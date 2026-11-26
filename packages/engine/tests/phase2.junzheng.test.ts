import { describe, expect, it } from 'vitest';
import {
  buildDeck,
  createCardInstance,
  GameEngine,
  registerModeRuleSet,
  type CardInstance,
  type GameConfig
} from '../src/index.js';

function make1v1Junzheng(params: {
  p1Hand: CardInstance[];
  p2Hand: CardInstance[];
  nextDraws?: CardInstance[];
}): GameEngine {
  const filler = buildDeck('junzheng_161')
    .slice(0, 40)
    .map((c, i) => ({ ...c, id: 9000 + i }));
  const pad = (cards: CardInstance[], baseId: number) => {
    const out = [...cards];
    while (out.length < 4) {
      out.push(createCardInstance(baseId + out.length, 'diamond', 2, 'dodge'));
    }
    return out.slice(0, 4);
  };
  const nextDraws = params.nextDraws ?? [
    createCardInstance(7001, 'diamond', 6, 'dodge'),
    createCardInstance(7002, 'diamond', 7, 'dodge')
  ];
  const deckOverride = [...pad(params.p1Hand, 5000), ...pad(params.p2Hand, 6000), ...nextDraws, ...filler];
  const engine = new GameEngine(
    {
      mode: '1v1',
      deckVariant: 'junzheng_161',
      seed: 202,
      skipGeneralSelection: true,
      seats: [
        { id: 'p1', name: '玩家一', isAI: false, generalId: 'blank_wei_m' },
        { id: 'p2', name: '玩家二', isAI: false, generalId: 'blank_wu_f' }
      ]
    },
    { deckOverride }
  );
  engine.start();
  return engine;
}

describe('Phase 2: 161-card Junzheng + Limit Break Deck Integrity', () => {
  it('builds exact 161 cards with verified category, card-name, suit, and rank counts', () => {
    const deck = buildDeck('junzheng_161');
    expect(deck.length).toBe(161);

    expect(deck.filter((c) => c.category === 'basic').length).toBe(85);
    expect(deck.filter((c) => c.category === 'trick').length).toBe(50);
    expect(deck.filter((c) => c.category === 'equip').length).toBe(26);

    const count = (name: string) => deck.filter((c) => c.name === name).length;
    expect(count('slash')).toBe(30);
    expect(count('fire_slash')).toBe(5);
    expect(count('thunder_slash')).toBe(9);
    expect(count('dodge')).toBe(24);
    expect(count('peach')).toBe(12);
    expect(count('alcohol')).toBe(5);
    expect(count('nullification')).toBe(7);
    expect(count('iron_chain')).toBe(6);
    expect(count('fire_attack')).toBe(3);
    expect(count('supply_shortage')).toBe(2);
    expect(count('guding_blade')).toBe(1);
    expect(count('fan')).toBe(1);
    expect(count('vine_armor')).toBe(2);
    expect(count('silver_lion')).toBe(1);
    expect(count('hualiu')).toBe(1);
    expect(count('wooden_ox')).toBe(1);

    // Suits: 40 spade, 40 heart, 40 club, 41 diamond (+ Wooden Ox ♦5)
    expect(deck.filter((c) => c.suit === 'spade').length).toBe(40);
    expect(deck.filter((c) => c.suit === 'heart').length).toBe(40);
    expect(deck.filter((c) => c.suit === 'club').length).toBe(40);
    expect(deck.filter((c) => c.suit === 'diamond').length).toBe(41);

    // Ranks: A/3/4/6/7/8/9/10/J/K = 12 each; 2/Q = 14 each; 5 = 13
    for (const r of [1, 3, 4, 6, 7, 8, 9, 10, 11, 13] as const) {
      expect(deck.filter((c) => c.rank === r).length).toBe(12);
    }
    expect(deck.filter((c) => c.rank === 2).length).toBe(14);
    expect(deck.filter((c) => c.rank === 12).length).toBe(14);
    expect(deck.filter((c) => c.rank === 5).length).toBe(13);

    // Wooden Ox is specifically ♦5
    const ox = deck.find((c) => c.name === 'wooden_ox')!;
    expect(ox.suit).toBe('diamond');
    expect(ox.rank).toBe(5);
    expect(ox.pack).toBe('limit_break');
  });
});

