import { describe, expect, it } from 'vitest';
import {
  ALL_PLAYABLE_GENERALS,
  EXPANSION_GENERALS,
  FENG_GENERALS,
  GameEngine,
  HUO_GENERALS,
  LIN_GENERALS,
  SHAN_GENERALS,
  createCardInstance,
  decideAIAction,
  getGeneralPool,
  getHandLimit,
  hasActiveSkill,
  runAutoGame,
  type CardInstance,
  type CardName,
  type CardRank,
  type GameConfig,
  type PromptRequest,
  type Suit
} from '../src/index.js';

function mkCard(
  id: number,
  name: CardName,
  suit: Suit,
  rank: number,
  pack: 'standard' | 'ex' | 'junzheng' = 'junzheng'
): CardInstance {
  return createCardInstance(id, suit, rank as CardRank, name, pack);
}

function fillerDeck(count = 60, startId = 9000): CardInstance[] {
  const cards: CardInstance[] = [];
  for (let i = 0; i < count; i++) {
    cards.push(mkCard(startId + i, i % 2 === 0 ? 'slash' : 'dodge', i % 2 === 0 ? 'club' : 'diamond', (i % 13) + 1));
  }
  return cards;
}

function make1v1(
  p1General: string,
  p2General: string,
  deck: CardInstance[] = fillerDeck(),
  seed = 100
): GameEngine {
  return new GameEngine(
    {
      mode: '1v1',
      deckVariant: 'junzheng_161',
      generalPack: 'expansion',
      seed,
      skipGeneralSelection: true,
      seats: [
        { id: 'p1', name: 'P1', isAI: false, generalId: p1General },
        { id: 'p2', name: 'P2', isAI: false, generalId: p2General }
      ]
    },
    { deckOverride: deck }
  );
}

function make2v2(
  generals: [string, string, string, string],
  deck: CardInstance[] = fillerDeck(80),
  seed = 200
): GameEngine {
  return new GameEngine(
    {
      mode: '2v2',
      deckVariant: 'junzheng_161',
      generalPack: 'expansion',
      seed,
      skipGeneralSelection: true,
      seats: generals.map((g, i) => ({
        id: `p${i + 1}`,
        name: `P${i + 1}`,
        isAI: false,
        generalId: g
      }))
    },
    { deckOverride: deck }
  );
}

function makeIdentity5(
  generals: [string, string, string, string, string],
  deck: CardInstance[] = fillerDeck(90),
  seed = 300
): GameEngine {
  const engine = new GameEngine(
    {
      mode: 'identity5',
      deckVariant: 'junzheng_161',
      generalPack: 'expansion',
      seed,
      skipGeneralSelection: true,
      seats: generals.map((g, i) => ({
        id: `p${i + 1}`,
        name: `P${i + 1}`,
        isAI: false,
        generalId: g
      }))
    },
    { deckOverride: deck }
  );
  // Pin deterministic seat 0 = Lord so tests can predict roles cleanly!
  engine.state.players[0].role = 'lord';
  engine.state.players[0].roleRevealed = true;
  engine.state.players[1].role = 'loyalist';
  engine.state.players[2].role = 'rebel';
  engine.state.players[3].role = 'rebel';
  engine.state.players[4].role = 'renegade';
  engine.state.activePlayerIndex = 0;
  return engine;
}

function advanceToPlayPhase(
  engine: GameEngine,
  playerId: string,
  customOptionHandler?: (p: PromptRequest) => boolean
): PromptRequest | null {
  let prompt = engine.state.pendingPrompt ?? engine.start();
  let guard = 0;
  while (prompt && !engine.state.result && guard < 120) {
    guard++;
    if (prompt.type === 'play_action' && prompt.playerId === playerId) {
      return prompt;
    }
    if (customOptionHandler && customOptionHandler(prompt)) {
      prompt = engine.state.pendingPrompt;
      continue;
    }
    if (prompt.type === 'choose_option') {
      const noOpt = prompt.options.find((o) => o.id === 'no' || o.id === 'keep' || o.id === 'trust');
      prompt = engine.submit({
        type: 'choose_option',
        optionId: noOpt ? noOpt.id : prompt.options[0].id
      });
    } else if (prompt.type === 'play_action') {
      prompt = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    } else if (prompt.type === 'choose_card') {
      if (prompt.optional) {
        prompt = engine.submit({ type: 'choose_card', cardIds: [], cancelled: true });
      } else {
        prompt = engine.submit({
          type: 'choose_card',
          cardIds: prompt.eligibleCardIds.slice(0, prompt.minCount)
        });
      }
    } else if (prompt.type === 'choose_target') {
      if (prompt.optional) {
        prompt = engine.submit({ type: 'choose_target', targetIds: [], cancelled: true });
      } else {
        prompt = engine.submit({
          type: 'choose_target',
          targetIds: prompt.eligibleTargetIds.slice(0, prompt.minCount)
        });
      }
    } else if (prompt.type === 'choose_player_card') {
      prompt = engine.submit({ type: 'choose_player_card', choiceIndex: 0 });
    } else if (prompt.type === 'choose_guanxing') {
      prompt = engine.submit({
        type: 'choose_guanxing',
        topCardIds: prompt.cards.map((c) => c.id),
        bottomCardIds: []
      });
    } else if (prompt.type === 'choose_harvest_card') {
      const avail = prompt.pool.find((x) => !x.takenBy);
      prompt = engine.submit({ type: 'choose_harvest_card', cardId: avail!.card.id });
    } else {
      break;
    }
  }
  return prompt;
}

describe('Phase 4C: Wind/Fire/Forest/Mountain Roster (32 OL Generals → 89 Total)', () => {
  it('contains exact 32 expansion generals (Wind 8, Fire 8, Forest 8, Mountain 8) and 89 total playable OL generals', () => {
    expect(FENG_GENERALS.length).toBe(8);
    expect(HUO_GENERALS.length).toBe(8);
    expect(LIN_GENERALS.length).toBe(8);
    expect(SHAN_GENERALS.length).toBe(8);
    expect(EXPANSION_GENERALS.length).toBe(32);
    expect(getGeneralPool('expansion').length).toBe(32);
    expect(ALL_PLAYABLE_GENERALS.length).toBe(89);
    expect(getGeneralPool('all').length).toBe(89);

    const uniqueIds = new Set(ALL_PLAYABLE_GENERALS.map((g) => g.id));
    expect(uniqueIds.size).toBe(89);
  });
});

