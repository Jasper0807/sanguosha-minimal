import { create } from 'zustand';
import {
  decideAIAction,
  GameEngine,
  getAllPlayableCards,
  type CardInstance,
  type ClientView,
  type DeckVariant,
  type GameConfig,
  type GameMode,
  type GeneralPackSelection,
  type PlayableCardInfo,
  type PlayerResponse,
  type SeatConfig
} from '@sgs/engine';

import type { InspectedSkill } from '../components/SkillDetailModal';

export type ScreenMode = 'lobby' | 'table' | 'summary';
export type AISpeed = 'instant' | 'fast' | 'normal' | 'slow';
export type AIDecider = (engine: GameEngine, playerId: string) => PlayerResponse;

export interface HostSettings {
  timerEnabled: boolean;
  timerSeconds: number;
  aiSpeed: AISpeed;
  revealAllHands: boolean;
  freeGeneralPick: boolean;
}

interface GameStoreState {
  screen: ScreenMode;
  theme: 'light' | 'dark';
  mode: GameMode;
  deckVariant: DeckVariant;
  generalPack: GeneralPackSelection;
  seed: number;
  seats: SeatConfig[];
  hostSettings: HostSettings;

  engine: GameEngine | null;
  viewerId: string;
  view: ClientView | null;
  playableInfos: PlayableCardInfo[];

  // Interactive selection state
  selectedCardIds: number[];
  selectedTargetIds: string[];
  secondaryTargetId: string | null;
  activeSkillId: string | null;
  serpentSpearMode: boolean;
  woodenOxMode: boolean;
  skipSimilarNullification: boolean;

  // UI overlays
  inspectCard: CardInstance | null;
  inspectSkill: InspectedSkill | null;
  showRulesModal: boolean;
  showLogDrawer: boolean;

  // Optional AI decider plug-in (populated in Phase 3)
  aiDecider: AIDecider | null;

  // Config & Host Actions
  toggleTheme: () => void;
  setMode: (mode: GameMode) => void;
  setDeckVariant: (variant: DeckVariant) => void;
  setGeneralPack: (pack: GeneralPackSelection) => void;
  setSeed: (seed: number) => void;
  randomizeSeed: () => void;
  updateSeat: (index: number, patch: Partial<SeatConfig>) => void;
  setAllOpponentsAI: (isAI: boolean) => void;
  updateHostSettings: (patch: Partial<HostSettings>) => void;
  registerAIDecider: (decider: AIDecider) => void;

  // Game lifecycle
  startNewGame: (overrideConfig?: Partial<GameConfig>) => void;
  returnToLobby: () => void;
  rematch: () => void;

  // Interaction
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
  handleTimeout: () => void;
  stepSingleAI: () => boolean;
  switchViewer: (playerId: string) => void;

  // Overlays
  setInspectCard: (card: CardInstance | null) => void;
  setInspectSkill: (skill: InspectedSkill | null) => void;
  setShowRulesModal: (open: boolean) => void;
  setShowLogDrawer: (open: boolean) => void;
  exportReplayJson: () => string;
}

export function buildDefaultSeats(mode: GameMode): SeatConfig[] {
  if (mode === '1v1') {
    return [
      { id: 'p1', name: '主视角玩家', isAI: false },
      { id: 'p2', name: 'AI 对手', isAI: true }
    ];
  }
  if (mode === '2v2') {
    return [
      { id: 'p1', name: '玩家一(蓝)', isAI: false },
      { id: 'p2', name: 'AI 敌方二(红)', isAI: true },
      { id: 'p3', name: 'AI 敌方三(红)', isAI: true },
      { id: 'p4', name: 'AI 队友四(蓝)', isAI: true }
    ];
  }
  return [
    { id: 'p1', name: '主视角玩家', isAI: false },
    { id: 'p2', name: 'AI 贰号', isAI: true },
    { id: 'p3', name: 'AI 叁号', isAI: true },
    { id: 'p4', name: 'AI 肆号', isAI: true },
    { id: 'p5', name: 'AI 伍号', isAI: true }
  ];
}

