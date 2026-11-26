import { describe, expect, it } from 'vitest';
import {
  buildDeck,
  createCardInstance,
  GameEngine,
  runAutoGame,
  type GameConfig
} from '../src/index.js';

describe('Phase 3: 2v2 (欢乐成双) Mode Rules', () => {
  it('enforces 1/4 vs 2/3 teams, Seat 1 first-turn draw -1, teammate hand visibility, teammate death draw +1, and team victory', () => {
    const slash1 = createCardInstance(1, 'heart', 10, 'slash');
    const slash2 = createCardInstance(2, 'heart', 11, 'slash');
    const crossbow = createCardInstance(3, 'diamond', 1, 'zhuge_crossbow');
    const filler = Array.from({ length: 50 }, (_, i) =>
      createCardInstance(2000 + i, 'spade', 7, 'slash')
    );

    const engine = new GameEngine(
      {
        mode: '2v2',
        deckVariant: 'junzheng_161',
        seed: 401,
        skipGeneralSelection: true,
        seats: [
          { id: 'p1', name: '蓝1', isAI: false },
          { id: 'p2', name: '红2', isAI: false },
          { id: 'p3', name: '红3', isAI: false },
          { id: 'p4', name: '蓝4', isAI: false }
        ]
      },
      { deckOverride: [crossbow, slash1, slash2, ...filler] }
    );
    engine.start();

    // Teams: 1 & 4 = Team A, 2 & 3 = Team B
    expect(engine.getPlayer('p1').team).toBe('A');
    expect(engine.getPlayer('p4').team).toBe('A');
    expect(engine.getPlayer('p2').team).toBe('B');
    expect(engine.getPlayer('p3').team).toBe('B');

    // Seat 1 first turn draws 1 card (initial 4 + 1 = 5 cards!)
    expect(engine.getPlayer('p1').hand.length).toBe(5);

    // Teammate hand visibility in ClientView: p1 sees p4's hand, NOT p2/p3!
    const viewP1 = engine.getClientView('p1');
    expect(viewP1.players[0].hand).not.toBeNull();
    expect(viewP1.players[1].hand).toBeNull();
    expect(viewP1.players[2].hand).toBeNull();
    expect(viewP1.players[3].hand).not.toBeNull();

    // Kill p2 (Team B) -> surviving teammate p3 immediately draws 1 card!
    engine.getPlayer('p2').hp = 1;
    engine.getPlayer('p3').hp = 1;
    const p3Before = engine.getPlayer('p3').hand.length;
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: crossbow.id } });
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash1.id, targetIds: ['p2'] }
    });
    expect(engine.getPlayer('p2').alive).toBe(false);
    expect(engine.getPlayer('p3').hand.length).toBe(p3Before + 1);
    expect(engine.state.result).toBeNull();

    // Kill p3 -> Team A (p1 & p4) wins!
    // Give p1 a -1 horse or range so p1 can reach p3 (now distance 1 since p2 died!)
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash2.id, targetIds: ['p3'] }
    });
    expect(engine.state.result).not.toBeNull();
    expect(engine.state.result?.winnerPlayerIds).toEqual(['p1', 'p4']);
  });
});