describe('Phase 4C: Wind Pack (风包 8将)', () => {
  it('1. 夏侯渊【神速1】：跳过判定与摸牌阶段，视为对任意目标使用无距离限制【杀】', () => {
    const engine = make1v1('exp_xiahouyuan', 'blank_wei_m');
    let prompt = engine.start();
    // P2 has no Dodge
    engine.getPlayer('p2').hand = [mkCard(501, 'slash', 'spade', 5)];
    expect(prompt?.type).toBe('choose_option');
    if (prompt?.type === 'choose_option') {
      expect(prompt.reason).toBe('shensu_judge');
      prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    }
    expect(prompt?.type).toBe('choose_target');
    prompt = engine.submit({ type: 'choose_target', targetIds: ['p2'] });
    expect(engine.getPlayer('p2').hp).toBe(3);
  });

  it('2. 曹仁【据守】&【解围】：结束阶段翻面摸4牌并直接装备，翻回正面触发解围移动场上牌，且装备可当无懈', () => {
    const deck = [
      // P1 hand (4), P2 hand (4), P1 draw (2), then 4 jushou draw cards (includes armor!)
      ...fillerDeck(10, 1000),
      mkCard(101, 'renwang_shield', 'club', 2),
      mkCard(102, 'slash', 'spade', 3),
      mkCard(103, 'dodge', 'heart', 4),
      mkCard(104, 'peach', 'heart', 5),
      ...fillerDeck(20, 1100)
    ];
    const engine = make1v1('exp_caoren', 'blank_shu_m', deck);
    let prompt = advanceToPlayPhase(engine, 'p1');
    // Put an armor on P2 so 解围 has a field card to move later
    engine.getPlayer('p2').equips.weapon = mkCard(201, 'qinggang_sword', 'spade', 6);
    // End play phase -> discard -> finish -> 据守!
    prompt = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    while (prompt && !(prompt.type === 'choose_option' && prompt.reason === 'jushou')) {
      if (prompt.type === 'choose_card') {
        prompt = engine.submit({
          type: 'choose_card',
          cardIds: prompt.eligibleCardIds.slice(0, prompt.minCount)
        });
      } else break;
    }
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('jushou');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(engine.getPlayer('p1').flipped).toBe(true);
    // Choose the renwang_shield (101) to equip directly!
    expect(prompt?.type).toBe('choose_card');
    prompt = engine.submit({ type: 'choose_card', cardIds: [101] });
    expect(engine.getPlayer('p1').equips.armor?.id).toBe(101);

    // During P2's turn, P2 plays Dismantle on P1 -> P1 can use equip (101) as Nullification!
    prompt = advanceToPlayPhase(engine, 'p2');
    const dism = mkCard(202, 'dismantle', 'spade', 3);
    engine.getPlayer('p2').hand.push(dism);
    // Refresh prompt by passing P2's turn -> P1 flips face up -> triggers 解围!
    prompt = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    while (prompt && !(prompt.type === 'choose_option' && prompt.reason === 'jiewei')) {
      if (prompt.type === 'choose_card') {
        prompt = engine.submit({
          type: 'choose_card',
          cardIds: prompt.eligibleCardIds.slice(0, prompt.minCount)
        });
      } else break;
    }
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('jiewei');
    expect(engine.getPlayer('p1').flipped).toBe(false);
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    // Discard 1 card
    if (prompt?.type === 'choose_card') {
      prompt = engine.submit({ type: 'choose_card', cardIds: [prompt.eligibleCardIds[0]] });
    }
    // Move field source: p2 -> qinggang_sword moves to p1!
    if (prompt?.type === 'choose_target' && prompt.reason === 'move_field_source') {
      prompt = engine.submit({ type: 'choose_target', targetIds: ['p2'] });
    }
    expect(engine.getPlayer('p1').equips.weapon?.id).toBe(201);
    expect(engine.getPlayer('p2').equips.weapon).toBeNull();
  });

  it('3. 黄忠【烈弓】：目标手牌数 >= 自身体力值时【杀】不可被【闪】响应', () => {
    const engine = make1v1('exp_huangzhong', 'blank_wei_m');
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    p1.hp = 3;
    const slash = mkCard(301, 'slash', 'heart', 7);
    p1.hand = [slash];
    p2.hand = [
      mkCard(302, 'dodge', 'diamond', 2),
      mkCard(303, 'dodge', 'diamond', 3),
      mkCard(304, 'dodge', 'diamond', 4)
    ]; // 3 >= 3!
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 301, targetIds: ['p2'] }
    });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('liegong');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    // P2 was NOT asked for Dodge and took 1 damage!
    expect(p2.hp).toBe(3);
    expect(p2.hand.length).toBe(3);
  });

  it('4. 魏延【狂骨】&【奇谋】：奇谋失血加出杀次数与距离减免，狂骨距离<=1造成伤害回血', () => {
    const engine = make1v1('exp_weiyan', 'blank_wei_m');
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    p1.hand = [mkCard(401, 'slash', 'spade', 8), mkCard(402, 'slash', 'club', 9)];
    p2.hand = [];

    // Activate 奇谋 (lose 1 HP -> slashLimit +1)
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'qimou' }
    });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('qimou');
    prompt = engine.submit({ type: 'choose_option', optionId: '1' });
    expect(p1.hp).toBe(3);

    // First Slash hits -> 狂骨 heals 1 HP back to 4!
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 401, targetIds: ['p2'] }
    });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('kuanggu');
    prompt = engine.submit({ type: 'choose_option', optionId: 'heal' });
    expect(p1.hp).toBe(4);
    expect(p2.hp).toBe(3);

    // Second Slash is ALSO playable because 奇谋 gave +1 Slash limit!
    expect(prompt?.type).toBe('play_action');
    if (prompt?.type === 'play_action') {
      expect(prompt.playableCardIds).toContain(402);
    }
  });

  it('5. 小乔【红颜】&【天香】：黑桃闪电判定视为红桃天过；天香转移伤害令目标摸已损体力张牌', () => {
    const deck = [
      ...fillerDeck(8, 1200),
      mkCard(501, 'slash', 'spade', 5), // Judge card for Lightning = Spade 5 -> 红颜 turns it into Heart 5!
      ...fillerDeck(20, 1250)
    ];
    const engine = make1v1('exp_xiaoqiao', 'blank_wei_m', deck);
    // Start runs setup & draw, then before P1's judge phase place Lightning in P1 judgeZone
    engine.start();
    // Wait: start already ran up to P1 play phase because judgeZone was empty. Test Lightning on turn 2!
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    p1.judgeZone.push(mkCard(502, 'lightning', 'spade', 1));
    // Put spade 5 right on top of drawPile!
    engine.state.drawPile.unshift(mkCard(503, 'slash', 'spade', 5));

    // Also test 天香 during P2's turn!
    let prompt = advanceToPlayPhase(engine, 'p2');
    p1.hand = [mkCard(504, 'slash', 'spade', 9)]; // 红颜 turns Spade 9 into Heart 9 -> valid for 天香!
    p2.hand = [mkCard(505, 'slash', 'heart', 7)];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 505, targetIds: ['p1'] }
    });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('tianxiang');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(prompt?.type).toBe('choose_card');
    prompt = engine.submit({ type: 'choose_card', cardIds: [504] });
    expect(prompt?.type === 'choose_target' && prompt.reason).toBe('tianxiang_target');
    prompt = engine.submit({ type: 'choose_target', targetIds: ['p2'] });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('tianxiang_mode');
    prompt = engine.submit({ type: 'choose_option', optionId: 'damage_draw' });
    // P1 prevented damage (hp=3), P2 took 1 dmg (hp=3) & drew 1 card!
    expect(p1.hp).toBe(3);
    expect(p2.hp).toBe(3);
    expect(p2.hand.length).toBe(1);

    // Advance to P1's turn -> Lightning judges Spade 5 -> 红颜 turns it into Heart 5 -> NO damage!
    engine.state.drawPile.unshift(mkCard(506, 'slash', 'spade', 5));
    prompt = advanceToPlayPhase(engine, 'p1');
    expect(p1.hp).toBe(3);
  });

  it('6. 周泰【不屈】&【奋激】：濒死置“创”回至1血且手牌上限等于创数；队友手牌被拆时奋激摸2牌', () => {
    const engine = make2v2(['blank_wei_m', 'exp_zhoutai', 'blank_shu_m', 'blank_wu_m']);
    let prompt = advanceToPlayPhase(engine, 'p1');
    // P1 (team A) dismantles P4's (team B, Zhou Tai's ally!) hand -> Zhou Tai (P2, team B) activates 奋激!
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2'); // Zhou Tai
    const p4 = engine.getPlayer('p4'); // Zhou Tai's teammate
    const dism = mkCard(601, 'dismantle', 'spade', 3);
    p1.hand = [dism, mkCard(602, 'slash', 'spade', 7)];
    p4.hand = [mkCard(603, 'dodge', 'heart', 2)];
    p2.hand = [];

    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 601, targetIds: ['p4'] }
    });
    expect(prompt?.type).toBe('choose_player_card');
    prompt = engine.submit({ type: 'choose_player_card', choiceIndex: 0 });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('fenji');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(p2.hp).toBe(3);
    expect(p4.hand.length).toBe(2);

    // Now drop Zhou Tai to 1 HP and hit him with Slash -> 不屈 puts 1 card as "创" and restores HP to 1!
    p2.hp = 1;
    p2.hand = [];
    engine.state.drawPile.unshift(mkCard(610, 'peach', 'heart', 12));
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 602, targetIds: ['p2'] }
    });
    expect(p2.alive).toBe(true);
    expect(p2.hp).toBe(1);
    expect(p2.removedCards['buqu']?.length).toBe(1);
    expect(getHandLimit(engine.state, p2, engine.modifiers)).toBe(1);
  });

  it('7. 张角【雷击】【鬼道】【黄天】：打闪雷击+黑牌鬼道改黑桃造成2点雷电伤害；群势力队友黄天给闪', () => {
    const engine = makeIdentity5([
      'exp_zhangjiao', // P1 Lord (Qun)
      'blank_qun_m',   // P2 Loyalist (Qun)
      'blank_wei_m',   // P3 Rebel
      'blank_shu_m',
      'blank_wu_m'
    ]);
    let prompt = advanceToPlayPhase(engine, 'p2');
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    const p3 = engine.getPlayer('p3');

    // P2 (Qun ally) uses 黄天给牌 (huangtian_give) to hand a Dodge to Lord Zhang Jiao!
    const dodgeCard = mkCard(701, 'dodge', 'diamond', 2);
    p2.hand = [dodgeCard];
    const p1Prev = p1.hand.length;
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'huangtian_give', cardIds: [701], targetIds: ['p1'] }
    });
    expect(p1.hand.length).toBe(p1Prev + 1);

    // Advance to P3's turn -> equip P3 with weapon so P3 reaches P1 (dist 2 in 5-player) -> P3 Slashes P1!
    prompt = advanceToPlayPhase(engine, 'p3');
    p3.equips.weapon = mkCard(705, 'blade', 'spade', 5);
    const p3Slash = mkCard(702, 'slash', 'heart', 9);
    p3.hand = [p3Slash];
    const p1Spade = mkCard(703, 'slash', 'spade', 10);
    p1.hand = [dodgeCard, p1Spade];
    engine.state.drawPile.unshift(mkCard(704, 'peach', 'heart', 6)); // Original judge = Heart

    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 702, targetIds: ['p1'] }
    });
    expect(prompt?.type === 'choose_card' && prompt.reason).toBe('dodge');
    prompt = engine.submit({ type: 'choose_card', cardIds: [701] });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('leiji');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(prompt?.type === 'choose_target' && prompt.reason).toBe('leiji_target');
    prompt = engine.submit({ type: 'choose_target', targetIds: ['p3'] });
    // 鬼道 replaces Heart 6 with Spade 10!
    expect(prompt?.type).toBe('choose_card');
    prompt = engine.submit({ type: 'choose_card', cardIds: [703] });
    expect(p3.hp).toBe(2); // 4 - 2 thunder dmg!
    expect(p1.hand.some((c) => c.id === 704)).toBe(true); // Zhang Jiao gained original judge card!
  });

  it('8. 于吉【蛊惑】&【缠怨】：假蛊惑被质疑作废且质疑者摸1；真蛊惑被质疑则质疑者获缠怨（1血封技能）', () => {
    const engine = make1v1('exp_yuji', 'std_caocao');
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');

    // Case A: Fake Ex Nihilo (real card is Slash) -> P2 doubts -> P2 draws 1, Ex Nihilo voided!
    const fakeCard = mkCard(801, 'slash', 'spade', 4);
    p1.hand = [fakeCard];
    p2.hand = [];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'guhuo', cardIds: [801] }
    });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('guhuo_declare');
    prompt = engine.submit({ type: 'choose_option', optionId: 'ex_nihilo' });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('guhuo_question');
    prompt = engine.submit({ type: 'choose_option', optionId: 'doubt' });
    expect(p2.hand.length).toBe(1); // Doubter drew 1!
    expect(p1.hand.length).toBe(0); // Voided!

    // Case B: Next turn, Real Peach -> P2 doubts -> fails, P2 gains 缠怨, P1 heals!
    delete p1.marks['guhuo_used'];
    p1.hp = 2;
    const realPeach = mkCard(802, 'peach', 'heart', 8);
    p1.hand = [realPeach];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'guhuo', cardIds: [802] }
    });
    prompt = engine.submit({ type: 'choose_option', optionId: 'peach' });
    prompt = engine.submit({ type: 'choose_option', optionId: 'doubt' });
    expect(p1.hp).toBe(3); // Real Peach worked!
    expect(p2.skills).toContain('chanyuan');
    // At HP > 1, Cao Cao's 奸雄 is still active; at HP === 1, 缠怨 disables 奸雄!
    expect(hasActiveSkill(p2, 'jianxiong')).toBe(true);
    p2.hp = 1;
    expect(hasActiveSkill(p2, 'jianxiong')).toBe(false);
  });
});

