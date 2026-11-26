import type { CardInstance, CardPack, DeckVariant } from '../../core/types.js';
import { CARD_SPECS } from './specs.js';
import { STANDARD_CARDS, type RawCardEntry } from './standard.js';
import { EX_CARDS } from './ex.js';

export { CARD_SPECS } from './specs.js';
export { STANDARD_CARDS } from './standard.js';
export { EX_CARDS } from './ex.js';

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
 * Builds an unshuffled deck for the requested variant.
 * Phase 1 provides 'standard_ex' (108 cards). Phase 2 adds 'junzheng_161' (161 cards).
 */
export function buildDeck(
  variant: DeckVariant,
  extraEntries: { entries: readonly RawCardEntry[]; pack: CardPack }[] = []
): CardInstance[] {
  const cards: CardInstance[] = [];
  let nextId = 1;

  const std = instantiatePack(STANDARD_CARDS, 'standard', nextId);
  cards.push(...std);
  nextId += std.length;

  const ex = instantiatePack(EX_CARDS, 'ex', nextId);
  cards.push(...ex);
  nextId += ex.length;

  for (const extra of extraEntries) {
    const built = instantiatePack(extra.entries, extra.pack, nextId);
    cards.push(...built);
    nextId += built.length;
  }

  // Note: variant === 'junzheng_161' will be populated automatically once Phase 2 junzheng.ts is wired
  void variant;
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
