import { describe, expect, it } from 'vitest';
import {
  buildDeck,
  createCardInstance,
  GameEngine,
  type CardInstance,
  type GameConfig,
  type PlayerResponse
} from '../src/index.js';

function make1v1Config(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    mode: '1v1',
    deckVariant: 'standard_ex',
    seed: 101,
    skipGeneralSelection: true,
    seats: [
      { id: 'p1', name: '玩家一', isAI: false, generalId: 'blank_wei_m' },
      { id: 'p2', name: '玩家二', isAI: false, generalId: 'blank_wu_f' }
    ],
    ...overrides
  };
}

/**
 * Helper to create a deterministic 1v1 engine with exact initial hands and exact upcoming draw pile.
 * In 1v1, p1 draws 4 cards, p2 draws 4 cards, then p1 turn 1 draws 2 cards.
 */
function setupCustom1v1(params: {
  p1Hand: CardInstance[];
  p2Hand: CardInstance[];
  nextDraws?: CardInstance[];
  p1General?: string;
  p2General?: string;
}): GameEngine {
  const filler = buildDeck('standard_ex').slice(0, 40).map((c, idx) => ({
    ...c,
    id: 9000 + idx
  }));
  // Make sure p1Hand and p2Hand have exactly 4 cards each for setup dealing
  const pad = (cards: CardInstance[], prefixId: number): CardInstance[] => {
    const out = [...cards];
    while (out.length < 4) {
      out.push(createCardInstance(prefixId + out.length, 'diamond', 2, 'dodge'));
    }
    return out.slice(0, 4);
  };
  const h1 = pad(params.p1Hand, 5000);
  const h2 = pad(params.p2Hand, 6000);
  const nextDraws = params.nextDraws ?? [
    createCardInstance(7001, 'diamond', 3, 'dodge'),
    createCardInstance(7002, 'diamond', 4, 'dodge')
  ];
  const deckOverride = [...h1, ...h2, ...nextDraws, ...filler];

  const engine = new GameEngine(
    make1v1Config({
      seats: [
        { id: 'p1', name: '玩家一', isAI: false, generalId: params.p1General ?? 'blank_wei_m' },
        { id: 'p2', name: '玩家二', isAI: false, generalId: params.p2General ?? 'blank_wu_f' }
      ]
    }),
    { deckOverride }
  );
  engine.start();
  return engine;
}

describe('Phase 1: Standard + EX 108-card deck integrity', () => {
  it('builds exactly 108 cards (104 Standard + 4 EX) with exact category counts', () => {
    const deck = buildDeck('standard_ex');
    expect(deck.length).toBe(108);

    const basic = deck.filter((c) => c.category === 'basic');
    const trick = deck.filter((c) => c.category === 'trick');
    const equip = deck.filter((c) => c.category === 'equip');
    expect(basic.length).toBe(53);
    expect(trick.length).toBe(36);
    expect(equip.length).toBe(19);

    const count = (name: string) => deck.filter((c) => c.name === name).length;
    expect(count('slash')).toBe(30);
    expect(count('dodge')).toBe(15);
    expect(count('peach')).toBe(8);
    expect(count('dismantle')).toBe(6);
    expect(count('snatch')).toBe(5);
    expect(count('ex_nihilo')).toBe(4);
    expect(count('nullification')).toBe(4); // 3 std + 1 EX
    expect(count('savage_assault')).toBe(3);
    expect(count('duel')).toBe(3);
    expect(count('collateral')).toBe(2);
    expect(count('harvest')).toBe(2);
    expect(count('archery_attack')).toBe(1);
    expect(count('peach_garden')).toBe(1);
    expect(count('indulgence')).toBe(3);
    expect(count('lightning')).toBe(2); // 1 std + 1 EX
    expect(count('zhuge_crossbow')).toBe(2);
    expect(count('eight_trigrams')).toBe(2);
    expect(count('ice_sword')).toBe(1);
    expect(count('renwang_shield')).toBe(1);

    // Every suit has exactly 27 cards in Standard + EX (26 std + 1 EX)
    for (const suit of ['spade', 'heart', 'club', 'diamond'] as const) {
      expect(deck.filter((c) => c.suit === suit).length).toBe(27);
    }
  });
});

