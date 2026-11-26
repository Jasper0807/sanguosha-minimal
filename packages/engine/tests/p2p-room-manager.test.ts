import { describe, expect, it } from 'vitest';
import {
  RoomManager,
  generateRoomCodeCandidate,
  type ClientConnection,
  type ServerMessage
} from '../src/index.js';

function createVirtualPeer(id: string) {
  const inbox: ServerMessage[] = [];
  const conn: ClientConnection = {
    id,
    send: (msg) => {
      inbox.push(msg);
    }
  };
  return { conn, inbox };
}

describe('Isomorphic RoomManager (WebRTC P2P Host Mode)', () => {
  it('supports fixedRoomCode matching PeerJS ID, disables host transfer, hides opponent hands, and supports full match + rematch', () => {
    const code = generateRoomCodeCandidate();
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);

    const manager = new RoomManager({
      fixedRoomCode: code,
      allowHostTransfer: false,
      defaultAiDelayMs: 0
    });

    const host = createVirtualPeer('host_local');
    const guest = createVirtualPeer('p2p_1_peer_guest');
    manager.registerConnection(host.conn);
    manager.registerConnection(guest.conn);

    // 1. Host creates room using exact fixedRoomCode
    manager.handleMessage(host.conn.id, {
      type: 'create_room',
      nickname: '房主P2P',
      config: { mode: '1v1', generalPack: 'standard', freeGeneralPick: false }
    });

    const hostWelcome = host.inbox.find((m) => m.type === 'welcome');
    expect(hostWelcome?.type).toBe('welcome');
    if (hostWelcome?.type === 'welcome') {
      expect(hostWelcome.roomCode).toBe(code);
      expect(hostWelcome.seatIndex).toBe(0);
    }

    // 2. Guest joins via room code
    manager.handleMessage(guest.conn.id, {
      type: 'join_room',
      roomCode: code,
      nickname: '好友客机'
    });

    const guestWelcome = guest.inbox.find((m) => m.type === 'welcome');
    expect(guestWelcome?.type).toBe('welcome');
    if (guestWelcome?.type === 'welcome') {
      expect(guestWelcome.roomCode).toBe(code);
      expect(guestWelcome.seatIndex).toBe(1);
      expect(guestWelcome.isSpectator).toBe(false);
    }

    // 3. Host transfer is rejected cleanly in P2P host-hosted mode
    host.inbox.length = 0;
    manager.handleMessage(host.conn.id, { type: 'transfer_host', seatIndex: 1 });
    const forbidden = host.inbox.find((m) => m.type === 'error');
    expect(forbidden?.type).toBe('error');
    if (forbidden?.type === 'error') {
      expect(forbidden.code).toBe('FORBIDDEN');
    }

    // 4. Guest readies up and host starts 1v1 match
    manager.handleMessage(guest.conn.id, { type: 'set_ready', ready: true });
    host.inbox.length = 0;
    guest.inbox.length = 0;
    manager.handleMessage(host.conn.id, { type: 'start_game', seed: 42 });

    // Both receive choose_general prompts; submit picks
    const hostFirstView = [...host.inbox].reverse().find((m) => m.type === 'game_view');
    expect(hostFirstView?.type).toBe('game_view');
    if (hostFirstView?.type === 'game_view' && hostFirstView.payload.view.pendingPrompt?.type === 'choose_general') {
      const p1Prompt = hostFirstView.payload.view.pendingPrompt;
      manager.handleMessage(host.conn.id, {
        type: 'submit_action',
        promptId: p1Prompt.promptId,
        response: { type: 'choose_general', generalId: p1Prompt.candidates[0].id }
      });
    }

    const guestPickView = [...guest.inbox].reverse().find((m) => m.type === 'game_view');
    expect(guestPickView?.type).toBe('game_view');
    if (guestPickView?.type === 'game_view' && guestPickView.payload.view.pendingPrompt?.type === 'choose_general') {
      const p2Prompt = guestPickView.payload.view.pendingPrompt;
      manager.handleMessage(guest.conn.id, {
        type: 'submit_action',
        promptId: p2Prompt.promptId,
        response: { type: 'choose_general', generalId: p2Prompt.candidates[0].id }
      });
    }

    // 5. Verify opponent hand privacy is strictly enforced in guest's ClientView!
    const guestPlayView = [...guest.inbox].reverse().find((m) => m.type === 'game_view');
    expect(guestPlayView?.type).toBe('game_view');
    if (guestPlayView?.type === 'game_view') {
      const p1FromGuest = guestPlayView.payload.view.players.find((p) => p.id === 'p1');
      const p2FromGuest = guestPlayView.payload.view.players.find((p) => p.id === 'p2');
      expect(p1FromGuest?.hand).toBeNull();
      expect((p1FromGuest?.handCount ?? 0)).toBeGreaterThan(0);
      expect((p2FromGuest?.hand?.length ?? 0)).toBeGreaterThan(0);
    }

    // 6. Rematch returns cleanly to waiting lobby
    guest.inbox.length = 0;
    manager.handleMessage(host.conn.id, { type: 'rematch_lobby' });
    const lobbyState = [...guest.inbox].reverse().find((m) => m.type === 'room_state');
    expect(lobbyState?.type).toBe('room_state');
    if (lobbyState?.type === 'room_state') {
      expect(lobbyState.room.status).toBe('waiting');
      expect(lobbyState.room.roomCode).toBe(code);
    }

    manager.dispose();
  });
});
