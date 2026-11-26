import type { GameMode, GameResult, GameState, PlayerState, Role } from '../core/types.js';
import type { SeededRng } from '../core/rng.js';

export interface ModeSetupResult {
  roles: Role[];
  teams?: ('A' | 'B')[];
  firstPlayerIndex: number;
}

export interface ModeRuleSet {
  mode: GameMode;
  playerCount: number;
  allowLordSkills: boolean;
  setupRoles: (state: GameState, rng: SeededRng) => ModeSetupResult;
  getInitialHandCount: (state: GameState, player: PlayerState) => number;
  getDrawPhaseCount: (state: GameState, player: PlayerState, isPlayerFirstTurn: boolean) => number;
  onPlayerDied?: (
    state: GameState,
    victim: PlayerState,
    killer: PlayerState | null,
    helpers: {
      drawCards: (playerId: string, count: number) => void;
      discardAllHandAndEquips: (playerId: string) => void;
      log: (type: string, message: string, actorId?: string, targetIds?: string[]) => void;
    }
  ) => void;
  checkVictory: (state: GameState) => GameResult | null;
}

/**
 * 1v1（纯单挑）:
 * - 2 players, each picks 1 general, initial hand = 4 for both,
 *   no first/second draw modifier, no reserves, no lord skills.
 * - First to eliminate opponent wins.
 */
export const mode1v1: ModeRuleSet = {
  mode: '1v1',
  playerCount: 2,
  allowLordSkills: false,
  setupRoles: () => ({
    roles: ['duelist', 'duelist'],
    firstPlayerIndex: 0
  }),
  getInitialHandCount: () => 4,
  getDrawPhaseCount: () => 2,
  checkVictory: (state) => {
    const alive = state.players.filter((p) => p.alive);
    if (alive.length === 1) {
      const winner = alive[0];
      return {
        winnerTeam: winner.name,
        winnerPlayerIds: [winner.id],
        reason: `${winner.name}（${winner.generalName}）击败对手，获得 1v1 单挑胜利！`,
        totalTurns: state.turn
      };
    }
    if (alive.length === 0) {
      return {
        winnerTeam: '平局',
        winnerPlayerIds: [],
        reason: '双方同归于尽，本局平局。',
        totalTurns: state.turn
      };
    }
    return null;
  }
};

const modeRegistry = new Map<GameMode, ModeRuleSet>([['1v1', mode1v1]]);

export function registerModeRuleSet(ruleSet: ModeRuleSet): void {
  modeRegistry.set(ruleSet.mode, ruleSet);
}

export function getModeRuleSet(mode: GameMode): ModeRuleSet {
  const found = modeRegistry.get(mode);
  if (!found) {
    throw new Error(`Unsupported game mode: ${mode}`);
  }
  return found;
}