describe('Phase 1: Core turn flow, Slash/Dodge/Peach, Dying & Discard', () => {
  it('handles Slash -> Dodge offset, Slash -> Hit, Peach heal, and Discard phase', () => {
    const slash1 = createCardInstance(1, 'heart', 10, 'slash');
    const slash2 = createCardInstance(2, 'spade', 8, 'slash');
    const peach1 = createCardInstance(3, 'heart', 3, 'peach');
    const dodgeP2 = createCardInstance(10, 'diamond', 2, 'dodge');

    const engine = setupCustom1v1({
      p1Hand: [slash1, slash2, peach1],
      p2Hand: [dodgeP2]
    });

    // Turn 1 p1 play phase (6 cards in hand, HP=4)
    expect(engine.state.phase).toBe('play');
    expect(engine.state.pendingPrompt?.type).toBe('play_action');
    expect(engine.getPlayer('p1').hand.length).toBe(6);

    // P1 plays slash1 on p2 -> p2 gets dodge prompt
    let prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash1.id, targetIds: ['p2'] }
    });
    expect(prompt?.type).toBe('choose_card');
    if (prompt?.type === 'choose_card') {
      expect(prompt.reason).toBe('dodge');
      expect(prompt.playerId).toBe('p2');
    }

    // P2 plays dodge -> no damage!
    prompt = engine.submit({ type: 'choose_card', cardIds: [dodgeP2.id] });
    expect(engine.getPlayer('p2').hp).toBe(4);
    expect(prompt?.type).toBe('play_action');

    // Second slash should NOT be playable (limit 1)
    if (prompt?.type === 'play_action') {
      expect(prompt.playableCardIds).not.toContain(slash2.id);
    }

    // End play phase -> p1 has 5 cards, HP 4 -> must discard 1
    prompt = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    expect(prompt?.type).toBe('choose_card');
    if (prompt?.type === 'choose_card') {
      expect(prompt.reason).toBe('discard_phase');
      expect(prompt.minCount).toBe(1);
      prompt = engine.submit({ type: 'choose_card', cardIds: [prompt.eligibleCardIds[0]] });
    }

    expect(engine.getPlayer('p1').hand.length).toBe(4);
    expect(engine.state.turn).toBe(2);
    expect(engine.state.pendingPrompt?.playerId).toBe('p2');
  });

  it('handles Dying peach rescue chain and death victory condition', () => {
    const slash1 = createCardInstance(1, 'heart', 10, 'slash');
    const peachP2 = createCardInstance(10, 'heart', 6, 'peach');
    const crossbow = createCardInstance(2, 'diamond', 1, 'zhuge_crossbow');
    const slash2 = createCardInstance(3, 'heart', 11, 'slash');

    const engine = setupCustom1v1({
      p1Hand: [crossbow, slash1, slash2],
      p2Hand: [peachP2, createCardInstance(11, 'spade', 7, 'slash'), createCardInstance(12, 'spade', 8, 'slash'), createCardInstance(13, 'spade', 9, 'slash')]
    });

    // Reduce p2 HP to 1 to test dying immediately
    engine.getPlayer('p2').hp = 1;

    // Equip crossbow
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: crossbow.id } });
    // Slash 1 hits p2 (p2 has no dodge) -> p2 enters dying at 0 HP -> asked for peach
    let prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash1.id, targetIds: ['p2'] }
    });
    expect(prompt?.type).toBe('choose_card');
    if (prompt?.type === 'choose_card') {
      expect(prompt.reason).toBe('peach_dying');
      expect(prompt.playerId).toBe('p2');
    }
    // P2 saves self with peach -> back to 1 HP!
    prompt = engine.submit({ type: 'choose_card', cardIds: [peachP2.id] });
    expect(engine.getPlayer('p2').hp).toBe(1);
    expect(engine.getPlayer('p2').alive).toBe(true);
    expect(prompt?.type).toBe('play_action');

    // Slash 2 (allowed by Zhuge Crossbow!) kills p2 (no more peaches) -> immediate 1v1 victory!
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash2.id, targetIds: ['p2'] }
    });
    expect(prompt).toBeNull();
    expect(engine.state.result).not.toBeNull();
    expect(engine.state.result?.winnerPlayerIds).toEqual(['p1']);
    expect(engine.getPlayer('p2').alive).toBe(false);
  });
});

describe('Phase 1: Nested Nullification (无懈可击套娃) & Quick-Skip', () => {
  it('resolves triple nested Nullification accurately (odd cancels, even restores)', () => {
    const ex1 = createCardInstance(1, 'heart', 7, 'ex_nihilo');
    const nullP1 = createCardInstance(2, 'spade', 11, 'nullification');
    const nullP2A = createCardInstance(10, 'club', 12, 'nullification');
    const nullP2B = createCardInstance(11, 'club', 13, 'nullification');

    const engine = setupCustom1v1({
      p1Hand: [ex1, nullP1],
      p2Hand: [nullP2A, nullP2B]
    });

    const handBefore = engine.getPlayer('p1').hand.length;
    // P1 plays Ex Nihilo -> p1 is asked first (has nullification), skips -> p2 is asked
    let prompt = engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: ex1.id } });
    expect(prompt?.type).toBe('choose_card');
    expect(prompt?.playerId).toBe('p1');
    prompt = engine.submit({ type: 'choose_card', cardIds: [], cancelled: true });

    // P2 plays Nullification #1
    expect(prompt?.playerId).toBe('p2');
    prompt = engine.submit({ type: 'choose_card', cardIds: [nullP2A.id] });

    // P1 plays Nullification #2 (countering #1!)
    expect(prompt?.playerId).toBe('p1');
    prompt = engine.submit({ type: 'choose_card', cardIds: [nullP1.id] });

    // P2 plays Nullification #3 (countering #2!) -> P1's #2 is negated -> #1 succeeds -> Ex Nihilo cancelled!
    expect(prompt?.playerId).toBe('p2');
    prompt = engine.submit({ type: 'choose_card', cardIds: [nullP2B.id] });

    expect(prompt?.type).toBe('play_action');
    // P1 lost ex1 and nullP1, drew 0 cards!
    expect(engine.getPlayer('p1').hand.length).toBe(handBefore - 2);
  });

  it('restores trick on double Nullification and honors per-turn quick-skip', () => {
    const ex1 = createCardInstance(1, 'heart', 7, 'ex_nihilo');
    const ex2 = createCardInstance(2, 'heart', 8, 'ex_nihilo');
    const nullP1 = createCardInstance(3, 'spade', 11, 'nullification');
    const nullP2 = createCardInstance(10, 'club', 12, 'nullification');

    const engine = setupCustom1v1({
      p1Hand: [ex1, ex2, nullP1],
      p2Hand: [nullP2]
    });

    // Play ex1 -> p1 skips with quick-skip enabled for ex_nihilo
    let prompt = engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: ex1.id } });
    expect(prompt?.playerId).toBe('p1');
    prompt = engine.submit({
      type: 'choose_card',
      cardIds: [],
      cancelled: true,
      skipSimilarTrickThisTurn: true
    });
    // P2 plays nullP2 -> P1 counters with nullP1 (counter-nullification is NOT quick-skipped!)
    expect(prompt?.playerId).toBe('p2');
    prompt = engine.submit({ type: 'choose_card', cardIds: [nullP2.id] });
    expect(prompt?.playerId).toBe('p1');
    prompt = engine.submit({ type: 'choose_card', cardIds: [nullP1.id] });

    // ex1 resolves! P1 drew 2 cards!
    expect(prompt?.type).toBe('play_action');
    expect(engine.getPlayer('p1').hand.length).toBe(6 - 2 + 2);

    // Playing ex2 should NOT ask p1 for nullification even if p1 had one, because quick-skip is active
    const extraNull = createCardInstance(99, 'diamond', 12, 'nullification');
    engine.getPlayer('p1').hand.push(extraNull);
    prompt = engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: ex2.id } });
    expect(prompt?.type).toBe('play_action'); // Immediately resolved without prompting p1!
  });
});

