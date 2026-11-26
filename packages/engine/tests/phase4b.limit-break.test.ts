import { describe, expect, it } from 'vitest';
import {
  ALL_PLAYABLE_GENERALS,
  createCardInstance,
  decideAIAction,
  GameEngine,
  getAllPlayableCards,
  getDistance,
  getGeneralPool,
  getHandLimit,
  LIMIT_BREAK_GENERALS,
  runAutoGame,
  type CardInstance,
  type GameConfig,
  type PlayerResponse,
  type PromptRequest
} from '../src/index.js';

function mkCard(
  id: number,
  name: CardInstance['name'],
  suit: CardInstance['suit'],
  rank: CardInstance['rank'],
  pack: CardInstance['pack'] = 'standard'
): CardInstance {
  return createCardInstance(id, suit, rank, name, pack);
}

function makeEngine(
  seats: GameConfig['seats'],
  mode: GameConfig['mode'] = '1v1',
  seed = 4001,
  generalPack: GameConfig['generalPack'] = 'limit_break'
): GameEngine {
  const engine = new GameEngine({
    mode,
    deckVariant: 'junzheng_161',
    generalPack,
    seed,
    seats,
    skipGeneralSelection: true
  });
  engine.start();
  return engine;
}

function advanceUntil(
  engine: GameEngine,
  predicate: (prompt: PromptRequest) => boolean,
  onOther?: (prompt: PromptRequest) => PlayerResponse | null,
  maxSteps = 80
): PromptRequest {
  let prompt = engine.state.pendingPrompt;
  for (let i = 0; i < maxSteps && prompt; i++) {
    if (predicate(prompt)) return prompt;
    const custom = onOther?.(prompt);
    if (custom) {
      prompt = engine.submit(custom);
      continue;
    }
    if (prompt.type === 'choose_option') {
      const noOpt =
        prompt.options.find((o) => o.id === 'no') ??
        prompt.options[prompt.options.length - 1];
      prompt = engine.submit({ type: 'choose_option', optionId: noOpt.id });
    } else if (prompt.type === 'choose_card') {
      prompt = engine.submit(
        prompt.optional
          ? { type: 'choose_card', cardIds: [], cancelled: true }
          : { type: 'choose_card', cardIds: prompt.eligibleCardIds.slice(0, prompt.minCount) }
      );
    } else if (prompt.type === 'choose_target') {
      prompt = engine.submit(
        prompt.optional
          ? { type: 'choose_target', targetIds: [], cancelled: true }
          : { type: 'choose_target', targetIds: prompt.eligibleTargetIds.slice(0, prompt.minCount) }
      );
    } else if (prompt.type === 'choose_guanxing') {
      prompt = engine.submit({
        type: 'choose_guanxing',
        topCardIds: prompt.cards.map((c) => c.id),
        bottomCardIds: []
      });
    } else if (prompt.type === 'play_action') {
      prompt = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    } else if (prompt.type === 'choose_player_card') {
      prompt = engine.submit({ type: 'choose_player_card', choiceIndex: 0 });
    } else if (prompt.type === 'choose_harvest_card') {
      const avail = prompt.pool.find((x) => !x.takenBy);
      prompt = engine.submit({ type: 'choose_harvest_card', cardId: avail!.card.id });
    } else {
      throw new Error(`Unexpected prompt: ${prompt.type}`);
    }
  }
  throw new Error(
    `Did not reach target prompt within ${maxSteps} steps; last=${prompt?.type} reason=${prompt && 'reason' in prompt ? prompt.reason : ''}`
  );
}

describe('Phase 4B: Limit Break Roster (30 OL Generals) & Mutual Exclusion', () => {
  it('contains exact 30 OL Limit Break generals (Wei 8, Shu 8, Wu 8, Qun 6) and 57 combined', () => {
    expect(LIMIT_BREAK_GENERALS.length).toBe(30);
    expect(getGeneralPool('limit_break').length).toBe(30);
    expect(ALL_PLAYABLE_GENERALS.length).toBeGreaterThanOrEqual(57);
    expect(getGeneralPool('all').length).toBeGreaterThanOrEqual(57);

    const byFaction = {
      wei: LIMIT_BREAK_GENERALS.filter((g) => g.faction === 'wei').length,
      shu: LIMIT_BREAK_GENERALS.filter((g) => g.faction === 'shu').length,
      wu: LIMIT_BREAK_GENERALS.filter((g) => g.faction === 'wu').length,
      qun: LIMIT_BREAK_GENERALS.filter((g) => g.faction === 'qun').length
    };
    expect(byFaction).toEqual({ wei: 8, shu: 8, wu: 8, qun: 6 });

    expect(LIMIT_BREAK_GENERALS.find((g) => g.id === 'lb_lidian')?.maxHp).toBe(3);
    expect(LIMIT_BREAK_GENERALS.find((g) => g.id === 'lb_xushu')?.maxHp).toBe(4);
    expect(LIMIT_BREAK_GENERALS.find((g) => g.id === 'lb_lvbu')?.maxHp).toBe(5);
    expect(LIMIT_BREAK_GENERALS.find((g) => g.id === 'lb_huaxiong')?.maxHp).toBe(6);
    expect(LIMIT_BREAK_GENERALS.find((g) => g.id === 'lb_gongsunzan')?.maxHp).toBe(4);
  });

  it('enforces mutual exclusion between Standard and Limit Break versions of same general', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const engine = new GameEngine({
        mode: 'identity5',
        deckVariant: 'junzheng_161',
        generalPack: 'all',
        seed,
        seats: [
          { id: 'p1', name: 'P1', isAI: true },
          { id: 'p2', name: 'P2', isAI: true },
          { id: 'p3', name: 'P3', isAI: true },
          { id: 'p4', name: 'P4', isAI: true },
          { id: 'p5', name: 'P5', isAI: true }
        ],
        skipGeneralSelection: false
      });
      let prompt = engine.start();
      while (prompt && prompt.type === 'choose_general') {
        prompt = engine.submit({ type: 'choose_general', generalId: prompt.candidates[0].id });
      }
      const baseIds = engine.state.players.map((p) => {
        const def = ALL_PLAYABLE_GENERALS.find((g) => g.id === p.generalId)!;
        return def.baseGeneralId ?? def.id;
      });
      expect(new Set(baseIds).size).toBe(5);
    }
  });
});