describe('Phase 4C: Fire Pack (火包 8将)', () => {
  it('9. 典韦【强袭】：出牌阶段限2次对不同目标弃武器或自损1血造成1点伤害', () => {
    const engine = make2v2(['exp_dianwei', 'blank_wei_m', 'blank_shu_m', 'blank_wu_m']);
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    const p4 = engine.getPlayer('p4');
    const weapon = mkCard(901, 'qinggang_sword', 'spade', 6);
    p1.hand = [weapon];

    // 1st 强袭: discard weapon to hit P2
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'qiangxi', cardIds: [901], targetIds: ['p2'] }
    });
    expect(p2.hp).toBe(3);
    expect(p1.hp).toBe(4);

    // 2nd 强袭: lose 1 HP to hit P4 (distinct target, P2 is no longer eligible!)
    if (prompt?.type === 'play_action') {
      const qx = prompt.usableSkills.find((s) => s.skillId === 'qiangxi');
      expect(qx?.eligibleTargetIds).not.toContain('p2');
      expect(qx?.eligibleTargetIds).toContain('p4');
    }
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'qiangxi', cardIds: [], targetIds: ['p4'] }
    });
    expect(p1.hp).toBe(3);
    expect(p4.hp).toBe(3);
  });

  it('10. 荀彧【驱虎】&【节命】：拼点赢令目标对其攻击范围内角色造成伤害；受伤节命补牌至体力上限', () => {
    const engine = make2v2(['exp_xunyu', 'blank_wei_m', 'blank_shu_m', 'blank_wu_m']);
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1'); // Xun Yu (3 HP)
    const p2 = engine.getPlayer('p2'); // 4 HP (> 3)
    const p3 = engine.getPlayer('p3'); // Within P2's range (dist 1)
    p1.hand = [mkCard(1001, 'slash', 'spade', 13)]; // K
    p2.hand = [mkCard(1002, 'slash', 'club', 2)];   // 2

    // 驱虎 win!
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'quhu', targetIds: ['p2'] }
    });
    prompt = engine.submit({ type: 'choose_card', cardIds: [1001] });
    prompt = engine.submit({ type: 'choose_card', cardIds: [1002] });
    expect(prompt?.type === 'choose_target' && prompt.reason).toBe('quhu_victim');
    prompt = engine.submit({ type: 'choose_target', targetIds: ['p3'] });
    expect(p3.hp).toBe(3);

    // Now test 节命 when Xun Yu takes damage!
    prompt = advanceToPlayPhase(engine, 'p2');
    p3.hand = [];
    p2.hand = [mkCard(1003, 'slash', 'heart', 7)];
    p1.hand = [];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 1003, targetIds: ['p1'] }
    });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('jieming');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(prompt?.type === 'choose_target' && prompt.reason).toBe('jieming_target');
    prompt = engine.submit({ type: 'choose_target', targetIds: ['p3'] });
    expect(p3.hand.length).toBe(4); // Filled to P3's maxHp (4)!
  });

  it('11. 卧龙诸葛亮【八阵】【火计】【看破】：无防具触发八卦阵、红牌当火攻、黑牌当无懈', () => {
    const engine = make1v1('exp_wolong', 'blank_wei_m');
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');

    // 火计: red card -> Fire Attack! (use diamond card for matching so 看破 black-nullification isn't prompted on self!)
    p1.hand = [mkCard(1101, 'slash', 'heart', 5), mkCard(1102, 'dodge', 'diamond', 6)];
    p2.hand = [mkCard(1103, 'slash', 'diamond', 9)];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'huoji', cardIds: [1101], targetIds: ['p2'] }
    });
    prompt = engine.submit({ type: 'choose_card', cardIds: [1103] }); // P2 shows diamond
    prompt = engine.submit({ type: 'choose_card', cardIds: [1102] }); // P1 discards diamond
    expect(p2.hp).toBe(3);

    // P2 turn: P2 Slashes P1 -> 【八阵】 virtual Eight Trigrams (red judge dodges!), and P2 plays Dismantle -> 【看破】 black hand card as Nullification!
    prompt = advanceToPlayPhase(engine, 'p2');
    p1.equips.armor = null;
    p1.hand = [mkCard(1104, 'slash', 'spade', 4)];
    p2.hand = [mkCard(1105, 'slash', 'club', 7), mkCard(1106, 'dismantle', 'spade', 3)];
    engine.state.drawPile.unshift(mkCard(1107, 'peach', 'heart', 8)); // Red judge for 八阵!

    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 1105, targetIds: ['p1'] }
    });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('eight_trigrams');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(p1.hp).toBe(3); // Dodged via 八阵!

    // Now P2 plays Dismantle -> P1 uses Spade 4 via 看破 as Nullification!
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 1106, targetIds: ['p1'] }
    });
    expect(prompt?.type === 'choose_card' && prompt.reason).toBe('nullification');
    if (prompt?.type === 'choose_card') {
      expect(prompt.eligibleCardIds).toContain(1104);
      prompt = engine.submit({ type: 'choose_card', cardIds: [1104] });
    }
    expect(p1.hand.length).toBe(0); // Used as Nullification cleanly
  });

  it('12. 庞统【连环】&【涅槃】：梅花手牌当铁索连环；濒死发动涅槃复活至3血摸3牌', () => {
    const engine = make1v1('exp_pangtong', 'blank_wei_m');
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    p1.hand = [mkCard(1201, 'slash', 'club', 5)];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'lianhuan', cardIds: [1201], targetIds: ['p1', 'p2'] }
    });
    expect(p1.chained).toBe(true);
    expect(p2.chained).toBe(true);

    // P2 kills Pang Tong -> 涅槃 triggers!
    prompt = advanceToPlayPhase(engine, 'p2');
    p1.hp = 1;
    p1.flipped = true;
    p1.hand = [];
    p2.hand = [mkCard(1202, 'slash', 'spade', 9)];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 1202, targetIds: ['p1'] }
    });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('niepan');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(p1.alive).toBe(true);
    expect(p1.hp).toBe(3);
    expect(p1.hand.length).toBe(3);
    expect(p1.chained).toBe(false);
    expect(p1.flipped).toBe(false);
  });

  it('13. 太史慈【天义】：拼点赢获出杀+1/无距离/目标+1，拼点输本回合不能使用【杀】', () => {
    const engine = make2v2(['exp_taishici', 'blank_wei_m', 'blank_shu_m', 'blank_wu_m']);
    advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    p1.hand = [
      mkCard(1301, 'slash', 'spade', 13), // K wins pindian
      mkCard(1302, 'slash', 'heart', 8),
      mkCard(1303, 'slash', 'club', 9)
    ];
    p2.hand = [mkCard(1304, 'slash', 'diamond', 3)];
    engine.getPlayer('p3').hand = [];

    engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'tianyi', targetIds: ['p2'] }
    });
    engine.submit({ type: 'choose_card', cardIds: [1301] });
    engine.submit({ type: 'choose_card', cardIds: [1304] });
    // Now Slash 1302 can target 2 players (including dist-2 P3)!
    const info = engine.getPlayableCards('p1').find((i) => i.cardId === 1302);
    expect(info?.maxTargets).toBe(2);
    expect(info?.eligibleTargetIds).toContain('p3');

    // Second engine: lose pindian -> cannotUseSlashThisTurn!
    const engine2 = make1v1('exp_taishici', 'blank_wei_m');
    let p = advanceToPlayPhase(engine2, 'p1');
    engine2.getPlayer('p1').hand = [mkCard(1311, 'slash', 'club', 2), mkCard(1312, 'slash', 'heart', 5)];
    engine2.getPlayer('p2').hand = [mkCard(1313, 'slash', 'spade', 13)];
    p = engine2.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'tianyi', targetIds: ['p2'] }
    });
    p = engine2.submit({ type: 'choose_card', cardIds: [1311] });
    p = engine2.submit({ type: 'choose_card', cardIds: [1313] });
    expect(engine2.getPlayer('p1').cannotUseSlashThisTurn).toBe(true);
    expect(engine2.getPlayableCards('p1').some((i) => i.cardId === 1312)).toBe(false);
    void p;
  });

  it('14. 袁绍【乱击】&【血裔】：同花色两牌当万箭齐发；主公技每名其他群角色手牌上限+2', () => {
    const engine = makeIdentity5([
      'exp_yuanshao',
      'blank_qun_m',
      'blank_qun_m',
      'blank_wei_m',
      'blank_shu_m'
    ]);
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    // Lord HP=5 + 2 other Qun * 2 = 9 hand limit!
    expect(getHandLimit(engine.state, p1, engine.modifiers)).toBe(9);

    p1.hand = [mkCard(1401, 'slash', 'spade', 5), mkCard(1402, 'dodge', 'spade', 9)];
    engine.getPlayer('p2').hand = [];
    engine.getPlayer('p3').hand = [];
    engine.getPlayer('p4').hand = [];
    engine.getPlayer('p5').hand = [];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'luanji', cardIds: [1401, 1402] }
    });
    expect(engine.getPlayer('p2').hp).toBe(3);
    expect(engine.getPlayer('p3').hp).toBe(3);
    void prompt;
  });

  it('15. 颜良&文丑【双雄】：摸牌阶段判定获得判定牌，不同颜色手牌可当【决斗】使用', () => {
    const deck = [
      ...fillerDeck(8, 1500),
      mkCard(1501, 'peach', 'heart', 6), // Judge = Red -> Black cards become Duel!
      ...fillerDeck(20, 1550)
    ];
    const engine = make1v1('exp_yanliangwenchou', 'blank_wei_m', deck);
    let prompt = engine.start();
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('shuangxiong');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    expect(p1.hand.some((c) => c.id === 1501)).toBe(true);
    const blackCard = mkCard(1502, 'dodge', 'spade', 8);
    p1.hand.push(blackCard);
    p2.hand = [];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'shuangxiong', cardIds: [1502], targetIds: ['p2'] }
    });
    expect(p2.hp).toBe(3);
    void prompt;
  });

  it('16. 庞德【马术】&【鞬出】：距离-1；出杀弃置目标装备牌令此【杀】不可闪避', () => {
    const engine = make1v1('exp_pangde', 'blank_wei_m');
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    p2.equips.armor = mkCard(1601, 'eight_trigrams', 'spade', 2);
    p2.hand = [mkCard(1602, 'dodge', 'heart', 2)];
    p1.hand = [mkCard(1603, 'slash', 'heart', 9)];

    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 1603, targetIds: ['p2'] }
    });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('jianchu');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    // Discard the armor (choiceIndex for armor)
    if (prompt?.type === 'choose_player_card') {
      const armorIdx = prompt.choices.findIndex((c) => c.zone === 'armor');
      prompt = engine.submit({ type: 'choose_player_card', choiceIndex: armorIdx });
    }
    expect(p2.equips.armor).toBeNull();
    expect(p2.hp).toBe(3); // Undodgeable!
    expect(p2.hand.length).toBe(1); // Dodge wasn't even asked!
  });
});

