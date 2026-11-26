import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  decideAIAction,
  GameEngine,
  getAllPlayableCards,
  getDistance,
  getGeneralPool,
  STANDARD_GENERALS,
  type CardInstance,
  type GameConfig,
  type PlayerResponse,
  type PromptRequest
} from '../src/index.js';

function makeEngine(
  seats: GameConfig['seats'],
  mode: GameConfig['mode'] = '1v1',
  seed = 1001
): GameEngine {
  const engine = new GameEngine({
    mode,
    deckVariant: 'junzheng_161',
    generalPack: 'standard',
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
  maxSteps = 40
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
      const noOpt = prompt.options.find((o) => o.id === 'no') ?? prompt.options[prompt.options.length - 1];
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
    } else {
      throw new Error(`Unexpected prompt: ${prompt.type}`);
    }
  }
  throw new Error(`Did not reach target prompt within ${maxSteps} steps; last=${prompt?.type}`);
}

describe('Phase 4A: Standard Pack 27 Generals Roster & Lord Skill Rules', () => {
  it('contains exact 27 OL Standard Pack generals (Wei 7, Shu 7, Wu 8, Qun 5)', () => {
    expect(STANDARD_GENERALS.length).toBe(27);
    expect(getGeneralPool('standard').length).toBe(27);

    const byFaction = {
      wei: STANDARD_GENERALS.filter((g) => g.faction === 'wei').length,
      shu: STANDARD_GENERALS.filter((g) => g.faction === 'shu').length,
      wu: STANDARD_GENERALS.filter((g) => g.faction === 'wu').length,
      qun: STANDARD_GENERALS.filter((g) => g.faction === 'qun').length
    };
    expect(byFaction).toEqual({ wei: 7, shu: 7, wu: 8, qun: 5 });

    // Restored 孙尚香, OL 华雄 6HP, OL 袁术 4HP
    const ssx = STANDARD_GENERALS.find((g) => g.id === 'std_sunshangxiang');
    const hx = STANDARD_GENERALS.find((g) => g.id === 'std_huaxiong');
    const ys = STANDARD_GENERALS.find((g) => g.id === 'std_yuanshu');
    expect(ssx?.skills.map((s) => s.id)).toEqual(['jieyin', 'xiaoji']);
    expect(hx?.maxHp).toBe(6);
    expect(hx?.skills.map((s) => s.id)).toEqual(['yaowu']);
    expect(ys?.maxHp).toBe(4);
    expect(ys?.skills.map((s) => s.id)).toEqual(['wangzun', 'tongji']);
  });

  it('grants Lord skills only to Lord in identity5 and strips them in 1v1/2v2', () => {
    const e1v1 = makeEngine([
      { id: 'p1', name: '曹操', isAI: false, generalId: 'std_caocao' },
      { id: 'p2', name: '刘备', isAI: false, generalId: 'std_liubei' }
    ]);
    expect(e1v1.state.players[0].skills).toEqual(['jianxiong']);
    expect(e1v1.state.players[1].skills).toEqual(['rende']);

    const eId5 = makeEngine(
      [
        { id: 'p1', name: '主曹操', isAI: false, generalId: 'std_caocao', preferredRole: 'lord' },
        { id: 'p2', name: '忠司马', isAI: false, generalId: 'std_simayi', preferredRole: 'loyalist' },
        { id: 'p3', name: '反刘备', isAI: false, generalId: 'std_liubei', preferredRole: 'rebel' },
        { id: 'p4', name: '反孙权', isAI: false, generalId: 'std_sunquan', preferredRole: 'rebel' },
        { id: 'p5', name: '内吕布', isAI: false, generalId: 'std_lvbu', preferredRole: 'renegade' }
      ],
      'identity5'
    );
    const caocao = eId5.state.players.find((p) => p.id === 'p1')!;
    const liubei = eId5.state.players.find((p) => p.id === 'p3')!;
    expect(caocao.skills).toEqual(['jianxiong', 'hujia']);
    expect(caocao.maxHp).toBe(5);
    expect(liubei.skills).toEqual(['rende']);
  });
});

