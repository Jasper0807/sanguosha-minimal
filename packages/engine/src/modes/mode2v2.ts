import type { ModeRuleSet } from './index.js';

/**
 * 2v2（欢乐成双）— 严格对齐三国杀OL规则：
 * - 4人：1号、4号位为蓝队（Team A），2号、3号位为红队（Team B）。
 * - 1号位首回合摸牌数 -1（摸 1 张）。
 * - 队友阵亡时，存活队友立即摸 1 张牌。
 * - 队友手牌互相可见（在 ClientView 投影中生效）。
 * - 禁用主公技。
 * - 消灭敌方全部 2 名角色获胜。
 */
export const mode2v2: ModeRuleSet = {
  mode: '2v2',
  playerCount: 4,
  allowLordSkills: false,
  setupRoles: () => ({
    roles: ['team_a', 'team_b', 'team_b', 'team_a'],
    teams: ['A', 'B', 'B', 'A'],
    firstPlayerIndex: 0
  }),
  getInitialHandCount: () => 4,
  getDrawPhaseCount: (_state, player, isPlayerFirstTurn) => {
    if (player.seat === 0 && isPlayerFirstTurn) {
      return 1;
    }
    return 2;
  },
  onPlayerDied: (state, victim, _killer, helpers) => {
    if (!victim.team) return;
    const survivingTeammate = state.players.find(
      (p) => p.alive && p.id !== victim.id && p.team === victim.team
    );
    if (survivingTeammate) {
      helpers.drawCards(survivingTeammate.id, 1);
      helpers.log(
        'draw',
        `【欢乐成双】队友 ${victim.name} 阵亡，${survivingTeammate.name} 摸了一张牌`,
        survivingTeammate.id
      );
    }
  },
  checkVictory: (state) => {
    const teamAAlive = state.players.some((p) => p.alive && p.team === 'A');
    const teamBAlive = state.players.some((p) => p.alive && p.team === 'B');
    if (!teamBAlive && teamAAlive) {
      return {
        winnerTeam: '蓝队（1/4号位）',
        winnerPlayerIds: state.players.filter((p) => p.team === 'A').map((p) => p.id),
        reason: '蓝队消灭全部红队角色，获得 2v2 欢乐成双胜利！',
        totalTurns: state.turn
      };
    }
    if (!teamAAlive && teamBAlive) {
      return {
        winnerTeam: '红队（2/3号位）',
        winnerPlayerIds: state.players.filter((p) => p.team === 'B').map((p) => p.id),
        reason: '红队消灭全部蓝队角色，获得 2v2 欢乐成双胜利！',
        totalTurns: state.turn
      };
    }
    if (!teamAAlive && !teamBAlive) {
      return {
        winnerTeam: '平局',
        winnerPlayerIds: [],
        reason: '双方同时全灭，本局平局。',
        totalTurns: state.turn
      };
    }
    return null;
  }
};
