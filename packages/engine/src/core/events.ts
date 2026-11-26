import type {
  CardInstance,
  DamageContext,
  GameState,
  JudgeContext,
  PlayerResponse,
  PlayerState,
  PromptRequest,
  TurnPhase
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
  | 'DyingStart'
  | 'PlayerDied';

export interface TriggerPayload {
  timing: TriggerTiming;
  playerId?: string;
  phase?: TurnPhase;
  card?: CardInstance;
  damage?: DamageContext;
  judge?: JudgeContext;
  drawCount?: number;
  lostEquip?: CardInstance;
  killerId?: string | null;
  victimId?: string;
  extra?: Record<string, unknown>;
}

export type EngineGenerator = Generator<PromptRequest, void, PlayerResponse>;

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

export interface TriggerHelpers {
  ask: (prompt: PromptRequest) => Generator<PromptRequest, PlayerResponse, PlayerResponse>;
  log: (type: string, message: string, actorId?: string, targetIds?: string[], cardIds?: number[]) => void;
  drawCards: (playerId: string, count: number) => CardInstance[];
  heal: (playerId: string, amount: number) => number;
  discardCards: (playerId: string, cardIds: number[]) => CardInstance[];
}

export class TriggerRegistry {
  private handlers = new Map<TriggerTiming, TriggerHandler[]>();

  register(handler: TriggerHandler): void {
    const list = this.handlers.get(handler.timing) ?? [];
    list.push(handler);
    list.sort((a, b) => b.priority - a.priority);
    this.handlers.set(handler.timing, list);
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
  /** Absolute override or infinite flag for slash usage limit in play phase */
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
    card?: CardInstance
  ) => boolean;
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
    card?: CardInstance
  ): boolean {
    return this.modifiers.some((m) =>
      m.ignoreArmor ? m.ignoreArmor(state, source, target, card) : false
    );
  }
}
