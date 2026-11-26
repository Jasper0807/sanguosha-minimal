import type { CardInstance, GameState, PlayerState } from './types.js';
import { isSlashCardName } from './types.js';
import type { ModifierRegistry } from './events.js';
import { getDistance, getSlashLimit, isInAttackRange } from './distance.js';
import { getUsableCards, hasAnyCardInZones } from './deck.js';

export interface PlayableCardInfo {
  cardId: number;
  needsTarget: boolean;
  minTargets: number;
  maxTargets: number;
  eligibleTargetIds: string[];
  /** For Collateral (借刀杀人): map from primary targetId to valid secondary slash targets */
  secondaryTargetsByPrimary?: Record<string, string[]>;
  canRecast?: boolean;
  canConvertToFireSlash?: boolean;
}

/**
 * Returns alive players in counter-clockwise (seat ascending) order starting from `startPlayerId`.
 */
export function getAlivePlayersInOrder(
  state: GameState,
  startPlayerId: string,
  includeStart = true
): PlayerState[] {
  const n = state.players.length;
  const startIdx = state.players.findIndex((p) => p.id === startPlayerId);
  if (startIdx === -1) return state.players.filter((p) => p.alive);
  const result: PlayerState[] = [];
  for (let offset = 0; offset < n; offset++) {
    if (offset === 0 && !includeStart) continue;
    const p = state.players[(startIdx + offset) % n];
    if (p.alive) result.push(p);
  }
  return result;
}

/**
 * Checks whether a card uses all remaining hand cards (for Halberd / 方天画戟).
 */
export function isLastHandCardSlash(player: PlayerState, card: CardInstance): boolean {
  if (player.equips.weapon?.name !== 'halberd') return false;
  if (!isSlashCardName(card.name)) return false;
  return player.hand.length === 1 && player.hand[0].id === card.id;
}

/**
 * Computes playability and legal targets for a specific usable card during Play phase.
 * Returns null if the card cannot be played right now.
 */
