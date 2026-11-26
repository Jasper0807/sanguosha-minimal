import Peer, { type DataConnection } from 'peerjs';
import {
  RoomManager,
  generateRoomCodeCandidate,
  type ClientConnection,
  type ClientMessage,
  type ServerMessage
} from '@sgs/engine';

export type TransportKind = 'ws' | 'p2p';

export interface OnlineTransportClient {
  readonly kind: TransportKind;
  readonly isP2PHost: boolean;
  send(msg: ClientMessage): boolean;
  close(): void;
}

export interface TransportCallbacks {
  onOpen: () => void;
  onMessage: (msg: ServerMessage) => void;
  onError: (message: string, fatal?: boolean) => void;
  onClose: (reason?: string) => void;
}

const PEER_PREFIX = 'sgs-min-';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
];

let cachedAutoTransport: TransportKind | null = null;

export function getPeerIdForRoom(roomCode: string): string {
  return `${PEER_PREFIX}${roomCode.trim().toLowerCase()}`;
}

export function getForcedTransportFromUrl(): TransportKind | null {
  if (typeof window === 'undefined') return null;
  const param = new URLSearchParams(window.location.search).get('transport')?.toLowerCase();
  if (param === 'p2p' || param === 'ws') return param;
  return null;
}

/**
 * Automatically selects Authoritative WebSocket Server ('ws') when hosted with `@sgs/server`
 * (Docker / Render / Railway / local dev with server), or Zero-Server WebRTC P2P ('p2p')
 * on static hosts such as GitHub Pages.
 */
export async function detectBestTransport(): Promise<TransportKind> {
  const forced = getForcedTransportFromUrl();
  if (forced) return forced;
  if (cachedAutoTransport) return cachedAutoTransport;

  if (typeof window === 'undefined') return 'ws';
  const host = window.location.hostname.toLowerCase();
  if (
    window.location.protocol === 'file:' ||
    host.endsWith('.github.io') ||
    host.endsWith('.pages.dev') ||
    host.endsWith('.netlify.app')
  ) {
    cachedAutoTransport = 'p2p';
    return 'p2p';
  }

  // Probe local /health endpoint with a fast timeout
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 1200);
  try {
    const res = await fetch('/health', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal
    });
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (data && data.ok === true) {
        cachedAutoTransport = 'ws';
        return 'ws';
      }
    }
  } catch {
    // No backend server reachable -> fall back to zero-server WebRTC P2P
  } finally {
    window.clearTimeout(timer);
  }

  cachedAutoTransport = 'p2p';
  return 'p2p';
}

function parseIncomingMessage<T extends { type: string }>(raw: unknown): T | null {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (obj && typeof obj === 'object' && typeof (obj as { type?: unknown }).type === 'string') {
      return obj as T;
    }
  } catch {
    // ignore malformed payloads
  }
  return null;
}

/**
 * Browser-hosted P2P Room Host:
 * Runs the shared isomorphic `@sgs/engine` RoomManager in memory, connects the local host UI
 * over a zero-latency loopback, and accepts remote friends via PeerJS WebRTC DataChannels.
 */
export class P2PHostSession implements OnlineTransportClient {
  readonly kind = 'p2p' as const;
  readonly isP2PHost = true;

  private peer: Peer | null = null;
  private roomManager: RoomManager | null = null;
  private readonly dataConns = new Map<string, DataConnection>();
  private connSeq = 0;
  private closed = false;
  private ready = false;
  private readonly callbacks: TransportCallbacks;
  private readonly initialCreateMsg: Extract<ClientMessage, { type: 'create_room' }>;
  private readonly beforeUnloadHandler: (e: BeforeUnloadEvent) => void;

  constructor(
    initialCreateMsg: Extract<ClientMessage, { type: 'create_room' }>,
    callbacks: TransportCallbacks
  ) {
    this.initialCreateMsg = initialCreateMsg;
    this.callbacks = callbacks;
    this.beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      if (!this.closed) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    this.startWithRetry(0);
  }

  private startWithRetry(attempt: number): void {
    if (this.closed) return;
    const roomCode = generateRoomCodeCandidate();
    const peerId = getPeerIdForRoom(roomCode);

    const peer = new Peer(peerId, {
      config: { iceServers: ICE_SERVERS }
    });
    this.peer = peer;

    const openTimeout = window.setTimeout(() => {
      if (!this.ready && !this.closed) {
        this.callbacks.onError('连接 P2P 信令服务器超时，请检查网络后重试', true);
        this.close();
      }
    }, 12000);

    peer.on('open', () => {
      window.clearTimeout(openTimeout);
      if (this.closed) {
        peer.destroy();
        return;
      }

      const manager = new RoomManager({
        fixedRoomCode: roomCode,
        allowHostTransfer: false
      });
      this.roomManager = manager;

      // Register local zero-latency host loopback connection
      const hostConn: ClientConnection = {
        id: 'host_local',
        send: (serverMsg) => {
          queueMicrotask(() => {
            if (!this.closed) {
              this.callbacks.onMessage(serverMsg);
            }
          });
        }
      };
      manager.registerConnection(hostConn);

      // Guard against accidental host tab closure while hosting a P2P room
      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', this.beforeUnloadHandler);
      }

      this.ready = true;
      this.callbacks.onOpen();
      manager.handleMessage('host_local', this.initialCreateMsg);
    });

