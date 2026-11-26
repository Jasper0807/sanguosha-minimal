import type { ClientView, GameState, PlayerState, PublicPlayerView } from './types.js';

export interface ViewOptions {
  revealAllHands?: boolean;
  revealAllRoles?: boolean;
}

function canSeeHand(
  state: GameState,
  viewer: PlayerState | undefined,
  target: PlayerState,
  options?: ViewOptions
): boolean {
  if (options?.revealAllHands || state.config.debug?.revealAllHands) {
    return true;
  }
  if (!viewer) return false;
  if (viewer.id === target.id) return true;
  // Sanguosha OL 欢乐2v2 rule: teammates can see each other's hand cards!
  if (state.config.mode === '2v2' && viewer.team && viewer.team === target.team) {
    return true;
  }
  return false;
}

function canSeeRole(
  state: GameState,
  viewer: PlayerState | undefined,
  target: PlayerState,
  options?: ViewOptions
): boolean {
  if (options?.revealAllRoles || state.result !== null) return true;
  if (target.roleRevealed || !target.alive) return true;
  if (viewer && viewer.id === target.id) return true;
  if (state.config.mode === '1v1' || state.config.mode === '2v2') return true;
  return false;
}

/**
 * Projects full authoritative GameState into a player-scoped ClientView
 * that strictly strips hidden hand cards and unrevealed roles.
 * Safe to serialize over WebSocket in Phase 5!
 */
export function buildClientView(
  state: GameState,
  viewerId: string,
  options?: ViewOptions
): ClientView {
  const viewer = state.players.find((p) => p.id === viewerId);
  const activePlayer = state.players[state.activePlayerIndex];

  const players: PublicPlayerView[] = state.players.map((p) => {
    const handVisible = canSeeHand(state, viewer, p, options);
    const roleVisible = canSeeRole(state, viewer, p, options);
    return {
      id: p.id,
      seat: p.seat,
      name: p.name,
      isAI: p.isAI,
      role: roleVisible ? p.role : 'hidden',
      roleRevealed: p.roleRevealed,
      team: p.team,
      generalId: p.generalId,
      generalName: p.generalName,
      generalTitle: p.generalTitle,
      faction: p.faction,
      gender: p.gender,
      hp: p.hp,
      maxHp: p.maxHp,
      alive: p.alive,
      chained: p.chained,
      flipped: p.flipped,
      drunk: p.drunk,
      slashUsedThisTurn: p.slashUsedThisTurn,
      handCount: p.hand.length,
      hand: handVisible ? [...p.hand] : null,
      equips: { ...p.equips },
      judgeZone: [...p.judgeZone],
      woodenOxCount: p.woodenOxCards.length,
      woodenOxCards: handVisible ? [...p.woodenOxCards] : null,
      woodenOxUsedThisTurn: p.woodenOxUsedThisTurn,
      skills: [...p.skills],
      marks: { ...p.marks },
      stats: { ...p.stats }
    };
  });

  // Only expose prompt to the prompted player (or in single-player debug/host view if needed)
  const pendingPrompt =
    state.pendingPrompt &&
    (state.pendingPrompt.playerId === viewerId || options?.revealAllHands)
      ? state.pendingPrompt
      : null;

  return {
    viewerId,
    mode: state.config.mode,
    deckVariant: state.config.deckVariant,
    seed: state.config.seed,
    turn: state.turn,
    round: state.round,
    activePlayerId: activePlayer?.id ?? '',
    phase: state.phase,
    drawPileCount: state.drawPile.length,
    discardPileCount: state.discardPile.length,
    recentDiscards: state.discardPile.slice(-8).reverse(),
    tableCards: [...state.tableCards],
    harvestPool: state.harvestPool.map((item) => ({ ...item })),
    players,
    pendingPrompt,
    events: state.events.slice(-150),
    result: state.result
  };
}