describe('Phase 4B: Wei Limit Break Generals (8)', () => {
  it('界曹操【奸雄】(draw 1 + obtain damage card) & 【护驾】(Wei ally out-of-turn Dodge draws 1)', () => {
    const engine = makeEngine(
      [
        { id: 'p1', name: '反刘备', isAI: false, generalId: 'std_liubei', preferredRole: 'rebel' },
        { id: 'p2', name: '主界曹操', isAI: false, generalId: 'lb_caocao', preferredRole: 'lord' },
        { id: 'p3', name: '忠界司马', isAI: false, generalId: 'lb_simayi', preferredRole: 'loyalist' },
        { id: 'p4', name: '反孙权', isAI: false, generalId: 'std_sunquan', preferredRole: 'rebel' },
        { id: 'p5', name: '内吕布', isAI: false, generalId: 'std_lvbu', preferredRole: 'renegade' }
      ],
      'identity5'
    );
    // Advance to p1's play phase
    advanceUntil(engine, (p) => p.type === 'play_action' && p.playerId === 'p1');
    const p1 = engine.getPlayer('p1');
    const lord = engine.getPlayer('p2');
    const weiAlly = engine.getPlayer('p3');

    // Give p1 Archery Attack (hits lord and weiAlly), weiAlly has Dodge, lord has no Dodge
    const archery = mkCard(9001, 'archery_attack', 'heart', 1, 'standard');
    const dodge = mkCard(9002, 'dodge', 'diamond', 2, 'standard');
    p1.hand = [archery];
    lord.hand = [];
    weiAlly.hand = [dodge];
    engine.getPlayer('p4').hand = [];
    engine.getPlayer('p5').hand = [];

    const lordBeforeHand = lord.hand.length;
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: archery.id } });

    // Decline hujia on lord so lord takes damage -> lb_jianxiong triggers!
    let p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'lb_hujia').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: 'no' })!;
    expect(p.type === 'choose_option' && p.reason === 'lb_jianxiong').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: 'yes' })!;

    // Lord drew 1 + took Archery Attack => +2 cards!
    expect(lord.hand.length).toBe(lordBeforeHand + 2);
    expect(lord.hand.some((c) => c.id === archery.id)).toBe(true);

    // Next weiAlly responds to Archery Attack with Dodge -> lb_hujia_draw triggers!
    expect(p.type === 'choose_card' && p.playerId === 'p3' && p.reason === 'dodge').toBe(true);
    p = engine.submit({ type: 'choose_card', cardIds: [dodge.id] })!;
    expect(p.type === 'choose_option' && p.reason === 'lb_hujia_draw').toBe(true);
    engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(lord.hand.length).toBe(lordBeforeHand + 3);
  });

  it('界司马懿【反馈】(per 1 dmg) & 【鬼才】(can use equipped card)', () => {
    const engine = makeEngine([
      { id: 'p1', name: '攻方', isAI: false, generalId: 'blank_shu_m' },
      { id: 'p2', name: '界司马', isAI: false, generalId: 'lb_simayi' }
    ]);
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    const alc = mkCard(9010, 'alcohol', 'spade', 3, 'junzheng');
    const slash = mkCard(9011, 'slash', 'spade', 7, 'standard');
    const spare1 = mkCard(9012, 'peach', 'heart', 4, 'standard');
    const spare2 = mkCard(9013, 'dodge', 'diamond', 5, 'standard');
    p1.hand = [alc, slash, spare1, spare2];
    p2.hand = [];
    // Also equip a Heart weapon on p2 and Indulgence on p2 to test equip-based Guicai!
    const heartEquip = mkCard(9014, 'kylin_bow', 'heart', 5, 'standard');
    const ind = mkCard(9015, 'indulgence', 'spade', 6, 'standard');
    p2.equips.weapon = heartEquip;
    p2.judgeZone = [ind];

    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: alc.id } });
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash.id, targetIds: ['p2'] }
    });

    // 2 damage -> Fankui prompts TWICE!
    let p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'lb_fankui').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: 'yes' })!;
    expect(p.type === 'choose_player_card').toBe(true);
    p = engine.submit({ type: 'choose_player_card', choiceIndex: 0 })!;
    expect(p.type === 'choose_option' && p.reason === 'lb_fankui').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: 'yes' })!;
    p = engine.submit({ type: 'choose_player_card', choiceIndex: 0 })!;
    expect(p2.hand.length).toBe(2);
    expect(p1.hand.length).toBe(0);

    // End p1 turn -> p2 judge phase (Indulgence), put Spade on top of drawPile, replace with equipped Heart Kylin Bow!
    engine.state.drawPile.unshift(mkCard(9016, 'slash', 'spade', 9, 'standard'));
    const guicaiPrompt = advanceUntil(
      engine,
      (pr) => pr.type === 'choose_card' && pr.playerId === 'p2' && pr.message.includes('鬼才')
    );
    expect(guicaiPrompt.type === 'choose_card' && guicaiPrompt.eligibleCardIds.includes(heartEquip.id)).toBe(true);
    engine.submit({ type: 'choose_card', cardIds: [heartEquip.id] });
    // Replaced with Heart -> Indulgence passed (did not skip play phase) & weapon removed!
    expect(p2.equips.weapon).toBeNull();
    expect(engine.state.skippedPhases.includes('play')).toBe(false);
  });

  it('界夏侯惇【刚烈】(red dmg / black discard) & 【清俭】(outside draw phase raises hand limit)', () => {
    const engine = makeEngine([
      { id: 'p1', name: '界夏侯', isAI: false, generalId: 'lb_xiahoudun' },
      { id: 'p2', name: '对手', isAI: false, generalId: 'blank_shu_m' }
    ]);
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    const ex = mkCard(9020, 'ex_nihilo', 'heart', 7, 'standard');
    const cBasic = mkCard(9021, 'slash', 'spade', 5, 'standard');
    const cEquip = mkCard(9022, 'qinggang_sword', 'spade', 6, 'standard');
    p1.hand = [ex, cBasic, cEquip];

    // Play Ex Nihilo outside draw phase -> triggers lb_qingjian!
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: ex.id } });
    let p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'lb_qingjian').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: 'yes' })!;
    expect(p.type === 'choose_card').toBe(true);
    // Give 2 distinct categories (basic + equip) to p2 -> active player (p1) hand limit +2!
    p = engine.submit({ type: 'choose_card', cardIds: [cBasic.id, cEquip.id] })!;
    expect(p.type === 'choose_target' && p.reason === 'lb_qingjian_target').toBe(true);
    engine.submit({ type: 'choose_target', targetIds: ['p2'] });
    expect(getHandLimit(engine.state, p1, engine.modifiers)).toBe(p1.hp + 2);

    // Advance to p2 play phase and slash p1 with Red judge on top -> lb_ganglie deals 1 dmg!
    advanceUntil(engine, (pr) => pr.type === 'play_action' && pr.playerId === 'p2');
    const slash = mkCard(9023, 'slash', 'club', 8, 'standard');
    p2.hand = [slash];
    p1.hand = [];
    engine.state.drawPile.unshift(mkCard(9024, 'peach', 'heart', 3, 'standard'));
    const p2HpBefore = p2.hp;
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash.id, targetIds: ['p1'] }
    });
    p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'lb_ganglie').toBe(true);
    engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(p2.hp).toBe(p2HpBefore - 1);
  });

  it('界张辽【突袭】reduces draw count and steals equal hand cards from opponents', () => {
    const engine = makeEngine([
      { id: 'p1', name: '对手', isAI: false, generalId: 'blank_shu_m' },
      { id: 'p2', name: '界张辽', isAI: false, generalId: 'lb_zhangliao' }
    ]);
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    p1.hand = [mkCard(9030, 'peach', 'heart', 6, 'standard')];
    const p2Before = p2.hand.length;

    const tuxiPrompt = advanceUntil(
      engine,
      (pr) => pr.type === 'choose_target' && pr.playerId === 'p2' && pr.reason === 'lb_tuxi'
    );
    expect(tuxiPrompt.type === 'choose_target').toBe(true);
    let p = engine.submit({ type: 'choose_target', targetIds: ['p1'] })!;
    expect(p.type === 'choose_player_card').toBe(true);
    engine.submit({ type: 'choose_player_card', choiceIndex: 0 });
    // Stole 1 from p1 + drew remaining 1 (2 - 1 = 1) => +2 total, and p1 has 0!
    expect(p1.hand.length).toBe(0);
    expect(p2.hand.length).toBe(p2Before + 2);
  });

  it('界许褚【裸衣】reveals top 3, obtains basic/weapon/duel, and adds +1 Slash damage', () => {
    const engine = makeEngine([
      { id: 'p1', name: '对手', isAI: false, generalId: 'blank_shu_m' },
      { id: 'p2', name: '界许褚', isAI: false, generalId: 'lb_xuchu' }
    ]);
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    p1.hand = [];
    p2.hand = [];

    // Prepare top 3 of draw pile: 1 Slash (basic), 1 Qinggang (weapon), 1 Dismantle (non-duel trick)
    const topSlash = mkCard(9040, 'slash', 'spade', 10, 'standard');
    const topWeapon = mkCard(9041, 'qinggang_sword', 'spade', 6, 'standard');
    const topTrick = mkCard(9042, 'dismantle', 'spade', 4, 'standard');
    engine.state.drawPile.unshift(topSlash, topWeapon, topTrick);

    advanceUntil(
      engine,
      (pr) => pr.type === 'choose_option' && pr.playerId === 'p2' && pr.reason === 'lb_luoyi_peek'
    );
    let p = engine.submit({ type: 'choose_option', optionId: 'yes' })!;
    expect(p.type === 'choose_option' && p.reason === 'lb_luoyi_confirm').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: 'yes' })!;

    // Obtained basic + weapon (2 cards), skipped draw phase, reached play phase!
    expect(p.type === 'play_action' && p.playerId === 'p2').toBe(true);
    expect(p2.hand.map((c) => c.id)).toEqual([topSlash.id, topWeapon.id]);

    const hpBefore = p1.hp;
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: topSlash.id, targetIds: ['p1'] }
    });
    expect(p1.hp).toBe(hpBefore - 2);
  });

  it('界郭嘉【遗计】draws 2 per damage and distributes hand cards to other players', () => {
    const engine = makeEngine([
      { id: 'p1', name: '攻方', isAI: false, generalId: 'blank_shu_m' },
      { id: 'p2', name: '界郭嘉', isAI: false, generalId: 'lb_guojia' }
    ]);
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    const slash = mkCard(9050, 'slash', 'club', 7, 'standard');
    p1.hand = [slash];
    p2.hand = [];

    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash.id, targetIds: ['p2'] }
    });
    let p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'lb_yiji').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: 'yes' })!;
    expect(p2.hand.length).toBe(2);
    // Give 1 card to p1
    expect(p.type === 'choose_card').toBe(true);
    p = engine.submit({ type: 'choose_card', cardIds: [p2.hand[0].id] })!;
    expect(p.type === 'choose_target' && p.reason === 'lb_yiji_give').toBe(true);
    engine.submit({ type: 'choose_target', targetIds: ['p1'] });
    expect(p1.hand.length).toBe(1);
    expect(p2.hand.length).toBe(1);
  });

  it('界甄姬【洛神】cards are exempt from hand limit during that turn', () => {
    const engine = makeEngine([
      { id: 'p1', name: '对手', isAI: false, generalId: 'blank_shu_m' },
      { id: 'p2', name: '界甄姬', isAI: false, generalId: 'lb_zhenji' }
    ]);
    const p2 = engine.getPlayer('p2');
    p2.hp = 1; // Normal hand limit would be 1!
    p2.hand = [mkCard(9060, 'peach', 'heart', 9, 'standard')];
    const b1 = mkCard(9061, 'slash', 'spade', 5, 'standard');
    const b2 = mkCard(9062, 'dodge', 'club', 2, 'standard');
    const r3 = mkCard(9063, 'peach', 'heart', 8, 'standard');
    engine.state.drawPile.unshift(b1, b2, r3);

    advanceUntil(
      engine,
      (pr) => pr.type === 'choose_option' && pr.playerId === 'p2' && pr.reason === 'lb_luoshen'
    );
    // Judge 1 (black) -> continue; Judge 2 (black) -> continue; Judge 3 (red) -> stops
    engine.submit({ type: 'choose_option', optionId: 'yes' });
    engine.submit({ type: 'choose_option', optionId: 'yes' });
    engine.submit({ type: 'choose_option', optionId: 'yes' });

    expect(b1.exemptFromHandLimitTurn).toBe(engine.state.turn);
    expect(b2.exemptFromHandLimitTurn).toBe(engine.state.turn);
    expect(getHandLimit(engine.state, p2, engine.modifiers)).toBe(p2.hp + 2);
  });

  it('李典【恂恂】(top 4 -> 2 top / 2 bottom) & 【忘隙】(draw 2, give 1 after 1 damage)', () => {
    const engine = makeEngine([
      { id: 'p1', name: '李典', isAI: false, generalId: 'lb_lidian' },
      { id: 'p2', name: '对手', isAI: false, generalId: 'blank_shu_m' }
    ]);
    advanceUntil(engine, (pr) => pr.type === 'play_action' && pr.playerId === 'p1');
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    // Test 忘隙 on p1's play phase immediately
    const slash = mkCard(9070, 'slash', 'spade', 8, 'standard');
    p1.hand = [slash];
    p2.hand = [];
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash.id, targetIds: ['p2'] }
    });
    let p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'lb_wangxi').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: 'yes' })!;
    expect(p1.hand.length).toBe(2);
    expect(p.type === 'choose_card').toBe(true);
    engine.submit({ type: 'choose_card', cardIds: [p1.hand[0].id] });
    expect(p1.hand.length).toBe(1);
    expect(p2.hand.length).toBe(1);

    // Advance to p1's next turn to test 恂恂
    const c1 = mkCard(9071, 'peach', 'heart', 3, 'standard');
    const c2 = mkCard(9072, 'ex_nihilo', 'heart', 7, 'standard');
    const c3 = mkCard(9073, 'slash', 'spade', 2, 'standard');
    const c4 = mkCard(9074, 'slash', 'club', 3, 'standard');
    const xxPrompt = advanceUntil(
      engine,
      (pr) => pr.type === 'choose_option' && pr.playerId === 'p1' && pr.reason === 'lb_xunxun'
    );
    expect(xxPrompt.type === 'choose_option').toBe(true);
    engine.state.drawPile.unshift(c1, c2, c3, c4);
    p = engine.submit({ type: 'choose_option', optionId: 'yes' })!;
    expect(p.type === 'choose_guanxing' && p.cards.length === 4).toBe(true);
    engine.submit({
      type: 'choose_guanxing',
      topCardIds: [c1.id, c2.id],
      bottomCardIds: [c3.id, c4.id]
    });
    // Draw phase immediately draws the 2 top cards (c1, c2)!
    expect(p1.hand.some((c) => c.id === c1.id)).toBe(true);
    expect(p1.hand.some((c) => c.id === c2.id)).toBe(true);
  });
});

