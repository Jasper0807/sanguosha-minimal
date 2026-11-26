import type { RawCardEntry } from './standard.js';

/**
 * Exact 52-card Sanguosha Junzheng Expansion (1 full deck without jokers).
 * Verified against Moegirl Wiki / Sanguosha OL official deck table:
 * - 32 Basic: 5 fire_slash, 9 thunder_slash, 9 dodge, 4 peach, 5 alcohol
 * - 14 Trick: 6 iron_chain, 3 nullification, 3 fire_attack, 2 supply_shortage
 * - 6 Equip: 2 weapons (guding_blade, fan), 3 armors (2 vine_armor, 1 silver_lion), 1 +1 horse (hualiu)
 */
export const JUNZHENG_CARDS: readonly RawCardEntry[] = [
  // ===== Heart (13) =====
  ['heart', 1, 'nullification'],
  ['heart', 2, 'fire_attack'],
  ['heart', 3, 'fire_attack'],
  ['heart', 4, 'fire_slash'],
  ['heart', 5, 'peach'],
  ['heart', 6, 'peach'],
  ['heart', 7, 'fire_slash'],
  ['heart', 8, 'dodge'],
  ['heart', 9, 'dodge'],
  ['heart', 10, 'fire_slash'],
  ['heart', 11, 'dodge'],
  ['heart', 12, 'dodge'],
  ['heart', 13, 'nullification'],

  // ===== Diamond (13) =====
  ['diamond', 1, 'fan'],
  ['diamond', 2, 'peach'],
  ['diamond', 3, 'peach'],
  ['diamond', 4, 'fire_slash'],
  ['diamond', 5, 'fire_slash'],
  ['diamond', 6, 'dodge'],
  ['diamond', 7, 'dodge'],
  ['diamond', 8, 'dodge'],
  ['diamond', 9, 'alcohol'],
  ['diamond', 10, 'dodge'],
  ['diamond', 11, 'dodge'],
  ['diamond', 12, 'fire_attack'],
  ['diamond', 13, 'hualiu'],

  // ===== Spade (13) =====
  ['spade', 1, 'guding_blade'],
  ['spade', 2, 'vine_armor'],
  ['spade', 3, 'alcohol'],
  ['spade', 4, 'thunder_slash'],
  ['spade', 5, 'thunder_slash'],
  ['spade', 6, 'thunder_slash'],
  ['spade', 7, 'thunder_slash'],
  ['spade', 8, 'thunder_slash'],
  ['spade', 9, 'alcohol'],
  ['spade', 10, 'supply_shortage'],
  ['spade', 11, 'iron_chain'],
  ['spade', 12, 'iron_chain'],
  ['spade', 13, 'nullification'],

  // ===== Club (13) =====
  ['club', 1, 'silver_lion'],
  ['club', 2, 'vine_armor'],
  ['club', 3, 'alcohol'],
  ['club', 4, 'supply_shortage'],
  ['club', 5, 'thunder_slash'],
  ['club', 6, 'thunder_slash'],
  ['club', 7, 'thunder_slash'],
  ['club', 8, 'thunder_slash'],
  ['club', 9, 'alcohol'],
  ['club', 10, 'iron_chain'],
  ['club', 11, 'iron_chain'],
  ['club', 12, 'iron_chain'],
  ['club', 13, 'iron_chain']
];

/**
 * Exact 1 Limit Break expansion card included in OL 161-card deck: 木牛流马 (♦5).
 */
export const LIMIT_BREAK_CARDS: readonly RawCardEntry[] = [
  ['diamond', 5, 'wooden_ox']
];
