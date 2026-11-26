import type {
  ActiveSkillPromptInfo,
  CardInstance,
  CardName,
  DamageContext,
  GameState,
  JudgeContext,
  PlayerResponse,
  PlayerState,
  PromptRequest,
  TurnPhase,
  VirtualCard
} from './types.js';

export type TriggerTiming =
  | 'TurnStart'
  | 'PhaseBefore'
  | 'PhaseStart'
  | 'PhaseEnd'
  | 'TurnEnd'
  | 'DrawCards'
  | 'CardUsed'
  | 'CardResponded'
  | 'TargetSpecified'
  | 'TargetConfirmed'
  | 'SlashMissed'
  | 'DamageBefore'
  | 'DamageStart'
  | 'DamageDealt'
  | 'DamageTaken'
  | 'AfterDamageDealt'
  | 'AfterDamageTaken'
  | 'DamageEnd'
  | 'JudgeModify'
  | 'JudgeResolved'
  | 'EquipLost'
  | 'CardLost'
  | 'HandEmptied'
  | 'DyingStart'
  | 'PlayerDied';

export interface SlashTargetContext {
  attackerId: string;
  targetId: string;
  slashCard: VirtualCard;
  cannotDodge: boolean;
  redirectedTargetId?: string;
}

export interface TriggerPayload {
  timing: TriggerTiming;
  playerId?: string;
  phase?: TurnPhase;
  card?: CardInstance;
  virtualCard?: VirtualCard;
  damage?: DamageContext;
  judge?: JudgeContext;
  slashTarget?: SlashTargetContext;
  drawCount?: number;
  lostEquip?: CardInstance;
  killerId?: string | null;
  victimId?: string;
  extra?: Record<string, unknown>;
}

export type EngineGenerator = Generator<PromptRequest, void, PlayerResponse>;

export interface TriggerHelpers {
  ask: (prompt: PromptRequest) => Generator<PromptRequest, PlayerResponse, PlayerResponse>;
  nextPromptId: () => string;
  log: (type: string, message: string, actorId?: string, targetIds?: string[], cardIds?: number[]) => void;
  drawCards: (playerId: string, count: number) => CardInstance[];
  popTopCards: (count: number) => CardInstance[];
  putCardsOnTop: (cards: CardInstance[]) => void;
  putCardsOnBottom: (cards: CardInstance[]) => void;
  moveToDiscard: (card: CardInstance) => void;
  pushTableCard: (card: CardInstance, actorId?: string, label?: string) => void;
  heal: (playerId: string, amount: number) => number;
  loseHp: (playerId: string, amount: number) => EngineGenerator;
  applyDamage: (ctx: DamageContext) => EngineGenerator;
  resolveJudge: (playerId: string, reason: string) => Generator<PromptRequest, CardInstance, PlayerResponse>;
  resolveSlash: (
    attacker: PlayerState,
    targets: PlayerState[],
    slashCard: VirtualCard,
    options: { countTowardLimit: boolean; useDrunkBonus: boolean }
  ) => EngineGenerator;
  resolveDuel: (
    user: PlayerState,
    target: PlayerState,
    card: CardInstance | VirtualCard,
    cannotNullify?: boolean
  ) => EngineGenerator;
  resolveNormalTrick: (
    actor: PlayerState,
    card: CardInstance,
    targetIds: string[],
    secondaryTargetId?: string
  ) => EngineGenerator;
  discardCards: (playerId: string, cardIds: number[]) => EngineGenerator;
  removeCardFromPlayer: (
    playerId: string,
    cardId: number
  ) => Generator<PromptRequest, CardInstance | null, PlayerResponse>;
  checkHandEmptied: (playerId: string, prevHandLength: number) => EngineGenerator;
  fireEquipLost: (playerId: string, lostEquip: CardInstance) => EngineGenerator;
  takeCardFromDiscard: (cardId: number) => CardInstance | null;
  getDistance: (fromId: string, toId: string) => number;
  isInAttackRange: (attackerId: string, targetId: string) => boolean;
}

export interface TriggerHandler {
  id: string;
  timing: TriggerTiming;
  priority: number;
  condition?: (state: GameState, payload: TriggerPayload) => boolean;
  execute: (
    state: GameState,
    payload: TriggerPayload,
    helpers: TriggerHelpers
  ) => EngineGenerator;
}

export class TriggerRegistry {
  private handlers = new Map<TriggerTiming, TriggerHandler[]>();

  register(handler: TriggerHandler): void {
    const list = this.handlers.get(handler.timing) ?? [];
    const filtered = list.filter((h) => h.id !== handler.id);
    filtered.push(handler);
    filtered.sort((a, b) => b.priority - a.priority);
    this.handlers.set(handler.timing, filtered);
  }

  unregister(id: string): void {
    for (const [timing, list] of this.handlers.entries()) {
      this.handlers.set(
        timing,
        list.filter((h) => h.id !== id)
      );
    }
  }

  getHandlers(timing: TriggerTiming): TriggerHandler[] {
    return this.handlers.get(timing) ?? [];
  }
}