describe('Phase 4B: Shu Limit Break Generals (8)', () => {
  it('界刘备【仁德】(2nd card triggers virtual Basic Peach/Slash) & 【激将】(Shu ally draw)', () => {
    const engine = makeEngine(
      [
        { id: 'p1', name: '主界刘备', isAI: false, generalId: 'lb_liubei', preferredRole: 'lord' },
        { id: 'p2', name: '忠界关羽', isAI: false, generalId: 'lb_guanyu', preferredRole: 'loyalist' },
        { id: 'p3', name: '反孙权', isAI: false, generalId: 'std_sunquan', preferredRole: 'rebel' },
        { id: 'p4', name: '反周瑜', isAI: false, generalId: 'std_zhouyu', preferredRole: 'rebel' },
        { id: 'p5', name: '内吕布', isAI: false, generalId: 'std_lvbu', preferredRole: 'renegade' }
      ],
      'identity5'
    );
    const lord = engine.getPlayer('p1');
    const shuAlly = engine.getPlayer('p2');
    lord.hp = 3; // wounded (maxHp=5)
    const c1 = mkCard(9101, 'dodge', 'diamond', 2, 'standard');
    const c2 = mkCard(9102, 'dodge', 'diamond', 3, 'standard');
    const savage = mkCard(9103, 'savage_assault', 'spade', 7, 'standard');
    lord.hand = [c1, c2, savage];
    shuAlly.hand = [mkCard(9104, 'slash', 'spade', 9, 'standard')];
    engine.getPlayer('p3').hand = [];
    engine.getPlayer('p4').hand = [];
    engine.getPlayer('p5').hand = [];

    // Give 2 cards to shuAlly -> triggers lb_rende_basic! Choose Peach -> heals +1!
    engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'lb_rende', cardIds: [c1.id, c2.id], targetIds: ['p2'] }
    });
    let p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'lb_rende_basic').toBe(true);
    engine.submit({ type: 'choose_option', optionId: 'peach' });
    expect(lord.hp).toBe(4);

    // Play Savage Assault -> Shu ally plays Slash out of turn -> triggers lb_jijiang_draw!
    const lordCardsBefore = lord.hand.length - 1; // minus savage
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: savage.id } });
    p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_card' && p.playerId === 'p2').toBe(true);
    p = engine.submit({ type: 'choose_card', cardIds: [9104] })!;
    expect(p.type === 'choose_option' && p.reason === 'lb_jijiang_draw').toBe(true);
    engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(lord.hand.length).toBe(lordCardsBefore + 1);
  });

  it('界关羽【武圣】(diamond Slash ignores distance) & 【义绝】(black seals & heart Slash +1 dmg)', () => {
    const engine = makeEngine([
      { id: 'p1', name: '界关羽', isAI: false, generalId: 'lb_guanyu' },
      { id: 'p2', name: '界司马', isAI: false, generalId: 'lb_simayi' }
    ]);
    const gy = engine.getPlayer('p1');
    const smy = engine.getPlayer('p2');
    // Put +1 horse on smy (distance = 2, gy attack range = 1)
    smy.equips.horsePlus = mkCard(9110, 'dilu', 'club', 5, 'standard');
    const dSlash = mkCard(9111, 'slash', 'diamond', 8, 'standard');
    const hSlash = mkCard(9112, 'slash', 'heart', 10, 'standard');
    const cost = mkCard(9113, 'dodge', 'club', 4, 'standard');
    gy.hand = [dSlash, hSlash, cost];
    smy.hand = [mkCard(9114, 'dodge', 'spade', 2, 'standard')];

    // Check diamond Slash is playable despite distance 2!
    const playable = getAllPlayableCards(engine.state, 'p1', engine.modifiers);
    expect(playable.find((i) => i.cardId === dSlash.id)?.eligibleTargetIds).toContain('p2');
    expect(playable.find((i) => i.cardId === hSlash.id)).toBeUndefined();

    // Remove +1 horse and activate 义绝 -> smy shows black card -> sealed & heart Slash deals 2 dmg & smy cannot dodge!
    smy.equips.horsePlus = null;
    engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'lb_yijue', cardIds: [cost.id], targetIds: ['p2'] }
    });
    let p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_card' && p.playerId === 'p2').toBe(true);
    engine.submit({ type: 'choose_card', cardIds: [9114] });
    expect(smy.nonCompulsoryDisabledThisTurn).toBe(true);
    expect(smy.cannotPlayHandCardsThisTurn).toBe(true);

    const hpBefore = smy.hp;
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: hSlash.id, targetIds: ['p2'] }
    });
    // smy cannot play Dodge (sealed) AND takes 2 damage (heart Slash +1) AND Fankui is sealed!
    expect(smy.hp).toBe(hpBefore - 2);
  });

  it('界张飞【咆哮】(missed Slash buffs next Slash +1) & 【替身】(limited full heal + draw)', () => {
    const engine = makeEngine([
      { id: 'p1', name: '界张飞', isAI: false, generalId: 'lb_zhangfei' },
      { id: 'p2', name: '对手', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const zf = engine.getPlayer('p1');
    const opp = engine.getPlayer('p2');
    const s1 = mkCard(9120, 'slash', 'spade', 5, 'standard');
    const s2 = mkCard(9121, 'slash', 'club', 6, 'standard');
    const dodge = mkCard(9122, 'dodge', 'heart', 2, 'standard');
    zf.hand = [s1, s2];
    opp.hand = [dodge];

    // Slash 1 dodged -> next Slash deals 2 damage!
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: s1.id, targetIds: ['p2'] } });
    engine.submit({ type: 'choose_card', cardIds: [dodge.id] });
    const hpBefore = opp.hp;
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: s2.id, targetIds: ['p2'] } });
    expect(opp.hp).toBe(hpBefore - 2);

    // Damage zf to 1 HP and advance to zf's next prepare phase -> 替身 heals +3 and draws 3!
    zf.hp = 1;
    const handBefore = zf.hand.length;
    advanceUntil(
      engine,
      (pr) => pr.type === 'choose_option' && pr.playerId === 'p1' && pr.reason === 'lb_tishen'
    );
    engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(zf.hp).toBe(4);
    expect(zf.hand.length).toBe(handBefore + 3 + 2); // 3 from 替身 + 2 from draw phase!
  });

  it('界诸葛亮【观星】(3 cards when <4 alive; all bottom triggers finish-phase Guanxing)', () => {
    const engine = makeEngine([
      { id: 'p1', name: '对手', isAI: false, generalId: 'blank_wei_m' },
      { id: 'p2', name: '界诸葛', isAI: false, generalId: 'lb_zhugeliang' }
    ]);
    advanceUntil(
      engine,
      (pr) => pr.type === 'choose_option' && pr.playerId === 'p2' && pr.reason === 'lb_guanxing'
    );
    let p = engine.submit({ type: 'choose_option', optionId: 'yes' })!;
    expect(p.type === 'choose_guanxing' && p.cards.length === 3).toBe(true);
    // Put ALL 3 on bottom!
    const allIds = p.type === 'choose_guanxing' ? p.cards.map((c) => c.id) : [];
    engine.submit({ type: 'choose_guanxing', topCardIds: [], bottomCardIds: allIds });

    // Advance to finish phase -> triggers 2nd Guanxing!
    const secondGx = advanceUntil(
      engine,
      (pr) => pr.type === 'choose_option' && pr.playerId === 'p2' && pr.reason === 'lb_guanxing'
    );
    expect(secondGx.type === 'choose_option').toBe(true);
    expect(engine.state.phase).toBe('finish');
  });

  it('界赵云【龙胆】(Alcohol->Peach / Peach->Alcohol) & 【涯角】(out-of-turn same/diff category)', () => {
    const engine = makeEngine([
      { id: 'p1', name: '界赵云', isAI: false, generalId: 'lb_zhaoyun' },
      { id: 'p2', name: '对手', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const zy = engine.getPlayer('p1');
    const opp = engine.getPlayer('p2');
    zy.hp = 2;
    const alc = mkCard(9130, 'alcohol', 'spade', 3, 'junzheng');
    const peach = mkCard(9131, 'peach', 'heart', 4, 'standard');
    const slash = mkCard(9132, 'slash', 'club', 7, 'standard');
    zy.hand = [alc, peach, slash];

    // Alcohol as Peach -> heals +1!
    engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'lb_longdan', cardIds: [alc.id] }
    });
    expect(zy.hp).toBe(3);

    // Peach as Alcohol -> drunk!
    engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'lb_longdan', cardIds: [peach.id] }
    });
    expect(zy.drunk).toBe(true);

    // Advance to opp's play phase -> opp Slashes zy -> zy dodges with Slash (basic) -> top card is basic -> 涯角 gives to zy!
    advanceUntil(engine, (pr) => pr.type === 'play_action' && pr.playerId === 'p2');
    const oppSlash = mkCard(9133, 'slash', 'spade', 9, 'standard');
    const topBasic = mkCard(9134, 'peach', 'heart', 9, 'standard');
    opp.hand = [oppSlash];
    zy.hand = [slash];
    engine.state.drawPile.unshift(topBasic);
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: oppSlash.id, targetIds: ['p1'] }
    });
    let p = engine.submit({ type: 'choose_card', cardIds: [slash.id] })!;
    expect(p.type === 'choose_option' && p.reason === 'lb_yajiao').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: 'yes' })!;
    expect(p.type === 'choose_target' && p.reason === 'lb_yajiao_give').toBe(true);
    engine.submit({ type: 'choose_target', targetIds: ['p1'] });
    expect(zy.hand.some((c) => c.id === topBasic.id)).toBe(true);
  });

  it('界马超【铁骑】seals non-compulsory skills and forces suit-matched discard or undodgeable Slash', () => {
    const engine = makeEngine([
      { id: 'p1', name: '界马超', isAI: false, generalId: 'lb_machao' },
      { id: 'p2', name: '界郭嘉', isAI: false, generalId: 'lb_guojia' }
    ]);
    const mc = engine.getPlayer('p1');
    const gj = engine.getPlayer('p2');
    const slash = mkCard(9140, 'slash', 'spade', 8, 'standard');
    const gjDodge = mkCard(9141, 'dodge', 'diamond', 2, 'standard');
    mc.hand = [slash];
    gj.hand = [gjDodge]; // Only Diamond, judge will be Spade!
    engine.state.drawPile.unshift(mkCard(9142, 'slash', 'spade', 10, 'standard'));

    const hpBefore = gj.hp;
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: slash.id, targetIds: ['p2'] } });
    let p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'lb_tieqi').toBe(true);
    engine.submit({ type: 'choose_option', optionId: 'yes' });

    // gj has no Spade -> cannot dodge, takes damage, AND Yiji is sealed!
    expect(gj.nonCompulsoryDisabledThisTurn).toBe(true);
    expect(gj.hp).toBe(hpBefore - 1);
    expect(engine.state.pendingPrompt?.type).toBe('play_action');
  });

  it('界黄月英【集智】(basic card discard for +1 hand limit) & 【奇才】(armor/treasure immune to Dismantle)', () => {
    const engine = makeEngine([
      { id: 'p1', name: '界月英', isAI: false, generalId: 'lb_huangyueying' },
      { id: 'p2', name: '对手', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const hyy = engine.getPlayer('p1');
    const opp = engine.getPlayer('p2');
    const ex = mkCard(9150, 'ex_nihilo', 'heart', 7, 'standard');
    const topBasic = mkCard(9151, 'slash', 'club', 5, 'standard');
    hyy.hand = [ex];
    hyy.equips.armor = mkCard(9152, 'renwang_shield', 'club', 2, 'standard');
    hyy.equips.treasure = mkCard(9153, 'wooden_ox', 'diamond', 5, 'junzheng');
    engine.state.drawPile.unshift(topBasic);

    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: ex.id } });
    let p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'lb_jizhi').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: 'yes' })!;
    expect(p.type === 'choose_option' && p.reason === 'lb_jizhi_discard').toBe(true);
    engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(getHandLimit(engine.state, hyy, engine.modifiers)).toBe(hyy.hp + 1);

    // Opp dismantles hyy -> armor & treasure must NOT be in choices!
    advanceUntil(engine, (pr) => pr.type === 'play_action' && pr.playerId === 'p2');
    const dis = mkCard(9154, 'dismantle', 'spade', 3, 'standard');
    opp.hand = [dis];
    hyy.hand = [mkCard(9155, 'dodge', 'heart', 2, 'standard')];
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: dis.id, targetIds: ['p1'] } });
    p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_player_card').toBe(true);
    if (p.type === 'choose_player_card') {
      expect(p.choices.some((c) => c.zone === 'armor' || c.zone === 'treasure')).toBe(false);
    }
  });

  it('界徐庶【诛害】+【潜心】awakening -> 【荐言】', () => {
    const engine = makeEngine([
      { id: 'p1', name: '对手', isAI: false, generalId: 'blank_wei_m' },
      { id: 'p2', name: '界徐庶', isAI: false, generalId: 'lb_xushu' }
    ]);
    const opp = engine.getPlayer('p1');
    const xs = engine.getPlayer('p2');
    const oppSlash = mkCard(9160, 'slash', 'spade', 7, 'standard');
    const xsSlash = mkCard(9161, 'slash', 'club', 8, 'standard');
    opp.hand = [oppSlash];
    xs.hand = [xsSlash];

    // Opp damages xs (xs is now wounded AND opp dealt damage this turn!)
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: oppSlash.id, targetIds: ['p2'] } });
    expect(xs.hp).toBe(3);
    // End opp play phase -> opp finish phase triggers 诛害!
    engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    const zhuhaiPrompt = engine.state.pendingPrompt!;
    expect(zhuhaiPrompt.type === 'choose_card' && zhuhaiPrompt.playerId === 'p2').toBe(true);
    engine.submit({ type: 'choose_card', cardIds: [xsSlash.id] });

    // xs dealt damage while wounded -> 潜心 awakens! maxHp 4 -> 3, gains lb_jianyan!
    expect(xs.maxHp).toBe(3);
    expect(xs.skills).toContain('lb_jianyan');

    // Advance to xs's play phase and test 荐言!
    advanceUntil(engine, (pr) => pr.type === 'play_action' && pr.playerId === 'p2');
    const redTrick = mkCard(9162, 'ex_nihilo', 'heart', 8, 'standard');
    engine.state.drawPile.unshift(
      mkCard(9163, 'slash', 'spade', 4, 'standard'),
      redTrick
    );
    engine.submit({ type: 'play_action', action: { type: 'activate_skill', skillId: 'lb_jianyan' } });
    let p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'lb_jianyan_declare').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: 'trick' })!;
    expect(p.type === 'choose_target' && p.reason === 'lb_jianyan_target').toBe(true);
    engine.submit({ type: 'choose_target', targetIds: ['p2'] });
    expect(xs.hand.some((c) => c.id === redTrick.id)).toBe(true);
  });
});

