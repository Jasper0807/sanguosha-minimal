import type {
  CardInstance,
  EquipSlot,
  GameState,
  PlayerCardChoice,
  PlayerState
} from './types.js';
import type { SeededRng } from './rng.js';

export function getEquipSlot(card: CardInstance): EquipSlot | null {
  switch (card.subtype) {
    case 'weapon':
      return 'weapon';
    case 'armor':
      return 'armor';
    case 'horse_plus':
      return 'horsePlus';
    case 'horse_minus':
      return 'horseMinus';
    case 'treasure':
      return 'treasure';
    default:
      return null;
  }
}

/**
 * Cards a player may USE or PLAY: hand cards + cards stashed under Wooden Ox (木牛流马).
 */
export function getUsableCards(player: PlayerState): CardInstance[] {
  return [...player.hand, ...player.woodenOxCards];
}

/**
 * All cards currently equipped by a player.
 */
export function getEquippedCards(player: PlayerState): CardInstance[] {
  const result: CardInstance[] = [];
  const slots: EquipSlot[] = ['weapon', 'armor', 'horsePlus', 'horseMinus', 'treasure'];
  for (const slot of slots) {
    const card = player.equips[slot];
    if (card) result.push(card);
  }
  return result;
}

/**
 * Finds and removes a card from a player's hand or woodenOxCards.
 */
export function removeUsableCard(player: PlayerState, cardId: number): CardInstance | null {
  const handIdx = player.hand.findIndex((c) => c.id === cardId);
  if (handIdx !== -1) {
    return player.hand.splice(handIdx, 1)[0];
  }
  const oxIdx = player.woodenOxCards.findIndex((c) => c.id === cardId);
  if (oxIdx !== -1) {
    return player.woodenOxCards.splice(oxIdx, 1)[0];
  }
  return null;
}

/**
 * Finds and removes a card from hand, woodenOxCards, or equipment slots.
 */
export function removeHandOrEquipCard(
  player: PlayerState,
  cardId: number
): { card: CardInstance; wasEquip: boolean; lostWoodenOxStash: CardInstance[] } | null {
  const usable = removeUsableCard(player, cardId);
  if (usable) {
    return { card: usable, wasEquip: false, lostWoodenOxStash: [] };
  }
  const slots: EquipSlot[] = ['weapon', 'armor', 'horsePlus', 'horseMinus', 'treasure'];
  for (const slot of slots) {
    const eq = player.equips[slot];
    if (eq && eq.id === cardId) {
      player.equips[slot] = null;
      let lostWoodenOxStash: CardInstance[] = [];
      if (slot === 'treasure' && eq.name === 'wooden_ox' && player.woodenOxCards.length > 0) {
        lostWoodenOxStash = player.woodenOxCards.splice(0, player.woodenOxCards.length);
      }
      return { card: eq, wasEquip: true, lostWoodenOxStash };
    }
  }
  return null;
}

/**
 * Checks if drawPile is empty and reshuffles discardPile into drawPile using deterministic RNG.
 * Returns true if at least one card is available in drawPile afterwards.
 */
export function ensureDrawPile(state: GameState, rng: SeededRng): boolean {
  if (state.drawPile.length > 0) return true;
  if (state.discardPile.length === 0) return false;
  state.drawPile = rng.shuffle(state.discardPile);
  state.discardPile = [];
  return state.drawPile.length > 0;
}

/**
 * Pops `count` cards from the top of `state.drawPile` (index 0 = top of deck).
 */
export function popTopCards(state: GameState, rng: SeededRng, count: number): CardInstance[] {
  const drawn: CardInstance[] = [];
  for (let i = 0; i < count; i++) {
    if (!ensureDrawPile(state, rng)) {
      state.emptyDeckTurnCounter += 1;
      break;
    }
    const card = state.drawPile.shift();
    if (card) drawn.push(card);
  }
  return drawn;
}

/**
 * Returns whether target player has any cards in specified zones.
 */
export function hasAnyCardInZones(
  player: PlayerState,
  includeJudge: boolean
): boolean {
  if (player.hand.length > 0) return true;
  if (getEquippedCards(player).length > 0) return true;
  if (includeJudge && player.judgeZone.length > 0) return true;
  return false;
}

/**
 * Builds selectable choices for Dismantle / Snatch / Ice Sword / Kylin Bow.
 */
export function buildPlayerCardChoices(
  target: PlayerState,
  options: { includeHand: boolean; includeEquips: boolean; includeJudge: boolean; horsesOnly?: boolean }
): PlayerCardChoice[] {
  const choices: PlayerCardChoice[] = [];
  if (options.includeHand) {
    target.hand.forEach((_card, idx) => {
      choices.push({
        zone: 'hand',
        handIndex: idx,
        label: `手牌 #${idx + 1}`
      });
    });
  }
  if (options.includeEquips) {
    const slots: EquipSlot[] = options.horsesOnly
      ? ['horsePlus', 'horseMinus']
      : ['weapon', 'armor', 'horsePlus', 'horseMinus', 'treasure'];
    const slotNames: Record<EquipSlot, string> = {
      weapon: '武器',
      armor: '防具',
      horsePlus: '+1马',
      horseMinus: '-1马',
      treasure: '宝物'
    };
    for (const slot of slots) {
      const card = target.equips[slot];
      if (card) {
        choices.push({
          zone: slot,
          cardId: card.id,
          label: `${slotNames[slot]}·【${card.displayName}】`
        });
      }
    }
  }
  if (options.includeJudge) {
    for (const card of target.judgeZone) {
      choices.push({
        zone: 'judge',
        cardId: card.id,
        label: `判定区·【${card.displayName}】`
      });
    }
  }
  return choices;
}

/**
 * Extracts a chosen card from a target's zone based on a PlayerCardChoice.
 */
export function extractChoiceCard(
  target: PlayerState,
  choice: PlayerCardChoice
): { card: CardInstance; wasEquip: boolean; lostWoodenOxStash: CardInstance[] } | null {
  if (choice.zone === 'hand') {
    const idx = choice.handIndex ?? 0;
    if (idx < 0 || idx >= target.hand.length) {
      if (target.hand.length === 0) return null;
      return { card: target.hand.splice(0, 1)[0], wasEquip: false, lostWoodenOxStash: [] };
    }
    return { card: target.hand.splice(idx, 1)[0], wasEquip: false, lostWoodenOxStash: [] };
  }
  if (choice.zone === 'judge') {
    const idx = target.judgeZone.findIndex((c) => c.id === choice.cardId);
    if (idx === -1) return null;
    return { card: target.judgeZone.splice(idx, 1)[0], wasEquip: false, lostWoodenOxStash: [] };
  }
  const slot = choice.zone;
  const eq = target.equips[slot];
  if (!eq) return null;
  target.equips[slot] = null;
  let lostWoodenOxStash: CardInstance[] = [];
  if (slot === 'treasure' && eq.name === 'wooden_ox' && target.woodenOxCards.length > 0) {
    lostWoodenOxStash = target.woodenOxCards.splice(0, target.woodenOxCards.length);
  }
  return { card: eq, wasEquip: true, lostWoodenOxStash };
}