describe('Phase 3: 5-Player Identity Mode (五人身份场) Rules', () => {
  function makeIdentity5Engine(deckOverride?: ReturnType<typeof buildDeck>): GameEngine {
    const filler = Array.from({ length: 60 }, (_, i) =>
      createCardInstance(3000 + i, 'spade', 7, 'slash')
    );
    const engine = new GameEngine(
      {
        mode: 'identity5',
        deckVariant: 'junzheng_161',
        seed: 501,
        skipGeneralSelection: true,
        seats: [
          { id: 'p1', name: '主公', isAI: false, preferredRole: 'lord' },
          { id: 'p2', name: '忠臣', isAI: false, preferredRole: 'loyalist' },
          { id: 'p3', name: '反一', isAI: false, preferredRole: 'rebel' },
          { id: 'p4', name: '反二', isAI: false, preferredRole: 'rebel' },
          { id: 'p5', name: '内奸', isAI: false, preferredRole: 'renegade' }
        ]
      },
      { deckOverride: deckOverride ?? filler }
    );
    engine.start();
    return engine;
  }

  it('sets Lord public with +1 maxHp, gives +3 cards for killing Rebel, strips Lord hand+equips on killing Loyalist, and detects Lord+Loyalist victory', () => {
    const crossbow = createCardInstance(1, 'diamond', 1, 'zhuge_crossbow');
    const kylin = createCardInstance(2, 'heart', 5, 'kylin_bow');
    const s1 = createCardInstance(3, 'heart', 10, 'slash');
    const s2 = createCardInstance(4, 'heart', 11, 'slash');
    const s3 = createCardInstance(5, 'heart', 10, 'slash');
    const s4 = createCardInstance(6, 'heart', 11, 'slash');
    const filler = Array.from({ length: 60 }, (_, i) =>
      createCardInstance(3000 + i, 'spade', 7, 'slash')
    );

    const engine = makeIdentity5Engine([crossbow, s1, s2, s3, ...filler.slice(0, 16), s4, kylin, ...filler.slice(16)]);
    const lord = engine.getPlayer('p1');

    // Lord HP is 4 + 1 = 5, roleRevealed = true, others hidden
    expect(lord.maxHp).toBe(5);
    expect(lord.hp).toBe(5);
    expect(lord.roleRevealed).toBe(true);
    const viewP3 = engine.getClientView('p3');
    expect(viewP3.players[0].role).toBe('lord'); // Public!
    expect(viewP3.players[1].role).toBe('hidden'); // Loyalist hidden from Rebel!
    expect(viewP3.players[2].role).toBe('rebel'); // Self visible!

    // Lord equips crossbow + kylin? Just equip crossbow and set range via -1 horse or kill adjacent!
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: crossbow.id } });
    // Put a -1 horse on lord so distance to p3/p4 is 1
    lord.equips.horseMinus = createCardInstance(999, 'heart', 5, 'chitu');

    // 1. Lord kills Rebel p3 -> draws 3 cards!
    engine.getPlayer('p3').hp = 1;
    const handBeforeKillRebel = lord.hand.length;
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: s1.id, targetIds: ['p3'] }
    });
    expect(engine.getPlayer('p3').alive).toBe(false);
    expect(lord.hand.length).toBe(handBeforeKillRebel - 1 + 3);

    // 2. Lord mistakenly kills Loyalist p2 -> Lord discards ALL hand cards & ALL equips!
    engine.getPlayer('p2').hp = 1;
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: s2.id, targetIds: ['p2'] }
    });
    expect(engine.getPlayer('p2').alive).toBe(false);
    expect(lord.hand.length).toBe(0);
    expect(lord.equips.weapon).toBeNull();
    expect(lord.equips.horseMinus).toBeNull();

    // 3. Give Lord crossbow & 2 slashes to eliminate remaining Rebel p4 & Renegade p5 -> Lord+Loyalist win!
    lord.equips.weapon = crossbow;
    lord.hand.push(s3, s4);
    engine.getPlayer('p4').hp = 1;
    engine.getPlayer('p5').hp = 1;
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: s3.id, targetIds: ['p4'] }
    });
    expect(engine.state.result).toBeNull(); // Renegade still alive!

    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: s4.id, targetIds: ['p5'] }
    });
    expect(engine.state.result).not.toBeNull();
    expect(engine.state.result?.winnerTeam).toBe('主忠阵营');
    expect(engine.state.result?.winnerPlayerIds).toEqual(['p1', 'p2']);
  });

  it('distinguishes Rebel victory vs sole-survivor Renegade victory when Lord dies', () => {
    // Case A: Rebel alive when Lord dies -> Rebels win!
    const engRebel = makeIdentity5Engine();
    engRebel.getPlayer('p1').hp = 1;
    engRebel.getPlayer('p1').hand = [];
    // End Lord turn -> let p2 end -> p3 (rebel) kills Lord with Duel
    const duel = createCardInstance(777, 'spade', 1, 'duel');
    engRebel.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    // Advance to p3 turn
    while (engRebel.state.pendingPrompt && engRebel.state.pendingPrompt.playerId !== 'p3') {
      const p = engRebel.state.pendingPrompt;
      if (p.type === 'play_action') {
        engRebel.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
      } else if (p.type === 'choose_card') {
        engRebel.submit({ type: 'choose_card', cardIds: p.eligibleCardIds.slice(0, p.minCount) });
      }
    }
    engRebel.getPlayer('p3').hand.push(duel);
    engRebel.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: duel.id, targetIds: ['p1'] }
    });
    expect(engRebel.state.result?.winnerTeam).toBe('反贼阵营');

    // Case B: Everyone else dead except Lord & Renegade -> Renegade kills Lord -> Renegade wins!
    const engRenegade = makeIdentity5Engine();
    engRenegade.getPlayer('p2').alive = false;
    engRenegade.getPlayer('p3').alive = false;
    engRenegade.getPlayer('p4').alive = false;
    engRenegade.getPlayer('p1').hp = 1;
    engRenegade.getPlayer('p1').hand = [];
    engRenegade.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    // Now it's p5 (Renegade)'s turn!
    expect(engRenegade.state.pendingPrompt?.playerId).toBe('p5');
    const slashKill = createCardInstance(888, 'heart', 10, 'slash');
    engRenegade.getPlayer('p5').hand.push(slashKill);
    engRenegade.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slashKill.id, targetIds: ['p1'] }
    });
    expect(engRenegade.state.result?.winnerTeam).toBe('内奸');
    expect(engRenegade.state.result?.winnerPlayerIds).toEqual(['p5']);
  });
});