export interface ModifierHooks {
  id: string;
  /** Delta applied to distance(from -> to) */
  distanceDelta?: (state: GameState, from: PlayerState, to: PlayerState) => number;
  /** Delta applied to player's attack range */
  attackRangeDelta?: (state: GameState, player: PlayerState) => number;
  /** Delta applied to slash usage limit in play phase */
  slashLimitDelta?: (state: GameState, player: PlayerState) => number;
  /** Delta applied to hand card limit during discard phase */
  handLimitDelta?: (state: GameState, player: PlayerState) => number;
  /** Extra draw count during draw phase */
  drawCountDelta?: (state: GameState, player: PlayerState) => number;
  /** Whether target's armor is ignored for an attack */
  ignoreArmor?: (
    state: GameState,
    source: PlayerState,
    target: PlayerState,
    card?: CardInstance | VirtualCard
  ) => boolean;
  /** Whether player ignores distance for Trick cards (黄月英【奇才】) */
  trickDistanceUnlimited?: (state: GameState, player: PlayerState) => boolean;
  /** Whether target can be targeted by a specific card (诸葛亮【空城】, 陆逊【谦逊】) */
  canBeTargetedByCard?: (
    state: GameState,
    source: PlayerState,
    target: PlayerState,
    cardName: CardName
  ) => boolean;
  /** Restricts legal Slash targets (袁术【同疾】) */
  filterSlashTargets?: (
    state: GameState,
    source: PlayerState,
    eligibleTargetIds: string[]
  ) => string[];
  /** Number of Dodges required to offset a Slash (吕布【无双】 -> 2) */
  requiredDodges?: (
    state: GameState,
    attacker: PlayerState,
    target: PlayerState,
    card: VirtualCard
  ) => number;
  /** Number of Slashes required per Duel round (吕布【无双】 -> 2) */
  requiredDuelSlashes?: (
    state: GameState,
    responder: PlayerState,
    opponent: PlayerState
  ) => number;
  /** Extra HP healed when `helper` uses Peach on `victim` (孙权【救援】 -> +1) */
  peachHealBonus?: (
    state: GameState,
    helper: PlayerState,
    victim: PlayerState
  ) => number;
}

export class ModifierRegistry {
  private modifiers: ModifierHooks[] = [];

  register(modifier: ModifierHooks): void {
    this.modifiers = this.modifiers.filter((m) => m.id !== modifier.id);
    this.modifiers.push(modifier);
  }

  unregister(id: string): void {
    this.modifiers = this.modifiers.filter((m) => m.id !== id);
  }

  getDistanceDelta(state: GameState, from: PlayerState, to: PlayerState): number {
    return this.modifiers.reduce(
      (sum, m) => sum + (m.distanceDelta ? m.distanceDelta(state, from, to) : 0),
      0
    );
  }

  getAttackRangeDelta(state: GameState, player: PlayerState): number {
    return this.modifiers.reduce(
      (sum, m) => sum + (m.attackRangeDelta ? m.attackRangeDelta(state, player) : 0),
      0
    );
  }

  getSlashLimitDelta(state: GameState, player: PlayerState): number {
    return this.modifiers.reduce(
      (sum, m) => sum + (m.slashLimitDelta ? m.slashLimitDelta(state, player) : 0),
      0
    );
  }

  getHandLimitDelta(state: GameState, player: PlayerState): number {
    return this.modifiers.reduce(
      (sum, m) => sum + (m.handLimitDelta ? m.handLimitDelta(state, player) : 0),
      0
    );
  }

  getDrawCountDelta(state: GameState, player: PlayerState): number {
    return this.modifiers.reduce(
      (sum, m) => sum + (m.drawCountDelta ? m.drawCountDelta(state, player) : 0),
      0
    );
  }

  isArmorIgnored(
    state: GameState,
    source: PlayerState,
    target: PlayerState,
    card?: CardInstance | VirtualCard
  ): boolean {
    return this.modifiers.some((m) =>
      m.ignoreArmor ? m.ignoreArmor(state, source, target, card) : false
    );
  }

  isTrickDistanceUnlimited(state: GameState, player: PlayerState): boolean {
    return this.modifiers.some((m) =>
      m.trickDistanceUnlimited ? m.trickDistanceUnlimited(state, player) : false
    );
  }

  canBeTargetedByCard(
    state: GameState,
    source: PlayerState,
    target: PlayerState,
    cardName: CardName
  ): boolean {
    return this.modifiers.every((m) =>
      m.canBeTargetedByCard ? m.canBeTargetedByCard(state, source, target, cardName) : true
    );
  }

  filterSlashTargets(
    state: GameState,
    source: PlayerState,
    eligibleTargetIds: string[]
  ): string[] {
    let result = eligibleTargetIds;
    for (const m of this.modifiers) {
      if (m.filterSlashTargets) {
        result = m.filterSlashTargets(state, source, result);
      }
    }
    return result;
  }