describe('Phase 4B: Wu Limit Break Generals (8)', () => {
  it('界孙权【制衡】(all-hand bonus +1) & 【救援】(Wu ally redirects own-turn heal to Lord)', () => {
    const engine = makeEngine(
      [
        { id: 'p1', name: '主界孙权', isAI: false, generalId: 'lb_sunquan', preferredRole: 'lord' },
        { id: 'p2', name: '忠界周瑜', isAI: false, generalId: 'lb_zhouyu', preferredRole: 'loyalist' },
        { id: 'p3', name: '反曹操', isAI: false, generalId: 'std_caocao', preferredRole: 'rebel' },
        { id: 'p4', name: '反刘备', isAI: false, generalId: 'std_liubei', preferredRole: 'rebel' },
        { id: 'p5', name: '内吕布', isAI: false, generalId: 'std_lvbu', preferredRole: 'renegade' }
      ],
      'identity5'
    );
    const lord = engine.getPlayer('p1');
    const wuAlly = engine.getPlayer('p2');
    const c1 = mkCard(9201, 'slash', 'spade', 5, 'standard');
    const c2 = mkCard(9202, 'dodge', 'diamond', 4, 'standard');
    lord.hand = [c1, c2];
    // Discard ALL 2 hand cards -> draws 3!
    engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'lb_zhiheng', cardIds: [c1.id, c2.id] }
    });
    expect(lord.hand.length).toBe(3);

    // Advance to wuAlly play phase; lord HP = 2, wuAlly HP = 2 (wuAlly.hp >= lord.hp!)
    advanceUntil(engine, (pr) => pr.type === 'play_action' && pr.playerId === 'p2');
    lord.hp = 2;
    wuAlly.hp = 2;
    const peach = mkCard(9203, 'peach', 'heart', 6, 'standard');
    wuAlly.hand = [peach];
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: peach.id } });
    const p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'lb_jiuyuan').toBe(true);
    engine.submit({ type: 'choose_option', optionId: 'yes' });
    // Lord healed +1, wuAlly stayed at 2 HP and drew 1 card!
    expect(lord.hp).toBe(3);
    expect(wuAlly.hp).toBe(2);
    expect(wuAlly.hand.length).toBe(1);
  });

  it('界甘宁【奋威】cancels selected targets on multi-target Savage Assault', () => {
    const engine = makeEngine(
      [
        { id: 'p1', name: '攻方', isAI: false, generalId: 'blank_wei_m' },
        { id: 'p2', name: '界甘宁', isAI: false, generalId: 'lb_ganning' },
        { id: 'p3', name: '友军A', isAI: false, generalId: 'blank_wu_m' },
        { id: 'p4', name: '友军B', isAI: false, generalId: 'blank_shu_m' }
      ],
      '2v2'
    );
    const p1 = engine.getPlayer('p1');
    const gn = engine.getPlayer('p2');
    const p3 = engine.getPlayer('p3');
    const p4 = engine.getPlayer('p4');
    const savage = mkCard(9210, 'savage_assault', 'spade', 7, 'standard');
    p1.hand = [savage];
    gn.hand = [];
    p3.hand = [];
    p4.hand = [];

    const gnHp = gn.hp;
    const p3Hp = p3.hp;
    const p4Hp = p4.hp;
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: savage.id } });
    let p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'lb_fenwei').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: 'yes' })!;
    expect(p.type === 'choose_target' && p.reason === 'lb_fenwei_targets').toBe(true);
    // Cancel Savage Assault on gn and p3; p4 still takes 1 dmg!
    engine.submit({ type: 'choose_target', targetIds: ['p2', 'p3'] });
    expect(gn.hp).toBe(gnHp);
    expect(p3.hp).toBe(p3Hp);
    expect(p4.hp).toBe(p4Hp - 1);
  });

  it('界吕蒙【勤学】awakening + 【攻心】+ 【博图】extra turn on 4 suits discarded', () => {
    const engine = makeEngine([
      { id: 'p1', name: '界吕蒙', isAI: false, generalId: 'lb_lvmeng' },
      { id: 'p2', name: '对手', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const lm = engine.getPlayer('p1');
    const opp = engine.getPlayer('p2');
    // Setup 4 suits to discard + hand >= hp + 2 at finish phase (hp=2 so after maxHp 4->3 still wounded for heal/draw prompt)!
    lm.hp = 2;
    const s = mkCard(9220, 'peach', 'spade', 2, 'standard');
    const h = mkCard(9221, 'peach', 'heart', 3, 'standard');
    const c = mkCard(9222, 'peach', 'club', 4, 'standard');
    const d = mkCard(9223, 'peach', 'diamond', 5, 'standard');
    const keep1 = mkCard(9224, 'dodge', 'spade', 6, 'standard');
    const keep2 = mkCard(9225, 'dodge', 'club', 7, 'standard');
    const keep3 = mkCard(9226, 'dodge', 'diamond', 8, 'standard');
    const keep4 = mkCard(9227, 'dodge', 'heart', 9, 'standard');
    const keep5 = mkCard(9228, 'dodge', 'heart', 10, 'standard');
    lm.hand = [keep1, keep2, keep3, keep4, keep5];
    // Simulate 4 suits entered discard pile this turn via playing/recasting or setting turnSuitsDiscarded
    engine.state.turnSuitsDiscarded = ['spade', 'heart', 'club', 'diamond'];
    void s;
    void h;
    void c;
    void d;

    // End play phase -> Keji skips discard -> Finish phase triggers 勤学 (hand 5 >= hp 3 + 2)!
    engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    let p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'keji').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: 'yes' })!;
    expect(p.type === 'choose_option' && p.reason === 'lb_qinxue').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: 'draw' })!;
    expect(lm.maxHp).toBe(3);
    expect(lm.skills).toContain('lb_gongxin');

    // TurnEnd triggers 博图!
    expect(p.type === 'choose_option' && p.reason === 'lb_botu').toBe(true);
    const turnBefore = engine.state.turn;
    engine.submit({ type: 'choose_option', optionId: 'yes' });
    // Extra turn belongs to p1 again!
    expect(engine.state.turn).toBe(turnBefore + 1);
    expect(engine.state.players[engine.state.activePlayerIndex].id).toBe('p1');

    // Now test 攻心 in the extra turn's play phase!
    const oppHeart = mkCard(9229, 'peach', 'heart', 12, 'standard');
    opp.hand = [oppHeart];
    engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'lb_gongxin', targetIds: ['p2'] }
    });
    p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'lb_gongxin_card').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: `card_${oppHeart.id}` })!;
    expect(p.type === 'choose_option' && p.reason === 'lb_gongxin_action').toBe(true);
    engine.submit({ type: 'choose_option', optionId: 'top' });
    expect(opp.hand.length).toBe(0);
    expect(engine.state.drawPile[0].id).toBe(oppHeart.id);
  });

  it('界黄盖【苦肉】+【诈降】(draws 3, +1 slash limit, red Slash unlimited range & undodgeable)', () => {
    const engine = makeEngine([
      { id: 'p1', name: '界黄盖', isAI: false, generalId: 'lb_huanggai' },
      { id: 'p2', name: '对手', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const hg = engine.getPlayer('p1');
    const opp = engine.getPlayer('p2');
    opp.equips.horsePlus = mkCard(9230, 'dilu', 'club', 5, 'standard'); // dist=2
    const cost = mkCard(9231, 'dodge', 'club', 3, 'standard');
    const rSlash1 = mkCard(9232, 'slash', 'heart', 10, 'standard');
    const rSlash2 = mkCard(9233, 'slash', 'diamond', 9, 'standard');
    hg.hand = [cost, rSlash1, rSlash2];
    opp.hand = [mkCard(9234, 'dodge', 'heart', 2, 'standard')];

    engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'lb_kurou', cardIds: [cost.id] }
    });
    expect(hg.hp).toBe(3);
    expect(hg.hand.length).toBe(5); // 2 left + 3 drawn from 诈降!

    // Both red Slashes ignore +1 horse AND cannot be dodged!
    const oppHp = opp.hp;
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: rSlash1.id, targetIds: ['p2'] } });
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: rSlash2.id, targetIds: ['p2'] } });
    expect(opp.hp).toBe(oppHp - 2);
  });

  it('界周瑜【英姿】(compulsory 3 draw & hand limit=maxHp) & 【反间】(discard suit or lose 1 HP)', () => {
    const engine = makeEngine([
      { id: 'p1', name: '界周瑜', isAI: false, generalId: 'lb_zhouyu' },
      { id: 'p2', name: '对手', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const zy = engine.getPlayer('p1');
    const opp = engine.getPlayer('p2');
    // Hand count after initial 4 + draw 3 = 7
    expect(zy.hand.length).toBe(7);
    zy.hp = 1;
    // Hand limit still equals maxHp (3) even at 1 HP!
    expect(getHandLimit(engine.state, zy, engine.modifiers)).toBe(3);

    const giveCard = mkCard(9240, 'slash', 'spade', 7, 'standard');
    const oppSpade = mkCard(9241, 'dodge', 'spade', 2, 'standard');
    const oppHeart = mkCard(9242, 'peach', 'heart', 4, 'standard');
    zy.hand = [giveCard];
    opp.hand = [oppSpade, oppHeart];

    engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'lb_fanjian', cardIds: [giveCard.id], targetIds: ['p2'] }
    });
    const p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'lb_fanjian').toBe(true);
    engine.submit({ type: 'choose_option', optionId: 'discard_suit' });
    // Discarded both Spade cards, only Heart remains!
    expect(opp.hand.map((c) => c.id)).toEqual([oppHeart.id]);
  });

  it('界大乔【国色】places or removes Indulgence once per turn and draws 1 card', () => {
    const engine = makeEngine([
      { id: 'p1', name: '界大乔', isAI: false, generalId: 'lb_daqiao' },
      { id: 'p2', name: '对手', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const dq = engine.getPlayer('p1');
    const opp = engine.getPlayer('p2');
    const diam = mkCard(9250, 'dodge', 'diamond', 5, 'standard');
    dq.hand = [diam];

    engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'lb_guose', cardIds: [diam.id], targetIds: ['p2'] }
    });
    expect(opp.judgeZone.length).toBe(1);
    expect(opp.judgeZone[0].asDelayedTrick).toBe('indulgence');
    expect(dq.hand.length).toBe(1); // Drew 1 card!
  });

  it('界陆逊【谦逊】(removes hand before single trick, returns at turn end) + 【连营】(up to X draw)', () => {
    const engine = makeEngine([
      { id: 'p1', name: '攻方', isAI: false, generalId: 'blank_wei_m' },
      { id: 'p2', name: '界陆逊', isAI: false, generalId: 'lb_luxun' }
    ]);
    const p1 = engine.getPlayer('p1');
    const lx = engine.getPlayer('p2');
    const fa = mkCard(9260, 'fire_attack', 'heart', 2, 'junzheng');
    const h1 = mkCard(9261, 'slash', 'spade', 5, 'standard');
    const h2 = mkCard(9262, 'dodge', 'diamond', 6, 'standard');
    p1.hand = [fa];
    lx.hand = [h1, h2];

    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: fa.id, targetIds: ['p2'] }
    });
    let p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'lb_qianxun').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: 'yes' })!;
    // Removing 2 cards emptied hand -> triggers 界连营 with maxCount = 2!
    expect(p.type === 'choose_option' && p.reason === 'lb_lianying').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: 'yes' })!;
    expect(p.type === 'choose_target' && p.reason === 'lb_lianying_targets' && p.maxCount === 2).toBe(true);
    engine.submit({ type: 'choose_target', targetIds: ['p2'] });
    expect(lx.removedCards['lb_qianxun']?.length).toBe(2);
    expect(lx.hand.length).toBe(1); // 1 from Lianying!
    // Authentic OL ruling: since Lianying drew 1 card back to lx, Fire Attack asks fire_attack_show!
    expect(engine.state.pendingPrompt?.type === 'choose_card' && engine.state.pendingPrompt.reason === 'fire_attack_show').toBe(true);

    // Finish Fire Attack & p1's turn -> TurnEnd returns the 2 removed Qianxun cards to lx's hand!
    advanceUntil(engine, (pr) => pr.type === 'play_action' && pr.playerId === 'p2');
    expect(lx.hand.length).toBe(1 + 2 + 2); // 1 (Lianying) + 2 (Qianxun returned) + 2 (lx draw phase)!
    expect(lx.removedCards['lb_qianxun']).toBeUndefined();
  });

  it('界孙尚香【结姻】places own equip into male equip zone (triggers 枭姬, higher draws 1, lower heals 1)', () => {
    const engine = makeEngine([
      { id: 'p1', name: '界香香', isAI: false, generalId: 'lb_sunshangxiang' },
      { id: 'p2', name: '男性', isAI: false, generalId: 'blank_shu_m' }
    ]);
    const ssx = engine.getPlayer('p1');
    const male = engine.getPlayer('p2');
    ssx.hp = 3;
    male.hp = 2; // ssx > male -> ssx draws 1, male heals 1!
    const bow = mkCard(9270, 'kylin_bow', 'heart', 5, 'standard');
    ssx.hand = [];
    ssx.equips.weapon = bow;

    engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'lb_jieyin', cardIds: [bow.id], targetIds: ['p2'] }
    });
    // Placed own equip into male's weapon slot -> triggers 枭姬!
    const p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'xiaoji').toBe(true);
    engine.submit({ type: 'choose_option', optionId: 'yes' });

    expect(ssx.equips.weapon).toBeNull();
    expect(male.equips.weapon?.id).toBe(bow.id);
    expect(male.hp).toBe(3); // healed +1!
    expect(ssx.hand.length).toBe(3); // 2 from xiaoji + 1 from jieyin!
  });
});

