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

function getWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

interface OnlineStoreState {
  status: WsConnectionStatus;
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

let activeSocket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false;
let lastRoomCode: string | null = null;
let lastNickname: string = getSavedNickname();
let pendingOnOpenMessage: ClientMessage | null = null;

function sendWs(msg: ClientMessage): boolean {
  if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) return false;
  activeSocket.send(JSON.stringify(msg));
  return true;
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
    sendWs({
      type: 'submit_action',
      promptId: prompt.promptId,
      response
    });
    set(resetSelectionFields());
  };

  const connectAndSend = (firstMessage: ClientMessage) => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    intentionalClose = false;

    if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
      activeSocket.send(JSON.stringify(firstMessage));
      return;
    }

    if (activeSocket) {
      try {
        activeSocket.onclose = null;
        activeSocket.close();
      } catch {
        // ignore
      }
      activeSocket = null;
    }

    pendingOnOpenMessage = firstMessage;
    set({ status: 'connecting', errorMessage: null });

    const ws = new WebSocket(getWsUrl());
    activeSocket = ws;

    ws.onopen = () => {
      set({ status: 'connected', errorMessage: null });
      if (pendingOnOpenMessage) {
        ws.send(JSON.stringify(pendingOnOpenMessage));
        pendingOnOpenMessage = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as ServerMessage;
        handleServerMessage(msg);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onerror = () => {
      set({
        errorMessage: '无法连接联机服务器，请确认已启动统一服务端（pnpm server:start）'
      });
    };

    ws.onclose = () => {
      activeSocket = null;
      set({ status: 'disconnected' });
      // Auto-reconnect into current room using saved playerToken!
      if (!intentionalClose && lastRoomCode) {
        const codeToRejoin = lastRoomCode;
        const savedToken = getSavedRoomToken(codeToRejoin) ?? undefined;
        set({ infoNotice: '连接已断开，正在尝试自动重连...' });
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
      }
    };
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
        lastRoomCode = null;
        updateUrlRoomParam(null);
        activeSocket?.close();
        activeSocket = null;
        set({
          status: 'disconnected',
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
      set({ nickname: cleaned, errorMessage: null });
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
      const token = explicitToken ?? getSavedRoomToken(code) ?? undefined;
      set({ nickname: cleaned, errorMessage: null });
      connectAndSend({ type: 'join_room', roomCode: code, nickname: cleaned, playerToken: token });
    },

    leaveRoom: () => {
      const code = get().room?.roomCode ?? lastRoomCode;
      if (code) clearRoomToken(code);
      intentionalClose = true;
      lastRoomCode = null;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      sendWs({ type: 'leave_room' });
      try {
        activeSocket?.close();
      } catch {
        // ignore
      }
      activeSocket = null;
      updateUrlRoomParam(null);
      set({
        status: 'disconnected',
        room: null,
        gamePayload: null,
        timer: null,
        errorMessage: null,
        infoNotice: null,
        unreadChatCount: 0,
        ...resetSelectionFields()
      });
    },

    swapSeat: (targetSeatIndex) => sendWs({ type: 'swap_seat', targetSeatIndex }),
    setReady: (ready) => sendWs({ type: 'set_ready', ready }),
    updateRoomConfig: (patch) => sendWs({ type: 'update_config', patch }),
    addAI: (seatIndex) => sendWs({ type: 'add_ai', seatIndex }),
    removeAI: (seatIndex) => sendWs({ type: 'remove_ai', seatIndex }),
    kickSeat: (seatIndex) => sendWs({ type: 'kick_seat', seatIndex }),
    transferHost: (seatIndex) => sendWs({ type: 'transfer_host', seatIndex }),
    takeoverAI: (seatIndex) => sendWs({ type: 'takeover_ai', seatIndex }),
    startOnlineGame: () => sendWs({ type: 'start_game' }),
    rematchLobby: () => sendWs({ type: 'rematch_lobby' }),
    sendChat: (text) => {
      const trimmed = text.trim();
      if (trimmed) sendWs({ type: 'send_chat', text: trimmed });
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