describe('Phase 4A: Wei Generals (7 generals / 11 skills)', () => {
  it('曹操: 【奸雄】 gains damaging card & 【护驾】 lets Wei ally dodge for Lord', () => {
    const engine = makeEngine(
      [
        { id: 'p1', name: '反张飞', isAI: false, generalId: 'std_zhangfei', preferredRole: 'rebel' },
        { id: 'p2', name: '主曹操', isAI: false, generalId: 'std_caocao', preferredRole: 'lord' },
        { id: 'p3', name: '忠司马', isAI: false, generalId: 'std_simayi', preferredRole: 'loyalist' },
        { id: 'p4', name: '反关羽', isAI: false, generalId: 'std_guanyu', preferredRole: 'rebel' },
        { id: 'p5', name: '内吕布', isAI: false, generalId: 'std_lvbu', preferredRole: 'renegade' }
      ],
      'identity5'
    );

    // Lord p2 acts first; end p2's turn, then p3, p4, p5 until p1's play phase
    const playP1 = advanceUntil(engine, (pr) => pr.type === 'play_action' && pr.playerId === 'p1');
    expect(playP1.playerId).toBe('p1');

    const p1 = engine.state.players.find((p) => p.id === 'p1')!;
    const caocao = engine.state.players.find((p) => p.id === 'p2')!;
    const simayi = engine.state.players.find((p) => p.id === 'p3')!;

    const slash1 = createCardInstance(901, 'spade', 7, 'slash');
    const slash2 = createCardInstance(902, 'heart', 10, 'slash');
    const allyDodge = createCardInstance(903, 'diamond', 2, 'dodge');
    p1.hand = [slash1, slash2];
    caocao.hand = [];
    simayi.hand = [allyDodge];

    // Slash #1: Caocao triggers Hujia -> Simayi plays Dodge -> 0 damage!
    let pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash1.id, targetIds: ['p2'] }
    });
    expect(pr?.type === 'choose_option' && pr.reason === 'hujia').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(pr?.type === 'choose_card' && pr.playerId === 'p3').toBe(true);
    pr = engine.submit({ type: 'choose_card', cardIds: [allyDodge.id] });
    expect(caocao.hp).toBe(5);
    expect(pr?.type).toBe('play_action');

    // Slash #2 (Zhangfei Paoxiao!): Caocao declines Hujia -> takes 1 damage -> Jianxiong gains slash2!
    pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash2.id, targetIds: ['p2'] }
    });
    expect(pr?.type === 'choose_option' && pr.reason === 'hujia').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'no' });
    expect(pr?.type === 'choose_option' && pr.reason === 'jianxiong').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(caocao.hp).toBe(4);
    expect(caocao.hand.some((c) => c.id === slash2.id)).toBe(true);
  });

  it('司马懿: 【反馈】 steals card from attacker & 【鬼才】 replaces judge card', () => {
    const engine = makeEngine([
      { id: 'p1', name: '白板攻', isAI: false, generalId: 'blank_shu_m' },
      { id: 'p2', name: '司马懿', isAI: false, generalId: 'std_simayi' }
    ]);
    const p1 = engine.state.players[0];
    const sima = engine.state.players[1];

    const slash = createCardInstance(910, 'spade', 8, 'slash');
    const stolenTargetCard = createCardInstance(911, 'heart', 12, 'peach');
    const ind = createCardInstance(912, 'club', 6, 'indulgence');
    const guicaiHeart = createCardInstance(913, 'heart', 5, 'dodge');

    p1.hand = [slash, stolenTargetCard, ind];
    sima.hand = [guicaiHeart];

    // 1. Slash Sima Yi -> Sima declines Dodge -> takes 1 dmg -> Fankui takes p1's card
    let pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash.id, targetIds: ['p2'] }
    });
    expect(pr?.type).toBe('choose_card');
    pr = engine.submit({ type: 'choose_card', cardIds: [], cancelled: true });
    expect(pr?.type === 'choose_option' && pr.reason === 'fankui').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(pr?.type).toBe('choose_player_card');
    pr = engine.submit({ type: 'choose_player_card', choiceIndex: 0 });
    expect(sima.hand.length).toBe(2);

    // 2. Put Indulgence on Sima Yi, stack Spade on top of deck, Sima replaces with Heart via Guicai!
    pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: ind.id, targetIds: ['p2'] }
    });
    engine.state.drawPile.unshift(createCardInstance(914, 'spade', 3, 'slash'));
    pr = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    // Now Sima's judge phase triggers Guicai
    expect(pr?.type === 'choose_card' && pr.playerId === 'p2' && pr.reason === 'general_skill').toBe(true);
    pr = engine.submit({ type: 'choose_card', cardIds: [guicaiHeart.id] });
    // Because judge became Heart, Indulgence fails -> Sima gets his Play Phase!
    expect(pr?.type === 'play_action' && pr.playerId === 'p2').toBe(true);
  });

  it('夏侯惇: 【刚烈】 forces 2-card discard or deals 1 damage on non-Heart judge', () => {
    const engine = makeEngine([
      { id: 'p1', name: '攻方', isAI: false, generalId: 'blank_shu_m' },
      { id: 'p2', name: '夏侯惇', isAI: false, generalId: 'std_xiahoudun' }
    ]);
    const p1 = engine.state.players[0];
    const xhd = engine.state.players[1];

    const s1 = createCardInstance(920, 'spade', 7, 'slash');
    const c1 = createCardInstance(921, 'club', 2, 'slash');
    const c2 = createCardInstance(922, 'club', 3, 'slash');
    p1.hand = [s1, c1, c2];
    xhd.hand = [];
    // Top of draw pile is Spade (non-Heart)
    engine.state.drawPile.unshift(createCardInstance(923, 'spade', 9, 'slash'));

    let pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: s1.id, targetIds: ['p2'] }
    });
    expect(pr?.type === 'choose_option' && pr.reason === 'ganglie').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(pr?.type === 'choose_option' && pr.reason === 'ganglie_choice').toBe(true);
    // p1 chooses to discard 2 cards
    pr = engine.submit({ type: 'choose_option', optionId: 'discard' });
    expect(pr?.type === 'choose_card' && pr.minCount === 2).toBe(true);
    pr = engine.submit({ type: 'choose_card', cardIds: [c1.id, c2.id] });
    expect(p1.hand.length).toBe(0);
    expect(p1.hp).toBe(4);

    // Second hit with 0 hand cards -> p1 takes 1 damage automatically!
    const s2 = createCardInstance(924, 'spade', 10, 'duel');
    p1.hand = [s2];
    engine.state.drawPile.unshift(createCardInstance(925, 'club', 4, 'slash'));
    pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: s2.id, targetIds: ['p2'] }
    });
    expect(pr?.type === 'choose_option' && pr.reason === 'ganglie').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(p1.hp).toBe(3);
  });

  it('张辽: 【突袭】 skips draw phase and steals enemy hand card', () => {
    const engine = makeEngine([
      { id: 'p1', name: '张辽', isAI: false, generalId: 'std_zhangliao' },
      { id: 'p2', name: '目标', isAI: false, generalId: 'blank_shu_m' }
    ]);
    // GameEngine starts at p1's draw PhaseBefore -> Tuxi prompt!
    const p1 = engine.state.players[0];
    const p2 = engine.state.players[1];
    const startP1Hand = p1.hand.length;
    const startP2Hand = p2.hand.length;

    let pr = engine.state.pendingPrompt;
    expect(pr?.type === 'choose_target' && pr.reason === 'tuxi').toBe(true);
    pr = engine.submit({ type: 'choose_target', targetIds: ['p2'] });
    expect(pr?.type).toBe('choose_player_card');
    pr = engine.submit({ type: 'choose_player_card', choiceIndex: 0 });
    expect(pr?.type).toBe('play_action');
    // Skipped drawing 2, stole 1 from p2
    expect(p1.hand.length).toBe(startP1Hand + 1);
    expect(p2.hand.length).toBe(startP2Hand - 1);
  });

  it('许褚: 【裸衣】 draws 1 fewer card and adds +1 damage to Slash and Duel', () => {
    const engine = makeEngine([
      { id: 'p1', name: '许褚', isAI: false, generalId: 'std_xuchu' },
      { id: 'p2', name: '木桩', isAI: false, generalId: 'blank_shu_m' }
    ]);
    const p1 = engine.state.players[0];
    const p2 = engine.state.players[1];
    const beforeDraw = p1.hand.length;

    let pr = engine.state.pendingPrompt;
    expect(pr?.type === 'choose_option' && pr.reason === 'luoyi').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(pr?.type).toBe('play_action');
    // Drew 1 instead of 2
    expect(p1.hand.length).toBe(beforeDraw + 1);

    const slash = createCardInstance(930, 'spade', 7, 'slash');
    p1.hand = [slash];
    p2.hand = [];
    pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash.id, targetIds: ['p2'] }
    });
    expect(p2.hp).toBe(2); // 4 - 2 (1 base + 1 Luoyi)
  });

  it('郭嘉: 【天妒】 gains judge card & 【遗计】 triggers twice for 2 damage', () => {
    const engine = makeEngine([
      { id: 'p1', name: '攻方', isAI: false, generalId: 'blank_shu_m' },
      { id: 'p2', name: '郭嘉', isAI: false, generalId: 'std_guojia' }
    ]);
    const p1 = engine.state.players[0];
    const gj = engine.state.players[1];

    // Test Yiji with Wine + Slash (2 dmg)
    const wine = createCardInstance(935, 'spade', 9, 'alcohol');
    const slash = createCardInstance(936, 'spade', 8, 'slash');
    const ind = createCardInstance(937, 'club', 6, 'indulgence');
    p1.hand = [wine, slash, ind];
    gj.hand = [];

    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: wine.id } });
    let pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash.id, targetIds: ['p2'] }
    });
    // Yiji step 1/2
    expect(pr?.type === 'choose_option' && pr.reason === 'yiji').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    pr = engine.submit({ type: 'choose_target', targetIds: ['p2'] });
    pr = engine.submit({ type: 'choose_target', targetIds: ['p2'] });
    // Yiji step 2/2
    expect(pr?.type === 'choose_option' && pr.reason === 'yiji').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    pr = engine.submit({ type: 'choose_target', targetIds: ['p2'] });
    pr = engine.submit({ type: 'choose_target', targetIds: ['p2'] });
    expect(gj.hp).toBe(1);
    expect(gj.hand.length).toBe(4);

    // Test Tiandu with Indulgence on Guo Jia
    const judgeCard = createCardInstance(938, 'heart', 9, 'peach');
    engine.state.drawPile.unshift(judgeCard);
    engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: ind.id, targetIds: ['p2'] }
    });
    pr = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    expect(pr?.type === 'choose_option' && pr.reason === 'tiandu').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(gj.hand.some((c) => c.id === judgeCard.id)).toBe(true);
  });

  it('甄姬: 【洛神】 chains black judge cards & 【倾国】 uses black hand card as Dodge', () => {
    const engine = makeEngine([
      { id: 'p1', name: '甄姬', isAI: false, generalId: 'std_zhenji' },
      { id: 'p2', name: '攻方', isAI: false, generalId: 'blank_shu_m' }
    ]);
    const zj = engine.state.players[0];
    const p2 = engine.state.players[1];

    // Stack draw pile (FIFO shift): black1 -> black2 -> redStop
    const redStop = createCardInstance(940, 'heart', 4, 'peach');
    const black2 = createCardInstance(941, 'club', 7, 'slash');
    const black1 = createCardInstance(942, 'spade', 5, 'slash');
    engine.state.drawPile.unshift(black1, black2, redStop);

    let pr = engine.state.pendingPrompt;
    expect(pr?.type === 'choose_option' && pr.reason === 'luoshen').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' }); // gets black1
    expect(zj.hand.some((c) => c.id === black1.id)).toBe(true);
    expect(pr?.type === 'choose_option' && pr.reason === 'luoshen').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' }); // gets black2
    expect(zj.hand.some((c) => c.id === black2.id)).toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' }); // hits redStop -> ends
    expect(pr?.type).toBe('play_action');

    // End Zhenji's turn (discard down to 3 HP) -> p2 slashes Zhenji -> Zhenji uses black card via Qingguo!
    zj.hand = [black1];
    pr = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    expect(pr?.type === 'play_action' && pr.playerId === 'p2').toBe(true);
    const p2Slash = createCardInstance(943, 'heart', 10, 'slash');
    p2.hand = [p2Slash];
    pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: p2Slash.id, targetIds: ['p1'] }
    });
    expect(pr?.type === 'choose_card' && pr.reason === 'dodge').toBe(true);
    if (pr?.type === 'choose_card') {
      expect(pr.eligibleCardIds).toContain(black1.id);
    }
    pr = engine.submit({ type: 'choose_card', cardIds: [black1.id] });
    expect(zj.hp).toBe(3); // Dodged via Qingguo!
  });
});