export function getPlayableCardInfo(
  state: GameState,
  playerId: string,
  card: CardInstance,
  modifiers?: ModifierRegistry
): PlayableCardInfo | null {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || !player.alive) return null;

  // LB Guan Yu Yijue (black card): target cannot use or play hand cards this turn
  if (
    player.cannotPlayHandCardsThisTurn &&
    player.hand.some((c) => c.id === card.id)
  ) {
    return null;
  }

  const others = state.players.filter((p) => p.alive && p.id !== playerId);

  // Equipment cards are always playable onto self
  if (card.category === 'equip') {
    return {
      cardId: card.id,
      needsTarget: false,
      minTargets: 0,
      maxTargets: 0,
      eligibleTargetIds: []
    };
  }

  const canTarget = (target: PlayerState, cardName: CardInstance['name']): boolean =>
    modifiers ? modifiers.canBeTargetedByCard(state, player, target, cardName) : true;
  const trickNoDist = modifiers ? modifiers.isTrickDistanceUnlimited(state, player) : false;

  // Basic cards
  if (isSlashCardName(card.name)) {
    const limit = getSlashLimit(state, player, modifiers);
    if (player.slashUsedThisTurn >= limit) return null;
    let targets = others
      .filter(
        (t) =>
          (isInAttackRange(state, playerId, t.id, modifiers) ||
            Boolean(modifiers?.isSlashDistanceUnlimited(state, player, t, card))) &&
          canTarget(t, card.name)
      )
      .map((t) => t.id);
    if (modifiers) {
      targets = modifiers.filterSlashTargets(state, player, targets);
    }
    if (targets.length === 0) return null;
    const maxTargets = isLastHandCardSlash(player, card) ? Math.min(3, targets.length) : 1;
    return {
      cardId: card.id,
      needsTarget: true,
      minTargets: 1,
      maxTargets,
      eligibleTargetIds: targets,
      canConvertToFireSlash:
        card.name === 'slash' && player.equips.weapon?.name === 'fan'
    };
  }

  if (card.name === 'dodge' || card.name === 'nullification') {
    return null;
  }

  if (card.name === 'peach') {
    if (player.hp >= player.maxHp) return null;
    return {
      cardId: card.id,
      needsTarget: false,
      minTargets: 0,
      maxTargets: 0,
      eligibleTargetIds: []
    };
  }

  if (card.name === 'alcohol') {
    if (player.drunkUsedThisTurn >= 1 || player.drunk) return null;
    return {
      cardId: card.id,
      needsTarget: false,
      minTargets: 0,
      maxTargets: 0,
      eligibleTargetIds: []
    };
  }

  // Normal Tricks
  switch (card.name) {
    case 'ex_nihilo':
    case 'harvest':
      return {
        cardId: card.id,
        needsTarget: false,
        minTargets: 0,
        maxTargets: 0,
        eligibleTargetIds: []
      };

    case 'savage_assault':
    case 'archery_attack':
      if (others.length === 0) return null;
      return {
        cardId: card.id,
        needsTarget: false,
        minTargets: 0,
        maxTargets: 0,
        eligibleTargetIds: []
      };

    case 'peach_garden': {
      // Usable whenever at least one alive player is wounded (OL standard UX & rule check)
      const anyWounded = state.players.some((p) => p.alive && p.hp < p.maxHp);
      if (!anyWounded) return null;
      return {
        cardId: card.id,
        needsTarget: false,
        minTargets: 0,
        maxTargets: 0,
        eligibleTargetIds: []
      };
    }

    case 'dismantle': {
      const targets = others
        .filter((t) => hasAnyCardInZones(t, true) && canTarget(t, 'dismantle'))
        .map((t) => t.id);
      if (targets.length === 0) return null;
      return {
        cardId: card.id,
        needsTarget: true,
        minTargets: 1,
        maxTargets: 1,
        eligibleTargetIds: targets
      };
    }

    case 'snatch': {
      const targets = others
        .filter(
          (t) =>
            (trickNoDist || getDistance(state, playerId, t.id, modifiers) <= 1) &&
            hasAnyCardInZones(t, true) &&
            canTarget(t, 'snatch')
        )
        .map((t) => t.id);
      if (targets.length === 0) return null;
      return {
        cardId: card.id,
        needsTarget: true,
        minTargets: 1,
        maxTargets: 1,
        eligibleTargetIds: targets
      };
    }

    case 'duel': {
      const targets = others.filter((t) => canTarget(t, 'duel')).map((t) => t.id);
      if (targets.length === 0) return null;
      return {
        cardId: card.id,
        needsTarget: true,
        minTargets: 1,
        maxTargets: 1,
        eligibleTargetIds: targets
      };
    }

    case 'collateral': {
      const secondaryMap: Record<string, string[]> = {};
      const eligiblePrimary: string[] = [];
      for (const candidate of others) {
        if (!candidate.equips.weapon || !canTarget(candidate, 'collateral')) continue;
        const secondary = state.players
          .filter(
            (s) =>
              s.alive &&
              s.id !== candidate.id &&
              isInAttackRange(state, candidate.id, s.id, modifiers)
          )
          .map((s) => s.id);
        if (secondary.length > 0) {
          eligiblePrimary.push(candidate.id);
          secondaryMap[candidate.id] = secondary;
        }
      }
      if (eligiblePrimary.length === 0) return null;
      return {
        cardId: card.id,
        needsTarget: true,
        minTargets: 1,
        maxTargets: 1,
        eligibleTargetIds: eligiblePrimary,
        secondaryTargetsByPrimary: secondaryMap
      };
    }

    case 'iron_chain': {
      const allAlive = state.players.filter((p) => p.alive).map((p) => p.id);
      return {
        cardId: card.id,
        needsTarget: true,
        minTargets: 1,
        maxTargets: Math.min(2, allAlive.length),
        eligibleTargetIds: allAlive,
        canRecast: true
      };
    }

    case 'fire_attack': {
      const allWithHand = state.players
        .filter((p) => p.alive && p.hand.length > 0 && canTarget(p, 'fire_attack'))
        .map((p) => p.id);
      // Note: can target self if self still has another hand card besides this Fire Attack
      const validTargets = allWithHand.filter((tid) => {
        if (tid !== playerId) return true;
        const otherHandCount = player.hand.filter((c) => c.id !== card.id).length;
        return otherHandCount > 0;
      });
      if (validTargets.length === 0) return null;
      return {
        cardId: card.id,
        needsTarget: true,
        minTargets: 1,
        maxTargets: 1,
        eligibleTargetIds: validTargets
      };
    }

    // Delayed Tricks
    case 'indulgence': {
      const targets = others
        .filter(
          (t) =>
            !t.judgeZone.some((j) => (j.asDelayedTrick ?? j.name) === 'indulgence') &&
            canTarget(t, 'indulgence')
        )
        .map((t) => t.id);
      if (targets.length === 0) return null;
      return {
        cardId: card.id,
        needsTarget: true,
        minTargets: 1,
        maxTargets: 1,
        eligibleTargetIds: targets
      };
    }

    case 'supply_shortage': {
      const targets = others
        .filter(
          (t) =>
            (trickNoDist || getDistance(state, playerId, t.id, modifiers) <= 1) &&
            !t.judgeZone.some((j) => j.name === 'supply_shortage') &&
            canTarget(t, 'supply_shortage')
        )
        .map((t) => t.id);
      if (targets.length === 0) return null;
      return {
        cardId: card.id,
        needsTarget: true,
        minTargets: 1,
        maxTargets: 1,
        eligibleTargetIds: targets
      };
    }

    case 'lightning': {
      if (player.judgeZone.some((j) => j.name === 'lightning')) return null;
      return {
        cardId: card.id,
        needsTarget: false,
        minTargets: 0,
        maxTargets: 0,
        eligibleTargetIds: []
      };
    }

    default:
      return null;
  }
}

export function getAllPlayableCards(
  state: GameState,
  playerId: string,
  modifiers?: ModifierRegistry
): PlayableCardInfo[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || !player.alive) return [];
  const usable = getUsableCards(player);
  const infos: PlayableCardInfo[] = [];
  for (const card of usable) {
    const info = getPlayableCardInfo(state, playerId, card, modifiers);
    if (info) infos.push(info);
  }
  return infos;
}

export function canUseSerpentSpearInPlay(
  state: GameState,
  playerId: string,
  modifiers?: ModifierRegistry
): boolean {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || !player.alive) return false;
  if (player.equips.weapon?.name !== 'serpent_spear') return false;
  if (player.slashUsedThisTurn >= getSlashLimit(state, player, modifiers)) return false;
  if (getUsableCards(player).length < 2) return false;
  let targets = state.players
    .filter(
      (t) =>
        t.alive &&
        t.id !== playerId &&
        isInAttackRange(state, playerId, t.id, modifiers) &&
        (modifiers ? modifiers.canBeTargetedByCard(state, player, t, 'slash') : true)
    )
    .map((t) => t.id);
  if (modifiers) {
    targets = modifiers.filterSlashTargets(state, player, targets);
  }
  return targets.length > 0;
}

export function canUseWoodenOxInPlay(state: GameState, playerId: string): boolean {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || !player.alive) return false;
  if (player.equips.treasure?.name !== 'wooden_ox') return false;
  if (player.woodenOxUsedThisTurn) return false;
  if (player.hand.length === 0) return false;
  if (player.woodenOxCards.length >= 5) return false;
  return true;
}
