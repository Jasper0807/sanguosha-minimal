import { create } from 'zustand';
import type {
  ChatMessage,
  ClientMessage,
  OnlineGamePayload,
  PlayerResponse,
  RoomConfig,
  RoomSnapshot,
  ServerMessage,
  TimerState
} from '@sgs/engine';
import {
  P2PGuestSession,
  P2PHostSession,
  WebSocketTransportClient,
  detectBestTransport,
  getForcedTransportFromUrl,
  type OnlineTransportClient,
  type TransportKind
} from '../p2p/p2pTransport';

export type WsConnectionStatus = 'disconnected' | 'connecting' | 'connected';

const NICKNAME_KEY = 'sgs_online_nickname';
const TOKEN_PREFIX = 'sgs_room_token_';

function getSavedNickname(): string {
  if (typeof window === 'undefined') return '侠客';
  return window.localStorage.getItem(NICKNAME_KEY) || '侠客';
}

function saveNickname(name: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(NICKNAME_KEY, name);
}

export function getSavedRoomToken(roomCode: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(`${TOKEN_PREFIX}${roomCode.toUpperCase()}`);
}

function saveRoomToken(roomCode: string, token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`${TOKEN_PREFIX}${roomCode.toUpperCase()}`, token);
}

function clearRoomToken(roomCode: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(`${TOKEN_PREFIX}${roomCode.toUpperCase()}`);
}

function updateUrlRoomParam(roomCode: string | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (roomCode) {
    url.searchParams.set('room', roomCode);
  } else {
    url.searchParams.delete('room');
  }
  window.history.replaceState({}, '', url.toString());
}

/**
 * Builds a clean invite URL that preserves GitHub Pages subpaths (e.g. `/sanguosha-minimal/`)
 * as well as root deployments (e.g. Render / Docker).
 */
export function buildRoomInviteUrl(roomCode: string): string {
  if (typeof window === 'undefined') return `?room=${roomCode}`;
  const url = new URL(window.location.href);
  const forcedTransport = getForcedTransportFromUrl();
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', roomCode);
  if (forcedTransport) {
    url.searchParams.set('transport', forcedTransport);
  }
  return url.toString();
}

interface OnlineStoreState {
  status: WsConnectionStatus;
  detectedTransport: TransportKind | null;
  activeTransport: TransportKind | null;
  isP2PHost: boolean;
  nickname: string;
  room: RoomSnapshot | null;
  gamePayload: OnlineGamePayload | null;
  timer: TimerState | null;
  serverTimeOffsetMs: number;
  errorMessage: string | null;
  infoNotice: string | null;
  muted: boolean;
  chatOpen: boolean;
  unreadChatCount: number;

  // Interactive tabletop selection state (online mode)
  selectedCardIds: number[];
  selectedTargetIds: string[];
  secondaryTargetId: string | null;
  activeSkillId: string | null;
  serpentSpearMode: boolean;
  woodenOxMode: boolean;
  skipSimilarNullification: boolean;

  // Actions
  probeTransport: () => Promise<TransportKind>;
  setNickname: (name: string) => void;
  setMuted: (muted: boolean) => void;
  setChatOpen: (open: boolean) => void;
  clearError: () => void;

  // Room lifecycle
  createRoom: (nickname: string, config?: Partial<RoomConfig>) => void;
  joinRoom: (roomCode: string, nickname: string, explicitToken?: string) => void;
  leaveRoom: () => void;
  swapSeat: (seatIndex: number) => void;
  setReady: (ready: boolean) => void;
  updateRoomConfig: (patch: Partial<RoomConfig>) => void;
  addAI: (seatIndex: number) => void;
  removeAI: (seatIndex: number) => void;
  kickSeat: (seatIndex: number) => void;
  transferHost: (seatIndex: number) => void;
  takeoverAI: (seatIndex: number) => void;
  startOnlineGame: () => void;
  rematchLobby: () => void;
  sendChat: (text: string) => void;