function resolveViewerId(engine: GameEngine, currentViewerId: string): string {
  const prompt = engine.state.pendingPrompt;
  if (prompt) {
    const promptedPlayer = engine.state.players.find((p) => p.id === prompt.playerId);
    if (promptedPlayer && !promptedPlayer.isAI) {
      return promptedPlayer.id;
    }
  }
  const existingHuman = engine.state.players.find(
    (p) => p.id === currentViewerId && !p.isAI
  );
  if (existingHuman) return existingHuman.id;
  const firstHuman = engine.state.players.find((p) => !p.isAI);
  return firstHuman ? firstHuman.id : engine.state.players[0].id;
}

function syncFromEngine(
  engine: GameEngine,
  prevViewerId: string,
  revealAllHands: boolean
): {
  viewerId: string;
  view: ClientView;
  playableInfos: PlayableCardInfo[];
  screen: ScreenMode;
} {
  const viewerId = resolveViewerId(engine, prevViewerId);
  const view = engine.getClientView(viewerId, { revealAllHands });
  const playableInfos =
    view.pendingPrompt?.type === 'play_action'
      ? getAllPlayableCards(engine.state, view.pendingPrompt.playerId, engine.modifiers)
      : [];
  const screen: ScreenMode = engine.state.result ? 'summary' : 'table';
  return { viewerId, view, playableInfos, screen };
}

