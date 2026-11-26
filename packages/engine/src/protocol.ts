import type {
  ClientView,
  DeckVariant,
  GameMode,
  PlayerResponse
} from './core/types.js';
import type { PlayableCardInfo } from './core/targeting.js';

export const QUICK_CHAT_PHRASES = [
  '救救我！',
  '别无懈！',
  '快点吧~',
  '打得好！',
  '留桃救人！',
  '集火他！'
] as const;

export interface RoomConfig {
  mode: GameMode;
  deckVariant: DeckVariant;
  generalPack: 'standard' | 'blank';
  freeGeneralPick: boolean;
  timerEnabled: boolean;
  timerSeconds: number;
  aiDelayMs: number;
}

export interface RoomSeatInfo {
  seatIndex: number;
  playerId: string;
  kind: 'empty' | 'human' | 'ai';
  name: string;
  ready: boolean;
  isHost: boolean;
  connected: boolean;
  aiTakeover: boolean;
  disconnectDeadlineTs: number | null;
}

export interface RoomSpectatorInfo {
  id: string;
  name: string;
}

export interface ChatMessage {
  id: string;
  senderName: string;
  senderRole: 'player' | 'spectator' | 'system';
  text: string;
  timestamp: number;
}

export interface TimerState {
  enabled: boolean;
  seconds: number;
  promptId: string | null;
  deadlineTs: number | null;
  serverNowTs: number;
}

export interface RoomSelfInfo {
  seatIndex: number | null;
  playerId: string | null;
  isHost: boolean;
  isSpectator: boolean;
  name: string;
}

export interface RoomSnapshot {
  roomCode: string;
  status: 'waiting' | 'playing' | 'finished';
  config: RoomConfig;
  seats: RoomSeatInfo[];
  spectators: RoomSpectatorInfo[];
  hostSeatIndex: number;
  you: RoomSelfInfo;
  timer: TimerState;
  chat: ChatMessage[];
}

/**
 * Per-connection authoritative game state projection.
 * Strictly strips hidden hands, hidden roles, and opponent prompts.
 */
export interface OnlineGamePayload {
  roomCode: string;
  view: ClientView;
  playableInfos: PlayableCardInfo[];
  serpentSpearTargetIds: string[];
  distancesFromViewer: Record<string, number>;
  canControl: boolean;
  waitingMessage: string;
  timer: TimerState;
}

export type ClientMessage =
  | {
      type: 'create_room';
      nickname: string;
      config?: Partial<RoomConfig>;
    }
  | {
      type: 'join_room';
      roomCode: string;
      nickname: string;
      playerToken?: string;
    }
  | { type: 'leave_room' }
  | { type: 'swap_seat'; targetSeatIndex: number }
  | { type: 'set_ready'; ready: boolean }
  | { type: 'update_config'; patch: Partial<RoomConfig> }
  | { type: 'add_ai'; seatIndex: number }
  | { type: 'remove_ai'; seatIndex: number }
  | { type: 'kick_seat'; seatIndex: number }
  | { type: 'transfer_host'; seatIndex: number }
  | { type: 'takeover_ai'; seatIndex: number }
  | { type: 'start_game'; seed?: number }
  | { type: 'rematch_lobby' }
  | {
      type: 'submit_action';
      promptId: string;
      response: PlayerResponse;
    }
  | { type: 'send_chat'; text: string }
  | { type: 'ping' };

export type ServerMessage =
  | {
      type: 'welcome';
      roomCode: string;
      playerToken: string;
      isSpectator: boolean;
      seatIndex: number | null;
      playerId: string | null;
    }
  | { type: 'room_state'; room: RoomSnapshot }
  | { type: 'game_view'; payload: OnlineGamePayload }
  | { type: 'timer_sync'; timer: TimerState }
  | { type: 'chat_message'; message: ChatMessage }
  | { type: 'error'; code: string; message: string }
  | { type: 'kicked'; reason: string }
  | { type: 'pong'; serverNowTs: number };