  // Tabletop actions
  toggleSelectCard: (cardId: number) => void;
  toggleSelectTarget: (targetId: string) => void;
  toggleActiveSkill: (skillId: string) => void;
  toggleSerpentSpearMode: () => void;
  toggleWoodenOxMode: () => void;
  setSkipSimilarNullification: (val: boolean) => void;
  clearSelection: () => void;
  confirmSelection: () => void;
  cancelPromptOrSelection: () => void;
  endPlayPhase: () => void;
  doubleClickCard: (cardId: number) => void;
  recastSelectedCard: () => void;
  respondOption: (optionId: string) => void;
  respondPlayerCard: (choiceIndex: number) => void;
  respondHarvestCard: (cardId: number) => void;
  respondGeneral: (generalId: string) => void;
  respondGuanxing: (topCardIds: number[], bottomCardIds: number[]) => void;
}

let activeClient: OnlineTransportClient | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false;
let lastRoomCode: string | null = null;
let lastNickname: string = getSavedNickname();
let reconnectAttempts = 0;
let connectNonce = 0;

function sendClientMsg(msg: ClientMessage): boolean {
  if (!activeClient) return false;
  return activeClient.send(msg);
}

function disposeActiveClient(): void {
  if (activeClient) {
    try {
      activeClient.close();
    } catch {
      // ignore
    }
    activeClient = null;
  }
}

function resetSelectionFields() {
  return {
    selectedCardIds: [] as number[],
    selectedTargetIds: [] as string[],
    secondaryTargetId: null as string | null,
    activeSkillId: null as string | null,
    serpentSpearMode: false,
    woodenOxMode: false,
    skipSimilarNullification: false
  };
}