describe('Phase 4A: Shu Generals (7 generals / 11 skills)', () => {
  it('刘备: 【仁德】 heals 1 HP on 2nd card given & 【激将】 calls Shu ally Slash', () => {
    const engine = makeEngine(
      [
        { id: 'p1', name: '主刘备', isAI: false, generalId: 'std_liubei', preferredRole: 'lord' },
        { id: 'p2', name: '忠关羽', isAI: false, generalId: 'std_guanyu', preferredRole: 'loyalist' },
        { id: 'p3', name: '反曹操', isAI: false, generalId: 'std_caocao', preferredRole: 'rebel' },
        { id: 'p4', name: '反孙权', isAI: false, generalId: 'std_sunquan', preferredRole: 'rebel' },
        { id: 'p5', name: '内华雄', isAI: false, generalId: 'std_huaxiong', preferredRole: 'renegade' }
      ],
      'identity5'
    );
    const lb = engine.state.players.find((p) => p.id === 'p1')!;
    const gy = engine.state.players.find((p) => p.id === 'p2')!;
    const hx = engine.state.players.find((p) => p.id === 'p5')!;

    lb.hp = 3; // wounded Lord (3/5)
    const c1 = createCardInstance(950, 'club', 4, 'dodge');
    const c2 = createCardInstance(951, 'diamond', 5, 'dodge');
    const gyRed = createCardInstance(952, 'heart', 9, 'peach'); // Guanyu can use red via Wusheng!
    lb.hand = [c1, c2];
    gy.hand = [gyRed];
    hx.hand = [];

    // 1. Rende gives 2 cards to Guanyu -> Liu Bei heals +1 (3 -> 4)
    let pr = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'rende', cardIds: [c1.id, c2.id], targetIds: ['p2'] }
    });
    expect(lb.hp).toBe(4);
    expect(gy.hand.some((c) => c.id === c1.id)).toBe(true);

    // 2. Jijiang attacks p5 (adjacent at seat 4 -> distance 1) using Guanyu's red card (Wusheng!)
    pr = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'jijiang', cardIds: [], targetIds: ['p5'] }
    });
    expect(pr?.type === 'choose_card' && pr.playerId === 'p2').toBe(true);
    pr = engine.submit({ type: 'choose_card', cardIds: [gyRed.id] });
    // Because gyRed is red and target is Huaxiong, Yaowu triggers for wounded Liu Bei!
    expect(pr?.type === 'choose_option' && pr.reason === 'yaowu').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'heal' });
    expect(lb.hp).toBe(5); // Healed via Yaowu!
    expect(hx.hp).toBe(5); // Huaxiong 6 -> 5
  });

  it('关羽: 【武圣】 uses red hand and red equipped card as Slash', () => {
    const engine = makeEngine([
      { id: 'p1', name: '关羽', isAI: false, generalId: 'std_guanyu' },
      { id: 'p2', name: '木桩', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const gy = engine.state.players[0];
    const p2 = engine.state.players[1];

    const redHorse = createCardInstance(955, 'heart', 5, 'chitu');
    gy.hand = [];
    gy.equips.horseMinus = redHorse;
    p2.hand = [];

    let pr = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'wusheng', cardIds: [redHorse.id], targetIds: ['p2'] }
    });
    expect(pr?.type).toBe('play_action');
    expect(gy.equips.horseMinus).toBeNull();
    expect(p2.hp).toBe(3);
  });

  it('张飞: 【咆哮】 plays unlimited Slashes per turn', () => {
    const engine = makeEngine([
      { id: 'p1', name: '张飞', isAI: false, generalId: 'std_zhangfei' },
      { id: 'p2', name: '木桩', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const zf = engine.state.players[0];
    const p2 = engine.state.players[1];

    const s1 = createCardInstance(956, 'spade', 7, 'slash');
    const s2 = createCardInstance(957, 'spade', 8, 'slash');
    const s3 = createCardInstance(958, 'spade', 9, 'slash');
    zf.hand = [s1, s2, s3];
    p2.hand = [];

    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: s1.id, targetIds: ['p2'] } });
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: s2.id, targetIds: ['p2'] } });
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: s3.id, targetIds: ['p2'] } });
    expect(p2.hp).toBe(1);
    expect(zf.slashUsedThisTurn).toBe(3);
  });

  it('诸葛亮: 【观星】 reorders draw pile & 【空城】 blocks Slash and Duel when hand empty', () => {
    const engine = makeEngine([
      { id: 'p1', name: '诸葛亮', isAI: false, generalId: 'std_zhugeliang' },
      { id: 'p2', name: '攻方', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const zgl = engine.state.players[0];
    const p2 = engine.state.players[1];

    const topA = createCardInstance(960, 'heart', 3, 'peach');
    const topB = createCardInstance(961, 'spade', 2, 'slash');
    engine.state.drawPile.unshift(topA, topB); // topA is index 0, topB index 1

    let pr = engine.state.pendingPrompt;
    expect(pr?.type === 'choose_option' && pr.reason === 'guanxing').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(pr?.type).toBe('choose_guanxing');
    // Put topA on top, topB on bottom!
    pr = engine.submit({
      type: 'choose_guanxing',
      topCardIds: [topA.id],
      bottomCardIds: [topB.id]
    });
    expect(pr?.type).toBe('play_action');
    expect(zgl.hand.some((c) => c.id === topA.id)).toBe(true);
    expect(engine.state.drawPile[engine.state.drawPile.length - 1].id).toBe(topB.id);

    // Empty Zhuge Liang's hand and end turn -> p2 cannot target with Slash or Duel!
    zgl.hand = [];
    pr = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    expect(pr?.type === 'play_action' && pr.playerId === 'p2').toBe(true);

    const p2Slash = createCardInstance(962, 'spade', 7, 'slash');
    const p2Duel = createCardInstance(963, 'spade', 1, 'duel');
    p2.hand = [p2Slash, p2Duel];
    const playable = getAllPlayableCards(engine.state, 'p2', engine.modifiers);
    expect(playable.length).toBe(0);
  });

  it('赵云: 【龙胆】 uses Dodge as Slash and Slash as Dodge', () => {
    const engine = makeEngine([
      { id: 'p1', name: '赵云', isAI: false, generalId: 'std_zhaoyun' },
      { id: 'p2', name: '攻方', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const zy = engine.state.players[0];
    const p2 = engine.state.players[1];

    const dodge = createCardInstance(965, 'diamond', 2, 'dodge');
    const slash = createCardInstance(966, 'spade', 7, 'slash');
    zy.hand = [dodge, slash];
    p2.hand = [];

    // 1. Dodge as Slash in Play phase
    let pr = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'longdan', cardIds: [dodge.id], targetIds: ['p2'] }
    });
    expect(p2.hp).toBe(3);

    // 2. Next turn p2 slashes Zhao Yun -> Zhao Yun uses Slash as Dodge!
    pr = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    const p2Slash = createCardInstance(967, 'heart', 10, 'slash');
    p2.hand = [p2Slash];
    pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: p2Slash.id, targetIds: ['p1'] }
    });
    expect(pr?.type === 'choose_card' && pr.reason === 'dodge').toBe(true);
    if (pr?.type === 'choose_card') {
      expect(pr.eligibleCardIds).toContain(slash.id);
    }
    pr = engine.submit({ type: 'choose_card', cardIds: [slash.id] });
    expect(zy.hp).toBe(4);
  });

  it('马超: 【马术】 reduces distance by 1 & 【铁骑】 red judge makes Slash undodgeable', () => {
    const engine = makeEngine(
      [
        { id: 'p1', name: '马超', isAI: false, generalId: 'std_machao' },
        { id: 'p2', name: '邻座', isAI: false, generalId: 'blank_wei_m' },
        { id: 'p3', name: '对角', isAI: false, generalId: 'blank_wei_m' },
        { id: 'p4', name: '队友', isAI: false, generalId: 'blank_shu_m' }
      ],
      '2v2'
    );
    // In 4-player ring, seat 0 -> seat 2 base distance = 2; Mashu makes it 1!
    expect(getDistance(engine.state, 'p1', 'p3', engine.modifiers)).toBe(1);

    const mc = engine.state.players[0];
    const p3 = engine.state.players[2];
    const slash = createCardInstance(970, 'spade', 7, 'slash');
    const dodge = createCardInstance(971, 'diamond', 2, 'dodge');
    mc.hand = [slash];
    p3.hand = [dodge];
    // Top of deck is red -> Tieqi makes Slash undodgeable!
    engine.state.drawPile.unshift(createCardInstance(972, 'heart', 8, 'peach'));

    let pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash.id, targetIds: ['p3'] }
    });
    expect(pr?.type === 'choose_option' && pr.reason === 'tieqi').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    // Skipped Dodge prompt entirely!
    expect(pr?.type).toBe('play_action');
    expect(p3.hp).toBe(3);
  });

  it('黄月英: 【集智】 draws 1 on normal trick & 【奇才】 ignores Snatch distance', () => {
    const engine = makeEngine(
      [
        { id: 'p1', name: '黄月英', isAI: false, generalId: 'std_huangyueying' },
        { id: 'p2', name: '邻座', isAI: false, generalId: 'blank_wei_m' },
        { id: 'p3', name: '远距离目标', isAI: false, generalId: 'blank_wei_m' },
        { id: 'p4', name: '队友', isAI: false, generalId: 'blank_shu_m' }
      ],
      '2v2'
    );
    const hyy = engine.state.players[0];
    const p3 = engine.state.players[2];
    expect(getDistance(engine.state, 'p1', 'p3', engine.modifiers)).toBe(2);

    const snatch = createCardInstance(975, 'spade', 3, 'snatch');
    const targetCard = createCardInstance(976, 'heart', 9, 'peach');
    hyy.hand = [snatch];
    p3.hand = [targetCard];

    // Qicai allows Snatch at distance 2!
    const playable = getAllPlayableCards(engine.state, 'p1', engine.modifiers);
    const snInfo = playable.find((i) => i.cardId === snatch.id);
    expect(snInfo?.eligibleTargetIds).toContain('p3');

    let pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: snatch.id, targetIds: ['p3'] }
    });
    // Jizhi triggers on CardUsed!
    expect(pr?.type === 'choose_option' && pr.reason === 'jizhi').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    // Now choose card to snatch from p3
    expect(pr?.type).toBe('choose_player_card');
    pr = engine.submit({ type: 'choose_player_card', choiceIndex: 0 });
    expect(hyy.hand.length).toBe(2); // 1 from Jizhi + 1 from Snatch
  });
});