describe('Phase 2: Alcohol, Fire Attack, Supply Shortage, and Junzheng Equips', () => {
  it('Alcohol boosts next Slash by +1 (once/turn), and saves dying self', () => {
    const alc1 = createCardInstance(1, 'spade', 3, 'alcohol', 'junzheng');
    const alc2 = createCardInstance(2, 'club', 3, 'alcohol', 'junzheng');
    const fireSlash = createCardInstance(3, 'heart', 4, 'fire_slash', 'junzheng');
    const p2Alc = createCardInstance(10, 'diamond', 9, 'alcohol', 'junzheng');

    const engine = make1v1Junzheng({
      p1Hand: [alc1, alc2, fireSlash],
      p2Hand: [
        p2Alc,
        createCardInstance(11, 'spade', 7, 'slash'),
        createCardInstance(12, 'spade', 8, 'slash'),
        createCardInstance(13, 'spade', 9, 'slash')
      ]
    });

    engine.getPlayer('p2').hp = 2;

    // Drink alc1 -> alc2 is NOT playable in same Play phase
    let prompt = engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: alc1.id } });
    expect(engine.getPlayer('p1').drunk).toBe(true);
    if (prompt?.type === 'play_action') {
      expect(prompt.playableCardIds).not.toContain(alc2.id);
    }

    // Fire Slash deals 2 damage -> p2 drops from 2 to 0 -> enters dying -> self-rescues with p2Alc!
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: fireSlash.id, targetIds: ['p2'] }
    });
    expect(engine.getPlayer('p1').drunk).toBe(false);
    expect(prompt?.type).toBe('choose_card');
    if (prompt?.type === 'choose_card') {
      expect(prompt.reason).toBe('peach_dying');
      expect(prompt.eligibleCardIds).toContain(p2Alc.id);
      prompt = engine.submit({ type: 'choose_card', cardIds: [p2Alc.id] });
    }
    expect(engine.getPlayer('p2').hp).toBe(1);
    expect(engine.getPlayer('p2').alive).toBe(true);
  });

  it('Fire Attack shows target hand card and deals 1 fire damage when matching suit discarded', () => {
    const fireAttack = createCardInstance(1, 'heart', 2, 'fire_attack', 'junzheng');
    const clubCard = createCardInstance(2, 'club', 7, 'slash');
    const p2Club = createCardInstance(10, 'club', 8, 'slash');

    const engine = make1v1Junzheng({
      p1Hand: [fireAttack, clubCard],
      p2Hand: [p2Club, createCardInstance(11, 'club', 9, 'slash'), createCardInstance(12, 'club', 10, 'slash'), createCardInstance(13, 'club', 11, 'slash')]
    });
    engine.getPlayer('p2').equips.armor = createCardInstance(50, 'spade', 2, 'vine_armor', 'junzheng');

    let prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: fireAttack.id, targetIds: ['p2'] }
    });
    // Target chooses hand card to reveal
    expect(prompt?.type).toBe('choose_card');
    if (prompt?.type === 'choose_card') {
      expect(prompt.reason).toBe('fire_attack_show');
      prompt = engine.submit({ type: 'choose_card', cardIds: [p2Club.id] });
    }
    // Actor chooses matching club hand card to discard
    expect(prompt?.type).toBe('choose_card');
    if (prompt?.type === 'choose_card') {
      expect(prompt.reason).toBe('fire_attack_discard');
      expect(prompt.eligibleCardIds).toContain(clubCard.id);
      prompt = engine.submit({ type: 'choose_card', cardIds: [clubCard.id] });
    }
    // 1 base fire + 1 Vine Armor = 2 damage!
    expect(engine.getPlayer('p2').hp).toBe(2);
  });

  it('Supply Shortage enforces distance 1 and skips draw phase on non-club judge', () => {
    const shortage = createCardInstance(1, 'spade', 10, 'supply_shortage', 'junzheng');
    const engine = make1v1Junzheng({
      p1Hand: [shortage],
      p2Hand: [
        createCardInstance(10, 'heart', 3, 'peach'),
        createCardInstance(11, 'heart', 4, 'peach'),
        createCardInstance(12, 'heart', 5, 'peach'),
        createCardInstance(13, 'heart', 6, 'peach')
      ],
      nextDraws: [
        createCardInstance(20, 'diamond', 2, 'dodge'), // p1 draw 1
        createCardInstance(21, 'diamond', 3, 'dodge'), // p1 draw 2
        createCardInstance(22, 'heart', 8, 'dodge')    // p2 Supply Shortage judge -> heart (not club -> skip draw!)
      ]
    });

    // If p2 has +1 horse (Hualiu), distance is 2 -> Supply Shortage not playable
    engine.getPlayer('p2').equips.horsePlus = createCardInstance(50, 'diamond', 13, 'hualiu', 'junzheng');
    expect(engine.getPlayableCards('p1').find((p) => p.cardId === shortage.id)).toBeUndefined();

    // Remove horse -> distance 1 -> playable!
    engine.getPlayer('p2').equips.horsePlus = null;
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: shortage.id, targetIds: ['p2'] }
    });
    expect(engine.getPlayer('p2').judgeZone.length).toBe(1);

    // End p1 turn (discard excess) -> p2 judges heart -> skips draw phase -> p2 enters play phase with STILL 4 cards!
    let prompt = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    if (prompt?.type === 'choose_card' && prompt.reason === 'discard_phase') {
      prompt = engine.submit({
        type: 'choose_card',
        cardIds: prompt.eligibleCardIds.slice(0, prompt.minCount)
      });
    }
    expect(prompt?.type).toBe('play_action');
    expect(prompt?.playerId).toBe('p2');
    expect(engine.getPlayer('p2').hand.length).toBe(4);
  });

  it('Vine Armor negates normal Slash / Savage / Archery; Fan converts normal Slash to Fire Slash (+1 on Vine Armor); Qinggang ignores Vine Armor fire +1', () => {
    const normalSlash = createCardInstance(1, 'heart', 10, 'slash');
    const savage = createCardInstance(2, 'spade', 7, 'savage_assault');
    const archery = createCardInstance(3, 'heart', 1, 'archery_attack');
    const fan = createCardInstance(4, 'diamond', 1, 'fan', 'junzheng');

    const engine = make1v1Junzheng({
      p1Hand: [normalSlash, savage, archery, fan],
      p2Hand: [
        createCardInstance(10, 'heart', 3, 'peach'),
        createCardInstance(11, 'heart', 4, 'peach'),
        createCardInstance(12, 'heart', 5, 'peach'),
        createCardInstance(13, 'heart', 6, 'peach')
      ]
    });
    engine.getPlayer('p2').equips.armor = createCardInstance(50, 'spade', 2, 'vine_armor', 'junzheng');

    // Savage Assault & Archery Attack are negated by Vine Armor!
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: savage.id } });
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: archery.id } });
    expect(engine.getPlayer('p2').hp).toBe(4);

    // Normal Slash without Fan is negated by Vine Armor!
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: normalSlash.id, targetIds: ['p2'] }
    });
    expect(engine.getPlayer('p2').hp).toBe(4);

    // Equip Fan + new normal Slash -> convert to Fire Slash -> bypasses Vine Armor & deals 1+1 = 2 damage!
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: fan.id } });
    const slash2 = createCardInstance(88, 'club', 8, 'slash');
    engine.getPlayer('p1').hand.push(slash2);
    engine.getPlayer('p1').slashUsedThisTurn = 0;

    let prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash2.id, targetIds: ['p2'] }
    });
    expect(prompt?.type).toBe('choose_option');
    if (prompt?.type === 'choose_option') {
      expect(prompt.reason).toBe('fan');
      prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    }
    expect(engine.getPlayer('p2').hp).toBe(2);

    // Swap to Qinggang Sword + Fire Slash -> Qinggang ignores Vine Armor, so Fire Slash deals ONLY 1 damage!
    engine.getPlayer('p1').equips.weapon = createCardInstance(89, 'spade', 6, 'qinggang_sword');
    const fireSlash = createCardInstance(90, 'heart', 7, 'fire_slash', 'junzheng');
    engine.getPlayer('p1').hand.push(fireSlash);
    engine.getPlayer('p1').slashUsedThisTurn = 0;
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: fireSlash.id, targetIds: ['p2'] }
    });
    expect(engine.getPlayer('p2').hp).toBe(1);
  });

  it('Guding Blade deals +1 to empty-handed target; Silver Lion caps damage to 1 and heals +1 when lost', () => {
    const guding = createCardInstance(1, 'spade', 1, 'guding_blade', 'junzheng');
    const alc = createCardInstance(2, 'spade', 3, 'alcohol', 'junzheng');
    const slash1 = createCardInstance(3, 'heart', 10, 'slash');
    const dismantle = createCardInstance(4, 'spade', 3, 'dismantle');

    const engine = make1v1Junzheng({
      p1Hand: [guding, alc, slash1, dismantle],
      p2Hand: []
    });

    // Empty p2 hand & equip Silver Lion on p2
    engine.getPlayer('p2').hand = [];
    engine.getPlayer('p2').equips.armor = createCardInstance(50, 'club', 1, 'silver_lion', 'junzheng');

    // Equip Guding Blade + Alcohol + Slash (would be 1 + 1 drunk + 1 guding = 3!) -> Silver Lion caps to 1!
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: guding.id } });
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: alc.id } });
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash1.id, targetIds: ['p2'] }
    });
    expect(engine.getPlayer('p2').hp).toBe(3); // Capped to 1 damage!

    // Dismantle p2's Silver Lion -> p2 heals back +1 HP (3 -> 4)!
    let prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: dismantle.id, targetIds: ['p2'] }
    });
    expect(prompt?.type).toBe('choose_player_card');
    prompt = engine.submit({ type: 'choose_player_card', choiceIndex: 0 });
    expect(engine.getPlayer('p2').equips.armor).toBeNull();
    expect(engine.getPlayer('p2').hp).toBe(4);

    // Without Silver Lion, Guding Blade against empty hand deals 2 damage!
    const slash2 = createCardInstance(88, 'heart', 11, 'slash');
    engine.getPlayer('p1').hand.push(slash2);
    engine.getPlayer('p1').slashUsedThisTurn = 0;
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash2.id, targetIds: ['p2'] }
    });
    expect(engine.getPlayer('p2').hp).toBe(2);
  });

  it('Wooden Ox stashes card, excludes stash from hand limit, transfers to target, allows using stashed card, and discards stash when lost', () => {
    const ox = createCardInstance(1, 'diamond', 5, 'wooden_ox', 'limit_break');
    const peach = createCardInstance(2, 'heart', 3, 'peach');
    const slash = createCardInstance(3, 'heart', 10, 'slash');
    const dismantle = createCardInstance(4, 'spade', 3, 'dismantle');

    const engine = make1v1Junzheng({
      p1Hand: [ox, peach, slash, dismantle],
      p2Hand: [
        createCardInstance(10, 'diamond', 2, 'dodge'),
        createCardInstance(11, 'diamond', 3, 'dodge'),
        createCardInstance(12, 'diamond', 4, 'dodge'),
        createCardInstance(13, 'diamond', 5, 'dodge')
      ]
    });

    // Equip Wooden Ox
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: ox.id } });
    expect(engine.getPlayer('p1').equips.treasure?.name).toBe('wooden_ox');

    // Stash Peach under Wooden Ox WITHOUT transferring
    engine.submit({
      type: 'play_action',
      action: { type: 'wooden_ox_stash', cardId: peach.id }
    });
    expect(engine.getPlayer('p1').woodenOxCards.map((c) => c.id)).toEqual([peach.id]);
    expect(engine.getPlayer('p1').woodenOxUsedThisTurn).toBe(true);

    // Wounded p1 can play Peach directly from Wooden Ox stash!
    engine.getPlayer('p1').hp = 2;
    expect(engine.getPlayableCards('p1').some((p) => p.cardId === peach.id)).toBe(true);
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: peach.id } });
    expect(engine.getPlayer('p1').hp).toBe(3);
    expect(engine.getPlayer('p1').woodenOxCards.length).toBe(0);

    // Next activation (reset once-per-turn flag for test): stash Slash AND transfer Wooden Ox to p2!
    engine.getPlayer('p1').woodenOxUsedThisTurn = false;
    engine.submit({
      type: 'play_action',
      action: { type: 'wooden_ox_stash', cardId: slash.id, transferTargetId: 'p2' }
    });
    expect(engine.getPlayer('p1').equips.treasure).toBeNull();
    expect(engine.getPlayer('p2').equips.treasure?.id).toBe(ox.id);
    expect(engine.getPlayer('p2').woodenOxCards.map((c) => c.id)).toEqual([slash.id]);

    // Dismantle Wooden Ox from p2 -> both Wooden Ox AND its stashed Slash go to discardPile!
    let prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: dismantle.id, targetIds: ['p2'] }
    });
    if (prompt?.type === 'choose_player_card') {
      const oxIdx = prompt.choices.findIndex((c) => c.zone === 'treasure');
      expect(oxIdx).toBeGreaterThanOrEqual(0);
      prompt = engine.submit({ type: 'choose_player_card', choiceIndex: oxIdx });
    }
    expect(engine.getPlayer('p2').equips.treasure).toBeNull();
    expect(engine.getPlayer('p2').woodenOxCards.length).toBe(0);
    expect(engine.state.discardPile.some((c) => c.id === ox.id)).toBe(true);
    expect(engine.state.discardPile.some((c) => c.id === slash.id)).toBe(true);
  });
});