describe('Phase 4C: Forest Pack (林包 8将)', () => {
  it('17. 徐晃【断粮】&【截辎】：黑基本/装备当兵粮寸断（手牌<=目标无距离限制），目标跳过摸牌时截辎摸1牌', () => {
    const engine = make2v2(['exp_xuhuang', 'blank_wei_m', 'blank_shu_m', 'blank_wu_m']);
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    p1.hand = [mkCard(1701, 'slash', 'club', 5)]; // 1 card <= P3's 4 cards -> unlimited distance!
    const dl = engine.skills
      .getAllActiveInfos(engine.state, p1, engine.modifiers)
      .find((s) => s.skillId === 'duanliang');
    expect(dl?.eligibleTargetIds).toContain('p3');

    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'duanliang', cardIds: [1701], targetIds: ['p2'] }
    });
    expect(engine.getPlayer('p2').judgeZone.length).toBe(1);

    // Put non-club on top of drawPile so P2 fails Supply Shortage -> skips draw -> Xu Huang 【截辎】 draws 1!
    const p1HandBefore = p1.hand.length;
    engine.state.drawPile.unshift(mkCard(1702, 'peach', 'heart', 3));
    prompt = advanceToPlayPhase(engine, 'p2');
    expect(p1.hand.length).toBe(p1HandBefore + 1);
    void prompt;
  });

  it('18. 曹丕【行殇】【放逐】【颂威】：受伤放逐翻面摸牌；阵亡行殇全收；魏队友黑判定颂威摸1', () => {
    const engine = makeIdentity5([
      'exp_caopi',   // P1 Lord (Wei)
      'blank_wei_m', // P2 Wei
      'blank_shu_m', // P3
      'blank_wu_m',
      'blank_qun_m'
    ]);
    // Put Lightning on P2 with Spade 11 (black, safe) -> 颂威 triggers!
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    const p3 = engine.getPlayer('p3');
    p1.hand = [mkCard(1800, 'slash', 'heart', 3)]; // Keep <= handLimit so no discard phase!
    p2.judgeZone.push(mkCard(1801, 'lightning', 'spade', 1));
    engine.state.drawPile.unshift(mkCard(1802, 'slash', 'spade', 11));
    const p1HandBefore = p1.hand.length;
    prompt = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('songwei');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(p1.hand.length).toBe(p1HandBefore + 1);

    // Now P2 Slashes P1 -> P1 activates 放逐 on P3 -> P3 flips & draws lost HP (1)!
    prompt = advanceToPlayPhase(engine, 'p2');
    p1.hand = [];
    p2.hand = [mkCard(1803, 'slash', 'heart', 6)];
    const p3Prev = p3.hand.length;
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 1803, targetIds: ['p1'] }
    });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('fangzhu');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    prompt = engine.submit({ type: 'choose_target', targetIds: ['p3'] });
    expect(p3.flipped).toBe(true);
    expect(p3.hand.length).toBe(p3Prev + 1);

    // Now P2 kills P3 (1 HP, holding 2 cards + 1 equip) -> 曹丕【行殇】 loots all 3!
    p3.hp = 1;
    p3.hand = [mkCard(1804, 'peach', 'heart', 4), mkCard(1805, 'dodge', 'diamond', 5)];
    p3.equips.weapon = mkCard(1806, 'blade', 'spade', 5);
    p2.hand = [mkCard(1807, 'duel', 'spade', 1)];
    p1.hand = [];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 1807, targetIds: ['p3'] }
    });
    if (prompt?.type === 'choose_card' && prompt.reason === 'peach_dying') {
      prompt = engine.submit({ type: 'choose_card', cardIds: [], cancelled: true });
    }
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('xingshang');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(p1.hand.map((c) => c.id)).toEqual(expect.arrayContaining([1804, 1805, 1806]));
  });

  it('19. 孟获【祸首】&【再起】 + 20. 祝融【巨象】&【烈刃】：免疫南蛮、祸首转来源、巨象收南蛮、再起回血、烈刃拼点夺牌', () => {
    const engine = make2v2(['blank_wei_m', 'exp_menghuo', 'exp_zhurong', 'blank_wu_m']);
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2'); // Meng Huo
    const p3 = engine.getPlayer('p3'); // Zhu Rong
    const p4 = engine.getPlayer('p4');

    const sa = mkCard(1901, 'savage_assault', 'spade', 7);
    p1.hand = [sa];
    p2.hand = [];
    p3.hand = [];
    p4.hand = [];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 1901 }
    });
    expect(p2.hp).toBe(4);
    expect(p3.hp).toBe(4);
    expect(p4.hp).toBe(3);
    expect(p2.stats.damageDealt).toBe(1); // 祸首!
    expect(p3.hand.some((c) => c.id === 1901)).toBe(true); // 巨象!

    // Meng Huo turn with 2 lost HP -> 再起 reveals 1 + 2 = 3 cards (2 hearts + 1 club -> heal 2, gain 1)!
    p2.hp = 2;
    engine.state.drawPile.unshift(
      mkCard(1910, 'peach', 'heart', 3),
      mkCard(1911, 'dodge', 'heart', 4),
      mkCard(1912, 'slash', 'club', 5)
    );
    prompt = advanceToPlayPhase(engine, 'p2', (pr) => {
      if (pr.type === 'choose_option' && pr.reason === 'zaiqi') {
        engine.submit({ type: 'choose_option', optionId: 'yes' });
        return true;
      }
      return false;
    });
    expect(p2.hp).toBe(4); // Healed 2!
    expect(p2.hand.some((c) => c.id === 1912)).toBe(true);

    // Zhu Rong turn -> Slash P4 -> 烈刃 wins pindian and snatches a card!
    prompt = advanceToPlayPhase(engine, 'p3');
    p3.hand = [mkCard(1920, 'slash', 'heart', 8), mkCard(1921, 'slash', 'spade', 13)];
    p4.hand = [mkCard(1922, 'slash', 'club', 2), mkCard(1923, 'peach', 'heart', 6)];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 1920, targetIds: ['p4'] }
    });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('lieren');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    prompt = engine.submit({ type: 'choose_card', cardIds: [1921] });
    prompt = engine.submit({ type: 'choose_card', cardIds: [1922] });
    expect(prompt?.type).toBe('choose_player_card');
    prompt = engine.submit({ type: 'choose_player_card', choiceIndex: 0 });
    expect(p3.hand.some((c) => c.id === 1923)).toBe(true);
  });

  it('21. 孙坚【英魂】：准备阶段已受伤，令目标摸1弃X或摸X弃1', () => {
    const engine = make1v1('exp_sunjian', 'blank_wei_m');
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    p1.hp = 2; // lost 2 HP
    prompt = advanceToPlayPhase(engine, 'p2');
    // Set P2 hand right before ending P2's play phase so draw phase already happened!
    p2.hand = [mkCard(2101, 'slash', 'spade', 4), mkCard(2102, 'dodge', 'heart', 5)];
    prompt = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    // Now P1 prepare phase -> 英魂!
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('yinghun');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    prompt = engine.submit({ type: 'choose_target', targetIds: ['p2'] });
    prompt = engine.submit({ type: 'choose_option', optionId: 'discard_x' }); // Draw 1, discard 2!
    expect(prompt?.type).toBe('choose_card');
    if (prompt?.type === 'choose_card') {
      expect(prompt.minCount).toBe(2);
      prompt = engine.submit({
        type: 'choose_card',
        cardIds: prompt.eligibleCardIds.slice(0, 2)
      });
    }
    expect(p2.hand.length).toBe(1); // 2 + 1 - 2 = 1!
  });

  it('22. 鲁肃【好施】&【缔盟】：好施额外摸2张（超5张给出一半）；缔盟交换两名角色手牌', () => {
    const engine = make2v2(['exp_lusu', 'blank_wei_m', 'blank_shu_m', 'blank_wu_m']);
    let prompt = engine.start();
    // 2v2 seat 0 first turn draws 1 + 好施 2 = 3 -> 4 + 3 = 7 > 5 -> must give floor(7/2) = 3 cards to min-hand player!
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('haoshi');
    const p2 = engine.getPlayer('p2');
    const p3 = engine.getPlayer('p3');
    p2.hand = [mkCard(2201, 'slash', 'spade', 3)]; // Min hand (1)
    p3.hand = [
      mkCard(2202, 'slash', 'heart', 4),
      mkCard(2203, 'dodge', 'club', 5)
    ]; // 2 cards
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(prompt?.type).toBe('choose_card');
    if (prompt?.type === 'choose_card') {
      expect(prompt.minCount).toBe(3);
      prompt = engine.submit({
        type: 'choose_card',
        cardIds: prompt.eligibleCardIds.slice(0, 3)
      });
    }
    expect(p2.hand.length).toBe(4); // 1 + 3!

    // Now 缔盟 swaps P2 (4 cards) and P3 (2 cards), diff = 2!
    expect(prompt?.type).toBe('play_action');
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'dimeng', targetIds: ['p2', 'p3'] }
    });
    expect(prompt?.type).toBe('choose_card');
    if (prompt?.type === 'choose_card') {
      expect(prompt.minCount).toBe(2);
      prompt = engine.submit({
        type: 'choose_card',
        cardIds: prompt.eligibleCardIds.slice(0, 2)
      });
    }
    expect(p2.hand.length).toBe(2);
    expect(p3.hand.length).toBe(4);
  });

  it('23. 董卓【酒池】【肉林】【崩坏】【暴虐】：黑桃当酒、对女性杀需两闪、结束崩坏、群伤暴虐判定', () => {
    const engine = makeIdentity5([
      'exp_dongzhuo', // P1 Lord (9 HP!)
      'blank_qun_m',  // P2 Qun
      'std_zhenji',   // P3 Female
      'blank_shu_m',
      'blank_wu_m'
    ]);
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    const p3 = engine.getPlayer('p3');
    // 酒池: spade card as Alcohol
    p1.hand = [mkCard(2301, 'dodge', 'spade', 6), mkCard(2302, 'slash', 'heart', 7)];
    p3.hand = [mkCard(2303, 'dodge', 'heart', 2)]; // Only 1 Dodge -> 肉林 requires 2!
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'jiuchi', cardIds: [2301] }
    });
    expect(p1.drunk).toBe(true);

    // Give P1 weapon so he reaches seat 2 (P3)
    p1.equips.weapon = mkCard(2304, 'kylin_bow', 'heart', 5);
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 2302, targetIds: ['p3'] }
    });
    // P3 plays her 1 Dodge -> STILL fails 2nd Dodge requirement -> takes 2 damage (drunk)!
    expect(prompt?.type === 'choose_card' && prompt.reason).toBe('dodge');
    prompt = engine.submit({ type: 'choose_card', cardIds: [2303] });
    expect(p3.hp).toBe(1); // 3 - 2 = 1!

    // End play phase -> finish phase triggers 崩坏!
    const hpBefore = p1.hp;
    prompt = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('benghuai');
    prompt = engine.submit({ type: 'choose_option', optionId: 'lose_hp' });
    expect(p1.hp).toBe(hpBefore - 1);

    // P2 (Qun) deals damage to P3 -> 暴虐 spade judge heals Dong Zhuo 1 HP!
    prompt = advanceToPlayPhase(engine, 'p2');
    p2.hand = [mkCard(2305, 'slash', 'heart', 8)];
    p3.hp = 3;
    p3.hand = [];
    engine.state.drawPile.unshift(mkCard(2306, 'slash', 'spade', 9)); // Spade judge!
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 2305, targetIds: ['p3'] }
    });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('baonue');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(p1.hp).toBe(hpBefore); // Healed 1 back!
  });

  it('24. 贾诩【完杀】【乱武】【帷幕】：免疫黑色锦囊、回合内完杀禁队友救桃、限定技乱武逼杀或失血', () => {
    const engine = make2v2(['exp_jiaxu', 'blank_wei_m', 'blank_shu_m', 'blank_wu_m']);
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    const p3 = engine.getPlayer('p3');
    const p4 = engine.getPlayer('p4');

    // 完杀: P1 kills P2 (1 HP) while P2's teammate P4 holds Peach -> P4 CANNOT save P2!
    p2.hp = 1;
    p2.hand = [];
    p4.hand = [mkCard(2401, 'peach', 'heart', 4)];
    p1.hand = [mkCard(2402, 'slash', 'heart', 9)];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 2402, targetIds: ['p2'] }
    });
    expect(p2.alive).toBe(false); // 完杀 blocked P4's Peach!

    // 乱武: forces P3 & P4 to Slash nearest (both cancel since empty hand) -> both lose 1 HP!
    p3.hand = [];
    p4.hand = [];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'luanwu' }
    });
    while (prompt?.type === 'choose_target' && prompt.reason === 'luanwu_target') {
      prompt = engine.submit({ type: 'choose_target', targetIds: [], cancelled: true });
    }
    expect(p3.hp).toBe(3);
    expect(p4.hp).toBe(3);

    // 帷幕: P3 holds black Dismantle -> CANNOT target Jia Xu!
    prompt = advanceToPlayPhase(engine, 'p3');
    const blackDism = mkCard(2403, 'dismantle', 'spade', 3);
    p3.hand = [blackDism];
    const dismInfo = engine.getPlayableCards('p3').find((i) => i.cardId === 2403);
    expect(dismInfo?.eligibleTargetIds ?? []).not.toContain('p1');
  });
});

