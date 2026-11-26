import { decideAIAction } from './ai/ruleAI.js';
import { GameEngine } from './core/engine.js';
import { getDistance, isInAttackRange } from './core/distance.js';
import { getAllPlayableCards, type PlayableCardInfo } from './core/targeting.js';
import type {
  GameConfig,
  GameMode,
  PlayerResponse,
  PromptRequest
} from './core/types.js';
import type {
  ChatMessage,
  ClientMessage,
  OnlineGamePayload,
  RoomConfig,
  RoomSeatInfo,
  RoomSnapshot,
  ServerMessage,
  TimerState
} from './protocol.js';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type WebCryptoLike = {
  getRandomValues(array: Uint8Array): Uint8Array;
};

function getRandomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const webCrypto = (globalThis as { crypto?: WebCryptoLike }).crypto;
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    webCrypto.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < length; i++) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

function randomHex(byteCount: number): string {
  const bytes = getRandomBytes(byteCount);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function randomInt(minOrMax: number, maybeMax?: number): number {
  const min = maybeMax === undefined ? 0 : minOrMax;
  const max = maybeMax === undefined ? minOrMax : maybeMax;
  const span = max - min;
  if (span <= 1) return min;

  const limit = Math.floor(0x100000000 / span) * span;
  const buf = new Uint8Array(4);
  const webCrypto = (globalThis as { crypto?: WebCryptoLike }).crypto;
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    for (let attempt = 0; attempt < 16; attempt++) {
      webCrypto.getRandomValues(buf);
      const val = (((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0);
      if (val < limit) {
        return min + (val % span);
      }
    }
  }
  return min + Math.floor(Math.random() * span);
}

/** Generate a random 6-character unambiguous room code (shared by WS server & P2P host). */
export function generateRoomCodeCandidate(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

export interface ClientConnection {
  id: string;
  send: (msg: ServerMessage) => void;
  close?: () => void;
}

export interface RoomManagerOptions {
  disconnectGraceMs?: number;
  idleRoomTtlMs?: number;
  defaultAiDelayMs?: number;
  /** Optional fixed room code (used by WebRTC P2P host to match claimed PeerJS signaling ID). */
  fixedRoomCode?: string;
  /** Whether host privilege can be transferred (disabled in browser-hosted P2P mode). */
  allowHostTransfer?: boolean;
}

interface InternalSeat {
  seatIndex: number;
  playerId: string;
  kind: 'empty' | 'human' | 'ai';
  name: string;
  ready: boolean;
  token: string | null;
  connId: string | null;
  connected: boolean;
  aiTakeover: boolean;
  disconnectDeadlineTs: number | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

interface InternalSpectator {
  id: string;
  token: string;
  connId: string;
  name: string;
}

interface InternalRoom {
  roomCode: string;
  status: 'waiting' | 'playing' | 'finished';
  config: RoomConfig;
  seats: InternalSeat[];
  spectators: InternalSpectator[];
  hostSeatIndex: number;
  engine: GameEngine | null;
  chat: ChatMessage[];
  promptTimer: ReturnType<typeof setTimeout> | null;
  promptDeadlineTs: number | null;
  promptTimerForId: string | null;
  aiStepTimer: ReturnType<typeof setTimeout> | null;
  lastActivityTs: number;
}

function getSeatCountForMode(mode: GameMode): number {
  if (mode === '1v1') return 2;
  if (mode === '2v2') return 4;
  return 5;
}

function sanitizeNickname(raw: string | undefined, fallback = '侠客'): string {
  const cleaned = (raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 16);
  return cleaned.length > 0 ? cleaned : fallback;
}

function makeEmptySeats(mode: GameMode): InternalSeat[] {
  const count = getSeatCountForMode(mode);
  return Array.from({ length: count }, (_, idx) => ({
    seatIndex: idx,
    playerId: `p${idx + 1}`,
    kind: 'empty',
    name: '',
    ready: false,
    token: null,
    connId: null,
    connected: false,
    aiTakeover: false,
    disconnectDeadlineTs: null,
    disconnectTimer: null
  }));
}

function buildSafeTimeoutResponse(prompt: PromptRequest): PlayerResponse {
  switch (prompt.type) {
    case 'play_action':
      return { type: 'play_action', action: { type: 'end_play_phase' } };
    case 'choose_card':
      return prompt.optional
        ? { type: 'choose_card', cardIds: [], cancelled: true }
        : { type: 'choose_card', cardIds: prompt.eligibleCardIds.slice(0, prompt.minCount) };
    case 'choose_target':
      return prompt.optional
        ? { type: 'choose_target', targetIds: [], cancelled: true }
        : { type: 'choose_target', targetIds: prompt.eligibleTargetIds.slice(0, prompt.minCount) };
    case 'choose_option':
      return {
        type: 'choose_option',
        optionId: prompt.options[prompt.options.length - 1].id
      };
    case 'choose_player_card':
      return { type: 'choose_player_card', choiceIndex: 0 };
    case 'choose_harvest_card': {
      const rem = prompt.pool.find((x) => !x.takenBy) ?? prompt.pool[0];
      return { type: 'choose_harvest_card', cardId: rem.card.id };
    }
    case 'choose_general':
      return { type: 'choose_general', generalId: prompt.candidates[0].id };
    case 'choose_guanxing':
      return {
        type: 'choose_guanxing',
        topCardIds: prompt.cards.map((c) => c.id),
        bottomCardIds: []
      };
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, InternalRoom>();
  private readonly connections = new Map<string, ClientConnection>();
  private readonly connRoomMap = new Map<string, string>();
  private readonly disconnectGraceMs: number;
  private readonly idleRoomTtlMs: number;
  private readonly defaultAiDelayMs: number;
  private readonly fixedRoomCode: string | null;
  private readonly allowHostTransfer: boolean;
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  constructor(options?: RoomManagerOptions) {
    this.disconnectGraceMs = options?.disconnectGraceMs ?? 30_000;
    this.idleRoomTtlMs = options?.idleRoomTtlMs ?? 30 * 60_000;
    this.defaultAiDelayMs = options?.defaultAiDelayMs ?? 450;
    this.fixedRoomCode = options?.fixedRoomCode?.trim().toUpperCase() || null;
    this.allowHostTransfer = options?.allowHostTransfer ?? true;

    this.cleanupInterval = setInterval(() => this.pruneIdleRooms(), 60_000);
    (this.cleanupInterval as unknown as { unref?: () => void })?.unref?.();
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  registerConnection(conn: ClientConnection): void {
    this.connections.set(conn.id, conn);
  }

  handleMessage(connId: string, msg: ClientMessage): void {
    const conn = this.connections.get(connId);
    if (!conn) return;

    switch (msg.type) {
      case 'ping':
        conn.send({ type: 'pong', serverNowTs: Date.now() });
        return;
      case 'create_room':
        this.handleCreateRoom(conn, msg.nickname, msg.config);
        return;
      case 'join_room':
        this.handleJoinRoom(conn, msg.roomCode, msg.nickname, msg.playerToken);
        return;
      case 'leave_room':
        this.handleLeaveRoom(connId, true);
        return;
      case 'swap_seat':
        this.handleSwapSeat(connId, msg.targetSeatIndex);
        return;
      case 'set_ready':
        this.handleSetReady(connId, msg.ready);
        return;
      case 'update_config':
        this.handleUpdateConfig(connId, msg.patch);
        return;
      case 'add_ai':
        this.handleAddAI(connId, msg.seatIndex);
        return;
      case 'remove_ai':
        this.handleRemoveAI(connId, msg.seatIndex);
        return;
      case 'kick_seat':
        this.handleKickSeat(connId, msg.seatIndex);
        return;
      case 'transfer_host':
        this.handleTransferHost(connId, msg.seatIndex);
        return;
      case 'takeover_ai':
        this.handleTakeoverAI(connId, msg.seatIndex);
        return;
      case 'start_game':
        this.handleStartGame(connId, msg.seed);
        return;
      case 'rematch_lobby':
        this.handleRematchLobby(connId);
        return;
      case 'submit_action':
        this.handleSubmitAction(connId, msg.promptId, msg.response);
        return;
      case 'send_chat':
        this.handleSendChat(connId, msg.text);
        return;
    }
  }

  handleDisconnect(connId: string): void {
    this.handleLeaveRoom(connId, false);
    this.connections.delete(connId);
  }

  dispose(): void {
    clearInterval(this.cleanupInterval);
    for (const room of this.rooms.values()) {
      this.clearRoomTimers(room);
    }
    this.rooms.clear();
    this.connections.clear();
    this.connRoomMap.clear();
  }

  private generateRoomCode(): string {
    if (this.fixedRoomCode && !this.rooms.has(this.fixedRoomCode)) {
      return this.fixedRoomCode;
    }
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = generateRoomCodeCandidate();
      if (!this.rooms.has(code)) return code;
    }
    return randomHex(3).toUpperCase();
  }

  private generateToken(): string {
    return randomHex(16);
  }

  private clearRoomTimers(room: InternalRoom): void {
    if (room.promptTimer) {
      clearTimeout(room.promptTimer);
      room.promptTimer = null;
    }
    room.promptDeadlineTs = null;
    room.promptTimerForId = null;
    if (room.aiStepTimer) {
      clearTimeout(room.aiStepTimer);
      room.aiStepTimer = null;
    }
    for (const seat of room.seats) {
      if (seat.disconnectTimer) {
        clearTimeout(seat.disconnectTimer);
        seat.disconnectTimer = null;
      }
    }
  }

  private getRoomForConn(connId: string): InternalRoom | null {
    const code = this.connRoomMap.get(connId);
    if (!code) return null;
    return this.rooms.get(code) ?? null;
  }

  private findSeatByConn(room: InternalRoom, connId: string): InternalSeat | null {
    return room.seats.find((s) => s.kind === 'human' && s.connId === connId) ?? null;
  }

  private isHostConn(room: InternalRoom, connId: string): boolean {
    const seat = room.seats[room.hostSeatIndex];
    return Boolean(seat && seat.kind === 'human' && seat.connId === connId);
  }

  private sendError(connId: string, code: string, message: string): void {
    this.connections.get(connId)?.send({ type: 'error', code, message });
  }

  private appendChat(
    room: InternalRoom,
    senderName: string,
    senderRole: ChatMessage['senderRole'],
    text: string
  ): void {
    const msg: ChatMessage = {
      id: `${Date.now()}_${randomInt(100000)}`,
      senderName,
      senderRole,
      text: text.trim().slice(0, 120),
      timestamp: Date.now()
    };
    if (!msg.text) return;
    room.chat.push(msg);
    if (room.chat.length > 80) {
      room.chat = room.chat.slice(-80);
    }
    this.broadcastToRoom(room, () => ({ type: 'chat_message', message: msg }));
  }

  private handleCreateRoom(
    conn: ClientConnection,
    rawNickname: string,
    partialConfig?: Partial<RoomConfig>
  ): void {
    // Detach from any previous room cleanly
    this.handleLeaveRoom(conn.id, true);

    const nickname = sanitizeNickname(rawNickname, '房主');
    const mode: GameMode = partialConfig?.mode ?? '1v1';
    const config: RoomConfig = {
      mode,
      deckVariant: partialConfig?.deckVariant ?? 'junzheng_161',
      generalPack: partialConfig?.generalPack ?? 'standard',
      freeGeneralPick: partialConfig?.freeGeneralPick ?? true,
      timerEnabled: partialConfig?.timerEnabled ?? false,
      timerSeconds: this.clampTimerSeconds(partialConfig?.timerSeconds ?? 20),
      aiDelayMs: Math.max(0, Math.min(3000, partialConfig?.aiDelayMs ?? this.defaultAiDelayMs))
    };

    const roomCode = this.generateRoomCode();
    const seats = makeEmptySeats(mode);
    const token = this.generateToken();
    seats[0] = {
      seatIndex: 0,
      playerId: 'p1',
      kind: 'human',
      name: nickname,
      ready: true,
      token,
      connId: conn.id,
      connected: true,
      aiTakeover: false,
      disconnectDeadlineTs: null,
      disconnectTimer: null
    };

    const room: InternalRoom = {
      roomCode,
      status: 'waiting',
      config,
      seats,
      spectators: [],
      hostSeatIndex: 0,
      engine: null,
      chat: [],
      promptTimer: null,
      promptDeadlineTs: null,
      promptTimerForId: null,
      aiStepTimer: null,
      lastActivityTs: Date.now()
    };

    this.rooms.set(roomCode, room);
    this.connRoomMap.set(conn.id, roomCode);

    conn.send({
      type: 'welcome',
      roomCode,
      playerToken: token,
      isSpectator: false,
      seatIndex: 0,
      playerId: 'p1'
    });
    this.appendChat(room, '系统', 'system', `${nickname} 创建了房间 ${roomCode}`);
    this.broadcastRoomState(room);
  }

  private handleJoinRoom(
    conn: ClientConnection,
    rawCode: string,
    rawNickname: string,
    playerToken?: string
  ): void {
    const roomCode = (rawCode ?? '').trim().toUpperCase();
    const room = this.rooms.get(roomCode);
    if (!room) {
      this.sendError(conn.id, 'ROOM_NOT_FOUND', `未找到房间 ${roomCode || '(空)'}，请检查房间号或链接`);
      return;
    }

    // Leave any other room first (unless rejoining the same room)
    if (this.connRoomMap.get(conn.id) && this.connRoomMap.get(conn.id) !== roomCode) {
      this.handleLeaveRoom(conn.id, true);
    }
    room.lastActivityTs = Date.now();
    const nickname = sanitizeNickname(rawNickname, '侠客');

    // 1. Check token reconnect into an existing human seat (works both in lobby and mid-game!)
    if (playerToken) {
      const existingSeat = room.seats.find(
        (s) => s.kind === 'human' && s.token === playerToken
      );
      if (existingSeat) {
        if (existingSeat.disconnectTimer) {
          clearTimeout(existingSeat.disconnectTimer);
          existingSeat.disconnectTimer = null;
        }
        // Detach stale connection if still registered
        if (existingSeat.connId && existingSeat.connId !== conn.id) {
          this.connRoomMap.delete(existingSeat.connId);
        }
        existingSeat.connId = conn.id;
        existingSeat.connected = true;
        const wasTakeover = existingSeat.aiTakeover;
        existingSeat.aiTakeover = false;
        existingSeat.disconnectDeadlineTs = null;
        if (room.status === 'waiting') {
          existingSeat.name = nickname;
        }
        this.connRoomMap.set(conn.id, roomCode);

        conn.send({
          type: 'welcome',
          roomCode,
          playerToken: existingSeat.token!,
          isSpectator: false,
          seatIndex: existingSeat.seatIndex,
          playerId: existingSeat.playerId
        });
        this.appendChat(
          room,
          '系统',
          'system',
          wasTakeover
            ? `${existingSeat.name} 重连成功，已收回座位控制权（取消 AI 托管）`
            : `${existingSeat.name} 已重新连接`
        );
        this.broadcastRoomState(room);
        if (room.engine) {
          this.sendGameViewToConn(room, conn.id);
          // Re-evaluate scheduler in case AI step was queued for this seat
          this.schedulePostStep(room);
        }
        return;
      }
    }

    // 2. If room is waiting and has an empty seat, seat the player!
    if (room.status === 'waiting') {
      const emptySeat = room.seats.find((s) => s.kind === 'empty');
      if (emptySeat) {
        const token = this.generateToken();
        emptySeat.kind = 'human';
        emptySeat.name = nickname;
        emptySeat.ready = false;
        emptySeat.token = token;
        emptySeat.connId = conn.id;
        emptySeat.connected = true;
        emptySeat.aiTakeover = false;
        emptySeat.disconnectDeadlineTs = null;
        this.connRoomMap.set(conn.id, roomCode);

        conn.send({
          type: 'welcome',
          roomCode,
          playerToken: token,
          isSpectator: false,
          seatIndex: emptySeat.seatIndex,
          playerId: emptySeat.playerId
        });
        this.appendChat(room, '系统', 'system', `${nickname} 加入了房间（${emptySeat.seatIndex + 1}号位）`);
        this.broadcastRoomState(room);
        return;
      }
    }

    // 3. Otherwise enter as Spectator (seat full or match already in progress)
    const specToken = this.generateToken();
    const spec: InternalSpectator = {
      id: `spec_${randomInt(1000000)}`,
      token: specToken,
      connId: conn.id,
      name: nickname
    };
    room.spectators = room.spectators.filter((s) => s.connId !== conn.id);
    room.spectators.push(spec);
    this.connRoomMap.set(conn.id, roomCode);

    conn.send({
      type: 'welcome',
      roomCode,
      playerToken: specToken,
      isSpectator: true,
      seatIndex: null,
      playerId: null
    });
    this.appendChat(room, '系统', 'system', `${nickname} 进入了观战席`);
    this.broadcastRoomState(room);
    if (room.engine) {
      this.sendGameViewToConn(room, conn.id);
    }
  }

  private handleLeaveRoom(connId: string, voluntary: boolean): void {
    const room = this.getRoomForConn(connId);
    if (!room) return;

    this.connRoomMap.delete(connId);
    room.lastActivityTs = Date.now();

    // Check if spectator
    const specIdx = room.spectators.findIndex((s) => s.connId === connId);
    if (specIdx !== -1) {
      const spec = room.spectators.splice(specIdx, 1)[0];
      this.appendChat(room, '系统', 'system', `观战者 ${spec.name} 离开了房间`);
      this.broadcastRoomState(room);
      this.cleanupRoomIfEmpty(room);
      return;
    }

    // Check if seated human
    const seat = room.seats.find((s) => s.kind === 'human' && s.connId === connId);
    if (!seat) return;

    seat.connId = null;
    seat.connected = false;

    if (room.status === 'waiting' || room.status === 'finished') {
      if (voluntary) {
        const leftName = seat.name;
        this.clearSeatToEmpty(seat);
        this.ensureValidHost(room);
        this.appendChat(room, '系统', 'system', `${leftName} 离开了房间`);
        this.broadcastRoomState(room);
        this.cleanupRoomIfEmpty(room);
      } else {
        // Short grace in waiting lobby so accidental page refresh keeps the seat!
        seat.disconnectDeadlineTs = Date.now() + this.disconnectGraceMs;
        seat.disconnectTimer = setTimeout(() => {
          seat.disconnectTimer = null;
          if (!seat.connected && (room.status === 'waiting' || room.status === 'finished')) {
            const leftName = seat.name;
            this.clearSeatToEmpty(seat);
            this.ensureValidHost(room);
            this.appendChat(room, '系统', 'system', `${leftName} 断线超时，已移出座位`);
            this.broadcastRoomState(room);
            this.cleanupRoomIfEmpty(room);
          }
        }, this.disconnectGraceMs);
        this.broadcastRoomState(room);
      }
      return;
    }

    // In-game disconnect: mark disconnected + start 30s grace period before automatic AI takeover
    if (voluntary) {
      seat.aiTakeover = true;
      seat.disconnectDeadlineTs = null;
      this.ensureLiveHostInGame(room);
      this.appendChat(room, '系统', 'system', `${seat.name} 主动离开对局，已由 AI 自动接管`);
      this.broadcastRoomState(room);
      this.schedulePostStep(room);
      this.cleanupRoomIfEmpty(room);
      return;
    }

    seat.disconnectDeadlineTs = Date.now() + this.disconnectGraceMs;
    this.appendChat(
      room,
      '系统',
      'system',
      `${seat.name} 已断线（保留 ${Math.round(this.disconnectGraceMs / 1000)} 秒重连宽限期，房主亦可立即切换 AI 托管）`
    );
    seat.disconnectTimer = setTimeout(() => {
      seat.disconnectTimer = null;
      if (!seat.connected && room.status === 'playing' && !seat.aiTakeover) {
        seat.aiTakeover = true;
        seat.disconnectDeadlineTs = null;
        this.ensureLiveHostInGame(room);
        this.appendChat(room, '系统', 'system', `${seat.name} 重连超时，已自动切换为 AI 托管（重连后可随时收回）`);
        this.broadcastRoomState(room);
        this.schedulePostStep(room);
      }
    }, this.disconnectGraceMs);
    this.broadcastRoomState(room);
  }

  private clearSeatToEmpty(seat: InternalSeat): void {
    if (seat.disconnectTimer) {
      clearTimeout(seat.disconnectTimer);
      seat.disconnectTimer = null;
    }
    seat.kind = 'empty';
    seat.name = '';
    seat.ready = false;
    seat.token = null;
    seat.connId = null;
    seat.connected = false;
    seat.aiTakeover = false;
    seat.disconnectDeadlineTs = null;
  }

  private ensureValidHost(room: InternalRoom): void {
    const current = room.seats[room.hostSeatIndex];
    if (current && current.kind === 'human') return;
    const nextHost =
      room.seats.find((s) => s.kind === 'human' && s.connected) ??
      room.seats.find((s) => s.kind === 'human');
    if (nextHost) {
      room.hostSeatIndex = nextHost.seatIndex;
      nextHost.ready = true;
      this.appendChat(room, '系统', 'system', `${nextHost.name} 自动成为新房主`);
    }
  }

  private ensureLiveHostInGame(room: InternalRoom): void {
    const current = room.seats[room.hostSeatIndex];
    if (current && current.kind === 'human' && current.connected) return;
    const nextLive = room.seats.find((s) => s.kind === 'human' && s.connected);
    if (nextLive) {
      room.hostSeatIndex = nextLive.seatIndex;
      this.appendChat(room, '系统', 'system', `房主掉线，权限临时移交至 ${nextLive.name}`);
    }
  }

  private cleanupRoomIfEmpty(room: InternalRoom): void {
    const hasConnectedHuman = room.seats.some((s) => s.kind === 'human' && s.connected);
    const hasPendingReconnect = room.seats.some((s) => s.kind === 'human' && s.disconnectTimer !== null);
    if (!hasConnectedHuman && !hasPendingReconnect && room.spectators.length === 0) {
      this.clearRoomTimers(room);
      this.rooms.delete(room.roomCode);
    }
  }

  private pruneIdleRooms(): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const hasConnected =
        room.seats.some((s) => s.kind === 'human' && s.connected) ||
        room.spectators.length > 0;
      if (!hasConnected && now - room.lastActivityTs > this.idleRoomTtlMs) {
        this.clearRoomTimers(room);
        this.rooms.delete(room.roomCode);
      }
    }
  }

  private handleSwapSeat(connId: string, targetSeatIndex: number): void {
    const room = this.getRoomForConn(connId);
    if (!room || room.status !== 'waiting') return;
    const target = room.seats[targetSeatIndex];
    if (!target || target.kind !== 'empty') {
      this.sendError(connId, 'SEAT_OCCUPIED', '该座位已被占用');
      return;
    }

    const fromSeat = this.findSeatByConn(room, connId);
    if (fromSeat) {
      const wasHost = room.hostSeatIndex === fromSeat.seatIndex;
      target.kind = 'human';
      target.name = fromSeat.name;
      target.ready = wasHost ? true : false;
      target.token = fromSeat.token;
      target.connId = fromSeat.connId;
      target.connected = true;
      target.aiTakeover = false;
      target.disconnectDeadlineTs = null;

      this.clearSeatToEmpty(fromSeat);
      if (wasHost) room.hostSeatIndex = target.seatIndex;

      this.connections.get(connId)?.send({
        type: 'welcome',
        roomCode: room.roomCode,
        playerToken: target.token!,
        isSpectator: false,
        seatIndex: target.seatIndex,
        playerId: target.playerId
      });
      this.broadcastRoomState(room);
      return;
    }

    // Spectator claiming an empty seat in waiting lobby!
    const specIdx = room.spectators.findIndex((s) => s.connId === connId);
    if (specIdx !== -1) {
      const spec = room.spectators.splice(specIdx, 1)[0];
      target.kind = 'human';
      target.name = spec.name;
      target.ready = false;
      target.token = spec.token;
      target.connId = spec.connId;
      target.connected = true;
      target.aiTakeover = false;
      target.disconnectDeadlineTs = null;

      this.connections.get(connId)?.send({
        type: 'welcome',
        roomCode: room.roomCode,
        playerToken: target.token,
        isSpectator: false,
        seatIndex: target.seatIndex,
        playerId: target.playerId
      });
      this.appendChat(room, '系统', 'system', `${spec.name} 从观战席入座（${target.seatIndex + 1}号位）`);
      this.broadcastRoomState(room);
    }
  }

  private handleSetReady(connId: string, ready: boolean): void {
    const room = this.getRoomForConn(connId);
    if (!room || room.status !== 'waiting') return;
    const seat = this.findSeatByConn(room, connId);
    if (!seat) return;
    seat.ready = seat.seatIndex === room.hostSeatIndex ? true : Boolean(ready);
    this.broadcastRoomState(room);
  }

  private clampTimerSeconds(sec: number): number {
    if (!Number.isFinite(sec)) return 20;
    return Math.max(1, Math.min(120, Math.round(sec)));
  }

  private handleUpdateConfig(connId: string, patch: Partial<RoomConfig>): void {
    const room = this.getRoomForConn(connId);
    if (!room) return;
    if (!this.isHostConn(room, connId)) {
      this.sendError(connId, 'FORBIDDEN', '仅房主可修改房间配置');
      return;
    }
    room.lastActivityTs = Date.now();

    // Live timer & AI delay changes are allowed ANYTIME (lobby OR mid-game!)
    let timerChanged = false;
    if (typeof patch.timerEnabled === 'boolean' && patch.timerEnabled !== room.config.timerEnabled) {
      room.config.timerEnabled = patch.timerEnabled;
      timerChanged = true;
    }
    if (typeof patch.timerSeconds === 'number') {
      const clamped = this.clampTimerSeconds(patch.timerSeconds);
      if (clamped !== room.config.timerSeconds) {
        room.config.timerSeconds = clamped;
        timerChanged = true;
      }
    }
    if (typeof patch.aiDelayMs === 'number' && Number.isFinite(patch.aiDelayMs)) {
      room.config.aiDelayMs = Math.max(0, Math.min(3000, Math.round(patch.aiDelayMs)));
    }

    // Lobby-only settings
    if (room.status === 'waiting') {
      if (patch.deckVariant === 'standard_ex' || patch.deckVariant === 'junzheng_161') {
        room.config.deckVariant = patch.deckVariant;
      }
      if (
        patch.generalPack === 'standard' ||
        patch.generalPack === 'limit_break' ||
        patch.generalPack === 'expansion' ||
        patch.generalPack === 'all' ||
        patch.generalPack === 'blank'
      ) {
        room.config.generalPack = patch.generalPack;
      }
      if (typeof patch.freeGeneralPick === 'boolean') {
        room.config.freeGeneralPick = patch.freeGeneralPick;
      }
      if (patch.mode && patch.mode !== room.config.mode) {
        this.resizeRoomForMode(room, patch.mode);
      }
    }

    if (room.status === 'playing' && timerChanged) {
      this.restartPromptTimer(room);
      this.appendChat(
        room,
        '系统',
        'system',
        room.config.timerEnabled
          ? `房主开启了操作倒计时（${room.config.timerSeconds} 秒）`
          : `房主关闭了操作倒计时`
      );
      this.broadcastTimerSync(room);
    }

    this.broadcastRoomState(room);
  }

  private resizeRoomForMode(room: InternalRoom, newMode: GameMode): void {
    const newCount = getSeatCountForMode(newMode);
    const oldHumans = room.seats.filter((s) => s.kind === 'human');
    const hostSeat = room.seats[room.hostSeatIndex];
    const nextSeats = makeEmptySeats(newMode);

    // Always place host at seat 0 first, then other seated humans
    const orderedHumans = hostSeat
      ? [hostSeat, ...oldHumans.filter((h) => h !== hostSeat)]
      : oldHumans;

    orderedHumans.forEach((h, idx) => {
      if (idx < newCount) {
        nextSeats[idx] = {
          ...h,
          seatIndex: idx,
          playerId: `p${idx + 1}`,
          ready: idx === 0 ? true : h.ready
        };
        if (h.connId) {
          this.connections.get(h.connId)?.send({
            type: 'welcome',
            roomCode: room.roomCode,
            playerToken: h.token!,
            isSpectator: false,
            seatIndex: idx,
            playerId: `p${idx + 1}`
          });
        }
      } else if (h.connId) {
        // Overflow human moved to spectator cleanly
        room.spectators.push({
          id: `spec_${randomInt(1000000)}`,
          token: h.token ?? this.generateToken(),
          connId: h.connId,
          name: h.name
        });
        this.connections.get(h.connId)?.send({
          type: 'welcome',
          roomCode: room.roomCode,
          playerToken: h.token ?? '',
          isSpectator: true,
          seatIndex: null,
          playerId: null
        });
      }
    });

    room.config.mode = newMode;
    room.seats = nextSeats;
    room.hostSeatIndex = 0;
  }

  private handleAddAI(connId: string, seatIndex: number): void {
    const room = this.getRoomForConn(connId);
    if (!room || room.status !== 'waiting') return;
    if (!this.isHostConn(room, connId)) {
      this.sendError(connId, 'FORBIDDEN', '仅房主可添加 AI');
      return;
    }
    const seat = room.seats[seatIndex];
    if (!seat || seat.kind !== 'empty') return;
    seat.kind = 'ai';
    seat.name = `AI ${seatIndex + 1}号`;
    seat.ready = true;
    seat.connected = true;
    seat.token = null;
    seat.connId = null;
    seat.aiTakeover = false;
    this.broadcastRoomState(room);
  }

  private handleRemoveAI(connId: string, seatIndex: number): void {
    const room = this.getRoomForConn(connId);
    if (!room || room.status !== 'waiting') return;
    if (!this.isHostConn(room, connId)) {
      this.sendError(connId, 'FORBIDDEN', '仅房主可移除 AI');
      return;
    }
    const seat = room.seats[seatIndex];
    if (!seat || seat.kind !== 'ai') return;
    this.clearSeatToEmpty(seat);
    this.broadcastRoomState(room);
  }

  private handleKickSeat(connId: string, seatIndex: number): void {
    const room = this.getRoomForConn(connId);
    if (!room || room.status !== 'waiting') return;
    if (!this.isHostConn(room, connId)) {
      this.sendError(connId, 'FORBIDDEN', '仅房主可踢出玩家');
      return;
    }
    if (seatIndex === room.hostSeatIndex) return;
    const seat = room.seats[seatIndex];
    if (!seat || seat.kind !== 'human') return;

    const kickedName = seat.name;
    const kickedConnId = seat.connId;
    this.clearSeatToEmpty(seat);
    if (kickedConnId) {
      this.connRoomMap.delete(kickedConnId);
      this.connections.get(kickedConnId)?.send({
        type: 'kicked',
        reason: '你已被房主移出房间'
      });
    }
    this.appendChat(room, '系统', 'system', `${kickedName} 已被房主移出房间`);
    this.broadcastRoomState(room);
  }

  private handleTransferHost(connId: string, seatIndex: number): void {
    const room = this.getRoomForConn(connId);
    if (!room) return;
    if (!this.allowHostTransfer) {
      this.sendError(connId, 'FORBIDDEN', 'P2P 房主托管模式暂不支持移交房主权限');
      return;
    }
    if (!this.isHostConn(room, connId)) {
      this.sendError(connId, 'FORBIDDEN', '仅房主可移交房主权限');
      return;
    }
    const target = room.seats[seatIndex];
    if (!target || target.kind !== 'human' || !target.connected) {
      this.sendError(connId, 'INVALID_TARGET', '只能移交房主给在线的真人玩家');
      return;
    }
    room.hostSeatIndex = seatIndex;
    target.ready = true;
    this.appendChat(room, '系统', 'system', `房主权限已移交至 ${target.name}`);
    this.broadcastRoomState(room);
  }

  private handleTakeoverAI(connId: string, seatIndex: number): void {
    const room = this.getRoomForConn(connId);
    if (!room || room.status !== 'playing') return;
    if (!this.isHostConn(room, connId)) {
      this.sendError(connId, 'FORBIDDEN', '仅房主可切换掉线玩家为 AI 托管');
      return;
    }
    const seat = room.seats[seatIndex];
    if (!seat || seat.kind !== 'human' || seat.connected) {
      this.sendError(connId, 'INVALID_TARGET', '仅可对已掉线的真人座位启用 AI 托管');
      return;
    }
    if (seat.disconnectTimer) {
      clearTimeout(seat.disconnectTimer);
      seat.disconnectTimer = null;
    }
    seat.aiTakeover = true;
    seat.disconnectDeadlineTs = null;
    this.appendChat(room, '系统', 'system', `房主已将掉线的 ${seat.name} 切换为 AI 托管（重连后可随时收回）`);
    this.broadcastRoomState(room);
    this.schedulePostStep(room);
  }

  private handleStartGame(connId: string, customSeed?: number): void {
    const room = this.getRoomForConn(connId);
    if (!room || room.status !== 'waiting') return;
    if (!this.isHostConn(room, connId)) {
      this.sendError(connId, 'FORBIDDEN', '仅房主可开始对局');
      return;
    }

    if (room.seats.some((s) => s.kind === 'empty')) {
      this.sendError(connId, 'SEATS_INCOMPLETE', '还有空位未填满，请等待好友加入或添加 AI 补位');
      return;
    }
    const unready = room.seats.find(
      (s) => s.kind === 'human' && s.seatIndex !== room.hostSeatIndex && !s.ready
    );
    if (unready) {
      this.sendError(connId, 'NOT_READY', `玩家 ${unready.name} 尚未准备`);
      return;
    }

    const seed =
      typeof customSeed === 'number' && Number.isFinite(customSeed)
        ? Math.floor(customSeed)
        : randomInt(1, 9999999);

    const gameConfig: GameConfig = {
      mode: room.config.mode,
      deckVariant: room.config.deckVariant,
      generalPack: room.config.generalPack,
      seed,
      seats: room.seats.map((s) => ({
        id: s.playerId,
        name: s.name,
        isAI: s.kind === 'ai'
      })),
      skipGeneralSelection: false,
      debug: {
        // Anti-cheat: strictly force revealAllHands = false in all online rooms!
        revealAllHands: false,
        freeGeneralPick: room.config.freeGeneralPick
      }
    };

    const engine = new GameEngine(gameConfig);
    engine.start();

    room.engine = engine;
    room.status = engine.state.result ? 'finished' : 'playing';
    room.lastActivityTs = Date.now();

    this.appendChat(room, '系统', 'system', `对局开始！（模式：${room.config.mode} · Seed ${seed}）`);
    this.broadcastRoomState(room);
    this.broadcastGameViews(room);
    this.schedulePostStep(room);
  }

  private handleRematchLobby(connId: string): void {
    const room = this.getRoomForConn(connId);
    if (!room) return;
    if (!this.isHostConn(room, connId)) {
      this.sendError(connId, 'FORBIDDEN', '仅房主可返回准备大厅');
      return;
    }
    this.clearRoomTimers(room);
    room.engine = null;
    room.status = 'waiting';
    for (const seat of room.seats) {
      if (seat.kind === 'human') {
        if (!seat.connected) {
          this.clearSeatToEmpty(seat);
        } else {
          seat.aiTakeover = false;
          seat.disconnectDeadlineTs = null;
          seat.ready = seat.seatIndex === room.hostSeatIndex;
        }
      }
    }
    this.ensureValidHost(room);
    this.appendChat(room, '系统', 'system', '房主已重置房间回到准备大厅，可准备开启下一局');
    this.broadcastRoomState(room);
  }

  private handleSubmitAction(connId: string, promptId: string, response: PlayerResponse): void {
    const room = this.getRoomForConn(connId);
    if (!room || room.status !== 'playing' || !room.engine) return;

    const seat = this.findSeatByConn(room, connId);
    if (!seat) {
      this.sendError(connId, 'NOT_PLAYER', '观战者无法执行对局操作');
      return;
    }

    const prompt = room.engine.state.pendingPrompt;
    if (!prompt) return;
    if (prompt.playerId !== seat.playerId || prompt.promptId !== promptId) {
      this.sendError(connId, 'STALE_PROMPT', '当前不轮到你操作或该响应已过期');
      return;
    }

    this.clearPromptAndAiTimers(room);
    room.lastActivityTs = Date.now();

    try {
      room.engine.submit(response);
    } catch (err) {
      this.sendError(
        connId,
        'INVALID_ACTION',
        err instanceof Error ? err.message : '操作无效'
      );
      this.schedulePostStep(room);
      return;
    }

    this.afterEngineStep(room);
  }

  private handleSendChat(connId: string, rawText: string): void {
    const room = this.getRoomForConn(connId);
    if (!room) return;
    const text = (rawText ?? '').trim().slice(0, 120);
    if (!text) return;
    room.lastActivityTs = Date.now();

    const seat = this.findSeatByConn(room, connId);
    if (seat) {
      this.appendChat(room, seat.name, 'player', text);
      return;
    }
    const spec = room.spectators.find((s) => s.connId === connId);
    if (spec) {
      this.appendChat(room, `${spec.name}(观战)`, 'spectator', text);
    }
  }

  private clearPromptAndAiTimers(room: InternalRoom): void {
    if (room.promptTimer) {
      clearTimeout(room.promptTimer);
      room.promptTimer = null;
    }
    room.promptDeadlineTs = null;
    room.promptTimerForId = null;
    if (room.aiStepTimer) {
      clearTimeout(room.aiStepTimer);
      room.aiStepTimer = null;
    }
  }

  private afterEngineStep(room: InternalRoom): void {
    if (!room.engine) return;
    if (room.engine.state.result) {
      this.clearPromptAndAiTimers(room);
      room.status = 'finished';
      this.appendChat(
        room,
        '系统',
        'system',
        `对局结束：${room.engine.state.result.winnerTeam} 获胜！（${room.engine.state.result.reason}）`
      );
      this.broadcastRoomState(room);
      this.broadcastGameViews(room);
      return;
    }

    this.broadcastGameViews(room);
    this.schedulePostStep(room);
  }

  private schedulePostStep(room: InternalRoom): void {
    if (room.status !== 'playing' || !room.engine || room.engine.state.result) return;
    const prompt = room.engine.state.pendingPrompt;
    if (!prompt) return;

    this.clearPromptAndAiTimers(room);

    const seat = room.seats.find((s) => s.playerId === prompt.playerId);
    const shouldRunAI = Boolean(seat && (seat.kind === 'ai' || seat.aiTakeover));

    if (shouldRunAI) {
      const promptId = prompt.promptId;
      room.aiStepTimer = setTimeout(() => {
        room.aiStepTimer = null;
        if (!room.engine || room.status !== 'playing') return;
        const cur = room.engine.state.pendingPrompt;
        if (!cur || cur.promptId !== promptId) return;
        // Re-check in case human reclaimed seat before delay elapsed
        const s = room.seats.find((x) => x.playerId === cur.playerId);
        if (!s || (s.kind !== 'ai' && !s.aiTakeover)) {
          this.restartPromptTimer(room);
          this.broadcastTimerSync(room);
          return;
        }
        const aiResp = decideAIAction(room.engine, cur.playerId);
        room.engine.submit(aiResp);
        this.afterEngineStep(room);
      }, room.config.aiDelayMs);
      this.broadcastTimerSync(room);
      return;
    }

    // Human prompt: start authoritative server countdown if enabled
    this.restartPromptTimer(room);
    this.broadcastTimerSync(room);
  }

  private restartPromptTimer(room: InternalRoom): void {
    if (room.promptTimer) {
      clearTimeout(room.promptTimer);
      room.promptTimer = null;
    }
    room.promptDeadlineTs = null;
    room.promptTimerForId = null;

    if (room.status !== 'playing' || !room.engine || !room.config.timerEnabled) return;
    const prompt = room.engine.state.pendingPrompt;
    if (!prompt) return;

    const seat = room.seats.find((s) => s.playerId === prompt.playerId);
    if (!seat || seat.kind === 'ai' || seat.aiTakeover) return;

    const promptId = prompt.promptId;
    const durationMs = room.config.timerSeconds * 1000;
    room.promptDeadlineTs = Date.now() + durationMs;
    room.promptTimerForId = promptId;

    room.promptTimer = setTimeout(() => {
      room.promptTimer = null;
      room.promptDeadlineTs = null;
      room.promptTimerForId = null;
      if (!room.engine || room.status !== 'playing') return;
      const cur = room.engine.state.pendingPrompt;
      if (!cur || cur.promptId !== promptId) return;
      const fallback = buildSafeTimeoutResponse(cur);
      room.engine.submit(fallback);
      this.afterEngineStep(room);
    }, durationMs);
  }

  private buildTimerState(room: InternalRoom): TimerState {
    return {
      enabled: room.config.timerEnabled,
      seconds: room.config.timerSeconds,
      promptId: room.promptTimerForId,
      deadlineTs: room.promptDeadlineTs,
      serverNowTs: Date.now()
    };
  }

  private buildRoomSnapshotFor(room: InternalRoom, connId: string): RoomSnapshot {
    const seat = this.findSeatByConn(room, connId);
    const spec = room.spectators.find((s) => s.connId === connId);

    const seats: RoomSeatInfo[] = room.seats.map((s) => ({
      seatIndex: s.seatIndex,
      playerId: s.playerId,
      kind: s.kind,
      name: s.name,
      ready: s.ready,
      isHost: s.seatIndex === room.hostSeatIndex && s.kind === 'human',
      connected: s.connected,
      aiTakeover: s.aiTakeover,
      disconnectDeadlineTs: s.disconnectDeadlineTs
    }));

    return {
      roomCode: room.roomCode,
      status: room.status,
      config: { ...room.config },
      seats,
      spectators: room.spectators.map((sp) => ({ id: sp.id, name: sp.name })),
      hostSeatIndex: room.hostSeatIndex,
      you: seat
        ? {
            seatIndex: seat.seatIndex,
            playerId: seat.playerId,
            isHost: seat.seatIndex === room.hostSeatIndex,
            isSpectator: false,
            name: seat.name
          }
        : {
            seatIndex: null,
            playerId: null,
            isHost: false,
            isSpectator: true,
            name: spec?.name ?? '观战者'
          },
      timer: this.buildTimerState(room),
      chat: [...room.chat]
    };
  }

  private buildOnlineGamePayload(
    room: InternalRoom,
    viewerId: string,
    canControl: boolean
  ): OnlineGamePayload {
    const engine = room.engine!;
    // STRICT ANTI-CHEAT: revealAllHands is ALWAYS false on the server!
    const view = engine.getClientView(viewerId, { revealAllHands: false });

    const rawPrompt = engine.state.pendingPrompt;
    const isMyPrompt = Boolean(canControl && rawPrompt && rawPrompt.playerId === viewerId);

    let playableInfos: PlayableCardInfo[] = [];
    let serpentSpearTargetIds: string[] = [];

    if (isMyPrompt && rawPrompt?.type === 'play_action') {
      playableInfos = getAllPlayableCards(engine.state, viewerId, engine.modifiers);
      if (rawPrompt.canUseSerpentSpear) {
        serpentSpearTargetIds = engine.state.players
          .filter(
            (p) =>
              p.alive &&
              p.id !== viewerId &&
              isInAttackRange(engine.state, viewerId, p.id, engine.modifiers)
          )
          .map((p) => p.id);
      }
    }

    const distancesFromViewer: Record<string, number> = {};
    const viewerSeat = engine.state.players.find((p) => p.id === viewerId);
    if (viewerSeat) {
      for (const p of engine.state.players) {
        if (p.id !== viewerId && p.alive) {
          const d = getDistance(engine.state, viewerId, p.id, engine.modifiers);
          if (Number.isFinite(d)) {
            distancesFromViewer[p.id] = d;
          }
        }
      }
    }

    let waitingMessage = '结算中...';
    if (engine.state.result) {
      waitingMessage = `${engine.state.result.winnerTeam} 获胜`;
    } else if (rawPrompt) {
      if (isMyPrompt) {
        waitingMessage = rawPrompt.message;
      } else if (rawPrompt.type === 'choose_card' && rawPrompt.reason === 'nullification') {
        // Anti-cheat: never reveal WHO holds Nullification!
        waitingMessage = '等待其他角色响应【无懈可击】...';
      } else {
        const promptPlayer = engine.state.players.find((p) => p.id === rawPrompt.playerId);
        waitingMessage = `等待 ${promptPlayer?.name ?? '其他玩家'} 操作...`;
      }
    }

    return {
      roomCode: room.roomCode,
      view,
      playableInfos,
      serpentSpearTargetIds,
      distancesFromViewer,
      canControl,
      waitingMessage,
      timer: this.buildTimerState(room)
    };
  }

  private broadcastToRoom(
    room: InternalRoom,
    buildMsg: (connId: string) => ServerMessage
  ): void {
    const connIds = new Set<string>();
    for (const s of room.seats) {
      if (s.kind === 'human' && s.connected && s.connId) {
        connIds.add(s.connId);
      }
    }
    for (const sp of room.spectators) {
      connIds.add(sp.connId);
    }
    for (const cid of connIds) {
      const conn = this.connections.get(cid);
      if (conn) {
        conn.send(buildMsg(cid));
      }
    }
  }

  private broadcastRoomState(room: InternalRoom): void {
    this.broadcastToRoom(room, (cid) => ({
      type: 'room_state',
      room: this.buildRoomSnapshotFor(room, cid)
    }));
  }

  private broadcastTimerSync(room: InternalRoom): void {
    const timer = this.buildTimerState(room);
    this.broadcastToRoom(room, () => ({ type: 'timer_sync', timer }));
  }

  private sendGameViewToConn(room: InternalRoom, connId: string): void {
    if (!room.engine) return;
    const conn = this.connections.get(connId);
    if (!conn) return;
    const seat = this.findSeatByConn(room, connId);
    const viewerId = seat ? seat.playerId : '__spectator__';
    const payload = this.buildOnlineGamePayload(room, viewerId, Boolean(seat));
    conn.send({ type: 'game_view', payload });
  }

  private broadcastGameViews(room: InternalRoom): void {
    if (!room.engine) return;
    for (const seat of room.seats) {
      if (seat.kind === 'human' && seat.connected && seat.connId) {
        this.sendGameViewToConn(room, seat.connId);
      }
    }
    for (const spec of room.spectators) {
      this.sendGameViewToConn(room, spec.connId);
    }
  }
}