export const useGameStore = create<GameStoreState>((set, get) => ({
  screen: 'lobby',
  theme: 'light',
  mode: '1v1',
  deckVariant: 'junzheng_161',
  generalPack: 'all',
  seed: Math.floor(Date.now() % 1000000),
  seats: buildDefaultSeats('1v1'),
  hostSettings: {
    timerEnabled: false,
    timerSeconds: 20,
    aiSpeed: 'normal',
    revealAllHands: false,
    freeGeneralPick: true
  },

  engine: null,
  viewerId: 'p1',
  view: null,
  playableInfos: [],

  selectedCardIds: [],
  selectedTargetIds: [],
  secondaryTargetId: null,
  activeSkillId: null,
  serpentSpearMode: false,
  woodenOxMode: false,
  skipSimilarNullification: false,

  inspectCard: null,
  inspectSkill: null,
  showRulesModal: false,
  showLogDrawer: typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
  aiDecider: decideAIAction,

  toggleTheme: () => {
    const next = get().theme === 'light' ? 'dark' : 'light';
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', next === 'dark');
    }
    set({ theme: next });
  },

  setMode: (mode) => {
    set({ mode, seats: buildDefaultSeats(mode) });
  },

  setDeckVariant: (deckVariant) => set({ deckVariant }),

  setGeneralPack: (generalPack) => set({ generalPack }),

  setSeed: (seed) => set({ seed }),

  randomizeSeed: () => set({ seed: Math.floor(Math.random() * 999999) + 1 }),

  updateSeat: (index, patch) => {
    const seats = [...get().seats];
    if (!seats[index]) return;
    seats[index] = { ...seats[index], ...patch };
    set({ seats });
  },

  setAllOpponentsAI: (isAI) => {
    const seats = get().seats.map((s, idx) =>
      idx === 0 ? s : { ...s, isAI, name: isAI ? `AI ${idx + 1}号` : `玩家 ${idx + 1}号` }
    );
    set({ seats });
  },

  updateHostSettings: (patch) => {
    const nextSettings = { ...get().hostSettings, ...patch };
    set({ hostSettings: nextSettings });
    const eng = get().engine;
    if (eng) {
      const synced = syncFromEngine(eng, get().viewerId, nextSettings.revealAllHands);
      set({ view: synced.view, viewerId: synced.viewerId, playableInfos: synced.playableInfos });
    }
  },

  registerAIDecider: (decider) => set({ aiDecider: decider }),

  startNewGame: (overrideConfig) => {
    const st = get();
    const config: GameConfig = {
      mode: st.mode,
      deckVariant: st.deckVariant,
      generalPack: st.generalPack,
      seed: st.seed,
      seats: st.seats.map((s, idx) => ({ ...s, id: s.id ?? `p${idx + 1}` })),
      skipGeneralSelection: false,
      debug: {
        revealAllHands: st.hostSettings.revealAllHands,
        freeGeneralPick: st.hostSettings.freeGeneralPick
      },
      ...overrideConfig
    };
    const engine = new GameEngine(config);
    engine.start();
    const synced = syncFromEngine(engine, 'p1', st.hostSettings.revealAllHands);
    set({
      engine,
      ...synced,
      selectedCardIds: [],
      selectedTargetIds: [],
      secondaryTargetId: null,
      activeSkillId: null,
      serpentSpearMode: false,
      woodenOxMode: false,
      skipSimilarNullification: false
    });
  },

  returnToLobby: () =>
    set({
      screen: 'lobby',
      engine: null,
      view: null,
      selectedCardIds: [],
      selectedTargetIds: [],
      secondaryTargetId: null,
      activeSkillId: null,
      serpentSpearMode: false,
      woodenOxMode: false
    }),

  rematch: () => {
    const nextSeed = Math.floor(Math.random() * 999999) + 1;
    set({ seed: nextSeed });
    get().startNewGame({ seed: nextSeed });
  },

  clearSelection: () =>
    set({
      selectedCardIds: [],
      selectedTargetIds: [],
      secondaryTargetId: null,
      activeSkillId: null,
      serpentSpearMode: false,
      woodenOxMode: false
    }),

  toggleActiveSkill: (skillId) => {
    const st = get();
    const { engine, view } = st;
    if (!engine || view?.pendingPrompt?.type !== 'play_action') return;
    const skill = view.pendingPrompt.usableSkills.find((s) => s.skillId === skillId);
    if (!skill) return;

    if (skill.needsConfirmOnly) {
      engine.submit({
        type: 'play_action',
        action: { type: 'activate_skill', skillId, cardIds: [], targetIds: [] }
      });
      const synced = syncFromEngine(engine, st.viewerId, st.hostSettings.revealAllHands);
      set({
        ...synced,
        selectedCardIds: [],
        selectedTargetIds: [],
        secondaryTargetId: null,
        activeSkillId: null,
        serpentSpearMode: false,
        woodenOxMode: false
      });
      return;
    }

    const nextSkillId = st.activeSkillId === skillId ? null : skillId;
    set({
      activeSkillId: nextSkillId,
      serpentSpearMode: false,
      woodenOxMode: false,
      selectedCardIds: [],
      selectedTargetIds: [],
      secondaryTargetId: null
    });
  },

  toggleSerpentSpearMode: () => {
    const active = !get().serpentSpearMode;
    set({
      serpentSpearMode: active,
      woodenOxMode: false,
      activeSkillId: null,
      selectedCardIds: [],
      selectedTargetIds: [],
      secondaryTargetId: null
    });
  },

  toggleWoodenOxMode: () => {
    const active = !get().woodenOxMode;
    set({
      woodenOxMode: active,
      serpentSpearMode: false,
      activeSkillId: null,
      selectedCardIds: [],
      selectedTargetIds: [],
      secondaryTargetId: null
    });
  },

  setSkipSimilarNullification: (val) => set({ skipSimilarNullification: val }),

  toggleSelectCard: (cardId) => {
    const st = get();
    const prompt = st.view?.pendingPrompt;
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
        set({
          selectedCardIds: st.selectedCardIds[0] === cardId ? [] : [cardId]
        });
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
    const prompt = st.view?.pendingPrompt;
    if (!prompt) return;

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
      if (st.woodenOxMode) {
        set({
          selectedTargetIds: st.selectedTargetIds[0] === targetId ? [] : [targetId]
        });
        return;
      }
      if (st.serpentSpearMode) {
        set({
          selectedTargetIds: st.selectedTargetIds[0] === targetId ? [] : [targetId]
        });
        return;
      }
      const cardId = st.selectedCardIds[0];
      if (!cardId) return;
      const info = st.playableInfos.find((i) => i.cardId === cardId);
      if (!info || !info.needsTarget) return;

      // Collateral two-step target selection: primary (weapon holder) -> secondary (slash target)
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
    const { engine, view } = st;
    if (!engine || !view?.pendingPrompt) return;
    const prompt = view.pendingPrompt;

    let response: PlayerResponse | null = null;

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
        response = {
          type: 'play_action',
          action: {
            type: 'activate_skill',
            skillId: skill.skillId,
            cardIds: st.selectedCardIds,
            targetIds: st.selectedTargetIds
          }
        };
      } else if (st.serpentSpearMode) {
        if (st.selectedCardIds.length !== 2 || st.selectedTargetIds.length !== 1) return;
        response = {
          type: 'play_action',
          action: {
            type: 'serpent_spear',
            cardIds: [st.selectedCardIds[0], st.selectedCardIds[1]],
            targetIds: st.selectedTargetIds
          }
        };
      } else if (st.woodenOxMode) {
        if (st.selectedCardIds.length !== 1) return;
        response = {
          type: 'play_action',
          action: {
            type: 'wooden_ox_stash',
            cardId: st.selectedCardIds[0],
            transferTargetId: st.selectedTargetIds[0]
          }
        };
      } else {
        const cardId = st.selectedCardIds[0];
        if (!cardId) return;
        const info = st.playableInfos.find((i) => i.cardId === cardId);
        if (!info) return;
        if (info.needsTarget && st.selectedTargetIds.length < info.minTargets) return;
        if (info.secondaryTargetsByPrimary && !st.secondaryTargetId) return;
        response = {
          type: 'play_action',
          action: {
            type: 'play_card',
            cardId,
            targetIds: st.selectedTargetIds,
            secondaryTargetId: st.secondaryTargetId ?? undefined
          }
        };
      }
    } else if (prompt.type === 'choose_card') {
      const useSpear = Boolean(st.serpentSpearMode && prompt.canUseSerpentSpear);
      const required = useSpear ? 2 : prompt.minCount;
      if (st.selectedCardIds.length < required) return;
      response = {
        type: 'choose_card',
        cardIds: st.selectedCardIds,
        useSerpentSpear: useSpear,
        skipSimilarTrickThisTurn: st.skipSimilarNullification
      };
    } else if (prompt.type === 'choose_target') {
      if (st.selectedTargetIds.length < prompt.minCount) return;
      response = {
        type: 'choose_target',
        targetIds: st.selectedTargetIds
      };
    }

    if (!response) return;
    engine.submit(response);
    const synced = syncFromEngine(engine, st.viewerId, st.hostSettings.revealAllHands);
    set({
      ...synced,
      selectedCardIds: [],
      selectedTargetIds: [],
      secondaryTargetId: null,
      activeSkillId: null,
      serpentSpearMode: false,
      woodenOxMode: false,
      skipSimilarNullification: false
    });
  },

  recastSelectedCard: () => {
    const st = get();
    const { engine, view } = st;
    if (!engine || view?.pendingPrompt?.type !== 'play_action') return;
    const cardId = st.selectedCardIds[0];
    if (!cardId || !view.pendingPrompt.canRecastCardIds.includes(cardId)) return;
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId, recast: true }
    });
    const synced = syncFromEngine(engine, st.viewerId, st.hostSettings.revealAllHands);
    set({
      ...synced,
      selectedCardIds: [],
      selectedTargetIds: [],
      secondaryTargetId: null,
      activeSkillId: null
    });
  },

  doubleClickCard: (cardId) => {
    const st = get();
    const { engine, view } = st;
    if (!engine || !view?.pendingPrompt) return;

    if (
      view.pendingPrompt.type === 'play_action' &&
      !st.serpentSpearMode &&
      !st.woodenOxMode &&
      !st.activeSkillId
    ) {
      const info = st.playableInfos.find((i) => i.cardId === cardId);
      if (info && !info.needsTarget) {
        engine.submit({
          type: 'play_action',
          action: { type: 'play_card', cardId }
        });
        const synced = syncFromEngine(engine, st.viewerId, st.hostSettings.revealAllHands);
        set({
          ...synced,
          selectedCardIds: [],
          selectedTargetIds: [],
          secondaryTargetId: null
        });
      }
    } else if (
      view.pendingPrompt.type === 'choose_card' &&
      view.pendingPrompt.maxCount === 1 &&
      view.pendingPrompt.eligibleCardIds.includes(cardId)
    ) {
      engine.submit({
        type: 'choose_card',
        cardIds: [cardId]
      });
      const synced = syncFromEngine(engine, st.viewerId, st.hostSettings.revealAllHands);
      set({
        ...synced,
        selectedCardIds: [],
        selectedTargetIds: []
      });
    }
  },

  cancelPromptOrSelection: () => {
    const st = get();
    const { engine, view } = st;
    if (!engine || !view?.pendingPrompt) return;
    const prompt = view.pendingPrompt;

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
      engine.submit({
        type: 'choose_card',
        cardIds: [],
        cancelled: true,
        skipSimilarTrickThisTurn: st.skipSimilarNullification
      });
      const synced = syncFromEngine(engine, st.viewerId, st.hostSettings.revealAllHands);
      set({ ...synced, skipSimilarNullification: false });
    } else if (prompt.type === 'choose_target' && prompt.optional) {
      engine.submit({ type: 'choose_target', targetIds: [], cancelled: true });
      const synced = syncFromEngine(engine, st.viewerId, st.hostSettings.revealAllHands);
      set({ ...synced });
    }
  },

  endPlayPhase: () => {
    const st = get();
    const { engine, view } = st;
    if (!engine || view?.pendingPrompt?.type !== 'play_action') return;
    engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    const synced = syncFromEngine(engine, st.viewerId, st.hostSettings.revealAllHands);
    set({
      ...synced,
      selectedCardIds: [],
      selectedTargetIds: [],
      secondaryTargetId: null,
      activeSkillId: null,
      serpentSpearMode: false,
      woodenOxMode: false
    });
  },

  respondOption: (optionId) => {
    const st = get();
    if (!st.engine || st.view?.pendingPrompt?.type !== 'choose_option') return;
    st.engine.submit({ type: 'choose_option', optionId });
    const synced = syncFromEngine(st.engine, st.viewerId, st.hostSettings.revealAllHands);
    set({ ...synced });
  },

  respondPlayerCard: (choiceIndex) => {
    const st = get();
    if (!st.engine || st.view?.pendingPrompt?.type !== 'choose_player_card') return;
    st.engine.submit({ type: 'choose_player_card', choiceIndex });
    const synced = syncFromEngine(st.engine, st.viewerId, st.hostSettings.revealAllHands);
    set({ ...synced });
  },

  respondHarvestCard: (cardId) => {
    const st = get();
    if (!st.engine || st.view?.pendingPrompt?.type !== 'choose_harvest_card') return;
    st.engine.submit({ type: 'choose_harvest_card', cardId });
    const synced = syncFromEngine(st.engine, st.viewerId, st.hostSettings.revealAllHands);
    set({ ...synced });
  },

  respondGeneral: (generalId) => {
    const st = get();
    if (!st.engine || st.view?.pendingPrompt?.type !== 'choose_general') return;
    st.engine.submit({ type: 'choose_general', generalId });
    const synced = syncFromEngine(st.engine, st.viewerId, st.hostSettings.revealAllHands);
    set({ ...synced });
  },

  respondGuanxing: (topCardIds, bottomCardIds) => {
    const st = get();
    if (!st.engine || st.view?.pendingPrompt?.type !== 'choose_guanxing') return;
    st.engine.submit({ type: 'choose_guanxing', topCardIds, bottomCardIds });
    const synced = syncFromEngine(st.engine, st.viewerId, st.hostSettings.revealAllHands);
    set({ ...synced });
  },

  handleTimeout: () => {
    const st = get();
    const { engine, view } = st;
    if (!engine || !view?.pendingPrompt) return;
    const p = view.pendingPrompt;
    let fallback: PlayerResponse;
    switch (p.type) {
      case 'play_action':
        fallback = { type: 'play_action', action: { type: 'end_play_phase' } };
        break;
      case 'choose_card':
        fallback = p.optional
          ? { type: 'choose_card', cardIds: [], cancelled: true }
          : { type: 'choose_card', cardIds: p.eligibleCardIds.slice(0, p.minCount) };
        break;
      case 'choose_target':
        fallback = p.optional
          ? { type: 'choose_target', targetIds: [], cancelled: true }
          : { type: 'choose_target', targetIds: p.eligibleTargetIds.slice(0, p.minCount) };
        break;
      case 'choose_option':
        fallback = {
          type: 'choose_option',
          optionId: p.options[p.options.length - 1].id
        };
        break;
      case 'choose_player_card':
        fallback = { type: 'choose_player_card', choiceIndex: 0 };
        break;
      case 'choose_harvest_card': {
        const rem = p.pool.find((x) => !x.takenBy) ?? p.pool[0];
        fallback = { type: 'choose_harvest_card', cardId: rem.card.id };
        break;
      }
      case 'choose_general':
        fallback = { type: 'choose_general', generalId: p.candidates[0].id };
        break;
      case 'choose_guanxing':
        fallback = {
          type: 'choose_guanxing',
          topCardIds: p.cards.map((c) => c.id),
          bottomCardIds: []
        };
        break;
    }
    engine.submit(fallback);
    const synced = syncFromEngine(engine, st.viewerId, st.hostSettings.revealAllHands);
    set({
      ...synced,
      selectedCardIds: [],
      selectedTargetIds: [],
      secondaryTargetId: null,
      activeSkillId: null,
      serpentSpearMode: false,
      woodenOxMode: false
    });
  },

  stepSingleAI: () => {
    const st = get();
    const { engine } = st;
    if (!engine || engine.state.result || !engine.state.pendingPrompt) return false;
    const prompt = engine.state.pendingPrompt;
    const player = engine.state.players.find((p) => p.id === prompt.playerId);
    if (!player || !player.isAI) return false;

    const response: PlayerResponse = st.aiDecider
      ? st.aiDecider(engine, player.id)
      : (() => {
          // Safe fallback if AI decider not registered yet
          switch (prompt.type) {
            case 'play_action':
              return { type: 'play_action', action: { type: 'end_play_phase' } };
            case 'choose_card':
              return prompt.optional
                ? { type: 'choose_card', cardIds: [], cancelled: true }
                : { type: 'choose_card', cardIds: prompt.eligibleCardIds.slice(0, prompt.minCount) };
            case 'choose_option':
              return { type: 'choose_option', optionId: prompt.options[0].id };
            case 'choose_player_card':
              return { type: 'choose_player_card', choiceIndex: 0 };
            case 'choose_harvest_card':
              return {
                type: 'choose_harvest_card',
                cardId: (prompt.pool.find((x) => !x.takenBy) ?? prompt.pool[0]).card.id
              };
            case 'choose_general':
              return { type: 'choose_general', generalId: prompt.candidates[0].id };
            case 'choose_guanxing':
              return {
                type: 'choose_guanxing',
                topCardIds: prompt.cards.map((c) => c.id),
                bottomCardIds: []
              };
            case 'choose_target':
              return {
                type: 'choose_target',
                targetIds: prompt.eligibleTargetIds.slice(0, prompt.minCount)
              };
          }
        })();

    engine.submit(response);
    const synced = syncFromEngine(engine, st.viewerId, st.hostSettings.revealAllHands);
    set({ ...synced });
    return true;
  },

  switchViewer: (playerId) => {
    const st = get();
    if (!st.engine) return;
    const view = st.engine.getClientView(playerId, {
      revealAllHands: st.hostSettings.revealAllHands
    });
    set({ viewerId: playerId, view });
  },

  setInspectCard: (inspectCard) => set({ inspectCard }),
  setInspectSkill: (inspectSkill) => set({ inspectSkill }),
  setShowRulesModal: (showRulesModal) => set({ showRulesModal }),
  setShowLogDrawer: (showLogDrawer) => set({ showLogDrawer }),

  exportReplayJson: () => {
    const eng = get().engine;
    if (!eng) return '{}';
    return JSON.stringify(
      {
        config: eng.state.config,
        result: eng.state.result,
        actionLog: eng.state.actionLog
      },
      null,
      2
    );
  }
}));