describe('Phase 3: Automated Multi-Game AI Verification Across All 3 Modes', () => {
  it('completes 20 full 1v1 AI-vs-AI games cleanly with zero deadlocks', () => {
    for (let i = 1; i <= 20; i++) {
      const config: GameConfig = {
        mode: '1v1',
        deckVariant: 'junzheng_161',
        seed: 1000 + i,
        skipGeneralSelection: false,
        seats: [
          { id: 'p1', name: 'AI甲', isAI: true },
          { id: 'p2', name: 'AI乙', isAI: true }
        ]
      };
      const engine = new GameEngine(config);
      const finalState = runAutoGame(engine);
      expect(finalState.result).not.toBeNull();
      expect(finalState.phase).toBe('gameover');
    }
  });

  it('completes 20 full 2v2 AI-vs-AI games cleanly with zero deadlocks', () => {
    for (let i = 1; i <= 20; i++) {
      const config: GameConfig = {
        mode: '2v2',
        deckVariant: 'junzheng_161',
        seed: 2000 + i,
        skipGeneralSelection: false,
        seats: [
          { id: 'p1', name: 'AI蓝1', isAI: true },
          { id: 'p2', name: 'AI红2', isAI: true },
          { id: 'p3', name: 'AI红3', isAI: true },
          { id: 'p4', name: 'AI蓝4', isAI: true }
        ]
      };
      const engine = new GameEngine(config);
      const finalState = runAutoGame(engine);
      expect(finalState.result).not.toBeNull();
      expect(finalState.phase).toBe('gameover');
    }
  });

  it('completes 20 full 5-Player Identity AI-vs-AI games cleanly and replays deterministically', () => {
    let sampleConfig: GameConfig | null = null;
    let sampleEngine: GameEngine | null = null;

    for (let i = 1; i <= 20; i++) {
      const config: GameConfig = {
        mode: 'identity5',
        deckVariant: 'junzheng_161',
        seed: 3000 + i,
        skipGeneralSelection: false,
        seats: [
          { id: 'p1', name: 'AI一', isAI: true },
          { id: 'p2', name: 'AI二', isAI: true },
          { id: 'p3', name: 'AI三', isAI: true },
          { id: 'p4', name: 'AI四', isAI: true },
          { id: 'p5', name: 'AI五', isAI: true }
        ]
      };
      const engine = new GameEngine(config);
      const finalState = runAutoGame(engine);
      expect(finalState.result).not.toBeNull();
      expect(finalState.phase).toBe('gameover');
      if (i === 1) {
        sampleConfig = config;
        sampleEngine = engine;
      }
    }

    // Verify full-game deterministic replay reproduces exact same winner & turns!
    const replayed = GameEngine.replay(sampleConfig!, sampleEngine!.state.actionLog);
    expect(replayed.state.result).toEqual(sampleEngine!.state.result);
    expect(replayed.state.turn).toBe(sampleEngine!.state.turn);
  });
});