  getRequiredDodges(
    state: GameState,
    attacker: PlayerState,
    target: PlayerState,
    card: VirtualCard
  ): number {
    let req = 1;
    for (const m of this.modifiers) {
      if (m.requiredDodges) {
        req = Math.max(req, m.requiredDodges(state, attacker, target, card));
      }
    }
    return req;
  }

  getRequiredDuelSlashes(
    state: GameState,
    responder: PlayerState,
    opponent: PlayerState
  ): number {
    let req = 1;
    for (const m of this.modifiers) {
      if (m.requiredDuelSlashes) {
        req = Math.max(req, m.requiredDuelSlashes(state, responder, opponent));
      }
    }
    return req;
  }

  getPeachHealBonus(
    state: GameState,
    helper: PlayerState,
    victim: PlayerState
  ): number {
    return this.modifiers.reduce(
      (sum, m) => sum + (m.peachHealBonus ? m.peachHealBonus(state, helper, victim) : 0),
      0
    );
  }
}

export interface ActiveSkillHandler {
  skillId: string;
  getPromptInfo: (
    state: GameState,
    player: PlayerState,
    modifiers: ModifierRegistry
  ) => ActiveSkillPromptInfo | null;
  execute: (
    state: GameState,
    player: PlayerState,
    cardIds: number[],
    targetIds: string[],
    helpers: TriggerHelpers
  ) => EngineGenerator;
}

export interface ResponseSkillHooks {
  id: string;
  /** Extra card IDs usable as Dodge (赵云龙胆, 甄姬倾国) */
  extraDodgeCardIds?: (state: GameState, player: PlayerState) => number[];
  /** Extra card IDs usable as Slash (关羽武圣, 赵云龙胆) */
  extraSlashCardIds?: (state: GameState, player: PlayerState) => number[];
  /** Extra card IDs usable as Peach in Dying rescue (华佗急救) */
  extraDyingPeachCardIds?: (
    state: GameState,
    helper: PlayerState,
    victim: PlayerState
  ) => number[];
  /** Lord assist Dodge (曹操护驾) */
  assistDodge?: (
    state: GameState,
    target: PlayerState,
    source: PlayerState,
    sourceCard: CardInstance | VirtualCard,
    helpers: TriggerHelpers
  ) => Generator<PromptRequest, boolean, PlayerResponse>;
  /** Lord assist Slash (刘备激将) */
  assistSlash?: (
    state: GameState,
    player: PlayerState,
    reason: string,
    helpers: TriggerHelpers
  ) => Generator<PromptRequest, VirtualCard | null, PlayerResponse>;
}

export class SkillRegistry {
  private activeSkills = new Map<string, ActiveSkillHandler>();
  private responseHooks: ResponseSkillHooks[] = [];

  registerActive(handler: ActiveSkillHandler): void {
    this.activeSkills.set(handler.skillId, handler);
  }

  registerResponse(hook: ResponseSkillHooks): void {
    this.responseHooks = this.responseHooks.filter((h) => h.id !== hook.id);
    this.responseHooks.push(hook);
  }

  getActive(skillId: string): ActiveSkillHandler | undefined {
    return this.activeSkills.get(skillId);
  }

  getAllActiveInfos(
    state: GameState,
    player: PlayerState,
    modifiers: ModifierRegistry
  ): ActiveSkillPromptInfo[] {
    const out: ActiveSkillPromptInfo[] = [];
    for (const [skillId, handler] of this.activeSkills.entries()) {
      if (!hasActiveSkill(player, skillId)) continue;
      const info = handler.getPromptInfo(state, player, modifiers);
      if (info) out.push(info);
    }
    return out;
  }

  getExtraDodgeCardIds(state: GameState, player: PlayerState): number[] {
    const ids = new Set<number>();
    for (const h of this.responseHooks) {
      if (h.extraDodgeCardIds) {
        h.extraDodgeCardIds(state, player).forEach((id) => ids.add(id));
      }
    }
    return Array.from(ids);
  }

  getExtraSlashCardIds(state: GameState, player: PlayerState): number[] {
    const ids = new Set<number>();
    for (const h of this.responseHooks) {
      if (h.extraSlashCardIds) {
        h.extraSlashCardIds(state, player).forEach((id) => ids.add(id));
      }
    }
    return Array.from(ids);
  }

  getExtraDyingPeachCardIds(
    state: GameState,
    helper: PlayerState,
    victim: PlayerState
  ): number[] {
    const ids = new Set<number>();
    for (const h of this.responseHooks) {
      if (h.extraDyingPeachCardIds) {
        h.extraDyingPeachCardIds(state, helper, victim).forEach((id) => ids.add(id));
      }
    }
    return Array.from(ids);
  }

  getResponseHooks(): ResponseSkillHooks[] {
    return this.responseHooks;
  }
}

export function hasActiveSkill(player: PlayerState, skillId: string): boolean {
  return (
    player.alive &&
    player.skills.includes(skillId) &&
    !player.disabledSkills.includes(skillId)
  );
}
