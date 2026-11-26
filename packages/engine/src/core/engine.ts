import {
  getCardColor,
  getRankLabel,
  getSuitSymbol,
  isSlashCardName,
  type CardInstance,
  type ClientView,
  type DamageContext,
  type DamageElement,
  type EquipSlot,
  type GameConfig,
  type GameState,
  type GeneralDefinition,
  type JudgeContext,
  type PindianResult,
  type PlayerResponse,
  type PlayerState,
  type PromptRequest,
  type RecordedAction,
  type Suit,
  type TurnPhase,
  type VirtualCard
} from './types.js';
import { SeededRng } from './rng.js';
import {
  hasActiveSkill,
  ModifierRegistry,
  SkillRegistry,
  TriggerRegistry,
  type BeforeHealContext,
  type EngineGenerator,
  type SingleTrickContext,
  type SlashTargetContext,
  type TrickTargetsContext,
  type TriggerHelpers,
  type TriggerPayload,
  type TriggerTiming
} from './events.js';
import { getDistance, getHandLimit, isInAttackRange } from './distance.js';
import { buildClientView, type ViewOptions } from './view.js';
import {
  buildPlayerCardChoices,
  extractChoiceCard,
  getEquipSlot,
  getEquippedCards,
  getUsableCards,
  popTopCards,
  removeHandOrEquipCard,
  removeUsableCard
} from './deck.js';
import {
  canUseSerpentSpearInPlay,
  canUseWoodenOxInPlay,
  getAlivePlayersInOrder,
  getAllPlayableCards,
  getPlayableCardInfo,
  type PlayableCardInfo
} from './targeting.js';
import { buildDeck } from '../data/cards/index.js';
import {
  ALL_GENERALS,
  BLANK_GENERALS,
  getGeneralById,
  getGeneralPool
} from '../data/generals/index.js';
import { getModeRuleSet, type ModeRuleSet } from '../modes/index.js';
import { registerStandardSkills } from '../skills/standard/index.js';
import { registerLimitBreakSkills } from '../skills/limitBreak/index.js';
import { registerExpansionSkills } from '../skills/expansion/index.js';

const TURN_PHASES: readonly TurnPhase[] = [
  'prepare',
  'judge',
  'draw',
  'play',
  'discard',
  'finish'
];

const MAX_TURNS_SAFETY = 600;

function formatCard(card: CardInstance | VirtualCard): string {
  return `${getSuitSymbol(card.suit)}${getRankLabel(card.rank)}【${card.displayName}】`;
}

function toVirtualCard(
  card: CardInstance,
  overrideName?: CardInstance['name'],
  overrideElement?: DamageElement
): VirtualCard {
  const name = overrideName ?? card.name;
  const element = overrideElement ?? card.element ?? 'normal';
  const displayName =
    overrideName === 'fire_slash'
      ? '火杀'
      : overrideName === 'thunder_slash'
        ? '雷杀'
        : card.displayName;
  return {
    name,
    displayName,
    suit: card.suit,
    rank: card.rank,
    color: getCardColor(card.suit),
    element,
    subcards: [card]
  };
}

function buildSerpentSpearVirtualSlash(cards: [CardInstance, CardInstance]): VirtualCard {
  const c0 = getCardColor(cards[0].suit);
  const c1 = getCardColor(cards[1].suit);
  const color = c0 === c1 ? c0 : 'none';
  return {
    name: 'slash',
    displayName: '杀(丈八)',
    suit: 'none',
    rank: 0,
    color,
    element: 'normal',
    subcards: cards,
    sourceSkill: 'serpent_spear'
  };
}

export interface EngineOptions {
  /** Optional custom unshuffled draw pile override for deterministic unit tests */
  deckOverride?: CardInstance[];
  /** Available generals pool (defaults to config.generalPack or blank fallback for legacy tests) */
  generalPool?: readonly GeneralDefinition[];
}

export class GameEngine {
  readonly state: GameState;
  readonly rng: SeededRng;
  readonly triggers = new TriggerRegistry();
  readonly modifiers = new ModifierRegistry();
  readonly skills = new SkillRegistry();

  private readonly modeRules: ModeRuleSet;
  private readonly generalPool: readonly GeneralDefinition[];
  private readonly firstTurnDone = new Set<string>();
  private runner: Generator<PromptRequest, void, PlayerResponse> | null = null;
  private started = false;

  constructor(config: GameConfig, options: EngineOptions = {}) {
    this.rng = new SeededRng(config.seed);
    this.modeRules = getModeRuleSet(config.mode);

    if (options.generalPool) {
      this.generalPool = options.generalPool;
    } else if (config.generalPack) {
      this.generalPool = getGeneralPool(config.generalPack);
    } else {
      // Default to BLANK_GENERALS when no pack specified so Phase 0–3 blank tests remain deterministic,
      // while still resolving explicit std_* generalIds via ALL_GENERALS!
      this.generalPool = BLANK_GENERALS;
    }

    if (config.seats.length !== this.modeRules.playerCount) {
      throw new Error(
        `Mode ${config.mode} requires ${this.modeRules.playerCount} seats, got ${config.seats.length}`
      );
    }

    const baseDeck = options.deckOverride
      ? options.deckOverride.map((c) => ({ ...c }))
      : this.rng.shuffle(buildDeck(config.deckVariant));

    const initialPlayers: PlayerState[] = config.seats.map((seat, idx) => {
      const defaultGen =
        this.generalPool[idx % this.generalPool.length] ?? getGeneralById('blank_wei_m');
      const gen = seat.generalId
        ? ALL_GENERALS.find((g) => g.id === seat.generalId) ?? getGeneralById(seat.generalId)
        : defaultGen;
      return {
        id: seat.id ?? `p${idx + 1}`,
        seat: idx,
        name: seat.name,
        isAI: seat.isAI,
        role: 'duelist',
        roleRevealed: true,
        generalId: gen.id,
        generalName: gen.name,
        generalTitle: gen.title,
        faction: gen.faction,
        gender: gen.gender,
        hp: gen.maxHp,
        maxHp: gen.maxHp,
        alive: true,
        chained: false,
        flipped: false,
        drunk: false,
        drunkUsedThisTurn: 0,
        slashUsedThisTurn: 0,
        hand: [],
        equips: {
          weapon: null,
          armor: null,
          horsePlus: null,
          horseMinus: null,
          treasure: null
        },
        judgeZone: [],
        woodenOxCards: [],
        woodenOxUsedThisTurn: false,
        removedCards: {},
        skills: [],
        disabledSkills: [],
        marks: {},
        stats: {
          damageDealt: 0,
          damageTaken: 0,
          kills: 0,
          cardsPlayed: 0
        }
      };
    });

    this.state = {
      config,
      turn: 0,
      round: 0,
      activePlayerIndex: 0,
      phase: 'setup',
      skippedPhases: [],
      players: initialPlayers,
      drawPile: baseDeck,
      discardPile: [],
      tableCards: [],
      harvestPool: [],
      events: [],
      nextEventId: 1,
      nextPromptId: 1,
      pendingPrompt: null,
      result: null,
      nullificationSkipByPlayer: {},
      emptyDeckTurnCounter: 0,
      turnSuitsDiscarded: [],
      turnDamageDealtByPlayer: {},
      extraTurnQueue: [],
      actionLog: []
    };

    const roleSetup = this.modeRules.setupRoles(this.state, this.rng);
    this.state.players.forEach((p, idx) => {
      p.role = roleSetup.roles[idx];
      p.team = roleSetup.teams?.[idx];
      if (config.mode === 'identity5') {
        p.roleRevealed = p.role === 'lord';
      } else {
        p.roleRevealed = true;
      }
    });
    this.state.activePlayerIndex = roleSetup.firstPlayerIndex;

    this.registerCoreEquipmentHooks();
    registerStandardSkills(this.triggers, this.modifiers, this.skills);
    registerLimitBreakSkills(this.triggers, this.modifiers, this.skills);
    registerExpansionSkills(this.triggers, this.modifiers, this.skills);
  }

  /**
   * Replays a recorded game deterministically from config + actionLog.
   */
  static replay(
    config: GameConfig,
    actionLog: readonly RecordedAction[],
    options: EngineOptions = {}
  ): GameEngine {
    const engine = new GameEngine(config, options);
    engine.start();
    for (const entry of actionLog) {
      if (engine.state.result || !engine.state.pendingPrompt) break;
      engine.submit(entry.response);
    }
    return engine;
  }

  private registerCoreEquipmentHooks(): void {
    // 青釭剑: Slash ignores target armor
    this.modifiers.register({
      id: 'equip_qinggang_sword',
      ignoreArmor: (_state, source, _target, card) =>
        Boolean(
          card &&
            isSlashCardName(card.name) &&
            source.equips.weapon?.name === 'qinggang_sword'
        )
    });

    // 寒冰剑: On Slash DamageDealt, may prevent damage & discard up to 2 hand/equip cards
    this.triggers.register({
      id: 'equip_ice_sword',
      timing: 'DamageDealt',
      priority: 60,
      condition: (state, payload) => {
        const dmg = payload.damage;
        if (!dmg || dmg.prevented || dmg.isChainDamage || !dmg.sourceId) return false;
        if (!dmg.card || !isSlashCardName(dmg.card.name)) return false;
        const source = state.players.find((p) => p.id === dmg.sourceId);
        const target = state.players.find((p) => p.id === dmg.targetId);
        if (!source || !target || !source.alive || !target.alive) return false;
        if (source.equips.weapon?.name !== 'ice_sword') return false;
        const choices = buildPlayerCardChoices(target, {
          includeHand: true,
          includeEquips: true,
          includeJudge: false
        }).filter((ch) =>
          ch.zone === 'hand' || ch.zone === 'judge'
            ? true
            : this.modifiers.canDiscardEquip(state, source, target, ch.zone)
        );
        return choices.length > 0;
      },
      execute: (state, payload) => {
        const engine = this;
        return (function* () {
          const dmg = payload.damage!;
          const source = state.players.find((p) => p.id === dmg.sourceId)!;
          const target = state.players.find((p) => p.id === dmg.targetId)!;
          const ans = yield* engine.ask({
            type: 'choose_option',
            promptId: engine.nextPromptId(),
            playerId: source.id,
            reason: 'ice_sword',
            message: `是否发动【寒冰剑】，防止对 ${target.name} 的伤害并改为依次弃置其至多两张牌？`,
            options: [
              { id: 'yes', label: '发动【寒冰剑】' },
              { id: 'no', label: '不发动（正常造成伤害）' }
            ]
          });
          if (ans.type !== 'choose_option' || ans.optionId !== 'yes') return;

          dmg.prevented = true;
          engine.log('equip', `${source.name} 发动【寒冰剑】，防止了对 ${target.name} 的伤害`, source.id, [target.id]);

          for (let step = 0; step < 2; step++) {
            if (!target.alive) break;
            const choices = buildPlayerCardChoices(target, {
              includeHand: true,
              includeEquips: true,
              includeJudge: false
            }).filter((ch) =>
              ch.zone === 'hand' || ch.zone === 'judge'
                ? true
                : engine.modifiers.canDiscardEquip(state, source, target, ch.zone)
            );
            if (choices.length === 0) break;
            const pick = yield* engine.ask({
              type: 'choose_player_card',
              promptId: engine.nextPromptId(),
              playerId: source.id,
              targetId: target.id,
              reason: 'ice_sword',
              message: `【寒冰剑】第 ${step + 1} 张：选择弃置 ${target.name} 的一张手牌或装备牌`,
              choices
            });
            const idx = pick.type === 'choose_player_card' ? pick.choiceIndex : 0;
            const choice = choices[idx] ?? choices[0];
            if (!choice) break;
            const prevHand = target.hand.length;
            const extracted = extractChoiceCard(target, choice);
            if (extracted) {
              engine.moveToDiscard(extracted.card);
              for (const oxCard of extracted.lostWoodenOxStash) {
                engine.moveToDiscard(oxCard);
              }
              engine.log(
                'discard',
                `${source.name} 通过【寒冰剑】弃置了 ${target.name} 的 ${formatCard(extracted.card)}`,
                source.id,
                [target.id],
                [extracted.card.id]
              );
              if (extracted.wasEquip) {
                yield* engine.fireTrigger('EquipLost', {
                  playerId: target.id,
                  lostEquip: extracted.card
                });
              }
              yield* engine.checkHandEmptied(target.id, prevHand);
              yield* engine.notifyCardsLost(
                target.id,
                [extracted.card],
                !extracted.wasEquip && choice.zone === 'hand'
              );
            }
          }
        })();
      }
    });

    // 麒麟弓: On Slash DamageDealt (when not prevented), may discard target's horse
    this.triggers.register({
      id: 'equip_kylin_bow',
      timing: 'DamageDealt',
      priority: 40,
      condition: (state, payload) => {
        const dmg = payload.damage;
        if (!dmg || dmg.prevented || dmg.isChainDamage || !dmg.sourceId) return false;
        if (!dmg.card || !isSlashCardName(dmg.card.name)) return false;
        const source = state.players.find((p) => p.id === dmg.sourceId);
        const target = state.players.find((p) => p.id === dmg.targetId);
        if (!source || !target || !source.alive || !target.alive) return false;
        if (source.equips.weapon?.name !== 'kylin_bow') return false;
        return Boolean(target.equips.horsePlus || target.equips.horseMinus);
      },
      execute: (state, payload) => {
        const engine = this;
        return (function* () {
          const dmg = payload.damage!;
          const source = state.players.find((p) => p.id === dmg.sourceId)!;
          const target = state.players.find((p) => p.id === dmg.targetId)!;
          const ans = yield* engine.ask({
            type: 'choose_option',
            promptId: engine.nextPromptId(),
            playerId: source.id,
            reason: 'kylin_bow',
            message: `是否发动【麒麟弓】，弃置 ${target.name} 装备区里的一张坐骑牌？`,
            options: [
              { id: 'yes', label: '发动【麒麟弓】' },
              { id: 'no', label: '不发动' }
            ]
          });
          if (ans.type !== 'choose_option' || ans.optionId !== 'yes') return;

          const choices = buildPlayerCardChoices(target, {
            includeHand: false,
            includeEquips: true,
            includeJudge: false,
            horsesOnly: true
          });
          let choice = choices[0];
          if (choices.length > 1) {
            const pick = yield* engine.ask({
              type: 'choose_player_card',
              promptId: engine.nextPromptId(),
              playerId: source.id,
              targetId: target.id,
              reason: 'kylin_bow',
              message: `选择要弃置的 ${target.name} 的坐骑牌`,
              choices
            });
            const idx = pick.type === 'choose_player_card' ? pick.choiceIndex : 0;
            choice = choices[idx] ?? choices[0];
          }
          if (!choice) return;
          const extracted = extractChoiceCard(target, choice);
          if (extracted) {
            engine.moveToDiscard(extracted.card);
            engine.log(
              'equip',
              `${source.name} 发动【麒麟弓】弃置了 ${target.name} 的 ${formatCard(extracted.card)}`,
              source.id,
              [target.id],
              [extracted.card.id]
            );
            yield* engine.fireTrigger('EquipLost', {
              playerId: target.id,
              lostEquip: extracted.card
            });
            yield* engine.notifyCardsLost(target.id, [extracted.card], false);
          }
        })();
      }
    });

    // 古锭刀: Compulsory +1 damage if Slash hits empty-handed target
    this.triggers.register({
      id: 'equip_guding_blade',
      timing: 'DamageDealt',
      priority: 50,
      condition: (state, payload) => {
        const dmg = payload.damage;
        if (!dmg || dmg.prevented || dmg.isChainDamage || !dmg.sourceId) return false;
        if (!dmg.card || !isSlashCardName(dmg.card.name)) return false;
        const source = state.players.find((p) => p.id === dmg.sourceId);
        const target = state.players.find((p) => p.id === dmg.targetId);
        if (!source || !target || !source.alive || !target.alive) return false;
        return source.equips.weapon?.name === 'guding_blade' && target.hand.length === 0;
      },
      execute: (state, payload) => {
        const engine = this;
        return (function* () {
          const dmg = payload.damage!;
          const source = state.players.find((p) => p.id === dmg.sourceId)!;
          const target = state.players.find((p) => p.id === dmg.targetId)!;
          dmg.amount += 1;
          engine.log(
            'equip',
            `${source.name} 的【古锭刀】生效，${target.name} 无手牌，伤害+1（当前 ${dmg.amount} 点）`,
            source.id,
            [target.id]
          );
        })();
      }
    });

    // 藤甲: Compulsory +1 fire damage when armor not ignored
    this.triggers.register({
      id: 'equip_vine_armor_fire',
      timing: 'DamageTaken',
      priority: 50,
      condition: (state, payload) => {
        const dmg = payload.damage;
        if (!dmg || dmg.prevented || dmg.armorIgnored) return false;
        if (dmg.element !== 'fire') return false;
        const target = state.players.find((p) => p.id === dmg.targetId);
        return Boolean(target && target.alive && target.equips.armor?.name === 'vine_armor');
      },
      execute: (state, payload) => {
        const engine = this;
        return (function* () {
          const dmg = payload.damage!;
          const target = state.players.find((p) => p.id === dmg.targetId)!;
          dmg.amount += 1;
          engine.log(
            'equip',
            `${target.name} 的【藤甲】引燃，火焰伤害+1（当前 ${dmg.amount} 点）`,
            target.id
          );
        })();
      }
    });

    // 白银狮子: Compulsory cap damage > 1 down to 1 (when armor not ignored)
    this.triggers.register({
      id: 'equip_silver_lion_cap',
      timing: 'DamageTaken',
      priority: 30,
      condition: (state, payload) => {
        const dmg = payload.damage;
        if (!dmg || dmg.prevented || dmg.armorIgnored || dmg.amount <= 1) return false;
        const target = state.players.find((p) => p.id === dmg.targetId);
        return Boolean(target && target.alive && target.equips.armor?.name === 'silver_lion');
      },
      execute: (state, payload) => {
        const engine = this;
        return (function* () {
          const dmg = payload.damage!;
          const target = state.players.find((p) => p.id === dmg.targetId)!;
          dmg.amount = 1;
          engine.log('equip', `${target.name} 的【白银狮子】生效，将伤害减至 1 点`, target.id);
        })();
      }
    });

    // 白银狮子: Losing Silver Lion from equip zone heals 1 HP
    this.triggers.register({
      id: 'equip_silver_lion_heal',
      timing: 'EquipLost',
      priority: 50,
      condition: (state, payload) => {
        if (!payload.playerId || payload.lostEquip?.name !== 'silver_lion') return false;
        const player = state.players.find((p) => p.id === payload.playerId);
        return Boolean(player && player.alive && player.hp < player.maxHp);
      },
      execute: (state, payload) => {
        const engine = this;
        return (function* () {
          const player = state.players.find((p) => p.id === payload.playerId)!;
          const healed = engine.healPlayer(player.id, 1);
          if (healed > 0) {
            engine.log(
              'heal',
              `${player.name} 失去【白银狮子】，回复 1 点体力（HP ${player.hp}/${player.maxHp}）`,
              player.id
            );
          }
        })();
      }
    });
  }