describe('Phase 4B: Qun Limit Break Generals (6)', () => {
  it('界华佗【除疠】discards 1 card from self and distinct-faction opponents, Spade discarders draw 1', () => {
    const engine = makeEngine(
      [
        { id: 'p1', name: '界华佗', isAI: false, generalId: 'lb_huatuo' },
        { id: 'p2', name: '魏将', isAI: false, generalId: 'blank_wei_m' },
        { id: 'p3', name: '蜀将', isAI: false, generalId: 'blank_shu_m' },
        { id: 'p4', name: '吴将', isAI: false, generalId: 'blank_wu_m' }
      ],
      '2v2'
    );
    const ht = engine.getPlayer('p1');
    const wei = engine.getPlayer('p2');
    const shu = engine.getPlayer('p3');
    const htSpade = mkCard(9301, 'slash', 'spade', 5, 'standard');
    const weiSpade = mkCard(9302, 'dodge', 'spade', 2, 'standard');
    const shuHeart = mkCard(9303, 'peach', 'heart', 6, 'standard');
    ht.hand = [htSpade];
    wei.hand = [weiSpade];
    shu.hand = [shuHeart];

    engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'lb_chuli', targetIds: ['p2', 'p3'] }
    });
    engine.submit({ type: 'choose_card', cardIds: [htSpade.id] });
    engine.submit({ type: 'choose_player_card', choiceIndex: 0 });
    engine.submit({ type: 'choose_player_card', choiceIndex: 0 });

    // ht and wei discarded Spades -> drew 1 each; shu discarded Heart -> 0 cards!
    expect(ht.hand.length).toBe(1);
    expect(wei.hand.length).toBe(1);
    expect(shu.hand.length).toBe(0);
  });

  it('界吕布【利驭】(5HP): takes equip card -> victim chooses 3rd player to Duel Lv Bu', () => {
    const engine = makeEngine(
      [
        { id: 'p1', name: '界吕布', isAI: false, generalId: 'lb_lvbu' },
        { id: 'p2', name: '受害者', isAI: false, generalId: 'blank_wei_m' },
        { id: 'p3', name: '决斗目标', isAI: false, generalId: 'blank_shu_m' },
        { id: 'p4', name: '旁观', isAI: false, generalId: 'blank_wu_m' }
      ],
      '2v2'
    );
    const lb = engine.getPlayer('p1');
    const victim = engine.getPlayer('p2');
    const third = engine.getPlayer('p3');
    expect(lb.maxHp).toBe(5);
    const slash = mkCard(9310, 'slash', 'spade', 9, 'standard');
    const equip = mkCard(9311, 'qinggang_sword', 'spade', 6, 'standard');
    lb.hand = [slash];
    victim.hand = [];
    victim.equips.weapon = equip;
    third.hand = [];
    const thirdHp = third.hp;

    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: slash.id, targetIds: ['p2'] } });
    let p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'lb_liyu').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: 'yes' })!;
    p = engine.submit({ type: 'choose_player_card', choiceIndex: 0 })!;
    expect(lb.hand.some((c) => c.id === equip.id)).toBe(true);
    // Victim picks third player for virtual Duel!
    expect(p.type === 'choose_target' && p.reason === 'lb_liyu_duel' && p.playerId === 'p2').toBe(true);
    engine.submit({ type: 'choose_target', targetIds: ['p3'] });
    expect(third.hp).toBe(thirdHp - 1);
  });

  it('界貂蝉【闭月】draws 2 cards when empty-handed and 1 card otherwise', () => {
    const engine = makeEngine([
      { id: 'p1', name: '界貂蝉', isAI: false, generalId: 'lb_diaochan' },
      { id: 'p2', name: '对手', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const dc = engine.getPlayer('p1');
    dc.hand = [];
    engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    const p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'lb_biyue').toBe(true);
    engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(dc.hand.length).toBe(2);
  });

  it('界华雄【耀武】(red->source draws 1, non-red->self draws 1) & 【势斩】(up to 2 duels/turn)', () => {
    const engine = makeEngine([
      { id: 'p1', name: '界华雄', isAI: false, generalId: 'lb_huaxiong' },
      { id: 'p2', name: '对手', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const hx = engine.getPlayer('p1');
    const opp = engine.getPlayer('p2');
    expect(hx.maxHp).toBe(6);
    hx.hand = [];
    opp.hand = [];
    const hxHp = hx.hp;

    // Shizhan #1: virtual colorless Duel -> hx has no slash -> takes 1 non-red damage -> 界耀武 lets hx draw 1!
    engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'lb_shizhan', targetIds: ['p2'] }
    });
    expect(hx.hp).toBe(hxHp - 1);
    expect(hx.hand.length).toBe(1);

    // Shizhan #2 still available!
    const playPrompt = engine.state.pendingPrompt!;
    expect(playPrompt.type === 'play_action' && playPrompt.usableSkillIds.includes('lb_shizhan')).toBe(true);
    hx.hand = [mkCard(9320, 'slash', 'spade', 7, 'standard')];
    const oppHp = opp.hp;
    engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'lb_shizhan', targetIds: ['p2'] }
    });
    engine.submit({ type: 'choose_card', cardIds: [9320] });
    expect(opp.hp).toBe(oppHp - 1);
  });

  it('界袁术【庸肆】(draws alive factions, discard phase discards 1 or loses 1 HP) & 【觊玺】awakening after 3 safe turns', () => {
    const engine = makeEngine(
      [
        { id: 'p1', name: '界袁术', isAI: false, generalId: 'lb_yuanshu' },
        { id: 'p2', name: '魏将', isAI: false, generalId: 'blank_wei_m' },
        { id: 'p3', name: '蜀将', isAI: false, generalId: 'blank_shu_m' },
        { id: 'p4', name: '吴将', isAI: false, generalId: 'blank_wu_m' }
      ],
      '2v2'
    );
    const ys = engine.getPlayer('p1');
    // 2v2 first player base draw = 1, Yongsi delta = 4 factions - 2 = +2 => 1 + 2 = 3 drawn (+4 initial = 7)!
    expect(ys.hand.length).toBe(7);

    // Run 3 full turns of p1 without losing HP (always discard 1 card for Yongsi!)
    let awakened = false;
    for (let cycle = 0; cycle < 3; cycle++) {
      advanceUntil(
        engine,
        (pr) => pr.type === 'choose_option' && pr.playerId === 'p1' && pr.reason === 'lb_yongsi'
      );
      let p = engine.submit({ type: 'choose_option', optionId: 'discard' })!;
      expect(p.type === 'choose_card').toBe(true);
      p = engine.submit({ type: 'choose_card', cardIds: [ys.hand[0].id] })!;
      // Complete discard phase if needed, then check if lb_jixi triggers at TurnEnd of 3rd turn!
      if (cycle === 2) {
        const jixiPrompt = advanceUntil(
          engine,
          (pr) => pr.type === 'choose_option' && pr.playerId === 'p1' && pr.reason === 'lb_jixi'
        );
        expect(jixiPrompt.type === 'choose_option').toBe(true);
        engine.submit({ type: 'choose_option', optionId: 'wangzun' });
        awakened = true;
      }
    }
    expect(awakened).toBe(true);
    expect(ys.maxHp).toBe(5);
    expect(ys.skills).toContain('wangzun');
  });

  it('界公孙瓒【义从】(dist-1; when HP<=2 others dist+1) & 【趫猛】(Slash dmg steals Horse)', () => {
    const engine = makeEngine(
      [
        { id: 'p1', name: '界公孙瓒', isAI: false, generalId: 'lb_gongsunzan' },
        { id: 'p2', name: '甲', isAI: false, generalId: 'blank_wei_m' },
        { id: 'p3', name: '乙', isAI: false, generalId: 'blank_shu_m' },
        { id: 'p4', name: '丙', isAI: false, generalId: 'blank_wu_m' }
      ],
      '2v2'
    );
    const gsz = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    // Raw distance p1->p3 = 2, with 义从 (-1) = 1!
    expect(getDistance(engine.state, 'p1', 'p3', engine.modifiers)).toBe(1);
    // Raw distance p2->p1 = 1 at HP 4, becomes 2 at HP <= 2!
    expect(getDistance(engine.state, 'p2', 'p1', engine.modifiers)).toBe(1);
    gsz.hp = 2;
    expect(getDistance(engine.state, 'p2', 'p1', engine.modifiers)).toBe(2);

    // Test 趫猛 obtaining horse from p2!
    const slash = mkCard(9340, 'slash', 'spade', 8, 'standard');
    const horse = mkCard(9341, 'chitu', 'heart', 5, 'standard');
    gsz.hand = [slash];
    p2.hand = [];
    p2.equips.horseMinus = horse;
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: slash.id, targetIds: ['p2'] } });
    let p = engine.state.pendingPrompt!;
    expect(p.type === 'choose_option' && p.reason === 'lb_qiaomeng').toBe(true);
    p = engine.submit({ type: 'choose_option', optionId: 'yes' })!;
    engine.submit({ type: 'choose_player_card', choiceIndex: 0 });
    expect(p2.equips.horseMinus).toBeNull();
    expect(gsz.hand.some((c) => c.id === horse.id)).toBe(true);
  });
});