export const useOnlineStore = create<OnlineStoreState>((set, get) => {
  const submitResponse = (response: PlayerResponse) => {
    const prompt = get().gamePayload?.view.pendingPrompt;
    if (!prompt) return;
    sendClientMsg({
      type: 'submit_action',
      promptId: prompt.promptId,
      response
    });
    set(resetSelectionFields());
  };

  const connectAndSend = (
    firstMessage: Extract<ClientMessage, { type: 'create_room' | 'join_room' }>
  ) => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    intentionalClose = false;

    const myNonce = ++connectNonce;
    disposeActiveClient();
    set({ status: 'connecting', errorMessage: null });

    void detectBestTransport().then((transport) => {
      if (myNonce !== connectNonce || intentionalClose) return;

      set({ detectedTransport: transport, activeTransport: transport });

      const callbacks = {
        onOpen: () => {
          if (myNonce !== connectNonce) return;
          reconnectAttempts = 0;
          set({
            status: 'connected',
            activeTransport: transport,
            isP2PHost: Boolean(activeClient?.isP2PHost),
            errorMessage: null
          });
        },
        onMessage: (msg: ServerMessage) => {
          if (myNonce !== connectNonce) return;
          handleServerMessage(msg);
        },
        onError: (message: string, fatal?: boolean) => {
          if (myNonce !== connectNonce) return;
          if (fatal) {
            intentionalClose = true;
            if (!get().room) {
              lastRoomCode = null;
            }
            disposeActiveClient();
            set({
              status: 'disconnected',
              activeTransport: null,
              isP2PHost: false,
              errorMessage: message,
              infoNotice: null
            });
          } else {
            set({ errorMessage: message });
          }
        },
        onClose: (reason?: string) => {
          if (myNonce !== connectNonce) return;
          const wasP2PHost = Boolean(activeClient?.isP2PHost);
          activeClient = null;
          set({ status: 'disconnected', isP2PHost: false });

          // Auto-reconnect into current room using saved playerToken (WS client or P2P guest)
          if (!intentionalClose && !wasP2PHost && lastRoomCode && reconnectAttempts < 5) {
            reconnectAttempts += 1;
            const codeToRejoin = lastRoomCode;
            const savedToken = getSavedRoomToken(codeToRejoin) ?? undefined;
            set({
              infoNotice: `${reason || '连接已断开'}，正在尝试自动重连（第 ${reconnectAttempts}/5 次）...`
            });
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              if (!intentionalClose && lastRoomCode === codeToRejoin) {
                connectAndSend({
                  type: 'join_room',
                  roomCode: codeToRejoin,
                  nickname: lastNickname,
                  playerToken: savedToken
                });
              }
            }, 1800);
          } else if (!intentionalClose && reconnectAttempts >= 5) {
            set({
              errorMessage: '重连失败：房间可能已关闭，请返回大厅重新加入或建房',
              infoNotice: null
            });
          }
        }
      };

      if (transport === 'p2p') {
        if (firstMessage.type === 'create_room') {
          activeClient = new P2PHostSession(firstMessage, callbacks);
          set({ isP2PHost: true });
        } else {
          activeClient = new P2PGuestSession(firstMessage, callbacks);
          set({ isP2PHost: false });
        }
      } else {
        activeClient = new WebSocketTransportClient(firstMessage, callbacks);
        set({ isP2PHost: false });
      }
    });
  };

  const handleServerMessage = (msg: ServerMessage) => {
    switch (msg.type) {
      case 'welcome': {
        lastRoomCode = msg.roomCode;
        if (!msg.isSpectator && msg.playerToken) {
          saveRoomToken(msg.roomCode, msg.playerToken);
        }
        updateUrlRoomParam(msg.roomCode);
        set({ errorMessage: null, infoNotice: null });
        break;
      }
      case 'room_state': {
        const offset = msg.room.timer.serverNowTs - Date.now();
        set((prev) => ({
          room: msg.room,
          timer: msg.room.timer,
          serverTimeOffsetMs: offset,
          gamePayload: msg.room.status === 'waiting' ? null : prev.gamePayload,
          ...(msg.room.status === 'waiting' ? resetSelectionFields() : {})
        }));
        break;
      }
      case 'game_view': {
        const offset = msg.payload.timer.serverNowTs - Date.now();
        const prevPromptId = get().gamePayload?.view.pendingPrompt?.promptId;
        const nextPromptId = msg.payload.view.pendingPrompt?.promptId;
        set({
          gamePayload: msg.payload,
          timer: msg.payload.timer,
          serverTimeOffsetMs: offset,
          ...(prevPromptId !== nextPromptId ? resetSelectionFields() : {})
        });
        break;
      }
      case 'timer_sync': {
        const offset = msg.timer.serverNowTs - Date.now();
        set({ timer: msg.timer, serverTimeOffsetMs: offset });
        break;
      }
      case 'chat_message': {
        set((prev) => {
          if (!prev.room) return prev;
          const nextChat: ChatMessage[] = [...prev.room.chat, msg.message].slice(-80);
          return {
            room: { ...prev.room, chat: nextChat },
            unreadChatCount: prev.chatOpen ? 0 : prev.unreadChatCount + 1
          };
        });
        break;
      }
      case 'error': {
        set({ errorMessage: msg.message });
        break;
      }
      case 'kicked': {
        const code = lastRoomCode;
        if (code) clearRoomToken(code);
        intentionalClose = true;
        connectNonce += 1;
        lastRoomCode = null;
        updateUrlRoomParam(null);
        disposeActiveClient();
        set({
          status: 'disconnected',
          activeTransport: null,
          isP2PHost: false,
          room: null,
          gamePayload: null,
          timer: null,
          errorMessage: msg.reason,
          ...resetSelectionFields()
        });
        break;
      }
      case 'pong':
        set({ serverTimeOffsetMs: msg.serverNowTs - Date.now() });
        break;
    }
  };

  return {
    status: 'disconnected',
    detectedTransport: null,
    activeTransport: null,
    isP2PHost: false,
    nickname: getSavedNickname(),
    room: null,
    gamePayload: null,
    timer: null,
    serverTimeOffsetMs: 0,
    errorMessage: null,
    infoNotice: null,
    muted: false,
    chatOpen: false,
    unreadChatCount: 0,

    ...resetSelectionFields(),

    probeTransport: async () => {
      const transport = await detectBestTransport();
      set({ detectedTransport: transport });
      return transport;
    },

    setNickname: (nickname) => {
      saveNickname(nickname);
      lastNickname = nickname;
      set({ nickname });
    },

    setMuted: (muted) => set({ muted }),

    setChatOpen: (chatOpen) =>
      set((prev) => ({
        chatOpen,
        unreadChatCount: chatOpen ? 0 : prev.unreadChatCount
      })),

    clearError: () => set({ errorMessage: null, infoNotice: null }),

    createRoom: (nickname, config) => {
      const cleaned = nickname.trim() || '房主';
      saveNickname(cleaned);
      lastNickname = cleaned;
      reconnectAttempts = 0;
      set({ nickname: cleaned, errorMessage: null, infoNotice: null });
      connectAndSend({ type: 'create_room', nickname: cleaned, config });
    },

    joinRoom: (roomCode, nickname, explicitToken) => {
      const code = roomCode.trim().toUpperCase();
      if (!code) {
        set({ errorMessage: '请输入 6 位房间码' });
        return;
      }
      const cleaned = nickname.trim() || '侠客';
      saveNickname(cleaned);
      lastNickname = cleaned;
      lastRoomCode = code;
      reconnectAttempts = 0;
      const token = explicitToken ?? getSavedRoomToken(code) ?? undefined;
      set({ nickname: cleaned, errorMessage: null, infoNotice: null });
      connectAndSend({ type: 'join_room', roomCode: code, nickname: cleaned, playerToken: token });
    },

    leaveRoom: () => {
      const code = get().room?.roomCode ?? lastRoomCode;
      if (code) clearRoomToken(code);
      intentionalClose = true;
      connectNonce += 1;
      lastRoomCode = null;
      reconnectAttempts = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      sendClientMsg({ type: 'leave_room' });
      disposeActiveClient();
      updateUrlRoomParam(null);
      set({
        status: 'disconnected',
        activeTransport: null,
        isP2PHost: false,
        room: null,
        gamePayload: null,
        timer: null,
        errorMessage: null,
        infoNotice: null,
        unreadChatCount: 0,
        ...resetSelectionFields()
      });
    },

    swapSeat: (targetSeatIndex) => sendClientMsg({ type: 'swap_seat', targetSeatIndex }),
    setReady: (ready) => sendClientMsg({ type: 'set_ready', ready }),
    updateRoomConfig: (patch) => sendClientMsg({ type: 'update_config', patch }),
    addAI: (seatIndex) => sendClientMsg({ type: 'add_ai', seatIndex }),
    removeAI: (seatIndex) => sendClientMsg({ type: 'remove_ai', seatIndex }),
    kickSeat: (seatIndex) => sendClientMsg({ type: 'kick_seat', seatIndex }),
    transferHost: (seatIndex) => sendClientMsg({ type: 'transfer_host', seatIndex }),
    takeoverAI: (seatIndex) => sendClientMsg({ type: 'takeover_ai', seatIndex }),
    startOnlineGame: () => sendClientMsg({ type: 'start_game' }),
    rematchLobby: () => sendClientMsg({ type: 'rematch_lobby' }),
    sendChat: (text) => {
      const trimmed = text.trim();
      if (trimmed) sendClientMsg({ type: 'send_chat', text: trimmed });
    },

    clearSelection: () => set(resetSelectionFields()),

    toggleActiveSkill: (skillId) => {
      const st = get();
      const prompt = st.gamePayload?.view.pendingPrompt;
      if (prompt?.type !== 'play_action') return;
      const skill = prompt.usableSkills.find((s) => s.skillId === skillId);
      if (!skill) return;

      if (skill.needsConfirmOnly) {
        submitResponse({
          type: 'play_action',
          action: { type: 'activate_skill', skillId, cardIds: [], targetIds: [] }
        });
        return;
      }
      const nextSkillId = st.activeSkillId === skillId ? null : skillId;
      set({
        ...resetSelectionFields(),
        activeSkillId: nextSkillId
      });
    },

    toggleSerpentSpearMode: () => {
      const active = !get().serpentSpearMode;
      set({ ...resetSelectionFields(), serpentSpearMode: active });
    },

    toggleWoodenOxMode: () => {
      const active = !get().woodenOxMode;
      set({ ...resetSelectionFields(), woodenOxMode: active });
    },

    setSkipSimilarNullification: (val) => set({ skipSimilarNullification: val }),

    toggleSelectCard: (cardId) => {
      const st = get();
      const prompt = st.gamePayload?.view.pendingPrompt;
      if (!prompt) return;

      if (prompt.type === 'play_action') {
        if (st.activeSkillId) {
          const skill = prompt.usableSkills.find((s) => s.skillId === st.activeSkillId);
          if (!skill || !skill.eligibleCardIds.includes(cardId)) return;
          const exists = st.selectedCardIds.includes(cardId);
          if (exists) {
            set({ selectedCardIds: st.selectedCardIds.filter((id) => id !== cardId) });
          } else if (skill.cardMax <= 1) {
            set({ selectedCardIds: [cardId] });
          } else if (st.selectedCardIds.length < skill.cardMax) {
            set({ selectedCardIds: [...st.selectedCardIds, cardId] });
          } else {
            set({ selectedCardIds: [...st.selectedCardIds.slice(1), cardId] });
          }
          return;
        }
        if (st.serpentSpearMode) {
          const exists = st.selectedCardIds.includes(cardId);
          const next = exists
            ? st.selectedCardIds.filter((id) => id !== cardId)
            : st.selectedCardIds.length < 2
              ? [...st.selectedCardIds, cardId]
              : [st.selectedCardIds[1], cardId];
          set({ selectedCardIds: next });
          return;
        }
        if (st.woodenOxMode) {
          set({ selectedCardIds: st.selectedCardIds[0] === cardId ? [] : [cardId] });
          return;
        }
        if (!prompt.playableCardIds.includes(cardId)) return;
        const isSame = st.selectedCardIds[0] === cardId;
        set({
          selectedCardIds: isSame ? [] : [cardId],
          selectedTargetIds: [],
          secondaryTargetId: null
        });
        return;
      }

      if (prompt.type === 'choose_card') {
        if (!prompt.eligibleCardIds.includes(cardId)) return;
        const exists = st.selectedCardIds.includes(cardId);
        const maxAllowed = st.serpentSpearMode && prompt.canUseSerpentSpear ? 2 : prompt.maxCount;
        if (exists) {
          set({ selectedCardIds: st.selectedCardIds.filter((id) => id !== cardId) });
        } else if (maxAllowed === 1) {
          set({ selectedCardIds: [cardId] });
        } else if (st.selectedCardIds.length < maxAllowed) {
          set({ selectedCardIds: [...st.selectedCardIds, cardId] });
        } else {
          set({ selectedCardIds: [...st.selectedCardIds.slice(1), cardId] });
        }
      }
    },

    toggleSelectTarget: (targetId) => {
      const st = get();
      const payload = st.gamePayload;
      const prompt = payload?.view.pendingPrompt;
      if (!prompt || !payload) return;

      if (prompt.type === 'play_action') {
        if (st.activeSkillId) {
          const skill = prompt.usableSkills.find((s) => s.skillId === st.activeSkillId);
          if (!skill || !skill.eligibleTargetIds.includes(targetId)) return;
          const exists = st.selectedTargetIds.includes(targetId);
          if (exists) {
            set({ selectedTargetIds: st.selectedTargetIds.filter((id) => id !== targetId) });
          } else if (skill.targetMax <= 1) {
            set({ selectedTargetIds: [targetId] });
          } else if (st.selectedTargetIds.length < skill.targetMax) {
            set({ selectedTargetIds: [...st.selectedTargetIds, targetId] });
          } else {
            set({ selectedTargetIds: [...st.selectedTargetIds.slice(1), targetId] });
          }
          return;
        }
        if (st.woodenOxMode || st.serpentSpearMode) {
          set({ selectedTargetIds: st.selectedTargetIds[0] === targetId ? [] : [targetId] });
          return;
        }
        const cardId = st.selectedCardIds[0];
        if (!cardId) return;
        const info = payload.playableInfos.find((i) => i.cardId === cardId);
        if (!info || !info.needsTarget) return;

        if (info.secondaryTargetsByPrimary) {
          const primary = st.selectedTargetIds[0];
          if (!primary) {
            if (info.eligibleTargetIds.includes(targetId)) {
              set({ selectedTargetIds: [targetId], secondaryTargetId: null });
            }
            return;
          }
          if (primary === targetId) {
            set({ selectedTargetIds: [], secondaryTargetId: null });
            return;
          }
          const validSecondaries = info.secondaryTargetsByPrimary[primary] ?? [];
          if (validSecondaries.includes(targetId)) {
            set({ secondaryTargetId: st.secondaryTargetId === targetId ? null : targetId });
          } else if (info.eligibleTargetIds.includes(targetId)) {
            set({ selectedTargetIds: [targetId], secondaryTargetId: null });
          }
          return;
        }

        if (!info.eligibleTargetIds.includes(targetId)) return;
        const exists = st.selectedTargetIds.includes(targetId);
        if (exists) {
          set({ selectedTargetIds: st.selectedTargetIds.filter((id) => id !== targetId) });
        } else if (info.maxTargets === 1) {
          set({ selectedTargetIds: [targetId] });
        } else if (st.selectedTargetIds.length < info.maxTargets) {
          set({ selectedTargetIds: [...st.selectedTargetIds, targetId] });
        }
        return;
      }

      if (prompt.type === 'choose_target') {
        if (!prompt.eligibleTargetIds.includes(targetId)) return;
        const exists = st.selectedTargetIds.includes(targetId);
        if (exists) {
          set({ selectedTargetIds: st.selectedTargetIds.filter((id) => id !== targetId) });
        } else if (prompt.maxCount === 1) {
          set({ selectedTargetIds: [targetId] });
        } else if (st.selectedTargetIds.length < prompt.maxCount) {
          set({ selectedTargetIds: [...st.selectedTargetIds, targetId] });
        }
      }
    },

    confirmSelection: () => {
      const st = get();
      const payload = st.gamePayload;
      const prompt = payload?.view.pendingPrompt;
      if (!prompt || !payload) return;

      if (prompt.type === 'play_action') {
        if (st.activeSkillId) {
          const skill = prompt.usableSkills.find((s) => s.skillId === st.activeSkillId);
          if (!skill) return;
          if (
            st.selectedCardIds.length < skill.cardMin ||
            st.selectedCardIds.length > skill.cardMax ||
            st.selectedTargetIds.length < skill.targetMin ||
            st.selectedTargetIds.length > skill.targetMax
          ) {
            return;
          }
          submitResponse({
            type: 'play_action',
            action: {
              type: 'activate_skill',
              skillId: skill.skillId,
              cardIds: st.selectedCardIds,
              targetIds: st.selectedTargetIds
            }
          });
          return;
        }
        if (st.serpentSpearMode) {
          if (st.selectedCardIds.length !== 2 || st.selectedTargetIds.length !== 1) return;
          submitResponse({
            type: 'play_action',
            action: {
              type: 'serpent_spear',
              cardIds: [st.selectedCardIds[0], st.selectedCardIds[1]],
              targetIds: st.selectedTargetIds
            }
          });
          return;
        }
        if (st.woodenOxMode) {
          if (st.selectedCardIds.length !== 1) return;
          submitResponse({
            type: 'play_action',
            action: {
              type: 'wooden_ox_stash',
              cardId: st.selectedCardIds[0],
              transferTargetId: st.selectedTargetIds[0]
            }
          });
          return;
        }
        const cardId = st.selectedCardIds[0];
        if (!cardId) return;
        const info = payload.playableInfos.find((i) => i.cardId === cardId);
        if (!info) return;
        if (info.needsTarget && st.selectedTargetIds.length < info.minTargets) return;
        if (info.secondaryTargetsByPrimary && !st.secondaryTargetId) return;
        submitResponse({
          type: 'play_action',
          action: {
            type: 'play_card',
            cardId,
            targetIds: st.selectedTargetIds,
            secondaryTargetId: st.secondaryTargetId ?? undefined
          }
        });
      } else if (prompt.type === 'choose_card') {
        const useSpear = Boolean(st.serpentSpearMode && prompt.canUseSerpentSpear);
        const required = useSpear ? 2 : prompt.minCount;
        if (st.selectedCardIds.length < required) return;
        submitResponse({
          type: 'choose_card',
          cardIds: st.selectedCardIds,
          useSerpentSpear: useSpear,
          skipSimilarTrickThisTurn: st.skipSimilarNullification
        });
      } else if (prompt.type === 'choose_target') {
        if (st.selectedTargetIds.length < prompt.minCount) return;
        submitResponse({
          type: 'choose_target',
          targetIds: st.selectedTargetIds
        });
      }
    },

    recastSelectedCard: () => {
      const st = get();
      const prompt = st.gamePayload?.view.pendingPrompt;
      if (prompt?.type !== 'play_action') return;
      const cardId = st.selectedCardIds[0];
      if (!cardId || !prompt.canRecastCardIds.includes(cardId)) return;
      submitResponse({
        type: 'play_action',
        action: { type: 'play_card', cardId, recast: true }
      });
    },

    doubleClickCard: (cardId) => {
      const st = get();
      const payload = st.gamePayload;
      const prompt = payload?.view.pendingPrompt;
      if (!prompt || !payload) return;

      if (
        prompt.type === 'play_action' &&
        !st.serpentSpearMode &&
        !st.woodenOxMode &&
        !st.activeSkillId
      ) {
        const info = payload.playableInfos.find((i) => i.cardId === cardId);
        if (info && !info.needsTarget) {
          submitResponse({ type: 'play_action', action: { type: 'play_card', cardId } });
        }
      } else if (
        prompt.type === 'choose_card' &&
        prompt.maxCount === 1 &&
        prompt.eligibleCardIds.includes(cardId)
      ) {
        submitResponse({ type: 'choose_card', cardIds: [cardId] });
      }
    },

    cancelPromptOrSelection: () => {
      const st = get();
      const prompt = st.gamePayload?.view.pendingPrompt;
      if (!prompt) return;

      if (
        st.selectedCardIds.length > 0 ||
        st.selectedTargetIds.length > 0 ||
        st.activeSkillId ||
        st.serpentSpearMode ||
        st.woodenOxMode
      ) {
        st.clearSelection();
        return;
      }

      if (prompt.type === 'choose_card' && prompt.optional) {
        submitResponse({
          type: 'choose_card',
          cardIds: [],
          cancelled: true,
          skipSimilarTrickThisTurn: st.skipSimilarNullification
        });
      } else if (prompt.type === 'choose_target' && prompt.optional) {
        submitResponse({ type: 'choose_target', targetIds: [], cancelled: true });
      }
    },

    endPlayPhase: () => {
      if (get().gamePayload?.view.pendingPrompt?.type !== 'play_action') return;
      submitResponse({ type: 'play_action', action: { type: 'end_play_phase' } });
    },

    respondOption: (optionId) => {
      if (get().gamePayload?.view.pendingPrompt?.type !== 'choose_option') return;
      submitResponse({ type: 'choose_option', optionId });
    },

    respondPlayerCard: (choiceIndex) => {
      if (get().gamePayload?.view.pendingPrompt?.type !== 'choose_player_card') return;
      submitResponse({ type: 'choose_player_card', choiceIndex });
    },

    respondHarvestCard: (cardId) => {
      if (get().gamePayload?.view.pendingPrompt?.type !== 'choose_harvest_card') return;
      submitResponse({ type: 'choose_harvest_card', cardId });
    },

    respondGeneral: (generalId) => {
      if (get().gamePayload?.view.pendingPrompt?.type !== 'choose_general') return;
      submitResponse({ type: 'choose_general', generalId });
    },

    respondGuanxing: (topCardIds, bottomCardIds) => {
      if (get().gamePayload?.view.pendingPrompt?.type !== 'choose_guanxing') return;
      submitResponse({ type: 'choose_guanxing', topCardIds, bottomCardIds });
    }
  };
});