describe('Phase 4A: Wu Generals (8 generals / 12 skills)', () => {
  it('孙权: 【制衡】 discards hand+equip and draws equal & 【救援】 Wu ally Peach heals +2 HP', () => {
    const engine = makeEngine(
      [
        { id: 'p1', name: '主孙权', isAI: false, generalId: 'std_sunquan', preferredRole: 'lord' },
        { id: 'p2', name: '忠甘宁', isAI: false, generalId: 'std_ganning', preferredRole: 'loyalist' },
        { id: 'p3', name: '反张飞', isAI: false, generalId: 'std_zhangfei', preferredRole: 'rebel' },
        { id: 'p4', name: '反关羽', isAI: false, generalId: 'std_guanyu', preferredRole: 'rebel' },
        { id: 'p5', name: '内吕布', isAI: false, generalId: 'std_lvbu', preferredRole: 'renegade' }
      ],
      'identity5'
    );
    const sq = engine.state.players.find((p) => p.id === 'p1')!;
    const gn = engine.state.players.find((p) => p.id === 'p2')!;
    const zf = engine.state.players.find((p) => p.id === 'p3')!;

    const h1 = createCardInstance(980, 'spade', 2, 'slash');
    const eq1 = createCardInstance(981, 'club', 1, 'zhuge_crossbow');
    sq.hand = [h1];
    sq.equips.weapon = eq1;

    // 1. Zhiheng discards 1 hand + 1 equip -> draws 2 cards
    let pr = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'zhiheng', cardIds: [h1.id, eq1.id], targetIds: [] }
    });
    expect(sq.hand.length).toBe(2);
    expect(sq.equips.weapon).toBeNull();
    // Zhiheng cannot be used a second time in same turn
    if (pr?.type === 'play_action') {
      expect(pr.usableSkillIds).not.toContain('zhiheng');
    }

    // 2. Jiuyuan: bring Sun Quan to 1 HP, let Zhangfei deal 1 dmg -> Ganning saves with 1 Peach -> heals +2 HP (0 -> 2)!
    sq.hp = 1;
    sq.hand = [];
    const gnPeach = createCardInstance(982, 'heart', 6, 'peach');
    gn.hand = [gnPeach];
    pr = advanceUntil(engine, (p) => p.type === 'play_action' && p.playerId === 'p3');
    const zfDuel = createCardInstance(983, 'spade', 1, 'duel');
    zf.hand = [zfDuel];
    pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: zfDuel.id, targetIds: ['p1'] }
    });
    // Dying prompt reaches Ganning
    pr = advanceUntil(engine, (p) => p.type === 'choose_card' && p.playerId === 'p2' && p.reason === 'peach_dying');
    pr = engine.submit({ type: 'choose_card', cardIds: [gnPeach.id] });
    expect(sq.hp).toBe(2); // 0 + 1 (base) + 1 (Jiuyuan)!
  });

  it('甘宁: 【奇袭】 uses black card as Dismantle', () => {
    const engine = makeEngine([
      { id: 'p1', name: '甘宁', isAI: false, generalId: 'std_ganning' },
      { id: 'p2', name: '目标', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const gn = engine.state.players[0];
    const p2 = engine.state.players[1];

    const blackCard = createCardInstance(985, 'spade', 6, 'slash');
    const p2Armor = createCardInstance(986, 'spade', 2, 'eight_trigrams');
    gn.hand = [blackCard];
    p2.hand = [];
    p2.equips.armor = p2Armor;

    let pr = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'qixi', cardIds: [blackCard.id], targetIds: ['p2'] }
    });
    expect(pr?.type).toBe('choose_player_card');
    pr = engine.submit({ type: 'choose_player_card', choiceIndex: 0 });
    expect(p2.equips.armor).toBeNull();
  });

  it('吕蒙: 【克己】 skips discard phase when no Slash played', () => {
    const engine = makeEngine([
      { id: 'p1', name: '吕蒙', isAI: false, generalId: 'std_lvmeng' },
      { id: 'p2', name: '对手', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const lm = engine.state.players[0];
    // Give 6 cards (> 4 HP)
    lm.hand = Array.from({ length: 6 }, (_, i) =>
      createCardInstance(990 + i, 'diamond', ((i % 13) + 1) as CardInstance['rank'], 'dodge')
    );

    let pr = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    expect(pr?.type === 'choose_option' && pr.reason === 'keji').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    // Skipped discard phase -> kept all 6 cards, now p2's turn!
    expect(lm.hand.length).toBe(6);
    expect(pr?.playerId).toBe('p2');
  });

  it('黄盖: 【苦肉】 loses 1 HP and draws 2 cards', () => {
    const engine = makeEngine([
      { id: 'p1', name: '黄盖', isAI: false, generalId: 'std_huanggai' },
      { id: 'p2', name: '对手', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const hg = engine.state.players[0];
    const startHand = hg.hand.length;

    const pr = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'kurou' }
    });
    expect(pr?.type).toBe('play_action');
    expect(hg.hp).toBe(3);
    expect(hg.hand.length).toBe(startHand + 2);
  });

  it('周瑜: 【英姿】 draws 3 cards & 【反间】 deals 1 dmg when target guesses wrong suit', () => {
    const engine = makeEngine([
      { id: 'p1', name: '周瑜', isAI: false, generalId: 'std_zhouyu' },
      { id: 'p2', name: '目标', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const zy = engine.state.players[0];
    const p2 = engine.state.players[1];
    const beforeDraw = zy.hand.length;

    let pr = engine.state.pendingPrompt;
    expect(pr?.type === 'choose_option' && pr.reason === 'yingzi').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(zy.hand.length).toBe(beforeDraw + 3);

    const heartCard = createCardInstance(1001, 'heart', 7, 'peach');
    zy.hand = [heartCard];
    pr = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'fanjian', cardIds: [], targetIds: ['p2'] }
    });
    expect(pr?.type === 'choose_option' && pr.reason === 'fanjian_suit').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'spade' }); // wrong suit!
    expect(pr?.type).toBe('choose_player_card');
    pr = engine.submit({ type: 'choose_player_card', choiceIndex: 0 });
    expect(p2.hp).toBe(3);
    expect(p2.hand.some((c) => c.id === heartCard.id)).toBe(true);
  });

  it('大乔: 【国色】 converts diamond to Indulgence (restoring original on discard) & 【流离】 redirects Slash', () => {
    const engine = makeEngine(
      [
        { id: 'p1', name: '大乔', isAI: false, generalId: 'std_daqiao' },
        { id: 'p2', name: '敌人1', isAI: false, generalId: 'blank_wei_m' },
        { id: 'p3', name: '敌人2', isAI: false, generalId: 'blank_wei_m' },
        { id: 'p4', name: '队友', isAI: false, generalId: 'blank_wu_m' }
      ],
      '2v2'
    );
    const dq = engine.state.players[0];
    const p2 = engine.state.players[1];
    const p3 = engine.state.players[2];

    const diaDodge = createCardInstance(1005, 'diamond', 8, 'dodge');
    const liuliCost = createCardInstance(1006, 'club', 4, 'slash');
    dq.hand = [diaDodge, liuliCost];

    // 1. Guose places diamond Dodge as Indulgence on p2
    let pr = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'guose', cardIds: [diaDodge.id], targetIds: ['p2'] }
    });
    expect(p2.judgeZone.length).toBe(1);
    expect(p2.judgeZone[0].asDelayedTrick).toBe('indulgence');

    // Stack Spade so p2 fails Indulgence and skips Play phase; diaDodge returns to discard WITHOUT asDelayedTrick!
    p2.hand = [];
    engine.state.drawPile.unshift(createCardInstance(1007, 'spade', 9, 'slash'));
    pr = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    // p2 skipped play phase -> moves on to p3's play phase!
    expect(pr?.type === 'play_action' && pr.playerId === 'p3').toBe(true);
    const discardedDia = engine.state.discardPile.find((c) => c.id === diaDodge.id);
    expect(discardedDia).toBeDefined();
    expect(discardedDia?.asDelayedTrick).toBeUndefined();

    // 2. Liuli: p3 (with weapon so p3 can reach Daqiao) slashes Daqiao -> Daqiao discards liuliCost & redirects to p2!
    p3.equips.weapon = createCardInstance(1008, 'spade', 5, 'blade');
    const p3Slash = createCardInstance(1009, 'spade', 7, 'slash');
    p3.hand = [p3Slash];
    p2.hand = [];
    pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: p3Slash.id, targetIds: ['p1'] }
    });
    expect(pr?.type === 'choose_option' && pr.reason === 'liuli').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    pr = engine.submit({ type: 'choose_card', cardIds: [liuliCost.id] });
    pr = engine.submit({ type: 'choose_target', targetIds: ['p2'] });
    expect(dq.hp).toBe(3); // Daqiao untouched
    expect(p2.hp).toBe(3); // p2 took the redirected Slash!
  });

  it('陆逊: 【谦逊】 blocks Snatch & Indulgence, and 【连营】 draws 1 when hand empties', () => {
    const engine = makeEngine([
      { id: 'p1', name: '陆逊', isAI: false, generalId: 'std_luxun' },
      { id: 'p2', name: '攻方', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const lx = engine.state.players[0];
    const p2 = engine.state.players[1];

    // 1. Lianying: Lu Xun has 1 card, plays it -> hand empties -> draws 1!
    const slash = createCardInstance(1010, 'spade', 7, 'slash');
    lx.hand = [slash];
    p2.hand = [];
    let pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash.id, targetIds: ['p2'] }
    });
    expect(pr?.type === 'choose_option' && pr.reason === 'lianying').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(lx.hand.length).toBe(1);

    // 2. Qianxun: on p2's turn, p2 cannot play Snatch or Indulgence targeting Lu Xun!
    pr = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    const snatch = createCardInstance(1011, 'spade', 3, 'snatch');
    const ind = createCardInstance(1012, 'heart', 6, 'indulgence');
    p2.hand = [snatch, ind];
    const playable = getAllPlayableCards(engine.state, 'p2', engine.modifiers);
    expect(playable.length).toBe(0);
  });

  it('孙尚香: 【结姻】 heals self & wounded male, 【枭姬】 draws 2 on equip lost', () => {
    const engine = makeEngine([
      { id: 'p1', name: '孙尚香', isAI: false, generalId: 'std_sunshangxiang' },
      { id: 'p2', name: '伤男', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const ssx = engine.state.players[0];
    const p2 = engine.state.players[1];

    ssx.hp = 2;
    p2.hp = 2;
    const c1 = createCardInstance(1015, 'club', 3, 'dodge');
    const c2 = createCardInstance(1016, 'club', 4, 'dodge');
    const oldWeapon = createCardInstance(1017, 'spade', 5, 'blade');
    const newWeapon = createCardInstance(1018, 'club', 1, 'zhuge_crossbow');
    ssx.hand = [c1, c2, newWeapon];
    ssx.equips.weapon = oldWeapon;

    // 1. Jieyin discards c1, c2 -> heals both +1
    let pr = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'jieyin', cardIds: [c1.id, c2.id], targetIds: ['p2'] }
    });
    expect(ssx.hp).toBe(3);
    expect(p2.hp).toBe(3);

    // 2. Equipping newWeapon replaces oldWeapon -> triggers Xiaoji -> draws 2!
    pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: newWeapon.id }
    });
    expect(pr?.type === 'choose_option' && pr.reason === 'xiaoji').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(ssx.hand.length).toBe(2);
  });
});

