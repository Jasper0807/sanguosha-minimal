import type { GameState, PlayerState } from './types.js';
import type { ModifierRegistry } from './events.js';

/**
 * Computes seat distance from `fromId` to `toId` following Sanguosha OL rules:
 * - Minimum circular seat distance among ALIVE players.
 * - +1 if target has defense horse (+1 horse).
 * - -1 if source has offense horse (-1 horse).
 * - Plus any skill/modifier deltas.
 * - Clamped to minimum 1 for distinct players (0 for self).
 */
export function getDistance(
  state: GameState,
  fromId: string,
  toId: string,
  modifiers?: ModifierRegistry
): number {
  if (fromId === toId) return 0;

  const alivePlayers = state.players.filter((p) => p.alive);
  const fromIdx = alivePlayers.findIndex((p) => p.id === fromId);
  const toIdx = alivePlayers.findIndex((p) => p.id === toId);
  if (fromIdx === -1 || toIdx === -1) return Number.POSITIVE_INFINITY;

  const n = alivePlayers.length;
  const raw = Math.abs(fromIdx - toIdx);
  let dist = Math.min(raw, n - raw);

  const from = alivePlayers[fromIdx];
  const to = alivePlayers[toIdx];

  if (to.equips.horsePlus) dist += 1;
  if (from.equips.horseMinus) dist -= 1;
  if (modifiers) {
    dist += modifiers.getDistanceDelta(state, from, to);
  }

  return Math.max(1, dist);
}

/**
 * Returns the effective attack range of a player (default 1, weapon range if equipped, plus modifiers).
 */
export function getAttackRange(
  state: GameState,
  player: PlayerState,
  modifiers?: ModifierRegistry
): number {
  const base = player.equips.weapon?.attackRange ?? 1;
  const delta = modifiers ? modifiers.getAttackRangeDelta(state, player) : 0;
  return Math.max(1, base + delta);
}

/**
 * Checks whether `targetId` is within `attackerId`'s attack range.
 * Optional `excludingEquipCardId` handles cards like Serpent Spear or Axe edge cases
 * where losing a weapon affects range if needed.
 */
export function isInAttackRange(
  state: GameState,
  attackerId: string,
  targetId: string,
  modifiers?: ModifierRegistry
): boolean {
  if (attackerId === targetId) return false;
  const attacker = state.players.find((p) => p.id === attackerId);
  if (!attacker || !attacker.alive) return false;
  const dist = getDistance(state, attackerId, targetId, modifiers);
  const range = getAttackRange(state, attacker, modifiers);
  return dist <= range;
}

/**
 * Returns effective Slash limit in Play phase.
 * Zhuge Crossbow (诸葛连弩) grants virtually unlimited slashes.
 */
export function getSlashLimit(
  state: GameState,
  player: PlayerState,
  modifiers?: ModifierRegistry
): number {
  if (player.equips.weapon?.name === 'zhuge_crossbow') {
    return 9999;
  }
  const base = 1;
  const delta = modifiers ? modifiers.getSlashLimitDelta(state, player) : 0;
  return Math.max(0, base + delta);
}

/**
 * Returns effective hand card limit during Discard phase.
 */
export function getHandLimit(
  state: GameState,
  player: PlayerState,
  modifiers?: ModifierRegistry
): number {
  const base = Math.max(0, player.hp);
  const delta = modifiers ? modifiers.getHandLimitDelta(state, player) : 0;
  return Math.max(0, base + delta);
}