describe('Phase 4C: Mountain Pack (山包 8将)', () => {
  it('25. 张郃【巧变】：弃1手牌跳过摸牌偷至多2名角色各1手牌，跳过出牌移动场上1张牌', () => {
    const engine = make2v2(['exp_zhanghe', 'blank_wei_m', 'blank_shu_m', 'blank_wu_m']);
    let prompt = engine.start();
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    p2.equips.armor = mkCard(2501, 'silver_lion', 'club', 1);
    const p1StartHand = p1.hand.length;

    // Decline qiaobian_judge first
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('qiaobian_judge');
    prompt = engine.submit({ type: 'choose_option', optionId: 'no' });

    // Skip draw phase -> steal 1 hand card each from P2 & P3!
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('qiaobian_draw');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    prompt = engine.submit({ type: 'choose_card', cardIds: [p1.hand[0].id] });
    expect(prompt?.type === 'choose_target' && prompt.reason).toBe('qiaobian_draw');
    prompt = engine.submit({ type: 'choose_target', targetIds: ['p2', 'p3'] });
    while (prompt?.type === 'choose_player_card') {
      prompt = engine.submit({ type: 'choose_player_card', choiceIndex: 0 });
    }
    expect(p1.hand.length).toBe(p1StartHand - 1 + 2); // -1 discard +2 stolen!

    // Skip play phase -> move P2's silver_lion to P1!
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('qiaobian_play');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    prompt = engine.submit({ type: 'choose_card', cardIds: [p1.hand[0].id] });
    expect(prompt?.type === 'choose_target' && prompt.reason).toBe('move_field_source');
    prompt = engine.submit({ type: 'choose_target', targetIds: ['p2'] });
    expect(prompt?.type === 'choose_target' && prompt.reason).toBe('move_field_dest');
    prompt = engine.submit({ type: 'choose_target', targetIds: ['p1'] });
    expect(p1.equips.armor?.id).toBe(2501);
    expect(p2.equips.armor).toBeNull();
  });

  it('26. 邓艾【屯田】【凿险】【急袭】：回合外失牌判定置田，满3田觉醒获急袭，移去田当顺手牵羊', () => {
    const engine = make1v1('blank_wei_m', 'exp_dengai');
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2'); // Deng Ai

    // Pre-seed 2 田 on Deng Ai, then P1 Slashes P2 -> P2 plays Dodge -> 屯田 judges Club -> 3rd 田!
    p2.removedCards['tian'] = [
      mkCard(2601, 'slash', 'spade', 3),
      mkCard(2602, 'dodge', 'club', 4)
    ];
    p1.hand = [mkCard(2603, 'slash', 'heart', 7), mkCard(2604, 'peach', 'heart', 8)];
    p2.hand = [mkCard(2605, 'dodge', 'diamond', 2)];
    engine.state.drawPile.unshift(mkCard(2606, 'slash', 'club', 9)); // Non-heart!

    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 2603, targetIds: ['p2'] }
    });
    prompt = engine.submit({ type: 'choose_card', cardIds: [2605] });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('tuntian');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(p2.removedCards['tian']?.length).toBe(3);

    // Advance to Deng Ai's turn -> 凿险 awakens (-1 maxHp, gains jixi_dengai)!
    prompt = advanceToPlayPhase(engine, 'p2');
    expect(p2.maxHp).toBe(3);
    expect(p2.skills).toContain('jixi_dengai');

    // Use 急袭 (spends 1 田 to Snatch P1's Peach!)
    const p1Before = p1.hand.length;
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'jixi_dengai', targetIds: ['p1'] }
    });
    if (prompt?.type === 'choose_player_card') {
      prompt = engine.submit({ type: 'choose_player_card', choiceIndex: 0 });
    }
    expect(p2.removedCards['tian']?.length).toBe(2);
    expect(p1.hand.length).toBe(p1Before - 1);
  });

  it('27. 姜维【挑衅】&【志继】：挑衅逼杀不成弃其1牌；准备阶段空城觉醒减上限回血并获观星', () => {
    const engine = make1v1('exp_jiangwei', 'blank_wei_m');
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    p2.hand = [mkCard(2701, 'dodge', 'heart', 2)]; // No Slash!
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'tiaoxin', targetIds: ['p2'] }
    });
    expect(prompt?.type).toBe('choose_player_card');
    prompt = engine.submit({ type: 'choose_player_card', choiceIndex: 0 });
    expect(p2.hand.length).toBe(0);

    // Next turn, Jiang Wei starts prepare phase with empty hand & 2 HP -> 志继 awakens!
    p1.hand = [];
    p1.hp = 2;
    prompt = advanceToPlayPhase(engine, 'p2');
    prompt = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('zhiji');
    prompt = engine.submit({ type: 'choose_option', optionId: 'heal' });
    expect(p1.hp).toBe(3);
    expect(p1.maxHp).toBe(3);
    expect(p1.skills).toContain('guanxing');
  });

  it('28. 刘禅【享乐】【放权】【若愚】：享乐不弃基本牌则杀无效；放权跳出牌赐队友额外回合；若愚主公觉醒', () => {
    const engine = makeIdentity5([
      'exp_liushan', // P1 Lord (3+1 = 4 HP; same as others so 若愚 awakens on Turn 1 prepare -> 5 maxHp + jijiang!)
      'blank_shu_m', // P2 Loyalist
      'blank_wei_m',
      'blank_wu_m',
      'blank_qun_m'
    ]);
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    let prompt = engine.start();
    // On Turn 1 prepare phase, P1 (4 HP) === minHp (4) -> 若愚 already awakened (+1 maxHp to 5, gained jijiang)!
    expect(p1.maxHp).toBe(5);
    expect(p1.skills).toContain('jijiang');

    // P1 play phase -> 放权 skip!
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('fangquan_skip');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    // Discard phase if needed -> TurnEnd 放权 grant to P2!
    while (prompt && !(prompt.type === 'choose_option' && prompt.reason === 'fangquan_grant')) {
      if (prompt.type === 'choose_card') {
        prompt = engine.submit({
          type: 'choose_card',
          cardIds: prompt.eligibleCardIds.slice(0, prompt.minCount)
        });
      } else break;
    }
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('fangquan_grant');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    prompt = engine.submit({ type: 'choose_card', cardIds: [p1.hand[0].id] });
    expect(prompt?.type === 'choose_target' && prompt.reason).toBe('fangquan_target');
    prompt = engine.submit({ type: 'choose_target', targetIds: ['p2'] });
    // P2 IMMEDIATELY gets an extra turn!
    expect(engine.state.players[engine.state.activePlayerIndex].id).toBe('p2');

    // During P2's extra turn, test 享乐: P2 Slashes P1 without discarding a basic card -> Slash cancelled!
    p2.hand = [mkCard(2801, 'slash', 'spade', 7), mkCard(2802, 'peach', 'heart', 4)];
    p1.hand = [];
    const p1HpBefore = p1.hp;
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 2801, targetIds: ['p1'] }
    });
    expect(prompt?.type === 'choose_card' && prompt.optional).toBe(true);
    prompt = engine.submit({ type: 'choose_card', cardIds: [], cancelled: true });
    expect(p1.hp).toBe(p1HpBefore); // Cancelled by 享乐!
  });

  it('29. 孙策【激昂】【魂姿】【制霸】：红杀/决斗激昂摸1；1血觉醒魂姿获英姿英魂；吴势力制霸拼点', () => {
    const engine = makeIdentity5([
      'exp_sunce',   // P1 Lord (Wu)
      'blank_wu_m',  // P2 Wu
      'blank_wei_m',
      'blank_shu_m',
      'blank_qun_m'
    ]);
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    // Red Slash triggers 激昂 draw 1!
    p1.hand = [mkCard(2901, 'slash', 'heart', 9)];
    p2.hand = [];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 2901, targetIds: ['p2'] }
    });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('jiang');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(p1.hand.length).toBe(1); // Drew 1 from 激昂!

    // P2 (Wu) triggers 制霸拼点 against Lord Sun Ce!
    prompt = advanceToPlayPhase(engine, 'p2');
    p2.hand = [mkCard(2902, 'slash', 'club', 2)];
    p1.hand = [mkCard(2903, 'slash', 'spade', 13)];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'zhiba_pindian', targetIds: ['p1'] }
    });
    prompt = engine.submit({ type: 'choose_card', cardIds: [2902] });
    prompt = engine.submit({ type: 'choose_card', cardIds: [2903] });
    // Sun Ce won pindian -> can take both pindian cards!
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('zhiba_take');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(p1.hand.map((c) => c.id)).toEqual(expect.arrayContaining([2902, 2903]));

    // Drop Sun Ce to 1 HP -> next prepare phase awakens 魂姿 (-1 maxHp, gains yingzi + yinghun)!
    p1.hp = 1;
    const prevMax = p1.maxHp;
    prompt = advanceToPlayPhase(engine, 'p1');
    expect(p1.maxHp).toBe(prevMax - 1);
    expect(p1.skills).toContain('yingzi');
    expect(p1.skills).toContain('yinghun');
  });

  it('30. 张昭&张纮【直谏】&【固政】：直谏置装备入队友装备区摸1；固政退还1张弃牌并收走其余弃牌', () => {
    const engine = make2v2(['exp_erzhang', 'blank_wei_m', 'blank_shu_m', 'blank_wu_m']);
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1');
    const p3 = engine.getPlayer('p3'); // P1's teammate
    const shield = mkCard(3001, 'renwang_shield', 'club', 2);
    p1.hand = [shield];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'activate_skill', skillId: 'zhijian', cardIds: [3001], targetIds: ['p3'] }
    });
    expect(p3.equips.armor?.id).toBe(3001);
    expect(p1.hand.length).toBe(1); // Drew 1!

    // Advance to P2's turn -> force P2 to discard 2 cards -> Erzhang 【固政】 returns 1 and takes 1!
    prompt = advanceToPlayPhase(engine, 'p2');
    const p2 = engine.getPlayer('p2');
    p2.hp = 1; // hand limit 1
    p2.hand = [
      mkCard(3002, 'slash', 'spade', 3),
      mkCard(3003, 'dodge', 'heart', 4),
      mkCard(3004, 'peach', 'heart', 5)
    ]; // must discard 2!
    const p1Before = p1.hand.length;
    prompt = engine.submit({ type: 'play_action', action: { type: 'end_play_phase' } });
    expect(prompt?.type === 'choose_card' && prompt.reason).toBe('discard_phase');
    prompt = engine.submit({ type: 'choose_card', cardIds: [3002, 3003] });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('guzheng');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('guzheng_return');
    prompt = engine.submit({ type: 'choose_option', optionId: '3002' });
    expect(p2.hand.some((c) => c.id === 3002)).toBe(true); // Returned 3002!
    expect(p1.hand.some((c) => c.id === 3003)).toBe(true); // Erzhang kept 3003!
    expect(p1.hand.length).toBe(p1Before + 1);
  });

  it('31. 蔡文姬【悲歌】&【断肠】：受杀伤发动悲歌判定红桃回血/黑桃翻面；阵亡断肠令凶手失去所有技能', () => {
    const engine = make2v2(['std_caocao', 'exp_caiwenji', 'blank_shu_m', 'blank_wu_m']);
    let prompt = advanceToPlayPhase(engine, 'p1');
    const p1 = engine.getPlayer('p1'); // Cao Cao
    const p2 = engine.getPlayer('p2'); // Cai Wenji
    p1.hand = [mkCard(3101, 'slash', 'spade', 7), mkCard(3102, 'duel', 'club', 1)];
    p2.hand = [mkCard(3103, 'slash', 'club', 5)];
    engine.state.drawPile.unshift(mkCard(3104, 'peach', 'heart', 8)); // Heart judge -> heal 1!

    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 3101, targetIds: ['p2'] }
    });
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('beige');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    prompt = engine.submit({ type: 'choose_card', cardIds: [3103] });
    expect(p2.hp).toBe(3); // 3 - 1 + 1 = 3!

    // Now P1 kills Cai Wenji -> 断肠 strips all skills from Cao Cao!
    p2.hp = 1;
    p2.hand = [];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 3102, targetIds: ['p2'] }
    });
    expect(p2.alive).toBe(false);
    expect(p1.skills.length).toBe(0); // 断肠!
  });

  it('32. 左慈【化身】&【新生】：开局获2张化身牌选技能并变更势力性别，受伤新生加化身，ClientView可见', () => {
    const engine = make1v1('exp_zuoci', 'blank_wei_m');
    let prompt = engine.start();
    const p1 = engine.getPlayer('p1');
    const p2 = engine.getPlayer('p2');
    // GameStart fires 化身!
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('huashen');
    expect(p1.huashenPool?.length).toBe(2);
    if (prompt?.type === 'choose_option') {
      prompt = engine.submit({ type: 'choose_option', optionId: prompt.options[0].id });
    }
    expect(p1.activeHuashenSkillId).toBeTruthy();
    expect(p1.skills).toContain(p1.activeHuashenSkillId!);

    const view = engine.getClientView('p1');
    const zcView = view.players.find((p) => p.id === 'p1')!;
    expect(zcView.huashenCount).toBe(2);
    expect(zcView.activeHuashenGeneralName).toBeTruthy();

    // During P2's turn, P2 damages Zuo Ci -> 新生 adds a 3rd Huashen general!
    prompt = advanceToPlayPhase(engine, 'p2');
    p1.hand = [];
    p2.hand = [mkCard(3201, 'slash', 'spade', 9)];
    prompt = engine.submit({
      type: 'play_action',
      action: { type: 'play_card', cardId: 3201, targetIds: ['p1'] }
    });
    while (prompt && !(prompt.type === 'choose_option' && prompt.reason === 'xinsheng')) {
      prompt = engine.submit(decideAIAction(engine, prompt.playerId));
    }
    expect(prompt?.type === 'choose_option' && prompt.reason).toBe('xinsheng');
    prompt = engine.submit({ type: 'choose_option', optionId: 'yes' });
    expect(p1.huashenPool?.length).toBe(3);
  });
});

describe('Phase 4C: Full Expansion & All-89 Automated AI Games & Replay Determinism', () => {
  it('completes 45 Expansion AI games (15x 1v1, 15x 2v2, 15x identity5) + 15 mixed All-89 games cleanly', () => {
    const configs: { mode: GameConfig['mode']; pack: GameConfig['generalPack']; count: number; baseSeed: number }[] = [
      { mode: '1v1', pack: 'expansion', count: 15, baseSeed: 5100 },
      { mode: '2v2', pack: 'expansion', count: 15, baseSeed: 5200 },
      { mode: 'identity5', pack: 'expansion', count: 15, baseSeed: 5300 },
      { mode: 'identity5', pack: 'all', count: 15, baseSeed: 5400 }
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

        if (i === 0) {
          const replayed = GameEngine.replay(cfg, state.actionLog);
          expect(replayed.state.result).toEqual(state.result);
          expect(replayed.state.events.length).toBe(state.events.length);
        }
      }
    }
  }, 60000);
});