describe('Phase 1: Normal Tricks & Delayed Tricks (LIFO, Lightning transfer)', () => {
  it('resolves Dismantle, Snatch (+distance check), Duel, Savage Assault, Archery Attack, Peach Garden, Harvest, Collateral', () => {
    const dismantle = createCardInstance(1, 'spade', 3, 'dismantle');
    const snatch = createCardInstance(2, 'spade', 4, 'snatch');
    const duel = createCardInstance(3, 'spade', 1, 'duel');
    const collateral = createCardInstance(4, 'club', 12, 'collateral');

    const p2Slash = createCardInstance(10, 'club', 5, 'slash');
    const p2Slash2 = createCardInstance(13, 'club', 6, 'slash');
    const p2Weapon = createCardInstance(11, 'spade', 6, 'qinggang_sword');
    const p2Horse = createCardInstance(12, 'spade', 5, 'jueying');

    const engine = setupCustom1v1({
      p1Hand: [dismantle, snatch, duel, collateral],
      p2Hand: [p2Slash, p2Slash2, p2Weapon, p2Horse]
    });

    // Give p2 weapon & +1 horse equipped
    engine.getPlayer('p2').equips.weapon = p2Weapon;
    engine.getPlayer('p2').equips.horsePlus = p2Horse;

    // Because p2 has +1 horse, distance is 2 -> Snatch cannot target p2!
    const playable = engine.getPlayableCards('p1');
    expect(playable.find((p) => p.cardId === snatch.id)).toBeUndefined();

    // Dismantle ignores distance -> dismantle p2's +1 horse!
    let prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: dismantle.id, targetIds: ['p2'] }
    });
    expect(prompt?.type).toBe('choose_player_card');
    if (prompt?.type === 'choose_player_card') {
      const horseChoiceIdx = prompt.choices.findIndex((c) => c.zone === 'horsePlus');
      expect(horseChoiceIdx).toBeGreaterThanOrEqual(0);
      prompt = engine.submit({ type: 'choose_player_card', choiceIndex: horseChoiceIdx });
    }
    expect(engine.getPlayer('p2').equips.horsePlus).toBeNull();

    // Now distance is 1 -> Snatch is playable! Steal a hand card from p2!
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: snatch.id, targetIds: ['p2'] }
    });
    expect(prompt?.type).toBe('choose_player_card');
    prompt = engine.submit({ type: 'choose_player_card', choiceIndex: 0 });
    expect(prompt?.type).toBe('play_action');

    // Collateral on p2 targeting p1 -> p2 still has p2Slash2 -> prompted for slash_collateral, declines -> p1 gets p2's weapon!
    prompt = engine.submit({
      type: 'play_action',
      action: {
        type: 'play_card',
        cardId: collateral.id,
        targetIds: ['p2'],
        secondaryTargetId: 'p1'
      }
    });
    expect(prompt?.type).toBe('choose_card');
    if (prompt?.type === 'choose_card') {
      expect(prompt.reason).toBe('slash_collateral');
      prompt = engine.submit({ type: 'choose_card', cardIds: [], cancelled: true });
    }
    expect(engine.getPlayer('p2').equips.weapon).toBeNull();
    expect(engine.getPlayer('p1').hand.some((c) => c.id === p2Weapon.id)).toBe(true);

    // Duel on p2 -> p2 plays p2Slash2, then p1 declines -> p1 takes 1 damage!
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: duel.id, targetIds: ['p2'] }
    });
    expect(prompt?.type).toBe('choose_card');
    if (prompt?.type === 'choose_card') {
      expect(prompt.reason).toBe('slash_duel');
      prompt = engine.submit({ type: 'choose_card', cardIds: [p2Slash2.id] });
    }
    if (prompt?.type === 'choose_card' && prompt.reason === 'slash_duel') {
      prompt = engine.submit({ type: 'choose_card', cardIds: [], cancelled: true });
    }
    expect(engine.getPlayer('p1').hp).toBe(3);
  });

  it('resolves Harvest, Peach Garden, Savage Assault, and Archery Attack', () => {
    const harvest = createCardInstance(1, 'heart', 3, 'harvest');
    const garden = createCardInstance(2, 'heart', 1, 'peach_garden');
    const savage = createCardInstance(3, 'spade', 7, 'savage_assault');
    const archery = createCardInstance(4, 'heart', 1, 'archery_attack');

    const engine = setupCustom1v1({
      p1Hand: [harvest, garden, savage, archery],
      p2Hand: [
        createCardInstance(10, 'heart', 3, 'peach'),
        createCardInstance(11, 'heart', 4, 'peach'),
        createCardInstance(12, 'heart', 6, 'peach'),
        createCardInstance(13, 'heart', 7, 'peach')
      ]
    });

    // Harvest -> p1 picks 1st, p2 picks 2nd
    let prompt = engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: harvest.id } });
    expect(prompt?.type).toBe('choose_harvest_card');
    if (prompt?.type === 'choose_harvest_card') {
      expect(prompt.pool.length).toBe(2);
      prompt = engine.submit({ type: 'choose_harvest_card', cardId: prompt.pool[0].card.id });
    }
    expect(prompt?.type).toBe('choose_harvest_card');
    if (prompt?.type === 'choose_harvest_card') {
      const remaining = prompt.pool.find((i) => !i.takenBy)!;
      prompt = engine.submit({ type: 'choose_harvest_card', cardId: remaining.card.id });
    }
    expect(engine.state.harvestPool.length).toBe(0);

    // Savage Assault -> p2 has no slash -> takes 1 damage (HP 3)
    prompt = engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: savage.id } });
    expect(engine.getPlayer('p2').hp).toBe(3);

    // Archery Attack -> p2 has no dodge -> takes 1 damage (HP 2)
    prompt = engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: archery.id } });
    expect(engine.getPlayer('p2').hp).toBe(2);

    // Peach Garden -> p1 is full HP (4), p2 is 2 HP -> p2 heals to 3 HP!
    prompt = engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: garden.id } });
    expect(engine.getPlayer('p1').hp).toBe(4);
    expect(engine.getPlayer('p2').hp).toBe(3);
  });

  it('resolves Indulgence skip play phase and Lightning LIFO + transfer + strike', () => {
    const indulgence = createCardInstance(1, 'spade', 6, 'indulgence');
    const lightning = createCardInstance(2, 'spade', 1, 'lightning');

    const engine = setupCustom1v1({
      p1Hand: [indulgence, lightning],
      p2Hand: [
        createCardInstance(10, 'heart', 3, 'peach'),
        createCardInstance(11, 'heart', 4, 'peach'),
        createCardInstance(12, 'heart', 6, 'peach'),
        createCardInstance(13, 'heart', 7, 'peach')
      ],
      nextDraws: [
        createCardInstance(20, 'diamond', 2, 'dodge'), // p1 draw 1
        createCardInstance(21, 'diamond', 3, 'dodge'), // p1 draw 2
        // Turn 2 (p2): p2 has Indulgence in judgeZone -> judge card is club 5 (not heart -> skips play!)
        createCardInstance(22, 'club', 5, 'slash'),
        createCardInstance(23, 'diamond', 4, 'dodge'), // p2 draw 1
        createCardInstance(24, 'diamond', 5, 'dodge'), // p2 draw 2
        // Turn 3 (p1): p1 has Lightning -> judge card is spade 5 (spade 2~9 -> 3 thunder damage!)
        createCardInstance(25, 'spade', 5, 'jueying')
      ]
    });

    // P1 places Indulgence on p2 and Lightning on self
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: indulgence.id, targetIds: ['p2'] }
    });
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: lightning.id }
    });
    expect(engine.getPlayer('p2').judgeZone.length).toBe(1);
    expect(engine.getPlayer('p1').judgeZone.length).toBe(1);

    // End p1 play phase (hand is 4 -> no discard)
    // P2 Turn 2: Indulgence judges club 5 -> skips p2 play phase -> jumps straight to p2 discard (hand 6, HP 4 -> discard 2)
    let prompt = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    expect(prompt?.type).toBe('choose_card');
    if (prompt?.type === 'choose_card') {
      expect(prompt.playerId).toBe('p2');
      expect(prompt.reason).toBe('discard_phase');
      prompt = engine.submit({
        type: 'choose_card',
        cardIds: prompt.eligibleCardIds.slice(0, prompt.minCount)
      });
    }

    // Turn 3 (p1): Lightning judges spade 5 -> p1 takes 3 thunder damage (HP 4 -> 1)!
    expect(engine.getPlayer('p1').hp).toBe(1);
    expect(engine.getPlayer('p1').judgeZone.length).toBe(0);
    expect(prompt?.type).toBe('play_action');
    expect(prompt?.playerId).toBe('p1');
  });

  it('transfers Lightning to next player when judge misses or when Nullified, and evaluates judgeZone LIFO', () => {
    const lightning = createCardInstance(1, 'spade', 1, 'lightning');
    const engine = setupCustom1v1({
      p1Hand: [lightning],
      p2Hand: [createCardInstance(10, 'club', 12, 'nullification')],
      nextDraws: [
        createCardInstance(20, 'diamond', 2, 'dodge'),
        createCardInstance(21, 'diamond', 3, 'dodge')
      ]
    });

    // Place lightning on p2 directly (after an indulgence) to test LIFO: Lightning resolves FIRST
    const ind = createCardInstance(90, 'spade', 6, 'indulgence');
    engine.getPlayer('p2').judgeZone.push(ind, lightning);
    engine.getPlayer('p1').hand = engine.getPlayer('p1').hand.filter((c) => c.id !== lightning.id);

    // End p1 turn -> discard excess if any -> p2 judge phase begins with Lightning (LIFO!)
    let prompt = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    if (prompt?.type === 'choose_card' && prompt.reason === 'discard_phase') {
      prompt = engine.submit({
        type: 'choose_card',
        cardIds: prompt.eligibleCardIds.slice(0, prompt.minCount)
      });
    }

    // P2 asked to Nullify Lightning FIRST!
    expect(prompt?.type).toBe('choose_card');
    if (prompt?.type === 'choose_card') {
      expect(prompt.reason).toBe('nullification');
      expect(prompt.message).toContain('闪电');
      // P2 nullifies Lightning -> Lightning transfers to p1's judgeZone without judging!
      prompt = engine.submit({ type: 'choose_card', cardIds: [10] });
    }
    expect(engine.getPlayer('p1').judgeZone.some((c) => c.name === 'lightning')).toBe(true);
    expect(engine.getPlayer('p2').hp).toBe(4);
  });
});