    peer.on('connection', (dataConn) => {
      if (this.closed || !this.roomManager) {
        try {
          dataConn.close();
        } catch {
          // ignore
        }
        return;
      }
      this.attachGuestDataConn(dataConn);
    });

    peer.on('disconnected', () => {
      // Keep signaling socket alive so friends can still join/reconnect mid-match
      if (!this.closed && !peer.destroyed) {
        window.setTimeout(() => {
          if (!this.closed && !peer.destroyed && peer.disconnected) {
            try {
              peer.reconnect();
            } catch {
              // ignore reconnect failure
            }
          }
        }, 1500);
      }
    });

    peer.on('error', (err) => {
      window.clearTimeout(openTimeout);
      if (this.closed) return;

      const errType = (err as { type?: string }).type ?? '';
      if (!this.ready && errType === 'unavailable-id' && attempt < 4) {
        try {
          peer.destroy();
        } catch {
          // ignore
        }
        this.startWithRetry(attempt + 1);
        return;
      }

      if (!this.ready) {
        this.callbacks.onError(
          `创建 P2P 房间失败（${errType || '网络异常'}），请稍后重试`,
          true
        );
        this.close();
      }
    });
  }

  private attachGuestDataConn(dataConn: DataConnection): void {
    const manager = this.roomManager;
    if (!manager) return;

    const connId = `p2p_${++this.connSeq}_${dataConn.peer}`;
    this.dataConns.set(connId, dataConn);

    let channelOpen = Boolean(dataConn.open);
    let disconnected = false;
    const pendingOutbox: ServerMessage[] = [];

    const clientConn: ClientConnection = {
      id: connId,
      send: (serverMsg) => {
        if (disconnected) return;
        if (channelOpen && dataConn.open) {
          try {
            dataConn.send(serverMsg);
          } catch {
            // ignore send failure on closing channel
          }
        } else {
          pendingOutbox.push(serverMsg);
        }
      },
      close: () => {
        try {
          dataConn.close();
        } catch {
          // ignore
        }
      }
    };

    manager.registerConnection(clientConn);

    const flushOutbox = () => {
      channelOpen = true;
      while (pendingOutbox.length > 0 && dataConn.open) {
        const msg = pendingOutbox.shift()!;
        try {
          dataConn.send(msg);
        } catch {
          break;
        }
      }
    };

    if (dataConn.open) {
      flushOutbox();
    } else {
      dataConn.on('open', flushOutbox);
    }

    dataConn.on('data', (raw) => {
      if (this.closed || disconnected) return;
      const msg = parseIncomingMessage<ClientMessage>(raw);
      if (!msg) return;
      this.roomManager?.handleMessage(connId, msg);
    });

    const handleDisconnect = () => {
      if (disconnected) return;
      disconnected = true;
      this.dataConns.delete(connId);
      this.roomManager?.handleDisconnect(connId);
    };

    dataConn.on('close', handleDisconnect);
    dataConn.on('error', handleDisconnect);
  }

  send(msg: ClientMessage): boolean {
    if (this.closed || !this.ready || !this.roomManager) return false;
    this.roomManager.handleMessage('host_local', msg);
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;

    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    }

    for (const conn of this.dataConns.values()) {
      try {
        conn.close();
      } catch {
        // ignore
      }
    }
    this.dataConns.clear();

    if (this.roomManager) {
      this.roomManager.dispose();
      this.roomManager = null;
    }

    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // ignore
      }
      this.peer = null;
    }
  }
}

/**
 * Browser P2P Room Guest:
 * Connects directly to the Host's PeerJS ID (`sgs-min-<roomcode>`) over WebRTC DataChannel
 * and exchanges the exact same `ClientMessage` / `ServerMessage` protocol as WebSocket mode.
 */
export class P2PGuestSession implements OnlineTransportClient {
  readonly kind = 'p2p' as const;
  readonly isP2PHost = false;