  /**
   * Starts the synchronous generator game loop and runs until the first PromptRequest or game over.
   */
  start(): PromptRequest | null {
    if (this.started) return this.state.pendingPrompt;
    this.started = true;
    this.runner = this.runGame();
    const step = this.runner.next();
    if (step.done) {
      this.state.pendingPrompt = null;
      return null;
    }
    this.state.pendingPrompt = step.value;
    return step.value;
  }

  /**
   * Submits a PlayerResponse to the current pendingPrompt and advances synchronously
   * until the next PromptRequest or GameOver.
   */
  submit(response: PlayerResponse): PromptRequest | null {
    if (!this.runner || !this.state.pendingPrompt) {
      return null;
    }
    const prompt = this.state.pendingPrompt;
    this.state.actionLog.push({
      promptId: prompt.promptId,
      playerId: prompt.playerId,
      response
    });
    this.state.pendingPrompt = null;
    const step = this.runner.next(response);
    if (step.done) {
      this.state.pendingPrompt = null;
      return null;
    }
    this.state.pendingPrompt = step.value;
    return step.value;
  }

  getClientView(viewerId: string, options?: ViewOptions): ClientView {
    return buildClientView(this.state, viewerId, options);
  }

  getPlayableCards(playerId: string): PlayableCardInfo[] {
    return getAllPlayableCards(this.state, playerId, this.modifiers);
  }

  getPlayer(playerId: string): PlayerState {
    const p = this.state.players.find((x) => x.id === playerId);
    if (!p) throw new Error(`Unknown playerId: ${playerId}`);
    return p;
  }

  private nextPromptId(): string {
    const id = `prompt_${this.state.nextPromptId}`;
    this.state.nextPromptId += 1;
    return id;
  }

  private log(
    type: string,
    message: string,
    actorId?: string,
    targetIds?: string[],
    cardIds?: number[]
  ): void {
    this.state.events.push({
      id: this.state.nextEventId++,
      turn: this.state.turn,
      phase: this.state.phase,
      type,
      actorId,
      targetIds,
      cardIds,
      message
    });
  }

  private createTriggerHelpers(): TriggerHelpers {
    const engine = this;
    return {
      ask: (prompt) => engine.ask(prompt),
      nextPromptId: () => engine.nextPromptId(),
      log: (type, message, actorId, targetIds, cardIds) =>
        engine.log(type, message, actorId, targetIds, cardIds),
      drawCards: (playerId, count) => engine.drawForPlayer(playerId, count),
      popTopCards: (count) => popTopCards(engine.state, engine.rng, count),
      putCardsOnTop: (cards) => {
        engine.state.drawPile.unshift(...cards);
      },
      putCardsOnBottom: (cards) => {
        engine.state.drawPile.push(...cards);
      },
      moveToDiscard: (card) => engine.moveToDiscard(card),
      pushTableCard: (card, actorId, label) => engine.pushTableCard(card, actorId, label),
      heal: (playerId, amount) => engine.healPlayer(playerId, amount),
      healAsync: (playerId, amount) => engine.healPlayerAsync(playerId, amount),
      loseHp: (playerId, amount) => engine.loseHp(playerId, amount),
      changeMaxHp: (playerId, delta) => engine.changeMaxHp(playerId, delta),
      gainSkill: (playerId, skillId) => engine.gainSkill(playerId, skillId),
      removeSkill: (playerId, skillId) => engine.removeSkill(playerId, skillId),
      flipPlayer: (playerId) => engine.flipPlayer(playerId),
      queueExtraTurn: (playerId) => engine.queueExtraTurn(playerId),
      putEquipDirectly: (targetId, card) => engine.putEquipDirectly(targetId, card),
      resolvePindian: (initiatorId, targetId, reason) =>
        engine.resolvePindian(initiatorId, targetId, reason),
      moveFieldCard: (actorId, reason) => engine.moveFieldCard(actorId, reason),
      askSlashAgainst: (attackerId, targetId, message) =>
        engine.askSlashAgainst(attackerId, targetId, message),
      getEffectiveSuit: (ownerId, card): Suit =>
        engine.modifiers.getEffectiveSuit(engine.state, engine.getPlayer(ownerId), card),
      applyDamage: (ctx) => engine.applyDamage(ctx),
      resolveJudge: (playerId, reason) => engine.resolveJudge(playerId, reason),
      resolveSlash: (attacker, targets, slashCard, options) =>
        engine.resolveSlash(attacker, targets, slashCard, options),
      resolveDuel: (user, target, card, cannotNullify) =>
        engine.resolveDuel(user, target, card, cannotNullify),
      resolveNormalTrick: (actor, card, targetIds, secondaryTargetId) =>
        engine.resolveNormalTrick(actor, card, targetIds, secondaryTargetId),
      discardCards: (playerId, cardIds) => engine.discardPlayerCardsGen(playerId, cardIds),
      removeCardFromPlayer: (playerId, cardId) => engine.removeCardFromPlayerGen(playerId, cardId),
      checkHandEmptied: (playerId, prevHandLength) =>
        engine.checkHandEmptied(playerId, prevHandLength),
      fireEquipLost: (playerId, lostEquip) =>
        engine.fireTrigger('EquipLost', { playerId, lostEquip }),
      notifyCardsObtained: (playerId, cards) => engine.notifyCardsObtained(playerId, cards),
      notifyCardsLost: (playerId, cards, handDiscardedOrTaken = false) =>
        engine.notifyCardsLost(playerId, cards, handDiscardedOrTaken),
      notifyOutOfTurnCard: (playerId, card, isRealCard = true) =>
        engine.notifyOutOfTurnCard(playerId, card, isRealCard),
      takeCardFromDiscard: (cardId) => {
        const idx = engine.state.discardPile.findIndex((c) => c.id === cardId);
        if (idx === -1) return null;
        return engine.state.discardPile.splice(idx, 1)[0];
      },
      getDistance: (fromId, toId) => getDistance(engine.state, fromId, toId, engine.modifiers),
      isInAttackRange: (attackerId, targetId) =>
        isInAttackRange(engine.state, attackerId, targetId, engine.modifiers),
      canDiscardPlayerEquip: (actorId, targetId, slot) =>
        engine.modifiers.canDiscardEquip(
          engine.state,
          engine.getPlayer(actorId),
          engine.getPlayer(targetId),
          slot
        )
    };
  }

  private *ask(prompt: PromptRequest): Generator<PromptRequest, PlayerResponse, PlayerResponse> {
    const response = yield prompt;
    return response;
  }

  private *fireTrigger(
    timing: TriggerTiming,
    partial: Omit<TriggerPayload, 'timing'>
  ): EngineGenerator {
    const payload: TriggerPayload = { timing, ...partial };
    const handlers = this.triggers.getHandlers(timing);
    const helpers = this.createTriggerHelpers();
    for (const handler of handlers) {
      if (this.state.result) return;
      if (handler.condition && !handler.condition(this.state, payload)) continue;
      yield* handler.execute(this.state, payload, helpers);
    }
  }

  private *checkHandEmptied(playerId: string, prevHandLength: number): EngineGenerator {
    if (prevHandLength <= 0 || this.state.result) return;
    const player = this.state.players.find((p) => p.id === playerId);
    if (player && player.alive && player.hand.length === 0) {
      yield* this.fireTrigger('HandEmptied', { playerId, lostHandCount: prevHandLength });
    }
  }

  private moveToDiscard(card: CardInstance): void {
    if (card.asDelayedTrick) {
      delete card.asDelayedTrick;
    }
    if (card.exemptFromHandLimitTurn !== undefined) {
      delete card.exemptFromHandLimitTurn;
    }
    if (!this.state.turnSuitsDiscarded.includes(card.suit)) {
      this.state.turnSuitsDiscarded.push(card.suit);
    }
    this.state.discardPile.push(card);
  }

  private pushTableCard(card: CardInstance, actorId?: string, label?: string): void {
    this.state.tableCards.push({ card, actorId, label });
    if (this.state.tableCards.length > 10) {
      this.state.tableCards.shift();
    }
  }

  private drawForPlayer(playerId: string, count: number): CardInstance[] {
    if (count <= 0) return [];
    const player = this.getPlayer(playerId);
    const drawn = popTopCards(this.state, this.rng, count);
    if (drawn.length > 0) {
      this.state.emptyDeckTurnCounter = 0;
      player.hand.push(...drawn);
    }
    return drawn;
  }