describe('Phase 4B: Full Limit Break Roster Automated AI Games & Replay Determinism', () => {
  it('completes 45 Limit Break AI games (15x 1v1, 15x 2v2, 15x identity5) + 15 mixed All-57 games cleanly', () => {
    const configs: { mode: GameConfig['mode']; pack: GameConfig['generalPack']; count: number; baseSeed: number }[] = [
      { mode: '1v1', pack: 'limit_break', count: 15, baseSeed: 4100 },
      { mode: '2v2', pack: 'limit_break', count: 15, baseSeed: 4200 },
      { mode: 'identity5', pack: 'limit_break', count: 15, baseSeed: 4300 },
      { mode: 'identity5', pack: 'all', count: 15, baseSeed: 4400 }
    ];

    for (const batch of configs) {
      const seatCount = batch.mode === '1v1' ? 2 : batch.mode === '2v2' ? 4 : 5;
      for (let i = 0; i < batch.count; i++) {
        const cfg: GameConfig = {
          mode: batch.mode,
          deckVariant: 'junzheng_161',
          generalPack: batch.pack,
          seed: batch.baseSeed + i,
          seats: Array.from({ length: seatCount }, (_, idx) => ({
            id: `p${idx + 1}`,
            name: `AI_${idx + 1}`,
            isAI: true
          }))
        };
        const engine = new GameEngine(cfg);
        const state = runAutoGame(engine, 12000);
        expect(state.result).not.toBeNull();
        expect(state.turn).toBeGreaterThan(0);

        // Verify deterministic replay on first game of each batch
        if (i === 0) {
          const replayed = GameEngine.replay(cfg, state.actionLog);
          expect(replayed.state.result).toEqual(state.result);
          expect(replayed.state.events.length).toBe(state.events.length);
        }
      }
    }
    void decideAIAction;
  }, 60000);
});