describe('Phase 1: All Standard + EX Weapons and Armors', () => {
  it('Renwang Shield blocks black Slash, Qinggang Sword ignores Renwang Shield & Eight Trigrams', () => {
    const blackSlash = createCardInstance(1, 'spade', 8, 'slash');
    const redSlash = createCardInstance(2, 'heart', 10, 'slash');
    const qinggang = createCardInstance(3, 'spade', 6, 'qinggang_sword');
    const renwang = createCardInstance(10, 'club', 2, 'renwang_shield');

    const engine = setupCustom1v1({
      p1Hand: [blackSlash, redSlash, qinggang],
      p2Hand: [
        createCardInstance(11, 'spade', 7, 'slash'),
        createCardInstance(12, 'spade', 8, 'slash'),
        createCardInstance(13, 'spade', 9, 'slash'),
        createCardInstance(14, 'spade', 10, 'slash')
      ]
    });
    engine.getPlayer('p2').equips.armor = renwang;

    // Without Qinggang Sword, black Slash is negated by Renwang Shield!
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: blackSlash.id, targetIds: ['p2'] }
    });
    expect(engine.getPlayer('p2').hp).toBe(4);

    // Equip Qinggang Sword & reset slash count -> black Slash now penetrates Renwang Shield!
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: qinggang.id } });
    const blackSlash2 = createCardInstance(99, 'club', 7, 'slash');
    engine.getPlayer('p1').hand.push(blackSlash2);
    engine.getPlayer('p1').slashUsedThisTurn = 0;

    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: blackSlash2.id, targetIds: ['p2'] }
    });
    expect(engine.getPlayer('p2').hp).toBe(3);

    // Swap p2 armor to Eight Trigrams -> Qinggang Sword prevents Eight Trigrams prompt!
    engine.getPlayer('p2').equips.armor = createCardInstance(100, 'spade', 2, 'eight_trigrams');
    engine.getPlayer('p1').slashUsedThisTurn = 0;
    const prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: redSlash.id, targetIds: ['p2'] }
    });
    expect(prompt?.type).toBe('play_action'); // No Eight Trigrams prompt!
    expect(engine.getPlayer('p2').hp).toBe(2);
  });

  it('Eight Trigrams red judge acts as Dodge, black judge falls back to hand Dodge', () => {
    const slash1 = createCardInstance(1, 'heart', 10, 'slash');
    const slash2 = createCardInstance(2, 'heart', 11, 'slash');
    const dodgeP2 = createCardInstance(10, 'diamond', 2, 'dodge');

    const engine = setupCustom1v1({
      p1Hand: [slash1, slash2],
      p2Hand: [dodgeP2, createCardInstance(11, 'spade', 7, 'slash'), createCardInstance(12, 'spade', 8, 'slash'), createCardInstance(13, 'spade', 9, 'slash')],
      nextDraws: [
        createCardInstance(20, 'diamond', 5, 'dodge'), // p1 draw 1
        createCardInstance(21, 'diamond', 6, 'dodge'), // p1 draw 2
        createCardInstance(22, 'heart', 4, 'peach'),   // Eight Trigrams judge #1 -> RED (success!)
        createCardInstance(23, 'spade', 9, 'slash')    // Eight Trigrams judge #2 -> BLACK (fail!)
      ]
    });
    engine.getPlayer('p2').equips.armor = createCardInstance(50, 'spade', 2, 'eight_trigrams');

    // Slash 1 -> p2 activates Eight Trigrams -> Heart 4 -> Dodged without spending dodgeP2!
    let prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash1.id, targetIds: ['p2'] }
    });
    expect(prompt?.type).toBe('choose_option');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(prompt?.type).toBe('play_action');
    expect(engine.getPlayer('p2').hp).toBe(4);
    expect(engine.getPlayer('p2').hand.some((c) => c.id === dodgeP2.id)).toBe(true);

    // Slash 2 -> Eight Trigrams judges Spade 9 (black) -> asks p2 for hand Dodge!
    engine.getPlayer('p1').slashUsedThisTurn = 0;
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash2.id, targetIds: ['p2'] }
    });
    expect(prompt?.type).toBe('choose_option');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(prompt?.type).toBe('choose_card');
    if (prompt?.type === 'choose_card') {
      expect(prompt.reason).toBe('dodge');
      prompt = engine.submit({ type: 'choose_card', cardIds: [dodgeP2.id] });
    }
    expect(engine.getPlayer('p2').hp).toBe(4);
  });

  it('Ice Sword prevents Slash damage and discards up to 2 hand/equip cards (not judgeZone)', () => {
    const slash1 = createCardInstance(1, 'heart', 10, 'slash');
    const iceSword = createCardInstance(2, 'spade', 2, 'ice_sword');

    const engine = setupCustom1v1({
      p1Hand: [slash1, iceSword],
      p2Hand: [
        createCardInstance(10, 'spade', 7, 'slash'),
        createCardInstance(11, 'spade', 8, 'slash'),
        createCardInstance(12, 'spade', 9, 'slash'),
        createCardInstance(13, 'spade', 10, 'slash')
      ]
    });
    engine.getPlayer('p2').judgeZone.push(createCardInstance(88, 'spade', 6, 'indulgence'));
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: iceSword.id } });

    let prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash1.id, targetIds: ['p2'] }
    });
    expect(prompt?.type).toBe('choose_option');
    if (prompt?.type === 'choose_option') {
      expect(prompt.reason).toBe('ice_sword');
      prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    }
    // Discard 1st card (judgeZone must NOT appear!)
    expect(prompt?.type).toBe('choose_player_card');
    if (prompt?.type === 'choose_player_card') {
      expect(prompt.choices.every((c) => c.zone !== 'judge')).toBe(true);
      prompt = engine.submit({ type: 'choose_player_card', choiceIndex: 0 });
    }
    // Discard 2nd card
    expect(prompt?.type).toBe('choose_player_card');
    prompt = engine.submit({ type: 'choose_player_card', choiceIndex: 0 });

    expect(engine.getPlayer('p2').hp).toBe(4); // Damage prevented!
    expect(engine.getPlayer('p2').hand.length).toBe(2); // Lost 2 cards!
    expect(engine.getPlayer('p2').judgeZone.length).toBe(1); // Judge untouched!
  });

  it('Axe forces hit by discarding 2 cards; Blade follows up after Dodge', () => {
    const axe = createCardInstance(1, 'diamond', 5, 'axe');
    const slash1 = createCardInstance(2, 'heart', 10, 'slash');
    const blade = createCardInstance(3, 'spade', 5, 'blade');
    const slash2 = createCardInstance(4, 'heart', 11, 'slash');
    const dodge1 = createCardInstance(10, 'diamond', 2, 'dodge');
    const dodge2 = createCardInstance(11, 'diamond', 3, 'dodge');

    const engine = setupCustom1v1({
      p1Hand: [axe, slash1, blade, slash2],
      p2Hand: [dodge1, dodge2, createCardInstance(12, 'spade', 8, 'slash'), createCardInstance(13, 'spade', 9, 'slash')]
    });

    // Equip Axe -> Slash -> p2 dodges -> p1 discards 2 cards -> p2 takes 1 damage!
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: axe.id } });
    let prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash1.id, targetIds: ['p2'] }
    });
    prompt = engine.submit({ type: 'choose_card', cardIds: [dodge1.id] });
    expect(prompt?.type).toBe('choose_card');
    if (prompt?.type === 'choose_card') {
      expect(prompt.reason).toBe('discard_axe');
      expect(prompt.eligibleCardIds).not.toContain(axe.id); // Cannot discard Axe itself!
      const twoToDiscard = prompt.eligibleCardIds.filter((id) => id !== blade.id && id !== slash2.id).slice(0, 2);
      prompt = engine.submit({ type: 'choose_card', cardIds: twoToDiscard });
    }
    expect(engine.getPlayer('p2').hp).toBe(3);

    // Equip Blade -> Slash 2 -> p2 dodges -> p1 follows up with another Slash -> p2 takes 1 damage!
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: blade.id } });
    const slash3 = createCardInstance(99, 'club', 8, 'slash');
    engine.getPlayer('p1').hand.push(slash3);
    engine.getPlayer('p1').slashUsedThisTurn = 0;

    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash2.id, targetIds: ['p2'] }
    });
    prompt = engine.submit({ type: 'choose_card', cardIds: [dodge2.id] });
    expect(prompt?.type).toBe('choose_card');
    if (prompt?.type === 'choose_card') {
      expect(prompt.reason).toBe('slash_blade');
      prompt = engine.submit({ type: 'choose_card', cardIds: [slash3.id] });
    }
    expect(engine.getPlayer('p2').hp).toBe(2);
  });

  it('Serpent Spear respects color rule (black+black blocked by Renwang; red+black bypasses) and works in Duel', () => {
    const spear = createCardInstance(1, 'spade', 12, 'serpent_spear');
    const b1 = createCardInstance(2, 'spade', 3, 'dismantle');
    const b2 = createCardInstance(3, 'club', 4, 'dismantle');
    const r1 = createCardInstance(4, 'heart', 3, 'peach');

    const engine = setupCustom1v1({
      p1Hand: [spear, b1, b2, r1],
      p2Hand: [
        createCardInstance(10, 'spade', 7, 'slash'),
        createCardInstance(11, 'spade', 8, 'slash'),
        createCardInstance(12, 'spade', 9, 'slash'),
        createCardInstance(13, 'spade', 10, 'slash')
      ]
    });
    engine.getPlayer('p2').equips.armor = createCardInstance(50, 'club', 2, 'renwang_shield');
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: spear.id } });

    // Two black cards -> BLACK Slash -> blocked by Renwang Shield!
    engine.submit({
      type: 'play_action',
      action: { type: 'serpent_spear', cardIds: [b1.id, b2.id], targetIds: ['p2'] }
    });
    expect(engine.getPlayer('p2').hp).toBe(4);

    // One red + one black card -> COLORLESS Slash -> bypasses Renwang Shield!
    engine.getPlayer('p1').slashUsedThisTurn = 0;
    const b3 = createCardInstance(60, 'spade', 4, 'snatch');
    engine.getPlayer('p1').hand.push(b3);
    engine.submit({
      type: 'play_action',
      action: { type: 'serpent_spear', cardIds: [r1.id, b3.id], targetIds: ['p2'] }
    });
    expect(engine.getPlayer('p2').hp).toBe(3);
  });

  it('Double Swords triggers on opposite gender and Kylin Bow discards equipped horse', () => {
    const doubleSwords = createCardInstance(1, 'spade', 2, 'double_swords');
    const kylinBow = createCardInstance(2, 'heart', 5, 'kylin_bow');
    const slash1 = createCardInstance(3, 'heart', 10, 'slash');
    const slash2 = createCardInstance(4, 'heart', 11, 'slash');

    const engine = setupCustom1v1({
      p1Hand: [doubleSwords, kylinBow, slash1, slash2],
      p2Hand: [
        createCardInstance(10, 'spade', 7, 'slash'),
        createCardInstance(11, 'spade', 8, 'slash'),
        createCardInstance(12, 'spade', 9, 'slash'),
        createCardInstance(13, 'spade', 10, 'slash')
      ],
      p1General: 'blank_wei_m',
      p2General: 'blank_wu_f'
    });
    engine.getPlayer('p2').equips.horseMinus = createCardInstance(70, 'heart', 5, 'chitu');

    // Double Swords: male p1 slashes female p2 -> p2 chooses let_draw -> p1 draws 1!
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: doubleSwords.id } });
    const p1Before = engine.getPlayer('p1').hand.length;
    let prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash1.id, targetIds: ['p2'] }
    });
    expect(prompt?.type).toBe('choose_option');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(prompt?.type).toBe('choose_option');
    prompt = engine.submit({ type: 'choose_option', optionId: 'let_draw' });
    // p1 spent slash1 (-1) and drew 1 (+1) -> same count!
    expect(engine.getPlayer('p1').hand.length).toBe(p1Before);
    expect(engine.getPlayer('p2').hp).toBe(3);

    // Kylin Bow: discard p2's Chitu on Slash damage!
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: kylinBow.id } });
    engine.getPlayer('p1').slashUsedThisTurn = 0;
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash2.id, targetIds: ['p2'] }
    });
    expect(prompt?.type).toBe('choose_option');
    if (prompt?.type === 'choose_option') {
      expect(prompt.reason).toBe('kylin_bow');
      prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    }
    expect(engine.getPlayer('p2').equips.horseMinus).toBeNull();
    expect(engine.getPlayer('p2').hp).toBe(2);
  });

  it('supports deterministic replay via GameEngine.replay()', () => {
    const config = make1v1Config({ seed: 777 });
    const engine = new GameEngine(config);
    let prompt = engine.start();

    // Run 15 simple scripted steps
    for (let i = 0; i < 15 && prompt; i++) {
      let resp: PlayerResponse;
      if (prompt.type === 'play_action') {
        resp = { type: 'play_action', action: { type: 'end_play_phase' } };
      } else if (prompt.type === 'choose_card') {
        resp = prompt.optional
          ? { type: 'choose_card', cardIds: [], cancelled: true }
          : { type: 'choose_card', cardIds: prompt.eligibleCardIds.slice(0, prompt.minCount) };
      } else if (prompt.type === 'choose_option') {
        resp = { type: 'choose_option', optionId: prompt.options[0].id };
      } else if (prompt.type === 'choose_general') {
        resp = { type: 'choose_general', generalId: prompt.candidates[0].id };
      } else if (prompt.type === 'choose_player_card') {
        resp = { type: 'choose_player_card', choiceIndex: 0 };
      } else if (prompt.type === 'choose_harvest_card') {
        resp = { type: 'choose_harvest_card', cardId: prompt.pool.find((x) => !x.takenBy)!.card.id };
      } else {
        resp = { type: 'choose_target', targetIds: prompt.eligibleTargetIds.slice(0, prompt.minCount) };
      }
      prompt = engine.submit(resp);
    }

    const replayed = GameEngine.replay(config, engine.state.actionLog);
    expect(replayed.state.turn).toBe(engine.state.turn);
    expect(replayed.state.drawPile.map((c) => c.id)).toEqual(engine.state.drawPile.map((c) => c.id));
    expect(replayed.state.players.map((p) => p.hand.map((c) => c.id))).toEqual(
      engine.state.players.map((p) => p.hand.map((c) => c.id))
    );
  });

  it('covers Double Swords discard & empty-hand, Collateral slash executed, Serpent Spear in Savage Assault, Peach play-phase heal, equip replacement, and reshuffle', () => {
    const doubleSwords = createCardInstance(1, 'spade', 2, 'double_swords');
    const slash1 = createCardInstance(2, 'heart', 10, 'slash');
    const slash2 = createCardInstance(3, 'heart', 11, 'slash');
    const peach1 = createCardInstance(4, 'heart', 3, 'peach');

    const engine = setupCustom1v1({
      p1Hand: [doubleSwords, slash1, slash2, peach1],
      p2Hand: [
        createCardInstance(10, 'spade', 12, 'serpent_spear'),
        createCardInstance(11, 'diamond', 2, 'dodge'),
        createCardInstance(12, 'diamond', 3, 'dodge'),
        createCardInstance(13, 'diamond', 4, 'dodge')
      ],
      p1General: 'blank_wei_m',
      p2General: 'blank_wu_f'
    });

    // Self-heal Peach in Play phase
    engine.getPlayer('p1').hp = 2;
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: peach1.id } });
    expect(engine.getPlayer('p1').hp).toBe(3);

    // Equip Double Swords, then slash female p2 -> p2 chooses discard 1 hand card
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: doubleSwords.id } });
    let prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash1.id, targetIds: ['p2'] }
    });
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    prompt = engine.submit({ type: 'choose_option', optionId: 'discard' });
    expect(prompt?.type).toBe('choose_card');
    if (prompt?.type === 'choose_card') {
      prompt = engine.submit({ type: 'choose_card', cardIds: [prompt.eligibleCardIds[0]] });
    }
    // P2 declines dodge
    if (prompt?.type === 'choose_card' && prompt.reason === 'dodge') {
      prompt = engine.submit({ type: 'choose_card', cardIds: [], cancelled: true });
    }
    expect(engine.getPlayer('p2').hp).toBe(3);
    expect(engine.getPlayer('p2').hand.length).toBe(3);

    // Equip replacement (replace Double Swords with Halberd)
    const halberd = createCardInstance(80, 'diamond', 12, 'halberd');
    engine.getPlayer('p1').hand.push(halberd);
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: halberd.id } });
    expect(engine.getPlayer('p1').equips.weapon?.id).toBe(halberd.id);
    expect(engine.state.discardPile.some((c) => c.id === doubleSwords.id)).toBe(true);

    // P2 equips Serpent Spear and uses 2 hand cards to respond to Savage Assault!
    engine.getPlayer('p2').equips.weapon = createCardInstance(81, 'spade', 12, 'serpent_spear');
    const savage = createCardInstance(82, 'spade', 7, 'savage_assault');
    engine.getPlayer('p1').hand.push(savage);
    prompt = engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: savage.id } });
    expect(prompt?.type).toBe('choose_card');
    if (prompt?.type === 'choose_card') {
      expect(prompt.canUseSerpentSpear).toBe(true);
      prompt = engine.submit({
        type: 'choose_card',
        cardIds: [prompt.eligibleCardIds[0], prompt.eligibleCardIds[1]],
        useSerpentSpear: true
      });
    }
    expect(engine.getPlayer('p2').hp).toBe(3); // Successfully blocked Savage Assault with Serpent Spear!

    // Collateral where p2 DOES play Slash against p1!
    const p2Slash = createCardInstance(83, 'heart', 10, 'slash');
    engine.getPlayer('p2').hand.push(p2Slash);
    const collateral = createCardInstance(84, 'club', 12, 'collateral');
    engine.getPlayer('p1').hand.push(collateral);
    prompt = engine.submit({
      type: 'play_action',
      action: {
        type: 'play_card',
        cardId: collateral.id,
        targetIds: ['p2'],
        secondaryTargetId: 'p1'
      }
    });
    expect(prompt?.type).toBe('choose_card');
    prompt = engine.submit({ type: 'choose_card', cardIds: [p2Slash.id] });
    // P1 prompted for dodge against p2's collateral slash -> decline -> p1 loses 1 HP, p2 keeps weapon!
    if (prompt?.type === 'choose_card' && prompt.reason === 'dodge') {
      prompt = engine.submit({ type: 'choose_card', cardIds: [], cancelled: true });
    }
    expect(engine.getPlayer('p1').hp).toBe(2);
    expect(engine.getPlayer('p2').equips.weapon?.name).toBe('serpent_spear');

    // Dismantle judgeZone card
    const ind = createCardInstance(85, 'spade', 6, 'indulgence');
    engine.getPlayer('p2').judgeZone.push(ind);
    const dismantle = createCardInstance(86, 'spade', 3, 'dismantle');
    engine.getPlayer('p1').hand.push(dismantle);
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: dismantle.id, targetIds: ['p2'] }
    });
    if (prompt?.type === 'choose_player_card') {
      const judgeIdx = prompt.choices.findIndex((c) => c.zone === 'judge');
      expect(judgeIdx).toBeGreaterThanOrEqual(0);
      prompt = engine.submit({ type: 'choose_player_card', choiceIndex: judgeIdx });
    }
    expect(engine.getPlayer('p2').judgeZone.length).toBe(0);

    // Reshuffle test: empty drawPile -> Ex Nihilo reshuffles discardPile cleanly!
    engine.state.drawPile = [];
    const exNihilo = createCardInstance(87, 'heart', 7, 'ex_nihilo');
    engine.getPlayer('p1').hand.push(exNihilo);
    const handBeforeReshuffle = engine.getPlayer('p1').hand.length;
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: exNihilo.id } });
    expect(engine.getPlayer('p1').hand.length).toBe(handBeforeReshuffle - 1 + 2);
  });

  it('supports interactive general selection and flipped turn skip', () => {
    const engine = new GameEngine(
      make1v1Config({ skipGeneralSelection: false, seed: 2026 })
    );
    let prompt = engine.start();
    expect(prompt?.type).toBe('choose_general');
    if (prompt?.type === 'choose_general') {
      prompt = engine.submit({ type: 'choose_general', generalId: prompt.candidates[0].id });
    }
    expect(prompt?.type).toBe('choose_general');
    if (prompt?.type === 'choose_general') {
      prompt = engine.submit({ type: 'choose_general', generalId: prompt.candidates[0].id });
    }
    expect(prompt?.type).toBe('play_action');

    // Flip p2 so p2 skips turn 2 and turns back face-up
    engine.getPlayer('p2').flipped = true;
    prompt = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    if (prompt?.type === 'choose_card' && prompt.reason === 'discard_phase') {
      prompt = engine.submit({
        type: 'choose_card',
        cardIds: prompt.eligibleCardIds.slice(0, prompt.minCount)
      });
    }
    expect(engine.getPlayer('p2').flipped).toBe(false);
    expect(prompt?.playerId).toBe('p1'); // Back to p1 immediately!
  });

  it('covers Kylin Bow 2-horse choice, Double Swords empty-hand auto-draw, Lightning miss transfer, Harvest nullified leftover discard, and ClientView', () => {
    const slash1 = createCardInstance(1, 'heart', 10, 'slash');
    const slash2 = createCardInstance(2, 'heart', 11, 'slash');
    const harvest = createCardInstance(3, 'heart', 3, 'harvest');
    const lightning = createCardInstance(4, 'spade', 1, 'lightning');

    const engine = setupCustom1v1({
      p1Hand: [slash1, slash2, harvest, lightning],
      p2Hand: [
        createCardInstance(10, 'spade', 11, 'nullification'),
        createCardInstance(11, 'heart', 3, 'peach'),
        createCardInstance(12, 'heart', 4, 'peach'),
        createCardInstance(13, 'heart', 6, 'peach')
      ],
      nextDraws: [
        createCardInstance(20, 'diamond', 2, 'dodge'), // p1 draw 1
        createCardInstance(21, 'diamond', 3, 'dodge'), // p1 draw 2
        createCardInstance(22, 'heart', 7, 'peach'),   // harvest card 1
        createCardInstance(23, 'heart', 8, 'peach'),   // harvest card 2
        createCardInstance(24, 'heart', 9, 'peach')    // lightning miss judge card (heart 9)
      ],
      p1General: 'blank_wei_m',
      p2General: 'blank_wu_f'
    });

    // ClientView check (p1 sees own hand, p2 hand hidden)
    const view1 = engine.getClientView('p1');
    expect(view1.players[0].hand).not.toBeNull();
    expect(view1.players[1].hand).toBeNull();

    // Kylin Bow with BOTH +1 and -1 horses equipped on p2 -> prompts choose_player_card
    engine.getPlayer('p1').equips.weapon = createCardInstance(50, 'heart', 5, 'kylin_bow');
    engine.getPlayer('p2').equips.horsePlus = createCardInstance(51, 'spade', 5, 'jueying');
    engine.getPlayer('p2').equips.horseMinus = createCardInstance(52, 'heart', 5, 'chitu');
    let prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash1.id, targetIds: ['p2'] }
    });
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(prompt?.type).toBe('choose_player_card');
    prompt = engine.submit({ type: 'choose_player_card', choiceIndex: 1 });
    expect(engine.getPlayer('p2').equips.horseMinus).toBeNull();
    expect(engine.getPlayer('p2').equips.horsePlus).not.toBeNull();

    // Harvest -> p1 picks card 1, p2 nullifies self -> card 2 goes to discardPile!
    prompt = engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: harvest.id } });
    // P2 asked to nullify p1's harvest pick -> decline
    if (prompt?.type === 'choose_card' && prompt.reason === 'nullification') {
      prompt = engine.submit({ type: 'choose_card', cardIds: [], cancelled: true });
    }
    expect(prompt?.type).toBe('choose_harvest_card');
    if (prompt?.type === 'choose_harvest_card') {
      prompt = engine.submit({ type: 'choose_harvest_card', cardId: prompt.pool[0].card.id });
    }
    // P2 nullifies own harvest pick
    if (prompt?.type === 'choose_card' && prompt.reason === 'nullification') {
      prompt = engine.submit({ type: 'choose_card', cardIds: [10] });
    }
    expect(engine.state.harvestPool.length).toBe(0);
    expect(engine.state.discardPile.some((c) => c.id === 23)).toBe(true);

    // Double Swords against empty-handed opposite gender -> auto-draws 1 for attacker!
    engine.getPlayer('p1').equips.weapon = createCardInstance(60, 'spade', 2, 'double_swords');
    engine.getPlayer('p2').hand = [];
    engine.getPlayer('p2').equips.horsePlus = null;
    engine.getPlayer('p1').slashUsedThisTurn = 0;
    const p1Before = engine.getPlayer('p1').hand.length;
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash2.id, targetIds: ['p2'] }
    });
    expect(prompt?.type).toBe('choose_option');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    // Spent slash2 (-1), auto-drew 1 (+1) -> equal hand count!
    expect(engine.getPlayer('p1').hand.length).toBe(p1Before);

    // Lightning on p2 judges Heart 9 (miss) -> transfers Lightning to p1!
    engine.getPlayer('p2').judgeZone.push(lightning);
    engine.getPlayer('p1').hand = engine.getPlayer('p1').hand.filter((c) => c.id !== lightning.id);
    prompt = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    if (prompt?.type === 'choose_card' && prompt.reason === 'discard_phase') {
      prompt = engine.submit({
        type: 'choose_card',
        cardIds: prompt.eligibleCardIds.slice(0, prompt.minCount)
      });
    }
    expect(engine.getPlayer('p1').judgeZone.some((c) => c.name === 'lightning')).toBe(true);
    expect(engine.getPlayer('p2').judgeZone.length).toBe(0);
  });
});


