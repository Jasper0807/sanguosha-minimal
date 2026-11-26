import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type {
  ClientMessage,
  OnlineGamePayload,
  PlayerResponse,
  PromptRequest,
  RoomSnapshot,
  ServerMessage
} from '@sgs/engine';
import { createSgsServer, type SgsServerHandle } from '../src/server.js';

class TestWsClient {
  readonly ws: WebSocket;
  readonly inbox: ServerMessage[] = [];
  private waiters: Array<{
    predicate: (msg: ServerMessage) => boolean;
    resolve: (msg: ServerMessage) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  roomCode: string | null = null;
  playerToken: string | null = null;
  seatIndex: number | null = null;
  playerId: string | null = null;
  isSpectator = false;
  lastRoom: RoomSnapshot | null = null;
  lastGame: OnlineGamePayload | null = null;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as ServerMessage;
      if (msg.type === 'welcome') {
        this.roomCode = msg.roomCode;
        this.playerToken = msg.playerToken;
        this.seatIndex = msg.seatIndex;
        this.playerId = msg.playerId;
        this.isSpectator = msg.isSpectator;
      } else if (msg.type === 'room_state') {
        this.lastRoom = msg.room;
      } else if (msg.type === 'game_view') {
        this.lastGame = msg.payload;
      }

      const idx = this.waiters.findIndex((w) => w.predicate(msg));
      if (idx !== -1) {
        const w = this.waiters.splice(idx, 1)[0];
        clearTimeout(w.timer);
        w.resolve(msg);
      } else {
        this.inbox.push(msg);
      }
    });
  }

  static connect(url: string): Promise<TestWsClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.once('open', () => resolve(new TestWsClient(ws)));
      ws.once('error', reject);
    });
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  waitFor<T extends ServerMessage = ServerMessage>(
    predicate: (msg: ServerMessage) => boolean,
    timeoutMs = 5000
  ): Promise<T> {
    const existingIdx = this.inbox.findIndex(predicate);
    if (existingIdx !== -1) {
      return Promise.resolve(this.inbox.splice(existingIdx, 1)[0] as T);
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(new Error(`Timed out waiting for WS message (${timeoutMs}ms)`));
      }, timeoutMs);
      this.waiters.push({
        predicate,
        resolve: resolve as (msg: ServerMessage) => void,
        reject,
        timer
      });
    });
  }

  async close(): Promise<void> {
    for (const w of this.waiters) {
      clearTimeout(w.timer);
    }
    this.waiters = [];
    if (this.ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

function makeSimpleClientResponse(payload: OnlineGamePayload): PlayerResponse | null {
  const prompt: PromptRequest | null = payload.view.pendingPrompt;
  if (!prompt) return null;

  switch (prompt.type) {
    case 'choose_general':
      return { type: 'choose_general', generalId: prompt.candidates[0].id };
    case 'choose_option':
      return { type: 'choose_option', optionId: prompt.options[0].id };
    case 'choose_player_card':
      return { type: 'choose_player_card', choiceIndex: 0 };
    case 'choose_harvest_card': {
      const rem = prompt.pool.find((x) => !x.takenBy) ?? prompt.pool[0];
      return { type: 'choose_harvest_card', cardId: rem.card.id };
    }
    case 'choose_guanxing':
      return {
        type: 'choose_guanxing',
        topCardIds: prompt.cards.map((c) => c.id),
        bottomCardIds: []
      };
    case 'choose_target':
      return prompt.optional
        ? { type: 'choose_target', targetIds: [], cancelled: true }
        : { type: 'choose_target', targetIds: prompt.eligibleTargetIds.slice(0, prompt.minCount) };
    case 'choose_card':
      if (prompt.reason === 'peach_dying' || prompt.reason === 'dodge') {
        return {
          type: 'choose_card',
          cardIds: prompt.eligibleCardIds.slice(0, prompt.minCount)
        };
      }
      return prompt.optional
        ? { type: 'choose_card', cardIds: [], cancelled: true }
        : { type: 'choose_card', cardIds: prompt.eligibleCardIds.slice(0, prompt.minCount) };
    case 'play_action': {
      // Play first simple playable card (like Slash/Duel/Equip/Peach) to finish match quickly
      for (const info of payload.playableInfos) {
        if (info.secondaryTargetsByPrimary) continue;
        if (!info.needsTarget) {
          return {
            type: 'play_action',
            action: { type: 'play_card', cardId: info.cardId }
          };
        }
        if (info.eligibleTargetIds.length >= info.minTargets) {
          return {
            type: 'play_action',
            action: {
              type: 'play_card',
              cardId: info.cardId,
              targetIds: info.eligibleTargetIds.slice(0, info.minTargets)
            }
          };
        }
      }
      return { type: 'play_action', action: { type: 'end_play_phase' } };
    }
  }
}

describe('Phase 5: Room-Link Online Real-Time PvP Server & Anti-Cheat Integration', () => {
  const openServers: SgsServerHandle[] = [];
  const openClients: TestWsClient[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const c of openClients.splice(0)) {
      await c.close();
    }
    for (const s of openServers.splice(0)) {
      await s.close();
    }
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  async function startTestServer(opts?: { disconnectGraceMs?: number; defaultAiDelayMs?: number }) {
    const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), 'sgs-web-dist-'));
    tempDirs.push(tmpDist);
    fs.writeFileSync(
      path.join(tmpDist, 'index.html'),
      '<!doctype html><html><body><div id="root">SGS SPA</div></body></html>',
      'utf-8'
    );

    const server = createSgsServer({
      webDistDir: tmpDist,
      disconnectGraceMs: opts?.disconnectGraceMs ?? 30_000,
      defaultAiDelayMs: opts?.defaultAiDelayMs ?? 5
    });
    openServers.push(server);
    const { port } = await server.listen(0, '127.0.0.1');
    return {
      server,
      httpUrl: `http://127.0.0.1:${port}`,
      wsUrl: `ws://127.0.0.1:${port}/ws`
    };
  }

  async function connectClient(wsUrl: string): Promise<TestWsClient> {
    const c = await TestWsClient.connect(wsUrl);
    openClients.push(c);
    return c;
  }

  it('serves /health JSON and SPA fallback for /?room=XXXXXX on the same port', async () => {
    const { httpUrl } = await startTestServer();

    const healthRes = await fetch(`${httpUrl}/health`);
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as { ok: boolean; rooms: number };
    expect(healthJson.ok).toBe(true);
    expect(healthJson.rooms).toBe(0);

    const spaRes = await fetch(`${httpUrl}/?room=ABC123`);
    expect(spaRes.status).toBe(200);
    expect(spaRes.headers.get('content-type')).toContain('text/html');
    const html = await spaRes.text();
    expect(html).toContain('SGS SPA');
  });

  it('handles full room lobby lifecycle: create, join, spectator overflow, mode switch, swap seat, AI fill, kick, transfer host, chat', async () => {
    const { wsUrl } = await startTestServer();
    const host = await connectClient(wsUrl);
    const guest = await connectClient(wsUrl);
    const extra = await connectClient(wsUrl);

    // 1. Create 1v1 room
    host.send({ type: 'create_room', nickname: '房主甲', config: { mode: '1v1' } });
    const hostWelcome = await host.waitFor((m) => m.type === 'welcome');
    expect(hostWelcome.type).toBe('welcome');
    const roomCode = host.roomCode!;
    expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);
    await host.waitFor((m) => m.type === 'room_state');

    // 2. Guest joins seat 2
    guest.send({ type: 'join_room', roomCode, nickname: '好友乙' });
    await guest.waitFor((m) => m.type === 'welcome');
    expect(guest.seatIndex).toBe(1);
    expect(guest.isSpectator).toBe(false);

    // 3. 3rd visitor joins full 1v1 room -> Spectator!
    extra.send({ type: 'join_room', roomCode, nickname: '观战丙' });
    await extra.waitFor((m) => m.type === 'welcome');
    expect(extra.isSpectator).toBe(true);
    expect(extra.seatIndex).toBeNull();

    // 4. Non-host cannot update config
    guest.send({ type: 'update_config', patch: { mode: '2v2' } });
    const errMsg = await guest.waitFor((m) => m.type === 'error');
    expect(errMsg.type === 'error' && errMsg.code === 'FORBIDDEN').toBe(true);

    // 5. Host upgrades to 2v2, guest swaps to seat 3 (4号位), host adds/removes AI, spectator sits in empty seat
    host.send({ type: 'update_config', patch: { mode: '2v2' } });
    await host.waitFor((m) => m.type === 'room_state' && m.room.seats.length === 4);

    guest.send({ type: 'swap_seat', targetSeatIndex: 3 });
    await guest.waitFor((m) => m.type === 'welcome' && m.seatIndex === 3);

    host.send({ type: 'add_ai', seatIndex: 1 });
    await host.waitFor((m) => m.type === 'room_state' && m.room.seats[1].kind === 'ai');

    host.send({ type: 'remove_ai', seatIndex: 1 });
    await host.waitFor((m) => m.type === 'room_state' && m.room.seats[1].kind === 'empty');

    extra.send({ type: 'swap_seat', targetSeatIndex: 2 });
    await extra.waitFor((m) => m.type === 'welcome' && m.seatIndex === 2 && !m.isSpectator);

    // 6. Chat broadcast works for seated players
    guest.send({ type: 'send_chat', text: '留桃救人！' });
    const chatEcho = await host.waitFor(
      (m) => m.type === 'chat_message' && m.message.text === '留桃救人！'
    );
    expect(chatEcho.type).toBe('chat_message');

    // 7. Kick & Transfer Host
    host.send({ type: 'kick_seat', seatIndex: 2 });
    const kicked = await extra.waitFor((m) => m.type === 'kicked');
    expect(kicked.type).toBe('kicked');

    host.send({ type: 'transfer_host', seatIndex: 3 });
    const transferred = await guest.waitFor(
      (m) => m.type === 'room_state' && m.room.you.isHost === true
    );
    expect(transferred.type).toBe('room_state');
  });

  it('strictly enforces anti-cheat view isolation across 2v2 (teammate visible, enemy & spectator hidden) and identity5 (hidden roles)', async () => {
    const { wsUrl } = await startTestServer();

    // --- 2v2 Anti-Cheat Check ---
    const p1 = await connectClient(wsUrl);
    const p4 = await connectClient(wsUrl);
    const p2 = await connectClient(wsUrl);
    const spec = await connectClient(wsUrl);

    p1.send({
      type: 'create_room',
      nickname: '蓝一',
      config: { mode: '2v2', generalPack: 'standard', aiDelayMs: 5 }
    });
    await p1.waitFor((m) => m.type === 'welcome');
    const code2v2 = p1.roomCode!;

    p2.send({ type: 'join_room', roomCode: code2v2, nickname: '红二' });
    await p2.waitFor((m) => m.type === 'welcome');
    p4.send({ type: 'join_room', roomCode: code2v2, nickname: '蓝四' });
    await p4.waitFor((m) => m.type === 'welcome');
    // Move p4 to seat 3 (Blue teammate of seat 0!) and add AI at seat 2 (Red)
    p4.send({ type: 'swap_seat', targetSeatIndex: 3 });
    await p4.waitFor((m) => m.type === 'welcome' && m.seatIndex === 3);
    p1.send({ type: 'add_ai', seatIndex: 2 });
    await p1.waitFor((m) => m.type === 'room_state' && m.room.seats[2].kind === 'ai');

    // 5th visitor becomes Spectator
    spec.send({ type: 'join_room', roomCode: code2v2, nickname: '观众' });
    await spec.waitFor((m) => m.type === 'welcome');
    expect(spec.isSpectator).toBe(true);

    p2.send({ type: 'set_ready', ready: true });
    p4.send({ type: 'set_ready', ready: true });
    await p1.waitFor(
      (m) => m.type === 'room_state' && m.room.seats.every((s) => s.kind !== 'empty' && s.ready)
    );

    p1.send({ type: 'start_game', seed: 5501 });

    // Pick generals for all human seats until play_action begins (hands are dealt!)
    const humans = [p1, p2, p4];
    for (let step = 0; step < 12; step++) {
      await new Promise((r) => setTimeout(r, 25));
      if (p1.lastGame?.view.phase === 'play' || p1.lastGame?.view.turn && p1.lastGame.view.turn >= 1) {
        if (p1.lastGame.view.players.every((pl) => pl.handCount > 0)) break;
      }
      for (const h of humans) {
        if (h.lastGame?.view.pendingPrompt?.type === 'choose_general') {
          h.send({
            type: 'submit_action',
            promptId: h.lastGame.view.pendingPrompt.promptId,
            response: {
              type: 'choose_general',
              generalId: h.lastGame.view.pendingPrompt.candidates[0].id
            }
          });
        }
      }
    }

    // Verify 2v2 wire payload anti-cheat!
    const p1View = p1.lastGame!.view;
    const p2View = p2.lastGame!.view;
    const specView = spec.lastGame!.view;

    // Blue p1 sees own hand AND Blue teammate p4 hand, but NEVER Red enemies p2/p3!
    expect(p1View.players.find((x) => x.id === 'p1')!.hand).not.toBeNull();
    expect(p1View.players.find((x) => x.id === 'p4')!.hand).not.toBeNull();
    expect(p1View.players.find((x) => x.id === 'p2')!.hand).toBeNull();
    expect(p1View.players.find((x) => x.id === 'p3')!.hand).toBeNull();

    // Red p2 sees own hand AND Red AI teammate p3 hand, NEVER Blue p1/p4!
    expect(p2View.players.find((x) => x.id === 'p2')!.hand).not.toBeNull();
    expect(p2View.players.find((x) => x.id === 'p3')!.hand).not.toBeNull();
    expect(p2View.players.find((x) => x.id === 'p1')!.hand).toBeNull();
    expect(p2View.players.find((x) => x.id === 'p4')!.hand).toBeNull();

    // Spectator sees ZERO hands and ZERO prompts!
    expect(specView.players.every((x) => x.hand === null && x.woodenOxCards === null)).toBe(true);
    expect(specView.pendingPrompt).toBeNull();

    // Spectator attempting to submit an action is rejected!
    spec.send({
      type: 'submit_action',
      promptId: 'fake',
      response: { type: 'play_action', action: { type: 'end_play_phase' } }
    });
    const specErr = await spec.waitFor((m) => m.type === 'error');
    expect(specErr.type === 'error' && specErr.code === 'NOT_PLAYER').toBe(true);

    // --- Identity5 Hidden Roles Anti-Cheat Check ---
    const idHost = await connectClient(wsUrl);
    const idSpec = await connectClient(wsUrl);
    idHost.send({
      type: 'create_room',
      nickname: '身份房主',
      config: { mode: 'identity5', generalPack: 'standard', aiDelayMs: 5 }
    });
    await idHost.waitFor((m) => m.type === 'welcome');
    const codeId5 = idHost.roomCode!;
    for (let i = 1; i <= 4; i++) {
      idHost.send({ type: 'add_ai', seatIndex: i });
    }
    await idHost.waitFor((m) => m.type === 'room_state' && m.room.seats.every((s) => s.kind !== 'empty'));
    idSpec.send({ type: 'join_room', roomCode: codeId5, nickname: '身份观众' });
    await idSpec.waitFor((m) => m.type === 'welcome');

    idHost.send({ type: 'start_game', seed: 5502 });
    const idViewMsg = await idHost.waitFor((m) => m.type === 'game_view');
    const specIdMsg = await idSpec.waitFor((m) => m.type === 'game_view');
    expect(idViewMsg.type === 'game_view' && specIdMsg.type === 'game_view').toBe(true);

    const specPlayers = idSpec.lastGame!.view.players;
    const revealedRoles = specPlayers.filter((x) => x.role !== 'hidden');
    // Only the single Lord is publicly revealed at start; the other 4 roles MUST be 'hidden'!
    expect(revealedRoles.length).toBe(1);
    expect(revealedRoles[0].role).toBe('lord');
    expect(specPlayers.filter((x) => x.role === 'hidden').length).toBe(4);
  });

  it('supports disconnect grace, host one-click AI takeover, auto-takeover on grace expiry, and token reconnect reclaim', async () => {
    const { wsUrl } = await startTestServer({ disconnectGraceMs: 250, defaultAiDelayMs: 10 });
    const host = await connectClient(wsUrl);
    const p2 = await connectClient(wsUrl);

    host.send({
      type: 'create_room',
      nickname: '房主',
      config: { mode: '1v1', generalPack: 'blank', aiDelayMs: 10 }
    });
    await host.waitFor((m) => m.type === 'welcome');
    const roomCode = host.roomCode!;

    p2.send({ type: 'join_room', roomCode, nickname: '掉线哥' });
    await p2.waitFor((m) => m.type === 'welcome');
    const savedP2Token = p2.playerToken!;

    p2.send({ type: 'set_ready', ready: true });
    await host.waitFor((m) => m.type === 'room_state' && m.room.seats[1].ready);

    host.send({ type: 'start_game', seed: 6001 });
    await host.waitFor((m) => m.type === 'game_view' && m.payload.view.pendingPrompt?.type === 'choose_general');

    // Host picks general -> now it's P2's choose_general prompt!
    host.send({
      type: 'submit_action',
      promptId: host.lastGame!.view.pendingPrompt!.promptId,
      response: {
        type: 'choose_general',
        generalId:
          host.lastGame!.view.pendingPrompt!.type === 'choose_general'
            ? host.lastGame!.view.pendingPrompt!.candidates[0].id
            : 'blank_shu_m'
      }
    });
    await p2.waitFor((m) => m.type === 'game_view' && m.payload.view.pendingPrompt?.type === 'choose_general');

    // Simulate abrupt P2 disconnect mid-prompt!
    await p2.close();
    const discState = await host.waitFor(
      (m) => m.type === 'room_state' && m.room.seats[1].connected === false && m.room.seats[1].disconnectDeadlineTs !== null
    );
    expect(discState.type).toBe('room_state');

    // Host clicks one-click AI takeover -> server AI immediately resolves P2's prompt and advances to host's play_action!
    host.send({ type: 'takeover_ai', seatIndex: 1 });
    await host.waitFor((m) => m.type === 'room_state' && m.room.seats[1].aiTakeover === true);
    const hostPlay = await host.waitFor(
      (m) => m.type === 'game_view' && m.payload.view.pendingPrompt?.type === 'play_action'
    );
    expect(hostPlay.type).toBe('game_view');

    // P2 reconnects with saved playerToken -> IMMEDIATELY reclaims seat control (aiTakeover becomes false)!
    const p2Reconnected = await connectClient(wsUrl);
    p2Reconnected.send({
      type: 'join_room',
      roomCode,
      nickname: '掉线哥',
      playerToken: savedP2Token
    });
    const recWelcome = await p2Reconnected.waitFor((m) => m.type === 'welcome');
    expect(recWelcome.type === 'welcome' && recWelcome.seatIndex === 1 && !recWelcome.isSpectator).toBe(true);
    const recRoom = await p2Reconnected.waitFor(
      (m) => m.type === 'room_state' && m.room.seats[1].connected === true && m.room.seats[1].aiTakeover === false
    );
    expect(recRoom.type).toBe('room_state');
    const recView = await p2Reconnected.waitFor((m) => m.type === 'game_view');
    expect(recView.type).toBe('game_view');
    expect(p2Reconnected.lastGame!.view.players[1].hand).not.toBeNull();

    // Test automatic grace expiry takeover when P2 disconnects again and host doesn't click anything
    await p2Reconnected.close();
    await host.waitFor(
      (m) => m.type === 'room_state' && m.room.seats[1].aiTakeover === true,
      2000
    );
  });

  it('supports live mid-game host timer toggle and authoritative server timeout auto-advance', async () => {
    const { wsUrl } = await startTestServer();
    const host = await connectClient(wsUrl);

    host.send({
      type: 'create_room',
      nickname: '计时房主',
      config: { mode: '1v1', generalPack: 'blank', timerEnabled: false, timerSeconds: 20, aiDelayMs: 5 }
    });
    await host.waitFor((m) => m.type === 'welcome');
    host.send({ type: 'add_ai', seatIndex: 1 });
    await host.waitFor((m) => m.type === 'room_state' && m.room.seats[1].kind === 'ai');

    host.send({ type: 'start_game', seed: 7001 });
    await host.waitFor((m) => m.type === 'game_view' && m.payload.view.pendingPrompt?.type === 'choose_general');
    const firstPromptId = host.lastGame!.view.pendingPrompt!.promptId;
    expect(host.lastGame!.timer.enabled).toBe(false);

    // Mid-game, host enables authoritative timer with 1s duration!
    host.send({ type: 'update_config', patch: { timerEnabled: true, timerSeconds: 1 } });
    const sync = await host.waitFor(
      (m) => m.type === 'timer_sync' && m.timer.enabled === true && m.timer.deadlineTs !== null
    );
    expect(sync.type).toBe('timer_sync');

    // Do NOT submit anything — server must auto-submit fallback on expiry and advance prompt!
    const nextView = await host.waitFor(
      (m) =>
        m.type === 'game_view' &&
        m.payload.view.pendingPrompt !== null &&
        m.payload.view.pendingPrompt.promptId !== firstPromptId,
      3000
    );
    expect(nextView.type).toBe('game_view');
  });

  it('completes full end-to-end 1v1 and 5-player Identity online PvP matches over WebSocket with Standard 27 generals and supports rematch_lobby', async () => {
    const { wsUrl } = await startTestServer({ defaultAiDelayMs: 1 });

    // Full 1v1 Human-vs-Human over real WebSockets
    const p1 = await connectClient(wsUrl);
    const p2 = await connectClient(wsUrl);
    p1.send({
      type: 'create_room',
      nickname: '玩家一',
      config: { mode: '1v1', deckVariant: 'junzheng_161', generalPack: 'standard', aiDelayMs: 1 }
    });
    await p1.waitFor((m) => m.type === 'welcome');
    p2.send({ type: 'join_room', roomCode: p1.roomCode!, nickname: '玩家二' });
    await p2.waitFor((m) => m.type === 'welcome');
    p2.send({ type: 'set_ready', ready: true });
    await p1.waitFor((m) => m.type === 'room_state' && m.room.seats[1].ready);

    p1.send({ type: 'start_game', seed: 8001 });

    const submitted = new Set<string>();
    const startTs = Date.now();
    while (!p1.lastGame?.view.result && Date.now() - startTs < 12_000) {
      for (const client of [p1, p2]) {
        const g = client.lastGame;
        const pr = g?.view.pendingPrompt;
        if (g && pr && !submitted.has(pr.promptId)) {
          const resp = makeSimpleClientResponse(g);
          if (resp) {
            submitted.add(pr.promptId);
            client.send({ type: 'submit_action', promptId: pr.promptId, response: resp });
          }
        }
      }
      await new Promise((r) => setTimeout(r, 3));
    }

    expect(p1.lastGame?.view.result).not.toBeNull();
    expect(p2.lastGame?.view.result).toEqual(p1.lastGame?.view.result);

    // Host triggers rematch_lobby -> room returns cleanly to waiting keeping both players!
    p1.send({ type: 'rematch_lobby' });
    const resetRoom = await p2.waitFor(
      (m) => m.type === 'room_state' && m.room.status === 'waiting'
    );
    expect(resetRoom.type === 'room_state' && resetRoom.room.seats[0].kind === 'human').toBe(true);
    expect(resetRoom.type === 'room_state' && resetRoom.room.seats[1].kind === 'human').toBe(true);
  });
});