describe('Phase 2: Iron Chain Recast & OL 3.0 Multi-Player Chain Propagation', () => {
  it('supports Iron Chain recast (draws 1 without nullification) and chaining 2 targets', () => {
    const ic1 = createCardInstance(1, 'spade', 11, 'iron_chain', 'junzheng');
    const ic2 = createCardInstance(2, 'club', 12, 'iron_chain', 'junzheng');
    const engine = make1v1Junzheng({
      p1Hand: [ic1, ic2],
      p2Hand: [createCardInstance(10, 'club', 13, 'nullification')]
    });

    // Recast ic1 -> draws 1 card immediately (does NOT prompt p2's Nullification!)
    const before = engine.getPlayer('p1').hand.length;
    const prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: ic1.id, recast: true }
    });
    expect(prompt?.type).toBe('play_action');
    expect(engine.getPlayer('p1').hand.length).toBe(before); // -1 + 1

    // Chain both p1 & p2 using ic2 (p2 declines nullification twice)
    let p = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: ic2.id, targetIds: ['p1', 'p2'] }
    });
    if (p?.type === 'choose_card') p = engine.submit({ type: 'choose_card', cardIds: [], cancelled: true });
    if (p?.type === 'choose_card') p = engine.submit({ type: 'choose_card', cardIds: [], cancelled: true });
    expect(engine.getPlayer('p1').chained).toBe(true);
    expect(engine.getPlayer('p2').chained).toBe(true);
  });

  it('executes OL 3.0 chain propagation: Vine Armor fire+1, Silver Lion cap, damage source, continues through death, and stops immediately on victory', () => {
    // Register a clean 4-seat team mode for testing full 4-player OL 3.0 chain propagation
    registerModeRuleSet({
      mode: '2v2',
      playerCount: 4,
      allowLordSkills: false,
      setupRoles: () => ({
        roles: ['team_a', 'team_b', 'team_b', 'team_a'],
        teams: ['A', 'B', 'B', 'A'],
        firstPlayerIndex: 0
      }),
      getInitialHandCount: () => 4,
      getDrawPhaseCount: (_s, p, first) => (p.seat === 0 && first ? 1 : 2),
      checkVictory: (state) => {
        const aAlive = state.players.some((p) => p.alive && p.team === 'A');
        const bAlive = state.players.some((p) => p.alive && p.team === 'B');
        if (!bAlive) {
          return {
            winnerTeam: '蓝队',
            winnerPlayerIds: state.players.filter((p) => p.team === 'A').map((p) => p.id),
            reason: '蓝队全灭红队获胜',
            totalTurns: state.turn
          };
        }
        if (!aAlive) {
          return {
            winnerTeam: '红队',
            winnerPlayerIds: state.players.filter((p) => p.team === 'B').map((p) => p.id),
            reason: '红队全灭蓝队获胜',
            totalTurns: state.turn
          };
        }
        return null;
      }
    });

    // Scenario A: p2 (Vine Armor), p3 (Vine Armor), p4 (Silver Lion) are ALL chained!
    // p1 hits p2 with Fire Slash -> p2 takes 2 (1+1), propagates 2 to p3 -> p3 takes 3 (2+1), propagates 2 to p4 -> p4 takes 1 (Silver Lion caps 2->1)!
    const fireSlash = createCardInstance(1, 'heart', 4, 'fire_slash', 'junzheng');
    const filler = Array.from({ length: 40 }, (_, i) =>
      createCardInstance(2000 + i, 'spade', 7, 'slash')
    );
    const deckA = [
      fireSlash,
      ...filler
    ];
    const cfg4: GameConfig = {
      mode: '2v2',
      deckVariant: 'junzheng_161',
      seed: 303,
      skipGeneralSelection: true,
      seats: [
        { id: 'p1', name: 'P1', isAI: false },
        { id: 'p2', name: 'P2', isAI: false },
        { id: 'p3', name: 'P3', isAI: false },
        { id: 'p4', name: 'P4', isAI: false }
      ]
    };

    const engA = new GameEngine(cfg4, { deckOverride: deckA });
    engA.start();

    const p2 = engA.getPlayer('p2');
    const p3 = engA.getPlayer('p3');
    const p4 = engA.getPlayer('p4');
    p2.chained = true;
    p3.chained = true;
    p4.chained = true;
    p2.equips.armor = createCardInstance(901, 'spade', 2, 'vine_armor', 'junzheng');
    p3.equips.armor = createCardInstance(902, 'club', 2, 'vine_armor', 'junzheng');
    p4.equips.armor = createCardInstance(903, 'club', 1, 'silver_lion', 'junzheng');

    engA.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: fireSlash.id, targetIds: ['p2'] }
    });

    expect(p2.hp).toBe(2); // 4 - 2 (Vine Armor fire +1)
    expect(p3.hp).toBe(1); // 4 - 3 (propagated 2 + Vine Armor fire +1)
    expect(p4.hp).toBe(3); // 4 - 1 (propagated 2 capped to 1 by Silver Lion)
    expect(p2.chained).toBe(false);
    expect(p3.chained).toBe(false);
    expect(p4.chained).toBe(false);
    expect(engA.getPlayer('p1').stats.damageDealt).toBe(6);

    // Scenario B: Triggering target p2 DIES (1 HP), Team B still has p3 alive -> continues propagating to p3 -> p3 also dies (1 HP) -> Victory triggers -> ABORTS before hitting chained p4!
    const thunderSlash = createCardInstance(10, 'spade', 4, 'thunder_slash', 'junzheng');
    const engB = new GameEngine(cfg4, { deckOverride: [thunderSlash, ...filler] });
    engB.start();

    engB.getPlayer('p2').hp = 1;
    engB.getPlayer('p3').hp = 1;
    engB.getPlayer('p4').hp = 4;
    engB.getPlayer('p2').chained = true;
    engB.getPlayer('p3').chained = true;
    engB.getPlayer('p4').chained = true;

    engB.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: thunderSlash.id, targetIds: ['p2'] }
    });

    // p2 died -> still propagated to p3 -> p3 died -> Team B wiped out -> Game Over -> p4 untouched (still 4 HP)!
    expect(engB.getPlayer('p2').alive).toBe(false);
    expect(engB.getPlayer('p3').alive).toBe(false);
    expect(engB.state.result?.winnerTeam).toBe('蓝队');
    expect(engB.getPlayer('p4').hp).toBe(4); // Aborted immediately upon victory!
  });
});
