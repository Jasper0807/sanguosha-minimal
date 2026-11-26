import type { Role } from '../core/types.js';
import type { ModeRuleSet } from './index.js';

const IDENTITY5_ROLES: readonly Role[] = ['lord', 'loyalist', 'rebel', 'rebel', 'renegade'];

/**
 * 五人身份场 — 严格对齐三国杀OL规则：
 * - 1主、1忠、2反、1内。
 * - 主公身份明置、体力上限+1且先手行动（支持调试指定身份，未指定则随机分配）。
 * - 击杀反贼：击杀者摸 3 张牌。
 * - 主公误杀忠臣：主公弃置全部手牌与装备牌。
 * - 胜负：
 *   - 主公阵亡：若仅剩内奸存活则内奸胜；否则反贼胜。
 *   - 反贼与内奸全部阵亡且主公存活：主公与忠臣胜。
 */
export const modeIdentity5: ModeRuleSet = {
  mode: 'identity5',
  playerCount: 5,
  allowLordSkills: true,
  setupRoles: (state, rng) => {
    const remaining: Role[] = [...IDENTITY5_ROLES];
    const assigned: (Role | null)[] = state.config.seats.map(() => null);

    // Honor any valid preferredRole specified by host/debug
    state.config.seats.forEach((seat, idx) => {
      if (!seat.preferredRole) return;
      const poolIdx = remaining.indexOf(seat.preferredRole);
      if (poolIdx !== -1) {
        assigned[idx] = seat.preferredRole;
        remaining.splice(poolIdx, 1);
      }
    });

    const shuffledRemaining = rng.shuffle(remaining);
    let cursor = 0;
    const roles: Role[] = assigned.map((r) => r ?? shuffledRemaining[cursor++]);
    const lordIndex = roles.indexOf('lord');

    return {
      roles,
      firstPlayerIndex: lordIndex >= 0 ? lordIndex : 0
    };
  },
  getInitialHandCount: () => 4,
  getDrawPhaseCount: () => 2,
  onPlayerDied: (_state, victim, killer, helpers) => {
    if (!killer || !killer.alive) return;

    if (victim.role === 'rebel') {
      helpers.drawCards(killer.id, 3);
      helpers.log(
        'draw',
        `【身份奖惩】${killer.name} 击杀反贼 ${victim.name}，摸 3 张牌！`,
        killer.id,
        [victim.id]
      );
    } else if (victim.role === 'loyalist' && killer.role === 'lord') {
      helpers.discardAllHandAndEquips(killer.id);
      helpers.log(
        'discard',
        `【身份奖惩】主公 ${killer.name} 误杀忠臣 ${victim.name}，弃置全部手牌与装备牌！`,
        killer.id,
        [victim.id]
      );
    }
  },
  checkVictory: (state) => {
    const lord = state.players.find((p) => p.role === 'lord');
    const alive = state.players.filter((p) => p.alive);

    // Lord died -> Renegade wins ONLY if sole survivor; otherwise Rebels win!
    if (!lord || !lord.alive) {
      if (alive.length === 1 && alive[0].role === 'renegade') {
        return {
          winnerTeam: '内奸',
          winnerPlayerIds: [alive[0].id],
          reason: `内奸 ${alive[0].name} 笑到最后并击杀主公，独自获胜！`,
          totalTurns: state.turn
        };
      }
      return {
        winnerTeam: '反贼阵营',
        winnerPlayerIds: state.players.filter((p) => p.role === 'rebel').map((p) => p.id),
        reason: '主公阵亡，反贼阵营获胜！',
        totalTurns: state.turn
      };
    }

    // Lord alive -> check if all Rebels and Renegades are eliminated
    const enemiesAlive = alive.some((p) => p.role === 'rebel' || p.role === 'renegade');
    if (!enemiesAlive) {
      return {
        winnerTeam: '主忠阵营',
        winnerPlayerIds: state.players
          .filter((p) => p.role === 'lord' || p.role === 'loyalist')
          .map((p) => p.id),
        reason: '所有反贼与内奸已消灭，主公与忠臣获胜！',
        totalTurns: state.turn
      };
    }

    return null;
  }
};