  private peer: Peer | null = null;
  private dataConn: DataConnection | null = null;
  private closed = false;
  private opened = false;
  private connectTimer: number | null = null;
  private readonly roomCode: string;
  private readonly initialJoinMsg: Extract<ClientMessage, { type: 'join_room' }>;
  private readonly callbacks: TransportCallbacks;

  constructor(
    initialJoinMsg: Extract<ClientMessage, { type: 'join_room' }>,
    callbacks: TransportCallbacks
  ) {
    this.roomCode = initialJoinMsg.roomCode.trim().toUpperCase();
    this.initialJoinMsg = initialJoinMsg;
    this.callbacks = callbacks;
    this.connect();
  }

  private connect(): void {
    const peer = new Peer({
      config: { iceServers: ICE_SERVERS }
    });
    this.peer = peer;

    this.connectTimer = window.setTimeout(() => {
      if (!this.opened && !this.closed) {
        this.callbacks.onError(
          `连接房间 ${this.roomCode} 超时：请确认房间码正确、房主仍在线，或稍后重试`,
          true
        );
        this.close();
      }
    }, 12000);

    peer.on('open', () => {
      if (this.closed) {
        peer.destroy();
        return;
      }

      const targetPeerId = getPeerIdForRoom(this.roomCode);
      const conn = peer.connect(targetPeerId, {
        reliable: true,
        serialization: 'json'
      });
      this.dataConn = conn;

      conn.on('open', () => {
        if (this.closed) {
          conn.close();
          return;
        }
        if (this.connectTimer !== null) {
          window.clearTimeout(this.connectTimer);
          this.connectTimer = null;
        }
        this.opened = true;
        this.callbacks.onOpen();
        conn.send(this.initialJoinMsg);
      });

      conn.on('data', (raw) => {
        if (this.closed) return;
        const msg = parseIncomingMessage<ServerMessage>(raw);
        if (msg) {
          this.callbacks.onMessage(msg);
        }
      });

      conn.on('close', () => {
        if (this.closed) return;
        this.closed = true;
        if (this.connectTimer !== null) {
          window.clearTimeout(this.connectTimer);
          this.connectTimer = null;
        }
        this.callbacks.onClose('与 P2P 房主的连接已断开');
      });

      conn.on('error', () => {
        if (this.closed) return;
        this.callbacks.onError('P2P 数据通道异常，正在尝试重连...', false);
      });
    });

    peer.on('error', (err) => {
      if (this.closed) return;
      if (this.connectTimer !== null) {
        window.clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      const errType = (err as { type?: string }).type ?? '';
      if (errType === 'peer-unavailable') {
        this.callbacks.onError(
          `未找到房间 ${this.roomCode}（房主未在线或已关闭页面），请核对 6 位房间码或邀请链接`,
          true
        );
        this.close();
        return;
      }
      this.callbacks.onError(
        `无法连接到房间 ${this.roomCode}（${errType || 'P2P 网络受限'}），请稍后重试`,
        !this.opened
      );
      if (!this.opened) {
        this.close();
      }
    });
  }

  send(msg: ClientMessage): boolean {
    if (this.closed || !this.dataConn || !this.dataConn.open) return false;
    try {
      this.dataConn.send(msg);
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.dataConn) {
      try {
        this.dataConn.close();
      } catch {
        // ignore
      }
      this.dataConn = null;
    }
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // ignore
      }
      this.peer = null;
    }
  }
}

/**
 * Authoritative WebSocket Client (used when `@sgs/server` backend is available).
 */
export class WebSocketTransportClient implements OnlineTransportClient {
  readonly kind = 'ws' as const;
  readonly isP2PHost = false;

  private ws: WebSocket | null = null;
  private closed = false;
  private pendingFirst: ClientMessage | null;
  private readonly callbacks: TransportCallbacks;

  constructor(firstMessage: ClientMessage, callbacks: TransportCallbacks) {
    this.pendingFirst = firstMessage;
    this.callbacks = callbacks;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      if (this.closed) {
        ws.close();
        return;
      }
      this.callbacks.onOpen();
      if (this.pendingFirst) {
        ws.send(JSON.stringify(this.pendingFirst));
        this.pendingFirst = null;
      }
    };

    ws.onmessage = (event) => {
      if (this.closed) return;
      const msg = parseIncomingMessage<ServerMessage>(String(event.data));
      if (msg) this.callbacks.onMessage(msg);
    };

    ws.onerror = () => {
      if (this.closed) return;
      this.callbacks.onError('无法连接联机服务器，请检查网络或切换至 P2P 免服务器联机');
    };

    ws.onclose = () => {
      if (this.closed) return;
      this.ws = null;
      this.callbacks.onClose('与联机服务器的连接已断开');
    };
  }

  send(msg: ClientMessage): boolean {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }
}
