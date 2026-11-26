import type { CardInstance, CardPack, DeckVariant } from '../../core/types.js';
import { CARD_SPECS } from './specs.js';
import { STANDARD_CARDS, type RawCardEntry } from './standard.js';
import { EX_CARDS } from './ex.js';
import { JUNZHENG_CARDS, LIMIT_BREAK_CARDS } from './junzheng.js';

export { CARD_SPECS } from './specs.js';
export { STANDARD_CARDS } from './standard.js';
export { EX_CARDS } from './ex.js';
export { JUNZHENG_CARDS, LIMIT_BREAK_CARDS } from './junzheng.js';

function instantiatePack(
  entries: readonly RawCardEntry[],
  pack: CardPack,
  startId: number
): CardInstance[] {
  return entries.map(([suit, rank, name], idx) => ({
    ...CARD_SPECS[name],
    id: startId + idx,
    suit,
    rank,
    pack
  }));
}

/**
 * Builds an unshuffled deck for the requested variant:
 * - 'standard_ex': Standard 104 + EX 4 = 108 cards
 * - 'junzheng_161': Standard 104 + EX 4 + Junzheng 52 + Limit Break (Wooden Ox) 1 = 161 cards
 */
export function buildDeck(variant: DeckVariant): CardInstance[] {
  const cards: CardInstance[] = [];
  let nextId = 1;

  const std = instantiatePack(STANDARD_CARDS, 'standard', nextId);
  cards.push(...std);
  nextId += std.length;

  const ex = instantiatePack(EX_CARDS, 'ex', nextId);
  cards.push(...ex);
  nextId += ex.length;

  if (variant === 'junzheng_161') {
    const jz = instantiatePack(JUNZHENG_CARDS, 'junzheng', nextId);
    cards.push(...jz);
    nextId += jz.length;

    const lb = instantiatePack(LIMIT_BREAK_CARDS, 'limit_break', nextId);
    cards.push(...lb);
    nextId += lb.length;
  }

  return cards;
}

export function createCardInstance(
  id: number,
  suit: CardInstance['suit'],
  rank: CardInstance['rank'],
  name: CardInstance['name'],
  pack: CardPack = 'standard'
): CardInstance {
  return {
    ...CARD_SPECS[name],
    id,
    suit,
    rank,
    pack
  };
}
