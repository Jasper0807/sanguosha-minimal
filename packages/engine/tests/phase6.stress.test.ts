import { describe, expect, it } from 'vitest';
import {
  ALL_PLAYABLE_GENERALS,
  GameEngine,
  runAutoGame,
  type GameConfig,
  type GameMode
} from '../src/index.js';

describe('Phase 6: 500-Game Full-Roster (89 OL Generals + 161 Cards) Automated AI Stress Test', () => {
  it('completes 500 full AI-vs-AI games across 1v1 (170), 2v2 (165), and identity5 (165) with zero crashes, zero deadlocks, and deterministic replays', () => {
    const batches: { mode: GameMode; count: number; baseSeed: number }[] = [
      { mode: '1v1', count: 170, baseSeed: 61000 },
      { mode: '2v2', count: 165, baseSeed: 62000 },
      { mode: 'identity5', count: 165, baseSeed: 63000 }
    ];

    let totalGames = 0;
    let drawProtectionCount = 0;
    const seenGeneralIds = new Set<string>();
    const modeStats: Record<
      GameMode,
      { games: number; totalTurns: number; winsByTeam: Record<string, number> }
    > = {
      '1v1': { games: 0, totalTurns: 0, winsByTeam: {} },
      '2v2': { games: 0, totalTurns: 0, winsByTeam: {} },
      identity5: { games: 0, totalTurns: 0, winsByTeam: {} }
    };

    for (const batch of batches) {
      const seatCount = batch.mode === '1v1' ? 2 : batch.mode === '2v2' ? 4 : 5;
      for (let i = 0; i < batch.count; i++) {
        const cfg: GameConfig = {
          mode: batch.mode,
          deckVariant: 'junzheng_161',
          generalPack: 'all',
          seed: batch.baseSeed + i,
          seats: Array.from({ length: seatCount }, (_, idx) => ({
            id: `p${idx + 1}`,
            name: `AI_${idx + 1}`,
            isAI: true
          }))
        };

        const engine = new GameEngine(cfg);
        const state = runAutoGame(engine, 15000);

        expect(state.result, `Game failed to terminate: ${batch.mode} seed=${cfg.seed}`).not.toBeNull();
        expect(state.phase).toBe('gameover');
        expect(state.turn).toBeGreaterThan(0);

        // Track roster coverage & stats
        for (const p of state.players) {
          seenGeneralIds.add(p.generalId);
        }
        totalGames += 1;
        const winnerTeam = state.result!.winnerTeam;
        if (winnerTeam === '平局') {
          drawProtectionCount += 1;
        }
        const ms = modeStats[batch.mode];
        ms.games += 1;
        ms.totalTurns += state.turn;
        ms.winsByTeam[winnerTeam] = (ms.winsByTeam[winnerTeam] ?? 0) + 1;

        // Verify deterministic replay on 15 sampled games (5 per mode)
        if (i < 5) {
          const replayed = GameEngine.replay(cfg, state.actionLog);
          expect(replayed.state.result).toEqual(state.result);
          expect(replayed.state.turn).toBe(state.turn);
          expect(replayed.state.events.length).toBe(state.events.length);
        }
      }
    }

    expect(totalGames).toBe(500);
    // Across 500 games with 1,825 seat selections, every single one of the 89 OL generals should appear!
    expect(seenGeneralIds.size).toBe(ALL_PLAYABLE_GENERALS.length);
    // Draw protection should stay low (well under 10%)
    expect(drawProtectionCount).toBeLessThan(50);

    // Emit crisp acceptance telemetry
    console.log('\n[Phase 6 Stress Telemetry — 500 Games, 89 OL Generals, 161 Junzheng Cards]');
    for (const mode of ['1v1', '2v2', 'identity5'] as const) {
      const s = modeStats[mode];
      const avgTurns = (s.totalTurns / s.games).toFixed(1);
      console.log(`  ${mode}: ${s.games} games | avg ${avgTurns} turns | outcomes:`, s.winsByTeam);
    }
    console.log(
      `  Unique generals exercised: ${seenGeneralIds.size}/${ALL_PLAYABLE_GENERALS.length} | draw-protection: ${drawProtectionCount}/500`
    );
  }, 180000);
});