describe('Phase 4A: Qun Generals (5 generals / 7 skills)', () => {
  it('华佗: 【青囊】 heals 1 HP & 【急救】 uses red equip/hand as Peach outside own turn only', () => {
    const engine = makeEngine([
      { id: 'p1', name: '华佗', isAI: false, generalId: 'std_huatuo' },
      { id: 'p2', name: '攻方', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const ht = engine.state.players[0];
    const p2 = engine.state.players[1];

    // 1. Qingnang heals self 1 -> 2
    ht.hp = 1;
    const cost = createCardInstance(1020, 'spade', 2, 'slash');
    const redHorse = createCardInstance(1021, 'heart', 5, 'chitu');
    ht.hand = [cost];
    ht.equips.horseMinus = redHorse;

    let pr = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'qingnang', cardIds: [cost.id], targetIds: ['p1'] }
    });
    expect(ht.hp).toBe(2);

    // 2. End turn -> p2 deals 2 dmg (Wine+Slash) to Hua Tuo (2 -> 0 dying) -> Jijiu lets redHorse save!
    pr = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    const wine = createCardInstance(1022, 'spade', 9, 'alcohol');
    const slash = createCardInstance(1023, 'spade', 7, 'slash');
    p2.hand = [wine, slash];
    engine.submit({ type: 'play_action', action: { type: 'play_card', cardId: wine.id } });
    pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash.id, targetIds: ['p1'] }
    });
    expect(pr?.type === 'choose_card' && pr.reason === 'peach_dying').toBe(true);
    if (pr?.type === 'choose_card') {
      expect(pr.eligibleCardIds).toContain(redHorse.id);
    }
    pr = engine.submit({ type: 'choose_card', cardIds: [redHorse.id] });
    expect(ht.hp).toBe(1);
    expect(ht.equips.horseMinus).toBeNull();
  });

  it('吕布: 【无双】 requires 2 Dodges for Slash and 2 Slashes per round in Duel', () => {
    const engine = makeEngine([
      { id: 'p1', name: '吕布', isAI: false, generalId: 'std_lvbu' },
      { id: 'p2', name: '木桩', isAI: false, generalId: 'blank_wei_m' }
    ]);
    const lb = engine.state.players[0];
    const p2 = engine.state.players[1];

    const slash = createCardInstance(1025, 'spade', 7, 'slash');
    const duel = createCardInstance(1026, 'spade', 1, 'duel');
    const d1 = createCardInstance(1027, 'diamond', 2, 'dodge');
    const d2 = createCardInstance(1028, 'diamond', 3, 'dodge');
    const p2s1 = createCardInstance(1029, 'spade', 8, 'slash');
    lb.hand = [slash, duel];
    p2.hand = [d1, d2, p2s1];

    // 1. Slash requires 2 Dodges -> playing both Dodges blocks it!
    let pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: slash.id, targetIds: ['p2'] }
    });
    expect(pr?.type === 'choose_card' && pr.reason === 'dodge').toBe(true);
    pr = engine.submit({ type: 'choose_card', cardIds: [d1.id] });
    expect(pr?.type === 'choose_card' && pr.reason === 'dodge').toBe(true);
    pr = engine.submit({ type: 'choose_card', cardIds: [d2.id] });
    expect(p2.hp).toBe(4); // Both Dodges blocked it

    // 2. Duel requires 2 Slashes -> p2 only has 1 Slash, so p2 takes 1 damage after failing the 2nd Slash!
    pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: duel.id, targetIds: ['p2'] }
    });
    expect(pr?.type === 'choose_card' && pr.reason === 'slash_duel').toBe(true);
    pr = engine.submit({ type: 'choose_card', cardIds: [p2s1.id] });
    // Needs 2nd Slash, p2 has none -> automatically takes 1 dmg!
    expect(p2.hp).toBe(3);
  });

  it('貂蝉: 【离间】 forces un-nullifiable Duel between 2 males & 【闭月】 draws 1 at finish', () => {
    const engine = makeEngine(
      [
        { id: 'p1', name: '貂蝉', isAI: false, generalId: 'std_diaochan' },
        { id: 'p2', name: '男甲', isAI: false, generalId: 'blank_wei_m' },
        { id: 'p3', name: '男乙', isAI: false, generalId: 'blank_shu_m' },
        { id: 'p4', name: '队友', isAI: false, generalId: 'blank_wu_m' }
      ],
      '2v2'
    );
    const dc = engine.state.players[0];
    const p2 = engine.state.players[1];
    const p3 = engine.state.players[2];

    const cost = createCardInstance(1030, 'spade', 4, 'slash');
    const nullif = createCardInstance(1031, 'spade', 11, 'nullification');
    dc.hand = [cost];
    p2.hand = [];
    p3.hand = [nullif]; // Even holding Nullification, Lijian Duel CANNOT be nullified!

    let pr = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'lijian', cardIds: [cost.id], targetIds: ['p2', 'p3'] }
    });
    // p3 receives no Nullification prompt and no Slash -> takes 1 dmg from p2 immediately!
    expect(pr?.type).toBe('play_action');
    expect(p3.hp).toBe(3);

    // End play phase -> Finish phase triggers Biyue (+1 draw)
    pr = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    expect(pr?.type === 'choose_option' && pr.reason === 'biyue').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(dc.hand.length).toBe(1);
  });

  it('华雄: 6 HP & 【耀武】 lets red Slash attacker choose heal 1 or draw 1', () => {
    const engine = makeEngine([
      { id: 'p1', name: '攻方', isAI: false, generalId: 'blank_shu_m' },
      { id: 'p2', name: '华雄', isAI: false, generalId: 'std_huaxiong' }
    ]);
    const p1 = engine.state.players[0];
    const hx = engine.state.players[1];
    expect(hx.maxHp).toBe(6);

    p1.hp = 2; // wounded
    const redSlash = createCardInstance(1035, 'heart', 10, 'slash');
    p1.hand = [redSlash];
    hx.hand = [];

    let pr = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: redSlash.id, targetIds: ['p2'] }
    });
    expect(pr?.type === 'choose_option' && pr.reason === 'yaowu').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'heal' });
    expect(p1.hp).toBe(3);
    expect(hx.hp).toBe(5);
  });

  it('袁术: 【妄尊】 draws 1 & reduces Lord hand limit, 【同疾】 forces attackers to target Yuan Shu', () => {
    const engine = makeEngine(
      [
        { id: 'p1', name: '主白板', isAI: false, generalId: 'blank_wei_m', preferredRole: 'lord' },
        { id: 'p2', name: '忠袁术', isAI: false, generalId: 'std_yuanshu', preferredRole: 'loyalist' },
        { id: 'p3', name: '反甲', isAI: false, generalId: 'blank_shu_m', preferredRole: 'rebel' },
        { id: 'p4', name: '反乙', isAI: false, generalId: 'blank_wu_m', preferredRole: 'rebel' },
        { id: 'p5', name: '内丙', isAI: false, generalId: 'blank_qun_m', preferredRole: 'renegade' }
      ],
      'identity5'
    );
    const lord = engine.state.players.find((p) => p.id === 'p1')!;
    const ys = engine.state.players.find((p) => p.id === 'p2')!;
    const ysStartHand = ys.hand.length;

    // Lord's prepare phase -> Wangzun prompt for Yuan Shu!
    let pr = engine.state.pendingPrompt;
    expect(pr?.type === 'choose_option' && pr.reason === 'wangzun' && pr.playerId === 'p2').toBe(true);
    pr = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(ys.hand.length).toBe(ysStartHand + 1); // 5 cards > 4 HP -> Tongji is now active!

    // Because Yuan Shu (seat 1) has hand (5) > hp (4) and is in Lord's attack range (dist 1),
    // Tongji forces Lord's Slash to ONLY target Yuan Shu (not seat 4)!
    const slash = createCardInstance(1040, 'spade', 7, 'slash');
    lord.hand = [slash, ...lord.hand.slice(0, 4)];
    const playable = getAllPlayableCards(engine.state, 'p1', engine.modifiers);
    const slashInfo = playable.find((i) => i.cardId === slash.id);
    expect(slashInfo?.eligibleTargetIds).toEqual(['p2']);

    // End Lord play phase -> Lord has 5 cards, 5 HP, but Wangzun hand limit -1 => must discard 1!
    pr = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    expect(pr?.type === 'choose_card' && pr.reason === 'discard_phase' && pr.minCount === 1).toBe(true);
  });
});