  private healPlayer(playerId: string, amount: number): number {
    const player = this.getPlayer(playerId);
    if (!player.alive || amount <= 0) return 0;
    const before = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + amount);
    return player.hp - before;
  }

  private *healPlayerAsync(
    playerId: string,
    amount: number
  ): Generator<PromptRequest, number, PlayerResponse> {
    const player = this.getPlayer(playerId);
    if (!player.alive || this.state.result || amount <= 0 || player.hp >= player.maxHp) {
      return 0;
    }
    const ctx: BeforeHealContext = { targetId: playerId, amount, cancelled: false };
    yield* this.fireTrigger('BeforeHeal', { playerId, beforeHeal: ctx });
    if (ctx.cancelled || ctx.amount <= 0 || !player.alive || this.state.result) {
      return 0;
    }
    return this.healPlayer(playerId, ctx.amount);
  }

  private *changeMaxHp(playerId: string, delta: number): EngineGenerator {
    const player = this.getPlayer(playerId);
    if (!player.alive || this.state.result || delta === 0) return;
    player.maxHp = Math.max(0, player.maxHp + delta);
    if (player.maxHp <= 0) {
      player.hp = 0;
      yield* this.killPlayer(player.id, null);
      return;
    }
    if (player.hp > player.maxHp) {
      player.hp = player.maxHp;
    }
    this.log(
      'skill',
      `${player.name} 体力上限${delta > 0 ? `+${delta}` : delta}（当前 HP ${player.hp}/${player.maxHp}）`,
      player.id
    );
  }

  private gainSkill(playerId: string, skillId: string): void {
    const player = this.getPlayer(playerId);
    if (!player.skills.includes(skillId)) {
      player.skills.push(skillId);
    }
  }

  private removeSkill(playerId: string, skillId: string): void {
    const player = this.getPlayer(playerId);
    player.skills = player.skills.filter((s) => s !== skillId);
  }

  private *flipPlayer(playerId: string): EngineGenerator {
    const player = this.getPlayer(playerId);
    if (!player.alive || this.state.result) return;
    player.flipped = !player.flipped;
    this.log(
      'skill',
      `${player.name} 将武将牌${player.flipped ? '翻至背面' : '翻回正面'}`,
      player.id
    );
    if (!player.flipped) {
      yield* this.fireTrigger('TurnedFaceUp', { playerId: player.id });
    }
  }

  private queueExtraTurn(playerId: string): void {
    this.state.extraTurnQueue.push(playerId);
  }

  private *resolvePindian(
    initiatorId: string,
    targetId: string,
    reason: string
  ): Generator<PromptRequest, PindianResult | null, PlayerResponse> {
    const initiator = this.getPlayer(initiatorId);
    const target = this.getPlayer(targetId);
    if (
      !initiator.alive ||
      !target.alive ||
      initiator.hand.length === 0 ||
      target.hand.length === 0 ||
      this.state.result
    ) {
      return null;
    }

    const initResp = yield* this.ask({
      type: 'choose_card',
      promptId: this.nextPromptId(),
      playerId: initiator.id,
      reason: 'pindian',
      message: `【${reason}】拼点：请选择一张手牌与 ${target.name} 拼点`,
      minCount: 1,
      maxCount: 1,
      eligibleCardIds: initiator.hand.map((c) => c.id),
      optional: false
    });
    const initCardId =
      initResp.type === 'choose_card' && initResp.cardIds[0]
        ? initResp.cardIds[0]
        : initiator.hand[0].id;

    const targResp = yield* this.ask({
      type: 'choose_card',
      promptId: this.nextPromptId(),
      playerId: target.id,
      reason: 'pindian',
      message: `【${reason}】拼点：请选择一张手牌响应 ${initiator.name} 的拼点`,
      minCount: 1,
      maxCount: 1,
      eligibleCardIds: target.hand.map((c) => c.id),
      optional: false
    });
    const targCardId =
      targResp.type === 'choose_card' && targResp.cardIds[0]
        ? targResp.cardIds[0]
        : target.hand[0].id;

    const prevInitHand = initiator.hand.length;
    const prevTargHand = target.hand.length;
    const initIdx = initiator.hand.findIndex((c) => c.id === initCardId);
    const targIdx = target.hand.findIndex((c) => c.id === targCardId);
    const initiatorCard = initiator.hand.splice(initIdx !== -1 ? initIdx : 0, 1)[0];
    const targetCard = target.hand.splice(targIdx !== -1 ? targIdx : 0, 1)[0];

    this.pushTableCard(initiatorCard, initiator.id, `${reason}拼点`);
    this.pushTableCard(targetCard, target.id, `${reason}拼点`);
    this.moveToDiscard(initiatorCard);
    this.moveToDiscard(targetCard);

    const winner: PindianResult['winner'] =
      initiatorCard.rank > targetCard.rank
        ? 'initiator'
        : initiatorCard.rank < targetCard.rank
          ? 'target'
          : 'tie';
    const outcomeText =
      winner === 'initiator'
        ? `${initiator.name} 拼点赢！`
        : winner === 'target'
          ? `${target.name} 拼点赢！`
          : '拼点平局（发起者没赢）';

    this.log(
      'skill',
      `【${reason}】拼点：${initiator.name} 亮出 ${formatCard(initiatorCard)} vs ${target.name} 亮出 ${formatCard(targetCard)} → ${outcomeText}`,
      initiator.id,
      [target.id],
      [initiatorCard.id, targetCard.id]
    );

    yield* this.checkHandEmptied(initiator.id, prevInitHand);
    yield* this.notifyCardsLost(initiator.id, [initiatorCard], false);
    yield* this.checkHandEmptied(target.id, prevTargHand);
    yield* this.notifyCardsLost(target.id, [targetCard], false);

    return {
      initiatorId: initiator.id,
      targetId: target.id,
      initiatorCard,
      targetCard,
      winner
    };
  }

  private getValidMoveDestinations(
    source: PlayerState,
    zone: EquipSlot | 'judge',
    card: CardInstance
  ): PlayerState[] {
    const others = this.state.players.filter((p) => p.alive && p.id !== source.id);
    if (zone === 'judge') {
      const delayedKind = card.asDelayedTrick ?? card.name;
      return others.filter(
        (d) => !d.judgeZone.some((c) => (c.asDelayedTrick ?? c.name) === delayedKind)
      );
    }
    return others.filter((d) => !d.equips[zone]);
  }

  private *moveFieldCard(
    actorId: string,
    reason: string
  ): Generator<PromptRequest, boolean, PlayerResponse> {
    const actor = this.getPlayer(actorId);
    if (!actor.alive || this.state.result) return false;

    const getMovableChoices = (src: PlayerState) => {
      const raw = buildPlayerCardChoices(src, {
        includeHand: false,
        includeEquips: true,
        includeJudge: true
      });
      return raw.filter((ch) => {
        if (ch.zone === 'hand' || ch.cardId === undefined) return false;
        const card =
          ch.zone === 'judge'
            ? src.judgeZone.find((c) => c.id === ch.cardId)
            : src.equips[ch.zone];
        if (!card) return false;
        return this.getValidMoveDestinations(src, ch.zone, card).length > 0;
      });
    };

    const validSources = this.state.players.filter(
      (p) => p.alive && getMovableChoices(p).length > 0
    );
    if (validSources.length === 0) return false;

    const srcResp = yield* this.ask({
      type: 'choose_target',
      promptId: this.nextPromptId(),
      playerId: actor.id,
      reason: 'move_field_source',
      message: `【${reason}】：选择一名场上（装备区/判定区）有可移动牌的角色`,
      minCount: 1,
      maxCount: 1,
      eligibleTargetIds: validSources.map((p) => p.id),
      optional: true
    });
    if (srcResp.type !== 'choose_target' || srcResp.cancelled || srcResp.targetIds.length !== 1) {
      return false;
    }

    const source = this.state.players.find((p) => p.id === srcResp.targetIds[0] && p.alive);
    if (!source) return false;
    const movableChoices = getMovableChoices(source);
    if (movableChoices.length === 0) return false;

    let chosenChoice = movableChoices[0];
    if (movableChoices.length > 1) {
      const pickResp = yield* this.ask({
        type: 'choose_player_card',
        promptId: this.nextPromptId(),
        playerId: actor.id,
        targetId: source.id,
        reason: 'move_field_card',
        message: `【${reason}】：选择要移动 ${source.name} 场上的哪一张牌`,
        choices: movableChoices
      });
      const idx = pickResp.type === 'choose_player_card' ? pickResp.choiceIndex : 0;
      chosenChoice = movableChoices[idx] ?? movableChoices[0];
    }

    if (chosenChoice.zone === 'hand' || chosenChoice.cardId === undefined) return false;
    const card =
      chosenChoice.zone === 'judge'
        ? source.judgeZone.find((c) => c.id === chosenChoice.cardId)
        : source.equips[chosenChoice.zone];
    if (!card) return false;

    const validDests = this.getValidMoveDestinations(source, chosenChoice.zone, card);
    if (validDests.length === 0) return false;

    let dest = validDests[0];
    if (validDests.length > 1) {
      const destResp = yield* this.ask({
        type: 'choose_target',
        promptId: this.nextPromptId(),
        playerId: actor.id,
        reason: 'move_field_dest',
        message: `【${reason}】：选择将 ${formatCard(card)} 移动至哪名角色的对应区域`,
        minCount: 1,
        maxCount: 1,
        eligibleTargetIds: validDests.map((p) => p.id),
        optional: false
      });
      if (destResp.type === 'choose_target' && destResp.targetIds[0]) {
        dest = validDests.find((d) => d.id === destResp.targetIds[0]) ?? validDests[0];
      }
    }

    if (chosenChoice.zone === 'judge') {
      const jIdx = source.judgeZone.findIndex((c) => c.id === card.id);
      if (jIdx === -1) return false;
      const moved = source.judgeZone.splice(jIdx, 1)[0];
      dest.judgeZone.push(moved);
      this.log(
        'skill',
        `${actor.name} 发动【${reason}】，将 ${source.name} 判定区的 ${formatCard(moved)} 移动至 ${dest.name} 判定区`,
        actor.id,
        [source.id, dest.id],
        [moved.id]
      );
      yield* this.notifyCardsLost(source.id, [moved], false);
    } else {
      const slot = chosenChoice.zone;
      const moved = source.equips[slot];
      if (!moved) return false;
      source.equips[slot] = null;
      const movedOx =
        slot === 'treasure' && moved.name === 'wooden_ox'
          ? source.woodenOxCards.splice(0)
          : [];
      dest.equips[slot] = moved;
      if (movedOx.length > 0) {
        dest.woodenOxCards.push(...movedOx);
      }
      this.log(
        'skill',
        `${actor.name} 发动【${reason}】，将 ${source.name} 装备区的 ${formatCard(moved)} 移动至 ${dest.name} 装备区`,
        actor.id,
        [source.id, dest.id],
        [moved.id]
      );
      yield* this.fireTrigger('EquipLost', { playerId: source.id, lostEquip: moved });
      yield* this.notifyCardsLost(source.id, [moved], false);
    }
    return true;
  }

  private *askSlashAgainst(
    attackerId: string,
    targetId: string,
    message: string
  ): Generator<PromptRequest, boolean, PlayerResponse> {
    const attacker = this.getPlayer(attackerId);
    const target = this.getPlayer(targetId);
    if (!attacker.alive || !target.alive || this.state.result) return false;
    if (attacker.cannotUseSlashThisTurn) return false;
    if (!this.modifiers.canBeTargetedByCard(this.state, attacker, target, 'slash')) {
      return false;
    }
    const usedSlash = yield* this.askSlashResponse(attacker, 'slash_collateral', message);
    if (!usedSlash) return false;
    yield* this.resolveSlash(attacker, [target], usedSlash, {
      countTowardLimit: false,
      useDrunkBonus: false
    });
    return true;
  }

  private *putEquipDirectly(targetId: string, card: CardInstance): EngineGenerator {
    const target = this.getPlayer(targetId);
    if (!target.alive || this.state.result) {
      this.moveToDiscard(card);
      return;
    }
    const slot = getEquipSlot(card);
    if (!slot) {
      this.moveToDiscard(card);
      return;
    }
    const oldEquip = target.equips[slot];
    target.equips[slot] = card;
    if (oldEquip) {
      this.moveToDiscard(oldEquip);
      if (slot === 'treasure' && oldEquip.name === 'wooden_ox') {
        for (const oxCard of target.woodenOxCards.splice(0)) {
          this.moveToDiscard(oxCard);
        }
      }
      yield* this.fireTrigger('EquipLost', { playerId: target.id, lostEquip: oldEquip });
      yield* this.notifyCardsLost(target.id, [oldEquip], false);
    }
  }

  private *notifyCardsObtained(playerId: string, cards: CardInstance[]): EngineGenerator {
    if (cards.length === 0 || this.state.result) return;
    const player = this.state.players.find((p) => p.id === playerId && p.alive);
    if (!player) return;
    yield* this.fireTrigger('CardObtained', { playerId, obtainedCards: cards });
  }

  private *notifyCardsLost(
    playerId: string,
    cards: CardInstance[],
    handDiscardedOrTaken = false
  ): EngineGenerator {
    if (cards.length === 0 || this.state.result) return;
    const player = this.state.players.find((p) => p.id === playerId && p.alive);
    if (!player) return;
    yield* this.fireTrigger('CardsLost', { playerId, lostCards: cards });
    if (handDiscardedOrTaken && !this.state.result && player.alive) {
      yield* this.fireTrigger('HandCardsDiscardedOrTaken', { playerId, lostCards: cards });
    }
  }

  private *notifyOutOfTurnCard(
    playerId: string,
    card: CardInstance | VirtualCard,
    isRealCard = true
  ): EngineGenerator {
    if (this.state.result) return;
    const active = this.state.players[this.state.activePlayerIndex];
    if (!active || active.id === playerId) return;
    const player = this.state.players.find((p) => p.id === playerId && p.alive);
    if (!player) return;
    yield* this.fireTrigger('CardPlayedOrUsedOutOfTurn', {
      playerId,
      outOfTurnCard: { playerId, card, isRealCard }
    });
  }

  private *loseHp(playerId: string, amount: number): EngineGenerator {
    const player = this.getPlayer(playerId);
    if (!player.alive || this.state.result || amount <= 0) return;
    player.hp -= amount;
    this.log(
      'damage',
      `${player.name} 失去了 ${amount} 点体力（HP ${player.hp}/${player.maxHp}）`,
      player.id
    );
    if (player.hp <= 0) {
      yield* this.resolveDying(player.id, null);
    }
    if (player.alive && !this.state.result) {
      yield* this.fireTrigger('HpLost', { playerId: player.id, hpLostAmount: amount });
    }
  }

  private *removeCardFromPlayerGen(
    playerId: string,
    cardId: number
  ): Generator<PromptRequest, CardInstance | null, PlayerResponse> {
    const player = this.getPlayer(playerId);
    const prevHand = player.hand.length;
    const removed = removeHandOrEquipCard(player, cardId);
    if (!removed) return null;
    for (const ox of removed.lostWoodenOxStash) {
      this.moveToDiscard(ox);
    }
    if (removed.wasEquip) {
      yield* this.fireTrigger('EquipLost', { playerId: player.id, lostEquip: removed.card });
    }
    yield* this.checkHandEmptied(player.id, prevHand);
    yield* this.notifyCardsLost(player.id, [removed.card], false);
    return removed.card;
  }

  private *discardPlayerCardsGen(playerId: string, cardIds: number[]): EngineGenerator {
    const player = this.getPlayer(playerId);
    const prevHand = player.hand.length;
    const lostEquips: CardInstance[] = [];
    const lostCards: CardInstance[] = [];
    for (const id of cardIds) {
      const removed = removeHandOrEquipCard(player, id);
      if (removed) {
        this.moveToDiscard(removed.card);
        lostCards.push(removed.card);
        for (const ox of removed.lostWoodenOxStash) {
          this.moveToDiscard(ox);
        }
        if (removed.wasEquip) {
          lostEquips.push(removed.card);
        }
      }
    }
    for (const eq of lostEquips) {
      yield* this.fireTrigger('EquipLost', { playerId: player.id, lostEquip: eq });
    }
    yield* this.checkHandEmptied(player.id, prevHand);
    yield* this.notifyCardsLost(player.id, lostCards, false);
  }

  private applyGeneralToPlayer(player: PlayerState, general: GeneralDefinition): void {
    const isIdentityLord = this.state.config.mode === 'identity5' && player.role === 'lord';
    const maxHp = general.maxHp + (isIdentityLord ? 1 : 0);
    player.generalId = general.id;
    player.generalName = general.name;
    player.generalTitle = general.title;
    player.faction = general.faction;
    player.gender = general.gender;
    player.maxHp = maxHp;
    player.hp = maxHp;
    player.skills = general.skills
      .filter((s) => {
        if (s.type !== 'lord') return true;
        return this.modeRules.allowLordSkills && player.role === 'lord';
      })
      .map((s) => s.id);
  }

  private *runGeneralSelection(): EngineGenerator {
    const pool = [...this.generalPool];
    const usedBaseIds = new Set<string>();
    const freePick = Boolean(this.state.config.debug?.freeGeneralPick);

    const ordered = [...this.state.players].sort((a, b) => {
      if (this.state.config.mode === 'identity5') {
        if (a.role === 'lord') return -1;
        if (b.role === 'lord') return 1;
      }
      return a.seat - b.seat;
    });

    const shuffledPool = this.rng.shuffle(pool);

    for (const player of ordered) {
      const seatCfg = this.state.config.seats[player.seat];
      if (seatCfg?.generalId && this.state.config.skipGeneralSelection) {
        const chosen =
          ALL_GENERALS.find((g) => g.id === seatCfg.generalId) ?? pool[0];
        this.applyGeneralToPlayer(player, chosen);
        usedBaseIds.add(chosen.baseGeneralId ?? chosen.id);
        continue;
      }

      if (this.state.config.skipGeneralSelection) {
        const available = shuffledPool.filter(
          (g) => !usedBaseIds.has(g.baseGeneralId ?? g.id)
        );
        const chosen = available[0] ?? pool[player.seat % pool.length];
        this.applyGeneralToPlayer(player, chosen);
        usedBaseIds.add(chosen.baseGeneralId ?? chosen.id);
        continue;
      }

      const available = shuffledPool.filter(
        (g) => !usedBaseIds.has(g.baseGeneralId ?? g.id)
      );
      let candidates: GeneralDefinition[];
      if (freePick) {
        candidates = pool.filter((g) => !usedBaseIds.has(g.baseGeneralId ?? g.id));
      } else {
        const lordExtras =
          this.state.config.mode === 'identity5' && player.role === 'lord'
            ? available.filter((g) => g.isLordCandidate)
            : [];
        const rest = available.filter((g) => !lordExtras.includes(g));
        const pickSize = player.role === 'lord' ? 5 : 3;
        candidates = [...lordExtras, ...rest].slice(0, Math.min(pickSize, available.length));
      }
      if (candidates.length === 0) candidates = [pool[0]];

      const res = yield* this.ask({
        type: 'choose_general',
        promptId: this.nextPromptId(),
        playerId: player.id,
        message: `${player.name} 请选择出战武将`,
        candidates
      });
      const chosenId = res.type === 'choose_general' ? res.generalId : candidates[0].id;
      const chosen = candidates.find((c) => c.id === chosenId) ?? candidates[0];
      this.applyGeneralToPlayer(player, chosen);
      usedBaseIds.add(chosen.baseGeneralId ?? chosen.id);
      this.log(
        'setup',
        `${player.name} 选择了武将【${chosen.name}】（HP ${player.maxHp}）`,
        player.id
      );
    }
  }

  private *runGame(): EngineGenerator {
    this.state.phase = 'setup';
    yield* this.runGeneralSelection();

    // Deal initial hands
    for (const player of this.state.players) {
      const initCount = this.modeRules.getInitialHandCount(this.state, player);
      this.drawForPlayer(player.id, initCount);
    }
    this.log(
      'setup',
      `对局开始（模式：${this.state.config.mode}，牌堆剩余 ${this.state.drawPile.length} 张）`
    );
    yield* this.fireTrigger('GameStart', {});
    if (this.state.result) return;

    const firstSeatIdx = this.state.activePlayerIndex;
    this.state.round = 1;

    while (!this.state.result) {
      const savedActiveIdx = this.state.activePlayerIndex;
      const current = this.state.players[savedActiveIdx];

      if (current.alive) {
        if (current.flipped) {
          this.log('turn', `${current.name} 将武将牌翻回正面，跳过本回合`, current.id);
          yield* this.flipPlayer(current.id);
          if (this.state.result) return;
        } else {
          this.state.turn += 1;
          if (this.state.turn > MAX_TURNS_SAFETY || this.state.emptyDeckTurnCounter >= 12) {
            this.state.result = {
              winnerTeam: '平局',
              winnerPlayerIds: [],
              reason:
                this.state.emptyDeckTurnCounter >= 12
                  ? '牌堆耗尽且无牌可摸，触发平局保护。'
                  : '回合数达到上限，触发平局保护。',
              totalTurns: this.state.turn
            };
            this.state.phase = 'gameover';
            this.log('gameover', this.state.result.reason);
            return;
          }

          yield* this.runPlayerTurn(current);
          if (this.state.result) return;

          if (current.extraTurnPending) {
            current.extraTurnPending = false;
            this.state.extraTurnQueue.unshift(current.id);
          }

          // Handle queued extra turns (界吕蒙【博图】、刘禅【放权】)
          while (!this.state.result && this.state.extraTurnQueue.length > 0) {
            const nextId = this.state.extraTurnQueue.shift()!;
            const extraPlayer = this.state.players.find((p) => p.id === nextId && p.alive);
            if (!extraPlayer) continue;
            this.state.activePlayerIndex = extraPlayer.seat;

            if (extraPlayer.flipped) {
              this.log('turn', `${extraPlayer.name} 额外回合将武将牌翻回正面，跳过本回合`, extraPlayer.id);
              yield* this.flipPlayer(extraPlayer.id);
              if (this.state.result) return;
              continue;
            }

            this.state.turn += 1;
            if (this.state.turn > MAX_TURNS_SAFETY || this.state.emptyDeckTurnCounter >= 12) {
              this.state.result = {
                winnerTeam: '平局',
                winnerPlayerIds: [],
                reason:
                  this.state.emptyDeckTurnCounter >= 12
                    ? '牌堆耗尽且无牌可摸，触发平局保护。'
                    : '回合数达到上限，触发平局保护。',
                totalTurns: this.state.turn
              };
              this.state.phase = 'gameover';
              this.log('gameover', this.state.result.reason);
              return;
            }
            this.log('turn', `${extraPlayer.name} 开始执行额外回合！`, extraPlayer.id);
            yield* this.runPlayerTurn(extraPlayer);
            if (this.state.result) return;
            if (extraPlayer.extraTurnPending) {
              extraPlayer.extraTurnPending = false;
              this.state.extraTurnQueue.unshift(extraPlayer.id);
            }
          }
          this.state.activePlayerIndex = savedActiveIdx;
        }
      }

      this.state.activePlayerIndex =
        (savedActiveIdx + 1) % this.state.players.length;
      if (this.state.activePlayerIndex === firstSeatIdx) {
        this.state.round += 1;
      }
    }
  }

  private cleanupTurnEffects(): void {
    for (const p of this.state.players) {
      p.nonCompulsoryDisabledThisTurn = false;
      p.cannotPlayHandCardsThisTurn = false;
      p.cannotUseSlashThisTurn = false;
      if (p.alive && p.removedCards['lb_qianxun'] && p.removedCards['lb_qianxun'].length > 0) {
        const returned = p.removedCards['lb_qianxun'].splice(0);
        delete p.removedCards['lb_qianxun'];
        p.hand.push(...returned);
        this.log('skill', `${p.name} 收回界【谦逊】移出游戏的 ${returned.length} 张手牌`, p.id);
      }
    }
  }

  private *runPlayerTurn(player: PlayerState): EngineGenerator {
    this.state.skippedPhases = [];
    this.state.nullificationSkipByPlayer = {};
    this.state.tableCards = [];
    this.state.turnSuitsDiscarded = [];
    this.state.turnDamageDealtByPlayer = {};
    player.slashUsedThisTurn = 0;
    player.drunk = false;
    player.drunkUsedThisTurn = 0;
    player.woodenOxUsedThisTurn = false;

    const isFirstTurn = !this.firstTurnDone.has(player.id);
    this.firstTurnDone.add(player.id);

    try {
      this.log(
        'turn',
        `=== 第 ${this.state.turn} 回合：${player.name}（${player.generalName}）===`,
        player.id
      );
      yield* this.fireTrigger('TurnStart', { playerId: player.id });
      if (this.state.result || !player.alive) return;

      for (const phase of TURN_PHASES) {
        if (this.state.result || !player.alive) return;
        this.state.phase = phase;
        yield* this.fireTrigger('PhaseBefore', { playerId: player.id, phase });
        if (this.state.result || !player.alive) return;

        if (this.state.skippedPhases.includes(phase)) {
          this.log('phase', `${player.name} 跳过了 ${this.phaseLabel(phase)}`, player.id);
          yield* this.fireTrigger('PhaseSkipped', { playerId: player.id, phase });
          continue;
        }

        yield* this.fireTrigger('PhaseStart', { playerId: player.id, phase });
        if (this.state.result || !player.alive) return;

        switch (phase) {
          case 'prepare':
            break;
          case 'judge':
            yield* this.runJudgePhase(player);
            break;
          case 'draw':
            yield* this.runDrawPhase(player, isFirstTurn);
            break;
          case 'play':
            yield* this.runPlayPhase(player);
            break;
          case 'discard':
            yield* this.runDiscardPhase(player);
            break;
          case 'finish':
            break;
        }

        if (this.state.result || !player.alive) return;
        yield* this.fireTrigger('PhaseEnd', { playerId: player.id, phase });
      }

      player.drunk = false;
      player.slashUsedThisTurn = 0;
      player.drunkUsedThisTurn = 0;
      player.woodenOxUsedThisTurn = false;
      yield* this.fireTrigger('TurnEnd', { playerId: player.id });
    } finally {
      if (!this.state.result) {
        this.cleanupTurnEffects();
      }
    }
  }

  private phaseLabel(phase: TurnPhase): string {
    const map: Record<TurnPhase, string> = {
      prepare: '准备阶段',
      judge: '判定阶段',
      draw: '摸牌阶段',
      play: '出牌阶段',
      discard: '弃牌阶段',
      finish: '结束阶段'
    };
    return map[phase];
  }

  private *runJudgePhase(player: PlayerState): EngineGenerator {
    while (player.judgeZone.length > 0 && player.alive && !this.state.result) {
      const delayedCard = player.judgeZone.pop()!;
      const delayedKind = delayedCard.asDelayedTrick ?? delayedCard.name;
      const trickLabel =
        delayedKind === 'indulgence'
          ? '乐不思蜀'
          : delayedKind === 'supply_shortage'
            ? '兵粮寸断'
            : delayedKind === 'lightning'
              ? '闪电'
              : delayedCard.displayName;

      this.pushTableCard(delayedCard, player.id, trickLabel);
      this.log(
        'judge',
        `${player.name} 判定区的【${trickLabel}】(${formatCard(delayedCard)}) 开始结算`,
        player.id,
        undefined,
        [delayedCard.id]
      );

      const nullified = yield* this.askNullification(
        delayedKind,
        player.id,
        delayedCard,
        false
      );

      if (nullified) {
        this.log('trick', `${player.name} 的【${trickLabel}】被【无懈可击】抵消`, player.id);
        if (delayedKind === 'lightning') {
          this.passLightningToNext(player, delayedCard);
        } else {
          this.moveToDiscard(delayedCard);
        }
        continue;
      }

      // SingleTrickBeforeEffect (界陆逊【谦逊】)
      const singleCtx: SingleTrickContext = {
        actorId: null,
        targetId: player.id,
        card: delayedCard,
        isDelayed: true
      };
      yield* this.fireTrigger('SingleTrickBeforeEffect', {
        playerId: player.id,
        singleTrick: singleCtx
      });
      if (this.state.result || !player.alive) {
        this.moveToDiscard(delayedCard);
        return;
      }

      const judgeCard = yield* this.resolveJudge(player.id, trickLabel);
      const effSuit = this.modifiers.getEffectiveSuit(this.state, player, judgeCard);

      if (delayedKind === 'indulgence') {
        this.moveToDiscard(delayedCard);
        if (effSuit !== 'heart') {
          this.state.skippedPhases.push('play');
          this.log('judge', `【乐不思蜀】判定非红桃，${player.name} 跳过本回合出牌阶段！`, player.id);
        } else {
          this.log('judge', `【乐不思蜀】判定红桃，天过！`, player.id);
        }
      } else if (delayedKind === 'supply_shortage') {
        this.moveToDiscard(delayedCard);
        if (effSuit !== 'club') {
          this.state.skippedPhases.push('draw');
          this.log('judge', `【兵粮寸断】判定非梅花，${player.name} 跳过本回合摸牌阶段！`, player.id);
        } else {
          this.log('judge', `【兵粮寸断】判定梅花，天过！`, player.id);
        }
      } else if (delayedKind === 'lightning') {
        if (effSuit === 'spade' && judgeCard.rank >= 2 && judgeCard.rank <= 9) {
          this.moveToDiscard(delayedCard);
          this.log('judge', `【闪电】判定黑桃 2~9！${player.name} 受到 3 点雷电伤害！`, player.id);
          yield* this.applyDamage({
            sourceId: null,
            targetId: player.id,
            amount: 3,
            element: 'thunder',
            card: delayedCard,
            isChainDamage: false,
            prevented: false,
            armorIgnored: false,
            wasChainedBeforeDeduct: player.chained,
            actualDeducted: 0
          });
        } else {
          this.log('judge', `【闪电】未劈中，移至下家判定区`, player.id);
          this.passLightningToNext(player, delayedCard);
        }
      } else {
        this.moveToDiscard(delayedCard);
      }
    }
  }

  private passLightningToNext(fromPlayer: PlayerState, lightningCard: CardInstance): void {
    const others = getAlivePlayersInOrder(this.state, fromPlayer.id, false);
    for (const candidate of others) {
      if (!candidate.judgeZone.some((c) => (c.asDelayedTrick ?? c.name) === 'lightning')) {
        candidate.judgeZone.push(lightningCard);
        return;
      }
    }
    if (
      fromPlayer.alive &&
      !fromPlayer.judgeZone.some((c) => (c.asDelayedTrick ?? c.name) === 'lightning')
    ) {
      fromPlayer.judgeZone.push(lightningCard);
    } else {
      this.moveToDiscard(lightningCard);
    }
  }

  private *runDrawPhase(player: PlayerState, isFirstTurn: boolean): EngineGenerator {
    const base = this.modeRules.getDrawPhaseCount(this.state, player, isFirstTurn);
    const delta = this.modifiers.getDrawCountDelta(this.state, player);
    const count = Math.max(0, base + delta);
    const drawn = this.drawForPlayer(player.id, count);
    this.log('draw', `${player.name} 摸了 ${drawn.length} 张牌`, player.id);
    yield* this.fireTrigger('DrawCards', { playerId: player.id, drawCount: drawn.length });
  }

  private *runPlayPhase(player: PlayerState): EngineGenerator {
    while (player.alive && !this.state.result) {
      const playableInfos = getAllPlayableCards(this.state, player.id, this.modifiers);
      const playableCardIds = playableInfos.map((i) => i.cardId);
      const canRecastCardIds = playableInfos
        .filter((i) => i.canRecast)
        .map((i) => i.cardId);
      const canUseSerpent = canUseSerpentSpearInPlay(this.state, player.id, this.modifiers);
      const canUseOx = canUseWoodenOxInPlay(this.state, player.id);
      const usableSkills = this.skills.getAllActiveInfos(this.state, player, this.modifiers);

      const response = yield* this.ask({
        type: 'play_action',
        promptId: this.nextPromptId(),
        playerId: player.id,
        message: `${player.name} 出牌阶段`,
        playableCardIds,
        canRecastCardIds,
        canUseSerpentSpear: canUseSerpent,
        canUseWoodenOx: canUseOx,
        usableSkillIds: usableSkills.map((s) => s.skillId),
        usableSkills
      });

      if (response.type !== 'play_action') {
        break;
      }

      const action = response.action;
      if (action.type === 'end_play_phase') {
        this.log('phase', `${player.name} 结束出牌阶段`, player.id);
        break;
      }

      if (action.type === 'activate_skill') {
        const handler = this.skills.getActive(action.skillId);
        if (!handler) continue;
        if (!handler.allowWithoutOwnSkill && !hasActiveSkill(player, action.skillId)) continue;
        const info = handler.getPromptInfo(this.state, player, this.modifiers);
        if (!info) continue;
        const cIds = action.cardIds ?? [];
        const tIds = action.targetIds ?? [];
        if (cIds.length < info.cardMin || cIds.length > info.cardMax) continue;
        if (tIds.length < info.targetMin || tIds.length > info.targetMax) continue;
        if (!cIds.every((id) => info.eligibleCardIds.includes(id))) continue;
        if (!tIds.every((id) => info.eligibleTargetIds.includes(id))) continue;
        yield* handler.execute(
          this.state,
          player,
          cIds,
          tIds,
          this.createTriggerHelpers()
        );
        continue;
      }

      if (action.type === 'serpent_spear') {
        if (!canUseSerpentSpearInPlay(this.state, player.id, this.modifiers)) continue;
        const [id1, id2] = action.cardIds;
        if (id1 === id2) continue;
        let targetIds = action.targetIds.filter(
          (tid) =>
            isInAttackRange(this.state, player.id, tid, this.modifiers) &&
            this.modifiers.canBeTargetedByCard(this.state, player, this.getPlayer(tid), 'slash')
        );
        targetIds = this.modifiers.filterSlashTargets(this.state, player, targetIds);
        if (targetIds.length === 0) continue;

        const prevHand = player.hand.length;
        const c1 = removeUsableCard(player, id1);
        const c2 = removeUsableCard(player, id2);
        if (!c1 || !c2) {
          if (c1) player.hand.push(c1);
          if (c2) player.hand.push(c2);
          continue;
        }
        this.pushTableCard(c1, player.id, '丈八蛇矛');
        this.pushTableCard(c2, player.id, '丈八蛇矛');
        this.moveToDiscard(c1);
        this.moveToDiscard(c2);

        const virtualSlash = buildSerpentSpearVirtualSlash([c1, c2]);
        player.slashUsedThisTurn += 1;
        player.stats.cardsPlayed += 1;
        const targets = targetIds.map((tid) => this.getPlayer(tid));
        this.log(
          'play',
          `${player.name} 发动【丈八蛇矛】将 ${formatCard(c1)} + ${formatCard(c2)} 当【杀】对 ${targets.map((t) => t.name).join('、')} 使用`,
          player.id,
          targetIds,
          [c1.id, c2.id]
        );
        yield* this.checkHandEmptied(player.id, prevHand);
        yield* this.resolveSlash(player, targets, virtualSlash, {
          countTowardLimit: false,
          useDrunkBonus: true
        });
        continue;
      }

      if (action.type === 'wooden_ox_stash') {
        if (!canUseWoodenOxInPlay(this.state, player.id)) continue;
        const prevHand = player.hand.length;
        const handIdx = player.hand.findIndex((c) => c.id === action.cardId);
        if (handIdx === -1) continue;
        const stashed = player.hand.splice(handIdx, 1)[0];
        player.woodenOxCards.push(stashed);
        player.woodenOxUsedThisTurn = true;
        this.log(
          'equip',
          `${player.name} 发动【木牛流马】扣置了一张手牌（当前 ${player.woodenOxCards.length} 张）`,
          player.id
        );
        yield* this.checkHandEmptied(player.id, prevHand);

        if (action.transferTargetId && action.transferTargetId !== player.id) {
          const target = this.state.players.find(
            (p) => p.id === action.transferTargetId && p.alive
          );
          if (target && player.equips.treasure?.name === 'wooden_ox') {
            const oxCard = player.equips.treasure;
            const movedStash = player.woodenOxCards.splice(0, player.woodenOxCards.length);
            player.equips.treasure = null;
            if (target.equips.treasure) {
              const oldTargetTreasure = target.equips.treasure;
              target.equips.treasure = null;
              this.moveToDiscard(oldTargetTreasure);
              if (oldTargetTreasure.name === 'wooden_ox') {
                for (const c of target.woodenOxCards.splice(0)) {
                  this.moveToDiscard(c);
                }
              }
              yield* this.fireTrigger('EquipLost', {
                playerId: target.id,
                lostEquip: oldTargetTreasure
              });
            }
            target.equips.treasure = oxCard;
            target.woodenOxCards.push(...movedStash);
            this.log(
              'equip',
              `${player.name} 将【木牛流马】（含 ${movedStash.length} 张扣置牌）移动至 ${target.name} 的装备区`,
              player.id,
              [target.id],
              [oxCard.id]
            );
          }
        }
        continue;
      }

      if (action.type === 'play_card') {
        const cardObj = getUsableCards(player).find((c) => c.id === action.cardId);
        if (!cardObj) continue;
        const info = getPlayableCardInfo(this.state, player.id, cardObj, this.modifiers);
        if (!info) continue;

        yield* this.executePlayCard(player, cardObj, info, action);
      }
    }
  }

  private *executePlayCard(
    player: PlayerState,
    card: CardInstance,
    info: PlayableCardInfo,
    action: {
      cardId: number;
      targetIds?: string[];
      secondaryTargetId?: string;
      asFireSlash?: boolean;
      recast?: boolean;
    }
  ): EngineGenerator {
    // Handle Iron Chain Recast (重铸)
    if (card.name === 'iron_chain' && action.recast) {
      const prevHand = player.hand.length;
      const removed = removeUsableCard(player, card.id);
      if (!removed) return;
      this.pushTableCard(removed, player.id, '重铸');
      this.moveToDiscard(removed);
      const drawn = this.drawForPlayer(player.id, 1);
      player.stats.cardsPlayed += 1;
      this.log(
        'play',
        `${player.name} 重铸了 ${formatCard(removed)}，摸了一张牌`,
        player.id,
        undefined,
        [removed.id]
      );
      yield* this.checkHandEmptied(player.id, prevHand);
      yield* this.notifyCardsObtained(player.id, drawn);
      return;
    }

    const chosenTargetIds = action.targetIds ?? [];
    if (info.needsTarget) {
      if (
        chosenTargetIds.length < info.minTargets ||
        chosenTargetIds.length > info.maxTargets ||
        !chosenTargetIds.every((id) => info.eligibleTargetIds.includes(id))
      ) {
        return;
      }
    }

    const prevHand = player.hand.length;
    const removed = removeUsableCard(player, card.id);
    if (!removed) return;
    player.stats.cardsPlayed += 1;

    // 1. Equipment
    if (removed.category === 'equip') {
      const slot = getEquipSlot(removed)!;
      const oldEquip = player.equips[slot];
      player.equips[slot] = removed;
      this.log('equip', `${player.name} 装备了 ${formatCard(removed)}`, player.id, undefined, [removed.id]);
      yield* this.checkHandEmptied(player.id, prevHand);
      if (oldEquip) {
        this.moveToDiscard(oldEquip);
        if (slot === 'treasure' && oldEquip.name === 'wooden_ox') {
          for (const oxCard of player.woodenOxCards.splice(0)) {
            this.moveToDiscard(oxCard);
          }
        }
        yield* this.fireTrigger('EquipLost', { playerId: player.id, lostEquip: oldEquip });
      }
      return;
    }

    // 2. Delayed Tricks
    if (removed.subtype === 'delayed_trick') {
      const target =
        removed.name === 'lightning' ? player : this.getPlayer(chosenTargetIds[0]);
      target.judgeZone.push(removed);
      this.log(
        'play',
        `${player.name} 对 ${target.name} 使用了延时锦囊 ${formatCard(removed)}`,
        player.id,
        [target.id],
        [removed.id]
      );
      yield* this.checkHandEmptied(player.id, prevHand);
      return;
    }

    // 3. Basic Cards
    if (isSlashCardName(removed.name)) {
      this.pushTableCard(removed, player.id);
      this.moveToDiscard(removed);
      player.slashUsedThisTurn += 1;
      yield* this.checkHandEmptied(player.id, prevHand);

      let virtualSlash = toVirtualCard(removed);
      if (removed.name === 'slash' && player.equips.weapon?.name === 'fan') {
        let convert = Boolean(action.asFireSlash);
        if (action.asFireSlash === undefined) {
          const opt = yield* this.ask({
            type: 'choose_option',
            promptId: this.nextPromptId(),
            playerId: player.id,
            reason: 'fan',
            message: '是否发动【朱雀羽扇】，将此普通【杀】转为【火杀】使用？',
            options: [
              { id: 'yes', label: '转为【火杀】' },
              { id: 'no', label: '保持普通【杀】' }
            ]
          });
          convert = opt.type === 'choose_option' && opt.optionId === 'yes';
        }
        if (convert) {
          virtualSlash = toVirtualCard(removed, 'fire_slash', 'fire');
          this.log('equip', `${player.name} 发动【朱雀羽扇】，将【杀】转化为【火杀】！`, player.id);
        }
      }

      const orderedAlive = getAlivePlayersInOrder(this.state, player.id, false);
      const targets = orderedAlive.filter((p) => chosenTargetIds.includes(p.id));
      this.log(
        'play',
        `${player.name} 对 ${targets.map((t) => t.name).join('、')} 使用了 ${formatCard(virtualSlash)}`,
        player.id,
        targets.map((t) => t.id),
        [removed.id]
      );
      yield* this.resolveSlash(player, targets, virtualSlash, {
        countTowardLimit: false,
        useDrunkBonus: true
      });
      return;
    }

    if (removed.name === 'peach') {
      this.pushTableCard(removed, player.id);
      this.moveToDiscard(removed);
      yield* this.checkHandEmptied(player.id, prevHand);
      const healed = yield* this.healPlayerAsync(player.id, 1);
      if (healed > 0) {
        this.log(
          'heal',
          `${player.name} 使用了 ${formatCard(removed)}，回复 ${healed} 点体力（HP ${player.hp}/${player.maxHp}）`,
          player.id,
          [player.id],
          [removed.id]
        );
      }
      return;
    }

    if (removed.name === 'alcohol') {
      this.pushTableCard(removed, player.id);
      this.moveToDiscard(removed);
      yield* this.checkHandEmptied(player.id, prevHand);
      player.drunk = true;
      player.drunkUsedThisTurn += 1;
      this.log(
        'play',
        `${player.name} 使用了 ${formatCard(removed)}，本回合下一张【杀】伤害+1`,
        player.id,
        undefined,
        [removed.id]
      );
      return;
    }

    // 4. Normal Tricks
    this.pushTableCard(removed, player.id);
    this.moveToDiscard(removed);
    yield* this.checkHandEmptied(player.id, prevHand);
    yield* this.fireTrigger('CardUsed', { playerId: player.id, card: removed });
    yield* this.resolveNormalTrick(player, removed, chosenTargetIds, action.secondaryTargetId);
  }

  private *resolveSlash(
    attacker: PlayerState,
    targets: PlayerState[],
    slashCard: VirtualCard,
    options: { countTowardLimit: boolean; useDrunkBonus: boolean }
  ): EngineGenerator {
    if (options.countTowardLimit) {
      attacker.slashUsedThisTurn += 1;
    }
    const baseDamage = options.useDrunkBonus && attacker.drunk ? 2 : 1;
    if (options.useDrunkBonus && attacker.drunk) {
      attacker.drunk = false;
    }

    for (const originalTarget of targets) {
      if (!originalTarget.alive || this.state.result) continue;

      // 1. TargetConfirmed (allows Da Qiao's 流离 to redirect target!)
      const slashTargetCtx: SlashTargetContext = {
        attackerId: attacker.id,
        targetId: originalTarget.id,
        slashCard,
        cannotDodge: false
      };
      yield* this.fireTrigger('TargetConfirmed', {
        playerId: originalTarget.id,
        slashTarget: slashTargetCtx
      });
      if (this.state.result) return;
      if (slashTargetCtx.cancelled) continue;

      const target = slashTargetCtx.redirectedTargetId
        ? this.getPlayer(slashTargetCtx.redirectedTargetId)
        : originalTarget;
      if (!target.alive) continue;
      slashTargetCtx.targetId = target.id;

      // 2. TargetSpecified (allows Ma Chao's 铁骑 to set cannotDodge!)
      yield* this.fireTrigger('TargetSpecified', {
        playerId: attacker.id,
        slashTarget: slashTargetCtx
      });
      if (this.state.result || !target.alive || slashTargetCtx.cancelled) continue;

      const armorIgnored = this.modifiers.isArmorIgnored(
        this.state,
        attacker,
        target,
        slashCard
      );

      // 雌雄双股剑
      if (
        attacker.alive &&
        attacker.equips.weapon?.name === 'double_swords' &&
        attacker.gender !== target.gender
      ) {
        const triggerOpt = yield* this.ask({
          type: 'choose_option',
          promptId: this.nextPromptId(),
          playerId: attacker.id,
          reason: 'double_swords',
          message: `是否对异性角色 ${target.name} 发动【雌雄双股剑】？`,
          options: [
            { id: 'yes', label: '发动【雌雄双股剑】' },
            { id: 'no', label: '不发动' }
          ]
        });
        if (triggerOpt.type === 'choose_option' && triggerOpt.optionId === 'yes') {
          this.log('equip', `${attacker.name} 对 ${target.name} 发动【雌雄双股剑】`, attacker.id, [target.id]);
          if (target.hand.length === 0) {
            this.drawForPlayer(attacker.id, 1);
            this.log('draw', `${target.name} 无手牌，${attacker.name} 摸了一张牌`, attacker.id);
          } else {
            const targetChoice = yield* this.ask({
              type: 'choose_option',
              promptId: this.nextPromptId(),
              playerId: target.id,
              reason: 'double_swords_choice',
              message: `${attacker.name} 发动了【雌雄双股剑】，请选择：`,
              options: [
                { id: 'discard', label: '弃置自己一张手牌' },
                { id: 'let_draw', label: `令 ${attacker.name} 摸一张牌` }
              ]
            });
            if (targetChoice.type === 'choose_option' && targetChoice.optionId === 'discard') {
              const cardPick = yield* this.ask({
                type: 'choose_card',
                promptId: this.nextPromptId(),
                playerId: target.id,
                reason: 'discard_double_swords',
                message: '请选择弃置一张手牌',
                minCount: 1,
                maxCount: 1,
                eligibleCardIds: target.hand.map((c) => c.id),
                optional: false
              });
              const cid =
                cardPick.type === 'choose_card' && cardPick.cardIds[0]
                  ? cardPick.cardIds[0]
                  : target.hand[0].id;
              const prevHand = target.hand.length;
              const removed = removeUsableCard(target, cid);
              if (removed) {
                this.moveToDiscard(removed);
                this.log('discard', `${target.name} 弃置了 ${formatCard(removed)}`, target.id, undefined, [removed.id]);
                yield* this.checkHandEmptied(target.id, prevHand);
                yield* this.notifyCardsLost(target.id, [removed], true);
              }
            } else {
              this.drawForPlayer(attacker.id, 1);
              this.log('draw', `${target.name} 选择让 ${attacker.name} 摸了一张牌`, attacker.id);
            }
          }
        }
      }

      // 仁王盾
      if (
        !armorIgnored &&
        target.equips.armor?.name === 'renwang_shield' &&
        slashCard.color === 'black'
      ) {
        this.log('equip', `${target.name} 的【仁王盾】生效，黑色【杀】无效！`, target.id);
        continue;
      }

      // 藤甲
      if (
        !armorIgnored &&
        target.equips.armor?.name === 'vine_armor' &&
        slashCard.element === 'normal'
      ) {
        this.log('equip', `${target.name} 的【藤甲】生效，普通【杀】无效！`, target.id);
        continue;
      }

      // Ask target for Dodge(s) (respecting Ma Chao 铁骑 cannotDodge & Lv Bu 无双 requiredDodges = 2!)
      let dodged = false;
      if (!slashTargetCtx.cannotDodge) {
        const requiredDodges = this.modifiers.getRequiredDodges(
          this.state,
          attacker,
          target,
          slashCard
        );
        dodged = true;
        for (let dIdx = 0; dIdx < requiredDodges; dIdx++) {
          const ok = yield* this.askDodge(target, attacker, slashCard, armorIgnored);
          if (this.state.result) return;
          if (!ok) {
            dodged = false;
            break;
          }
        }
      }

      let forcedHit = false;
      if (dodged) {
        yield* this.fireTrigger('SlashMissed', { playerId: attacker.id });

        // 贯石斧
        if (attacker.alive && attacker.equips.weapon?.name === 'axe') {
          const axeId = attacker.equips.weapon.id;
          const eligibleCards = [
            ...getUsableCards(attacker),
            ...getEquippedCards(attacker).filter((e) => e.id !== axeId)
          ];
          if (eligibleCards.length >= 2) {
            const axeResp = yield* this.ask({
              type: 'choose_card',
              promptId: this.nextPromptId(),
              playerId: attacker.id,
              reason: 'discard_axe',
              message: `是否发动【贯石斧】，弃置两张牌令此【杀】强制造成伤害？`,
              minCount: 2,
              maxCount: 2,
              eligibleCardIds: eligibleCards.map((c) => c.id),
              optional: true
            });
            if (
              axeResp.type === 'choose_card' &&
              !axeResp.cancelled &&
              axeResp.cardIds.length === 2
            ) {
              const uniqueIds = Array.from(new Set(axeResp.cardIds));
              if (uniqueIds.length === 2) {
                yield* this.discardPlayerCardsGen(attacker.id, uniqueIds);
                this.log(
                  'equip',
                  `${attacker.name} 发动【贯石斧】弃置两张牌，强制命中 ${target.name}！`,
                  attacker.id,
                  [target.id]
                );
                forcedHit = true;
              }
            }
          }
        }

        // 青龙偃月刀
        if (!forcedHit && attacker.alive && target.alive && attacker.equips.weapon?.name === 'blade') {
          const extraSlashIds = this.skills.getExtraSlashCardIds(this.state, attacker);
          const slashCards = [
            ...getUsableCards(attacker),
            ...getEquippedCards(attacker)
          ].filter((c) => isSlashCardName(c.name) || extraSlashIds.includes(c.id));
          if (slashCards.length > 0) {
            const bladeResp = yield* this.ask({
              type: 'choose_card',
              promptId: this.nextPromptId(),
              playerId: attacker.id,
              reason: 'slash_blade',
              message: `【青龙偃月刀】：是否对 ${target.name} 再使用一张【杀】？`,
              minCount: 1,
              maxCount: 1,
              eligibleCardIds: slashCards.map((c) => c.id),
              optional: true
            });
            if (
              bladeResp.type === 'choose_card' &&
              !bladeResp.cancelled &&
              bladeResp.cardIds.length === 1
            ) {
              const followCard = yield* this.removeCardFromPlayerGen(
                attacker.id,
                bladeResp.cardIds[0]
              );
              if (followCard) {
                this.pushTableCard(followCard, attacker.id, '青龙追杀');
                this.moveToDiscard(followCard);
                this.log(
                  'equip',
                  `${attacker.name} 发动【青龙偃月刀】对 ${target.name} 追杀 ${formatCard(followCard)}`,
                  attacker.id,
                  [target.id],
                  [followCard.id]
                );
                const vs = isSlashCardName(followCard.name)
                  ? toVirtualCard(followCard)
                  : toVirtualCard(followCard, 'slash', 'normal');
                yield* this.resolveSlash(attacker, [target], vs, {
                  countTowardLimit: false,
                  useDrunkBonus: false
                });
              }
            }
          }
        }
      }

      if (!dodged || forcedHit) {
        yield* this.applyDamage({
          sourceId: attacker.alive ? attacker.id : null,
          targetId: target.id,
          amount: baseDamage,
          element: slashCard.element,
          card: slashCard,
          isChainDamage: false,
          prevented: false,
          armorIgnored,
          wasChainedBeforeDeduct: target.chained,
          actualDeducted: 0
        });
      }
    }
  }

  private *askDodge(
    target: PlayerState,
    source: PlayerState,
    sourceCard: CardInstance | VirtualCard,
    armorIgnored: boolean
  ): Generator<PromptRequest, boolean, PlayerResponse> {
    // 0. Lord assist skills (e.g., 曹操【护驾】)
    const helpers = this.createTriggerHelpers();
    for (const hook of this.skills.getResponseHooks()) {
      if (hook.assistDodge) {
        const assisted = yield* hook.assistDodge(
          this.state,
          target,
          source,
          sourceCard,
          helpers
        );
        if (assisted) return true;
      }
    }

    // 1. 八卦阵 / 卧龙诸葛亮【八阵】
    const hasVirtualTrigrams = this.modifiers.hasVirtualEightTrigrams(this.state, target);
    if (!armorIgnored && (target.equips.armor?.name === 'eight_trigrams' || hasVirtualTrigrams)) {
      const trigramsLabel = hasVirtualTrigrams ? '八阵(八卦阵)' : '八卦阵';
      const opt = yield* this.ask({
        type: 'choose_option',
        promptId: this.nextPromptId(),
        playerId: target.id,
        reason: 'eight_trigrams',
        message: `面对 ${source.name} 的 ${formatCard(sourceCard)}，是否发动【${trigramsLabel}】进行判定？`,
        options: [
          { id: 'yes', label: `发动【${trigramsLabel}】判定` },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type === 'choose_option' && opt.optionId === 'yes') {
        const judgeCard = yield* this.resolveJudge(target.id, trigramsLabel);
        const effSuit = this.modifiers.getEffectiveSuit(this.state, target, judgeCard);
        if (getCardColor(effSuit) === 'red') {
          this.log('equip', `${target.name} 【${trigramsLabel}】判定红色，视为打出【闪】！`, target.id);
          yield* this.fireTrigger('CardResponded', {
            playerId: target.id,
            virtualCard: {
              name: 'dodge',
              displayName: '闪(八卦)',
              suit: effSuit,
              rank: judgeCard.rank,
              color: 'red',
              element: 'normal',
              subcards: []
            }
          });
          return true;
        }
        this.log('equip', `${target.name} 【${trigramsLabel}】判定黑色，未生效`, target.id);
      }
    }

    // 2. Dodge cards + view-as Dodge skills (赵云龙胆, 甄姬倾国)
    const handIds = new Set(target.hand.map((c) => c.id));
    const extraDodgeIds = this.skills.getExtraDodgeCardIds(this.state, target);
    const dodges = getUsableCards(target).filter(
      (c) =>
        (!target.cannotPlayHandCardsThisTurn || !handIds.has(c.id)) &&
        (c.name === 'dodge' || extraDodgeIds.includes(c.id))
    );
    if (dodges.length === 0) return false;

    const resp = yield* this.ask({
      type: 'choose_card',
      promptId: this.nextPromptId(),
      playerId: target.id,
      reason: 'dodge',
      message: `请打出一张【闪】抵消 ${source.name} 的 ${formatCard(sourceCard)}`,
      minCount: 1,
      maxCount: 1,
      eligibleCardIds: dodges.map((c) => c.id),
      optional: true
    });

    if (resp.type === 'choose_card' && !resp.cancelled && resp.cardIds.length === 1) {
      const prevHand = target.hand.length;
      const wasFromHand = handIds.has(resp.cardIds[0]);
      const card = removeUsableCard(target, resp.cardIds[0]);
      if (card) {
        this.pushTableCard(card, target.id, card.name === 'dodge' ? '闪避' : '转化闪');
        this.moveToDiscard(card);
        this.log('respond', `${target.name} 打出了 ${formatCard(card)}`, target.id, undefined, [card.id]);
        const effDodge: VirtualCard = {
          name: 'dodge',
          displayName: '闪',
          suit: card.suit,
          rank: card.rank,
          color: getCardColor(card.suit),
          element: 'normal',
          subcards: [card]
        };
        yield* this.checkHandEmptied(target.id, prevHand);
        yield* this.notifyCardsLost(target.id, [card], false);
        yield* this.fireTrigger('CardResponded', {
          playerId: target.id,
          card,
          virtualCard: effDodge
        });
        if (wasFromHand) {
          yield* this.notifyOutOfTurnCard(target.id, effDodge, true);
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Asks a player to play a Slash (for Duel, Savage Assault, Collateral).
   * Supports Serpent Spear, View-As Slash (武圣/龙胆), and Lord Assist (激将)!
   */
  private *askSlashResponse(
    responder: PlayerState,
    reason: 'slash_duel' | 'slash_savage' | 'slash_collateral',
    message: string
  ): Generator<PromptRequest, VirtualCard | null, PlayerResponse> {
    const active = this.state.players[this.state.activePlayerIndex];
    const markKeji = () => {
      if (active && active.id === responder.id && this.state.phase === 'play') {
        responder.marks['keji_slashed'] = 1;
      }
    };

    // 0. Lord assist Slash (刘备【激将】)
    const helpers = this.createTriggerHelpers();
    for (const hook of this.skills.getResponseHooks()) {
      if (hook.assistSlash) {
        const assisted = yield* hook.assistSlash(this.state, responder, reason, helpers);
        if (assisted) {
          markKeji();
          return assisted;
        }
      }
    }

    const handIds = new Set(responder.hand.map((c) => c.id));
    const usable = getUsableCards(responder).filter(
      (c) => !responder.cannotPlayHandCardsThisTurn || !handIds.has(c.id)
    );
    const extraSlashIds = this.skills.getExtraSlashCardIds(this.state, responder);
    const allCandidateCards = [...usable, ...getEquippedCards(responder)];
    const slashes = allCandidateCards.filter(
      (c) => isSlashCardName(c.name) || extraSlashIds.includes(c.id)
    );
    const canSpear =
      responder.equips.weapon?.name === 'serpent_spear' && usable.length >= 2;

    if (slashes.length === 0 && !canSpear) {
      return null;
    }

    const eligibleIds = canSpear
      ? Array.from(new Set([...usable.map((c) => c.id), ...slashes.map((c) => c.id)]))
      : slashes.map((c) => c.id);

    const resp = yield* this.ask({
      type: 'choose_card',
      promptId: this.nextPromptId(),
      playerId: responder.id,
      reason,
      message,
      minCount: 1,
      maxCount: canSpear ? 2 : 1,
      eligibleCardIds: eligibleIds,
      optional: true,
      canUseSerpentSpear: canSpear
    });

    if (resp.type !== 'choose_card' || resp.cancelled) return null;

    if (resp.useSerpentSpear && canSpear && resp.cardIds.length === 2) {
      const [id1, id2] = resp.cardIds;
      if (id1 === id2) return null;
      const prevHand = responder.hand.length;
      const c1 = removeUsableCard(responder, id1);
      const c2 = removeUsableCard(responder, id2);
      if (!c1 || !c2) {
        if (c1) responder.hand.push(c1);
        if (c2) responder.hand.push(c2);
        return null;
      }
      this.pushTableCard(c1, responder.id, '丈八响应');
      this.pushTableCard(c2, responder.id, '丈八响应');
      this.moveToDiscard(c1);
      this.moveToDiscard(c2);
      markKeji();
      const vs = buildSerpentSpearVirtualSlash([c1, c2]);
      this.log(
        'respond',
        `${responder.name} 发动【丈八蛇矛】打出 ${formatCard(c1)} + ${formatCard(c2)} 当【杀】`,
        responder.id,
        undefined,
        [c1.id, c2.id]
      );
      yield* this.checkHandEmptied(responder.id, prevHand);
      yield* this.notifyCardsLost(responder.id, [c1, c2], false);
      yield* this.notifyOutOfTurnCard(responder.id, vs, true);
      return vs;
    }

    if (resp.cardIds.length === 1) {
      const chosen = slashes.find((c) => c.id === resp.cardIds[0]);
      if (!chosen) return null;
      const wasFromHand = handIds.has(chosen.id);
      const removed = yield* this.removeCardFromPlayerGen(responder.id, chosen.id);
      if (!removed) return null;
      this.pushTableCard(removed, responder.id, isSlashCardName(removed.name) ? '响应出杀' : '转化杀');
      this.moveToDiscard(removed);
      markKeji();
      this.log('respond', `${responder.name} 打出了 ${formatCard(removed)}`, responder.id, undefined, [removed.id]);
      yield* this.fireTrigger('CardResponded', { playerId: responder.id, card: removed });
      let resultVs = isSlashCardName(removed.name)
        ? toVirtualCard(removed)
        : toVirtualCard(removed, 'slash', 'normal');
      if (
        reason === 'slash_collateral' &&
        removed.name === 'slash' &&
        responder.equips.weapon?.name === 'fan'
      ) {
        const opt = yield* this.ask({
          type: 'choose_option',
          promptId: this.nextPromptId(),
          playerId: responder.id,
          reason: 'fan',
          message: '是否发动【朱雀羽扇】，将此普通【杀】转为【火杀】使用？',
          options: [
            { id: 'yes', label: '转为【火杀】' },
            { id: 'no', label: '保持普通【杀】' }
          ]
        });
        if (opt.type === 'choose_option' && opt.optionId === 'yes') {
          this.log('equip', `${responder.name} 发动【朱雀羽扇】，将【杀】转化为【火杀】！`, responder.id);
          resultVs = toVirtualCard(removed, 'fire_slash', 'fire');
        }
      }
      if (wasFromHand) {
        yield* this.notifyOutOfTurnCard(responder.id, resultVs, true);
      }
      return resultVs;
    }

    return null;
  }

  private *askNullification(
    trickName: string,
    targetId: string,
    trickCard: CardInstance,
    isCounteringNullification: boolean,
    depth = 0
  ): Generator<PromptRequest, boolean, PlayerResponse> {
    if (depth > 16) return false;
    const activePlayer = this.state.players[this.state.activePlayerIndex];
    const targetPlayer = this.getPlayer(targetId);
    const trickKey = `${trickName}`;

    while (!this.state.result) {
      let someonePlayedAndGotCountered = false;
      const order = getAlivePlayersInOrder(this.state, activePlayer.id, true);

      for (const p of order) {
        const pHandIds = new Set(p.hand.map((c) => c.id));
        const extraNullIds = this.skills.getExtraNullificationCardIds(this.state, p);
        const allCandidates = [...getUsableCards(p), ...getEquippedCards(p)];
        const nullCards = allCandidates.filter(
          (c) =>
            (!p.cannotPlayHandCardsThisTurn || !pHandIds.has(c.id)) &&
            (c.name === 'nullification' || extraNullIds.includes(c.id))
        );
        if (nullCards.length === 0) continue;

        const skippedList = this.state.nullificationSkipByPlayer[p.id] ?? [];
        if (!isCounteringNullification && skippedList.includes(trickKey)) {
          continue;
        }

        const label = isCounteringNullification
          ? `是否使用【无懈可击】反制 ${targetPlayer.name} 的【无懈可击】？`
          : `是否使用【无懈可击】抵消对 ${targetPlayer.name} 生效的 ${formatCard(trickCard)}？`;

        const resp = yield* this.ask({
          type: 'choose_card',
          promptId: this.nextPromptId(),
          playerId: p.id,
          reason: 'nullification',
          message: label,
          minCount: 1,
          maxCount: 1,
          eligibleCardIds: nullCards.map((c) => c.id),
          optional: true,
          trickKeyForQuickSkip: isCounteringNullification ? undefined : trickKey
        });

        if (
          resp.type === 'choose_card' &&
          resp.skipSimilarTrickThisTurn &&
          !isCounteringNullification
        ) {
          this.state.nullificationSkipByPlayer[p.id] = [...skippedList, trickKey];
        }

        if (resp.type === 'choose_card' && !resp.cancelled && resp.cardIds.length === 1) {
          const wasFromHand = pHandIds.has(resp.cardIds[0]);
          const nc = yield* this.removeCardFromPlayerGen(p.id, resp.cardIds[0]);
          if (nc) {
            this.pushTableCard(nc, p.id, nc.name === 'nullification' ? '无懈可击' : '转化无懈');
            this.moveToDiscard(nc);
            p.stats.cardsPlayed += 1;
            this.log(
              'trick',
              `${p.name} 对 ${isCounteringNullification ? `${targetPlayer.name} 的【无懈可击】` : `${targetPlayer.name} 的 ${formatCard(trickCard)}`} 使用了 ${formatCard(nc)}（无懈可击）！`,
              p.id,
              [targetPlayer.id],
              [nc.id]
            );
            yield* this.fireTrigger('CardUsed', { playerId: p.id, card: nc });
            if (wasFromHand) {
              yield* this.notifyOutOfTurnCard(p.id, nc, true);
            }
            const countered = yield* this.askNullification(
              'nullification',
              p.id,
              nc,
              true,
              depth + 1
            );
            if (!countered) {
              return true;
            }
            someonePlayedAndGotCountered = true;
            break;
          }
        }
      }

      if (!someonePlayedAndGotCountered) {
        return false;
      }
    }
    return false;
  }

  private *resolveDuel(
    user: PlayerState,
    target: PlayerState,
    card: CardInstance | VirtualCard,
    cannotNullify = false
  ): EngineGenerator {
    yield* this.fireTrigger('DuelTargeted', {
      duelUserId: user.id,
      duelTargetId: target.id
    });
    if (this.state.result || !target.alive) return;

    if (!cannotNullify && 'pack' in card) {
      const nullified = yield* this.askNullification('duel', target.id, card, false);
      if (nullified || !target.alive) return;
    }

    if ('pack' in card && user.id !== target.id) {
      yield* this.fireTrigger('SingleTrickBeforeEffect', {
        playerId: target.id,
        singleTrick: {
          actorId: user.id,
          targetId: target.id,
          card,
          isDelayed: false
        }
      });
      if (this.state.result || !target.alive) return;
    }

    let responder = target;
    let opponent = user;
    while (responder.alive && opponent.alive && !this.state.result) {
      const needed = this.modifiers.getRequiredDuelSlashes(this.state, responder, opponent);
      let satisfied = true;
      for (let i = 0; i < needed; i++) {
        const played = yield* this.askSlashResponse(
          responder,
          'slash_duel',
          `【决斗】（需打 ${i + 1}/${needed} 张【杀】）：请打出一张【杀】，否则受到 ${opponent.name} 造成的 1 点伤害`
        );
        if (!played) {
          satisfied = false;
          break;
        }
      }
      if (!satisfied) {
        yield* this.applyDamage({
          sourceId: opponent.alive ? opponent.id : null,
          targetId: responder.id,
          amount: 1,
          element: 'normal',
          card,
          isChainDamage: false,
          prevented: false,
          armorIgnored: false,
          wasChainedBeforeDeduct: responder.chained,
          actualDeducted: 0
        });
        return;
      }
      const tmp = responder;
      responder = opponent;
      opponent = tmp;
    }
  }

  private *resolveNormalTrick(
    actor: PlayerState,
    card: CardInstance,
    targetIds: string[],
    secondaryTargetId?: string
  ): EngineGenerator {
    switch (card.name) {
      case 'ex_nihilo': {
        this.log('play', `${actor.name} 使用了 ${formatCard(card)}`, actor.id, [actor.id], [card.id]);
        const nullified = yield* this.askNullification('ex_nihilo', actor.id, card, false);
        if (!nullified && actor.alive) {
          const drawn = this.drawForPlayer(actor.id, 2);
          this.log('draw', `${actor.name} 【无中生有】摸了 ${drawn.length} 张牌`, actor.id);
          yield* this.notifyCardsObtained(actor.id, drawn);
        }
        return;
      }

      case 'dismantle':
      case 'snatch': {
        const target = this.getPlayer(targetIds[0]);
        this.log('play', `${actor.name} 对 ${target.name} 使用了 ${formatCard(card)}`, actor.id, [target.id], [card.id]);
        const nullified = yield* this.askNullification(card.name, target.id, card, false);
        if (nullified || !target.alive) return;

        if (actor.id !== target.id) {
          yield* this.fireTrigger('SingleTrickBeforeEffect', {
            playerId: target.id,
            singleTrick: { actorId: actor.id, targetId: target.id, card, isDelayed: false }
          });
          if (this.state.result || !target.alive) return;
        }

        const rawChoices = buildPlayerCardChoices(target, {
          includeHand: true,
          includeEquips: true,
          includeJudge: true
        });
        const choices =
          card.name === 'dismantle'
            ? rawChoices.filter((ch) =>
                ch.zone === 'hand' || ch.zone === 'judge'
                  ? true
                  : this.modifiers.canDiscardEquip(this.state, actor, target, ch.zone as EquipSlot)
              )
            : rawChoices;
        if (choices.length === 0) return;

        const pick = yield* this.ask({
          type: 'choose_player_card',
          promptId: this.nextPromptId(),
          playerId: actor.id,
          targetId: target.id,
          reason: card.name,
          message: `选择${card.name === 'dismantle' ? '弃置' : '获得'} ${target.name} 区域内的一张牌`,
          choices
        });
        const idx = pick.type === 'choose_player_card' ? pick.choiceIndex : 0;
        const choice = choices[idx] ?? choices[0];
        if (!choice) return;
        const prevHand = target.hand.length;
        const extracted = extractChoiceCard(target, choice);
        if (!extracted) return;

        if (extracted.card.asDelayedTrick) {
          delete extracted.card.asDelayedTrick;
        }
        if (card.name === 'dismantle') {
          this.moveToDiscard(extracted.card);
          this.log('discard', `${actor.name} 弃置了 ${target.name} 的 ${formatCard(extracted.card)}`, actor.id, [target.id], [extracted.card.id]);
        } else {
          actor.hand.push(extracted.card);
          this.log('trick', `${actor.name} 获得了 ${target.name} 的一张牌`, actor.id, [target.id]);
        }
        for (const oxCard of extracted.lostWoodenOxStash) {
          this.moveToDiscard(oxCard);
        }
        if (extracted.wasEquip) {
          yield* this.fireTrigger('EquipLost', { playerId: target.id, lostEquip: extracted.card });
        }
        yield* this.checkHandEmptied(target.id, prevHand);
        yield* this.notifyCardsLost(
          target.id,
          [extracted.card],
          !extracted.wasEquip && choice.zone === 'hand'
        );
        if (card.name === 'snatch' && actor.alive) {
          yield* this.notifyCardsObtained(actor.id, [extracted.card]);
        }
        return;
      }

      case 'duel': {
        const target = this.getPlayer(targetIds[0]);
        this.log('play', `${actor.name} 对 ${target.name} 使用了 ${formatCard(card)}`, actor.id, [target.id], [card.id]);
        yield* this.resolveDuel(actor, target, card, false);
        return;
      }

      case 'savage_assault': {
        this.log('play', `${actor.name} 使用了 ${formatCard(card)}`, actor.id, undefined, [card.id]);
        const targets = getAlivePlayersInOrder(this.state, actor.id, false);
        const trickTargets: TrickTargetsContext = {
          actorId: actor.id,
          card,
          targetIds: targets.map((t) => t.id),
          cancelledTargetIds: []
        };
        yield* this.fireTrigger('TrickTargetsSpecified', {
          playerId: actor.id,
          trickTargets
        });
        for (const target of targets) {
          if (!target.alive || this.state.result) continue;
          if (trickTargets.cancelledTargetIds.includes(target.id)) continue;
          if (target.equips.armor?.name === 'vine_armor') {
            this.log('equip', `${target.name} 的【藤甲】生效，【南蛮入侵】无效！`, target.id);
            continue;
          }
          const nullified = yield* this.askNullification('savage_assault', target.id, card, false);
          if (nullified || !target.alive) continue;

          const dmgSourceCandidate = trickTargets.damageSourceOverrideId ?? actor.id;
          const dmgSourcePlayer = this.state.players.find(
            (p) => p.id === dmgSourceCandidate && p.alive
          );
          const dmgSourceLabel = dmgSourcePlayer ? dmgSourcePlayer.name : actor.name;

          const played = yield* this.askSlashResponse(
            target,
            'slash_savage',
            `【南蛮入侵】：请打出一张【杀】，否则受到 ${dmgSourceLabel} 造成的 1 点伤害`
          );
          if (!played) {
            const finalSrc = this.state.players.find(
              (p) => p.id === dmgSourceCandidate && p.alive
            );
            yield* this.applyDamage({
              sourceId: finalSrc ? finalSrc.id : null,
              targetId: target.id,
              amount: 1,
              element: 'normal',
              card,
              isChainDamage: false,
              prevented: false,
              armorIgnored: false,
              wasChainedBeforeDeduct: target.chained,
              actualDeducted: 0
            });
          }
        }
        if (!this.state.result) {
          yield* this.fireTrigger('TrickResolved', { playerId: actor.id, card });
        }
        return;
      }

      case 'archery_attack': {
        this.log('play', `${actor.name} 使用了 ${formatCard(card)}`, actor.id, undefined, [card.id]);
        const targets = getAlivePlayersInOrder(this.state, actor.id, false);
        const trickTargets: TrickTargetsContext = {
          actorId: actor.id,
          card,
          targetIds: targets.map((t) => t.id),
          cancelledTargetIds: []
        };
        yield* this.fireTrigger('TrickTargetsSpecified', {
          playerId: actor.id,
          trickTargets
        });
        for (const target of targets) {
          if (!target.alive || this.state.result) continue;
          if (trickTargets.cancelledTargetIds.includes(target.id)) continue;
          if (target.equips.armor?.name === 'vine_armor') {
            this.log('equip', `${target.name} 的【藤甲】生效，【万箭齐发】无效！`, target.id);
            continue;
          }
          const nullified = yield* this.askNullification('archery_attack', target.id, card, false);
          if (nullified || !target.alive) continue;

          const dodged = yield* this.askDodge(target, actor, card, false);
          if (!dodged) {
            yield* this.applyDamage({
              sourceId: actor.alive ? actor.id : null,
              targetId: target.id,
              amount: 1,
              element: 'normal',
              card,
              isChainDamage: false,
              prevented: false,
              armorIgnored: false,
              wasChainedBeforeDeduct: target.chained,
              actualDeducted: 0
            });
          }
        }
        return;
      }

      case 'peach_garden': {
        this.log('play', `${actor.name} 使用了 ${formatCard(card)}`, actor.id, undefined, [card.id]);
        const targets = getAlivePlayersInOrder(this.state, actor.id, true);
        const trickTargets: TrickTargetsContext = {
          actorId: actor.id,
          card,
          targetIds: targets.map((t) => t.id),
          cancelledTargetIds: []
        };
        yield* this.fireTrigger('TrickTargetsSpecified', {
          playerId: actor.id,
          trickTargets
        });
        for (const target of targets) {
          if (!target.alive || target.hp >= target.maxHp || this.state.result) continue;
          if (trickTargets.cancelledTargetIds.includes(target.id)) continue;
          const nullified = yield* this.askNullification('peach_garden', target.id, card, false);
          if (nullified || !target.alive) continue;
          const healed = yield* this.healPlayerAsync(target.id, 1);
          if (healed > 0) {
            this.log(
              'heal',
              `${target.name} 响应【桃园结义】回复 1 点体力（HP ${target.hp}/${target.maxHp}）`,
              target.id
            );
          }
        }
        return;
      }

      case 'harvest': {
        this.log('play', `${actor.name} 使用了 ${formatCard(card)}`, actor.id, undefined, [card.id]);
        const targets = getAlivePlayersInOrder(this.state, actor.id, true);
        const trickTargets: TrickTargetsContext = {
          actorId: actor.id,
          card,
          targetIds: targets.map((t) => t.id),
          cancelledTargetIds: []
        };
        yield* this.fireTrigger('TrickTargetsSpecified', {
          playerId: actor.id,
          trickTargets
        });
        const revealed = popTopCards(this.state, this.rng, targets.length);
        this.state.harvestPool = revealed.map((c) => ({ card: c, takenBy: null }));

        for (const target of targets) {
          if (!target.alive || this.state.result) continue;
          if (trickTargets.cancelledTargetIds.includes(target.id)) continue;
          const remaining = this.state.harvestPool.filter((i) => !i.takenBy);
          if (remaining.length === 0) break;

          const nullified = yield* this.askNullification('harvest', target.id, card, false);
          if (nullified || !target.alive) continue;

          const pickResp = yield* this.ask({
            type: 'choose_harvest_card',
            promptId: this.nextPromptId(),
            playerId: target.id,
            message: '【五谷丰登】：请选择获得一张亮出的牌',
            pool: this.state.harvestPool.map((item) => ({ ...item }))
          });
          const chosenId =
            pickResp.type === 'choose_harvest_card' ? pickResp.cardId : remaining[0].card.id;
          const slot =
            this.state.harvestPool.find((i) => !i.takenBy && i.card.id === chosenId) ??
            remaining[0];
          slot.takenBy = target.id;
          target.hand.push(slot.card);
          this.log('draw', `${target.name} 从【五谷丰登】获得了 ${formatCard(slot.card)}`, target.id, undefined, [slot.card.id]);
          yield* this.notifyCardsObtained(target.id, [slot.card]);
        }

        for (const item of this.state.harvestPool) {
          if (!item.takenBy) {
            this.moveToDiscard(item.card);
          }
        }
        this.state.harvestPool = [];
        return;
      }

      case 'collateral': {
        const victim = this.getPlayer(targetIds[0]);
        const validSecondaries = this.state.players
          .filter(
            (s) =>
              s.alive &&
              s.id !== victim.id &&
              isInAttackRange(this.state, victim.id, s.id, this.modifiers)
          )
          .map((s) => s.id);
        let slashTargetId =
          secondaryTargetId && validSecondaries.includes(secondaryTargetId)
            ? secondaryTargetId
            : validSecondaries[0];
        if (!secondaryTargetId && validSecondaries.length > 1) {
          const secResp = yield* this.ask({
            type: 'choose_target',
            promptId: this.nextPromptId(),
            playerId: actor.id,
            reason: 'collateral_secondary',
            message: `【借刀杀人】：指定 ${victim.name} 攻击范围内的一名出杀目标`,
            minCount: 1,
            maxCount: 1,
            eligibleTargetIds: validSecondaries,
            optional: false
          });
          if (secResp.type === 'choose_target' && secResp.targetIds[0]) {
            slashTargetId = secResp.targetIds[0];
          }
        }
        if (!slashTargetId) return;
        const slashTarget = this.getPlayer(slashTargetId);

        this.log(
          'play',
          `${actor.name} 对 ${victim.name} 使用 ${formatCard(card)}，令其杀 ${slashTarget.name}`,
          actor.id,
          [victim.id, slashTarget.id],
          [card.id]
        );
        const nullified = yield* this.askNullification('collateral', victim.id, card, false);
        if (nullified || !victim.alive) return;

        if (actor.id !== victim.id) {
          yield* this.fireTrigger('SingleTrickBeforeEffect', {
            playerId: victim.id,
            singleTrick: { actorId: actor.id, targetId: victim.id, card, isDelayed: false }
          });
          if (this.state.result || !victim.alive) return;
        }

        const usedSlash = yield* this.askSlashResponse(
          victim,
          'slash_collateral',
          `【借刀杀人】：请对 ${slashTarget.name} 使用一张【杀】，否则将武器交给 ${actor.name}`
        );

        if (usedSlash) {
          yield* this.resolveSlash(victim, [slashTarget], usedSlash, {
            countTowardLimit: false,
            useDrunkBonus: false
          });
        } else if (victim.equips.weapon) {
          const weapon = victim.equips.weapon;
          victim.equips.weapon = null;
          if (actor.alive) {
            actor.hand.push(weapon);
            this.log(
              'equip',
              `${victim.name} 未出【杀】，将 ${formatCard(weapon)} 交给 ${actor.name}`,
              victim.id,
              [actor.id],
              [weapon.id]
            );
          } else {
            this.moveToDiscard(weapon);
          }
          yield* this.fireTrigger('EquipLost', { playerId: victim.id, lostEquip: weapon });
          yield* this.notifyCardsLost(victim.id, [weapon], false);
          if (actor.alive) {
            yield* this.notifyCardsObtained(actor.id, [weapon]);
          }
        }
        return;
      }

      case 'iron_chain': {
        const targets = targetIds.map((id) => this.getPlayer(id));
        this.log(
          'play',
          `${actor.name} 对 ${targets.map((t) => t.name).join('、')} 使用了 ${formatCard(card)}`,
          actor.id,
          targetIds,
          [card.id]
        );
        const trickTargets: TrickTargetsContext = {
          actorId: actor.id,
          card,
          targetIds: targets.map((t) => t.id),
          cancelledTargetIds: []
        };
        yield* this.fireTrigger('TrickTargetsSpecified', {
          playerId: actor.id,
          trickTargets
        });
        for (const target of targets) {
          if (!target.alive || this.state.result) continue;
          if (trickTargets.cancelledTargetIds.includes(target.id)) continue;
          const nullified = yield* this.askNullification('iron_chain', target.id, card, false);
          if (nullified || !target.alive) continue;
          if (targets.length === 1 && actor.id !== target.id) {
            yield* this.fireTrigger('SingleTrickBeforeEffect', {
              playerId: target.id,
              singleTrick: { actorId: actor.id, targetId: target.id, card, isDelayed: false }
            });
            if (this.state.result || !target.alive) continue;
          }
          target.chained = !target.chained;
          this.log(
            'trick',
            `${target.name} ${target.chained ? '横置（进入连环状态）' : '重置（解除连环状态）'}`,
            target.id
          );
        }
        return;
      }

      case 'fire_attack': {
        const target = this.getPlayer(targetIds[0]);
        this.log('play', `${actor.name} 对 ${target.name} 使用了 ${formatCard(card)}`, actor.id, [target.id], [card.id]);
        const nullified = yield* this.askNullification('fire_attack', target.id, card, false);
        if (nullified || !target.alive) return;

        if (actor.id !== target.id) {
          yield* this.fireTrigger('SingleTrickBeforeEffect', {
            playerId: target.id,
            singleTrick: { actorId: actor.id, targetId: target.id, card, isDelayed: false }
          });
          if (this.state.result || !target.alive) return;
        }
        if (target.hand.length === 0) return;

        const showResp = yield* this.ask({
          type: 'choose_card',
          promptId: this.nextPromptId(),
          playerId: target.id,
          reason: 'fire_attack_show',
          message: `【火攻】：请选择展示一张手牌`,
          minCount: 1,
          maxCount: 1,
          eligibleCardIds: target.hand.map((c) => c.id),
          optional: false
        });
        const shownId =
          showResp.type === 'choose_card' && showResp.cardIds[0]
            ? showResp.cardIds[0]
            : target.hand[0].id;
        const shownCard = target.hand.find((c) => c.id === shownId) ?? target.hand[0];
        const shownSuit = this.modifiers.getEffectiveSuit(this.state, target, shownCard);
        this.pushTableCard(shownCard, target.id, '火攻展示');
        this.log('trick', `${target.name} 展示了 ${formatCard(shownCard)}`, target.id, undefined, [shownCard.id]);

        if (!actor.alive) return;
        const matchingHand = actor.hand.filter(
          (c) => this.modifiers.getEffectiveSuit(this.state, actor, c) === shownSuit
        );
        if (matchingHand.length === 0) {
          this.log('trick', `${actor.name} 没有 ${getSuitSymbol(shownSuit)} 花色手牌，【火攻】未造成伤害`, actor.id);
          return;
        }

        const discResp = yield* this.ask({
          type: 'choose_card',
          promptId: this.nextPromptId(),
          playerId: actor.id,
          reason: 'fire_attack_discard',
          message: `【火攻】：是否弃置一张 ${getSuitSymbol(shownSuit)} 花色手牌，对 ${target.name} 造成 1 点火焰伤害？`,
          minCount: 1,
          maxCount: 1,
          eligibleCardIds: matchingHand.map((c) => c.id),
          optional: true
        });
        if (discResp.type === 'choose_card' && !discResp.cancelled && discResp.cardIds.length === 1) {
          const prevHand = actor.hand.length;
          const discIdx = actor.hand.findIndex((c) => c.id === discResp.cardIds[0]);
          if (discIdx !== -1) {
            const discCard = actor.hand.splice(discIdx, 1)[0];
            this.moveToDiscard(discCard);
            this.log(
              'discard',
              `${actor.name} 弃置 ${formatCard(discCard)}，对 ${target.name} 造成 1 点火焰伤害！`,
              actor.id,
              [target.id],
              [discCard.id]
            );
            yield* this.checkHandEmptied(actor.id, prevHand);
            yield* this.notifyCardsLost(actor.id, [discCard], false);
            yield* this.applyDamage({
              sourceId: actor.id,
              targetId: target.id,
              amount: 1,
              element: 'fire',
              card,
              isChainDamage: false,
              prevented: false,
              armorIgnored: false,
              wasChainedBeforeDeduct: target.chained,
              actualDeducted: 0
            });
          }
        }
        return;
      }

      default:
        return;
    }
  }

  private *resolveJudge(
    playerId: string,
    reason: string
  ): Generator<PromptRequest, CardInstance, PlayerResponse> {
    const player = this.getPlayer(playerId);
    const popped = popTopCards(this.state, this.rng, 1);
    const card = popped[0];
    if (!card) {
      this.state.result = {
        winnerTeam: '平局',
        winnerPlayerIds: [],
        reason: '牌堆与弃牌堆同时耗尽无法判定，触发平局保护。',
        totalTurns: this.state.turn
      };
      this.state.phase = 'gameover';
      return {
        id: -1,
        name: 'slash',
        displayName: '无牌',
        suit: 'heart',
        rank: 1,
        category: 'basic',
        subtype: 'basic',
        pack: 'standard',
        shortTag: '',
        description: ''
      };
    }

    const ctx: JudgeContext = { playerId, reason, card };
    this.pushTableCard(ctx.card, playerId, `${reason}判定`);
    this.log('judge', `${player.name} 进行【${reason}】判定，翻开 ${formatCard(ctx.card)}`, playerId, undefined, [ctx.card.id]);

    yield* this.fireTrigger('JudgeModify', { playerId, judge: ctx });

    this.moveToDiscard(ctx.card);
    yield* this.fireTrigger('JudgeResolved', { playerId, judge: ctx });
    return ctx.card;
  }

  private *applyDamage(ctx: DamageContext): EngineGenerator {
    const target = this.getPlayer(ctx.targetId);
    if (!target.alive || this.state.result || ctx.amount <= 0) return;

    ctx.wasChainedBeforeDeduct = target.chained;

    yield* this.fireTrigger('DamageBefore', { damage: ctx });
    if (ctx.prevented || ctx.amount <= 0 || this.state.result) {
      yield* this.fireTrigger('DamageEnd', { damage: ctx });
      return;
    }

    yield* this.fireTrigger('DamageStart', { damage: ctx });
    if (ctx.prevented || ctx.amount <= 0 || this.state.result) {
      yield* this.fireTrigger('DamageEnd', { damage: ctx });
      return;
    }

    yield* this.fireTrigger('DamageDealt', { damage: ctx });
    if (ctx.prevented || ctx.amount <= 0 || this.state.result) {
      yield* this.fireTrigger('DamageEnd', { damage: ctx });
      return;
    }

    yield* this.fireTrigger('DamageTaken', { damage: ctx });
    if (ctx.prevented || ctx.amount <= 0 || this.state.result) {
      yield* this.fireTrigger('DamageEnd', { damage: ctx });
      return;
    }

    target.hp -= ctx.amount;
    ctx.actualDeducted = ctx.amount;
    target.stats.damageTaken += ctx.amount;
    const source = ctx.sourceId ? this.state.players.find((p) => p.id === ctx.sourceId) : null;
    if (source) {
      source.stats.damageDealt += ctx.amount;
      this.state.turnDamageDealtByPlayer[source.id] =
        (this.state.turnDamageDealtByPlayer[source.id] ?? 0) + ctx.amount;
    }

    const elemLabel =
      ctx.element === 'fire' ? '火焰' : ctx.element === 'thunder' ? '雷电' : '';
    const chainTag = ctx.isChainDamage ? '（连环传导）' : '';
    this.log(
      'damage',
      `${target.name} 受到${source ? ` ${source.name} 造成的` : '无来源'} ${ctx.amount} 点${elemLabel}伤害${chainTag}（HP ${target.hp}/${target.maxHp}）`,
      source?.id,
      [target.id]
    );

    if (target.hp <= 0) {
      yield* this.resolveDying(target.id, ctx.sourceId);
      if (this.state.result) return;
    }

    if (source && source.alive) {
      yield* this.fireTrigger('AfterDamageDealt', { damage: ctx });
      if (this.state.result) return;
    }

    if (target.alive) {
      yield* this.fireTrigger('AfterDamageTaken', { damage: ctx });
      if (this.state.result) return;
    }

    if (ctx.wasChainedBeforeDeduct && ctx.element !== 'normal' && target.alive) {
      target.chained = false;
      this.log('trick', `${target.name} 解除连环状态`, target.id);
    }

    yield* this.fireTrigger('DamageEnd', { damage: ctx });
    if (this.state.result) return;

    if (ctx.wasChainedBeforeDeduct && !ctx.isChainDamage && ctx.element !== 'normal') {
      const activePlayer = this.state.players[this.state.activePlayerIndex];
      const chainOrder = getAlivePlayersInOrder(this.state, activePlayer.id, true);
      for (const next of chainOrder) {
        if (this.state.result) return;
        if (!next.alive || !next.chained) continue;
        const effectiveSource =
          ctx.sourceId && this.getPlayer(ctx.sourceId).alive ? ctx.sourceId : null;
        yield* this.applyDamage({
          sourceId: effectiveSource,
          targetId: next.id,
          amount: ctx.actualDeducted,
          element: ctx.element,
          card: ctx.card,
          isChainDamage: true,
          prevented: false,
          armorIgnored: false,
          wasChainedBeforeDeduct: true,
          actualDeducted: 0
        });
        if (this.state.result) return;
      }
    }
  }

  private *resolveDying(victimId: string, killerId: string | null): EngineGenerator {
    const victim = this.getPlayer(victimId);
    this.log('dying', `${victim.name} 进入濒死状态（HP ${victim.hp}/${victim.maxHp}），请求救援！`, victim.id);
    yield* this.fireTrigger('DyingStart', { victimId, killerId });
    if (!victim.alive || victim.hp > 0 || this.state.result) return;

    const activePlayer = this.state.players[this.state.activePlayerIndex];

    while (victim.alive && victim.hp <= 0 && !this.state.result) {
      let savedThisPass = false;
      const order = getAlivePlayersInOrder(this.state, activePlayer.id, true);

      for (const helper of order) {
        if (victim.hp > 0) break;
        if (!this.modifiers.canUseDyingPeach(this.state, helper, victim)) continue;
        const helperHandIds = new Set(helper.hand.map((c) => c.id));
        const extraPeachIds = this.skills.getExtraDyingPeachCardIds(
          this.state,
          helper,
          victim
        );
        const allCards = [...getUsableCards(helper), ...getEquippedCards(helper)];
        const saveCards = allCards.filter(
          (c) =>
            (!helper.cannotPlayHandCardsThisTurn || !helperHandIds.has(c.id)) &&
            (c.name === 'peach' ||
              (helper.id === victim.id && c.name === 'alcohol') ||
              extraPeachIds.includes(c.id))
        );
        if (saveCards.length === 0) continue;

        const resp = yield* this.ask({
          type: 'choose_card',
          promptId: this.nextPromptId(),
          playerId: helper.id,
          reason: 'peach_dying',
          message:
            helper.id === victim.id
              ? `你正处于濒死状态（还需 ${1 - victim.hp} 桃/酒），是否使用【桃】或【酒】自救？`
              : `${victim.name} 正处于濒死状态（还需 ${1 - victim.hp} 桃），是否对其使用【桃】？`,
          minCount: 1,
          maxCount: 1,
          eligibleCardIds: saveCards.map((c) => c.id),
          optional: true
        });

        if (resp.type === 'choose_card' && !resp.cancelled && resp.cardIds.length === 1) {
          const wasFromHand = helperHandIds.has(resp.cardIds[0]);
          const card = yield* this.removeCardFromPlayerGen(helper.id, resp.cardIds[0]);
          if (card) {
            const isAlcoholSelf =
              helper.id === victim.id &&
              (card.name === 'alcohol' ||
                (card.name !== 'peach' &&
                  hasActiveSkill(helper, 'jiuchi') &&
                  this.modifiers.getEffectiveSuit(this.state, helper, card) === 'spade'));
            const bonus = isAlcoholSelf
              ? 0
              : this.modifiers.getPeachHealBonus(this.state, helper, victim);
            const healAmt = 1 + bonus;
            this.pushTableCard(card, helper.id, '濒死救援');
            this.moveToDiscard(card);
            helper.stats.cardsPlayed += 1;
            victim.hp = Math.min(victim.maxHp, victim.hp + healAmt);
            this.log(
              'heal',
              `${helper.name} 对 ${victim.name} 使用了 ${formatCard(card)}，回复 ${healAmt} 点体力（HP ${victim.hp}/${victim.maxHp}）`,
              helper.id,
              [victim.id],
              [card.id]
            );
            if (wasFromHand) {
              yield* this.notifyOutOfTurnCard(helper.id, card, true);
            }
            savedThisPass = true;
            if (victim.hp > 0) break;
          }
        }
      }

      if (!savedThisPass) {
        break;
      }
    }

    if (victim.alive && victim.hp <= 0) {
      yield* this.killPlayer(victimId, killerId);
    }
  }

  private *killPlayer(victimId: string, killerId: string | null): EngineGenerator {
    const victim = this.getPlayer(victimId);
    const killer = killerId ? this.state.players.find((p) => p.id === killerId) ?? null : null;

    victim.alive = false;
    victim.roleRevealed = true;
    victim.chained = false;
    victim.flipped = false;
    victim.drunk = false;

    if (killer && killer.id !== victim.id) {
      killer.stats.kills += 1;
    }

    this.log(
      'death',
      `${victim.name}（${victim.generalName}，身份：${victim.role}）阵亡！${killer ? `击杀者：${killer.name}` : ''}`,
      killer?.id,
      [victim.id]
    );

    const slots = ['weapon', 'armor', 'horsePlus', 'horseMinus', 'treasure'] as const;
    const discardVictimCards = () => {
      for (const c of victim.hand.splice(0)) this.moveToDiscard(c);
      for (const c of victim.woodenOxCards.splice(0)) this.moveToDiscard(c);
      for (const c of victim.judgeZone.splice(0)) this.moveToDiscard(c);
      for (const key of Object.keys(victim.removedCards)) {
        for (const c of victim.removedCards[key].splice(0)) this.moveToDiscard(c);
        delete victim.removedCards[key];
      }
      for (const slot of slots) {
        const eq = victim.equips[slot];
        if (eq) {
          victim.equips[slot] = null;
          this.moveToDiscard(eq);
        }
      }
    };

    const victory = this.modeRules.checkVictory(this.state);
    if (victory) {
      discardVictimCards();
      this.state.result = victory;
      this.state.phase = 'gameover';
      this.log('gameover', victory.reason);
      return;
    }

    // Before discarding dead player's cards (曹丕【行殇】)
    const deathLoot = { victimId };
    yield* this.fireTrigger('BeforePlayerDeathDiscard', { victimId, killerId, deathLoot });
    if (this.state.result) return;

    discardVictimCards();

    if (this.modeRules.onPlayerDied) {
      this.modeRules.onPlayerDied(this.state, victim, killer, {
        drawCards: (pid, cnt) => {
          this.drawForPlayer(pid, cnt);
        },
        discardAllHandAndEquips: (pid) => {
          const p = this.getPlayer(pid);
          for (const c of p.hand.splice(0)) this.moveToDiscard(c);
          for (const c of p.woodenOxCards.splice(0)) this.moveToDiscard(c);
          for (const slot of slots) {
            const eq = p.equips[slot];
            if (eq) {
              p.equips[slot] = null;
              this.moveToDiscard(eq);
            }
          }
        },
        log: (type, message, actorId, targetIds) => this.log(type, message, actorId, targetIds)
      });
    }

    yield* this.fireTrigger('PlayerDied', { victimId, killerId });
  }

  private *runDiscardPhase(player: PlayerState): EngineGenerator {
    const limit = getHandLimit(this.state, player, this.modifiers);
    const excess = player.hand.length - limit;
    if (excess <= 0) return;

    const resp = yield* this.ask({
      type: 'choose_card',
      promptId: this.nextPromptId(),
      playerId: player.id,
      reason: 'discard_phase',
      message: `弃牌阶段：当前手牌 ${player.hand.length} 张，手牌上限 ${limit} 张，请弃置 ${excess} 张手牌`,
      minCount: excess,
      maxCount: excess,
      eligibleCardIds: player.hand.map((c) => c.id),
      optional: false
    });

    const chosenIds =
      resp.type === 'choose_card' && resp.cardIds.length === excess
        ? resp.cardIds
        : player.hand.slice(0, excess).map((c) => c.id);

    const prevHand = player.hand.length;
    const discardedNames: string[] = [];
    const discardedCards: CardInstance[] = [];
    for (const cid of chosenIds) {
      const idx = player.hand.findIndex((c) => c.id === cid);
      if (idx !== -1) {
        const card = player.hand.splice(idx, 1)[0];
        this.moveToDiscard(card);
        discardedCards.push(card);
        discardedNames.push(formatCard(card));
      }
    }
    this.log('discard', `${player.name} 弃置了 ${discardedNames.join('、')}`, player.id, undefined, chosenIds);
    yield* this.checkHandEmptied(player.id, prevHand);
    yield* this.notifyCardsLost(player.id, discardedCards, false);
    yield* this.fireTrigger('DiscardPhaseDiscarded', {
      playerId: player.id,
      discardedInPhaseCards: discardedCards
    });
  }
}