describe('Phase 4A: Automated 45-Game Standard Pack AI Stress & Replay Verification', () => {
  function runFullAIGame(mode: GameConfig['mode'], seed: number) {
    const count = mode === '1v1' ? 2 : mode === '2v2' ? 4 : 5;
    const config: GameConfig = {
      mode,
      deckVariant: 'junzheng_161',
      generalPack: 'standard',
      seed,
      seats: Array.from({ length: count }, (_, i) => ({
        id: `p${i + 1}`,
        name: `AI_${i + 1}`,
        isAI: true
      }))
    };
    const engine = new GameEngine(config);
    let prompt = engine.start();
    let steps = 0;
    while (prompt && !engine.state.result && steps < 4000) {
      const resp = decideAIAction(engine, prompt.playerId);
      prompt = engine.submit(resp);
      steps += 1;
    }
    return { config, engine, steps };
  }

  it('completes 15 1v1 + 15 2v2 + 15 identity5 games with all 27 Standard Pack generals cleanly', () => {
    for (const mode of ['1v1', '2v2', 'identity5'] as const) {
      for (let i = 0; i < 15; i++) {
        const seed = 4000 + i * 31 + (mode === '2v2' ? 1000 : mode === 'identity5' ? 2000 : 0);
        const { config, engine, steps } = runFullAIGame(mode, seed);
        expect(engine.state.result, `${mode} seed=${seed} stalled at step ${steps}`).not.toBeNull();
        expect(steps).toBeLessThan(4000);

        // Verify deterministic replay on first 3 seeds of each mode
        if (i < 3) {
          const replayed = GameEngine.replay(config, engine.state.actionLog);
          expect(replayed.state.result).toEqual(engine.state.result);
          expect(replayed.state.turn).toBe(engine.state.turn);
        }
      }
    }
  });
});
