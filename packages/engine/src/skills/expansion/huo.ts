import {
  getCardColor,
  type CardInstance,
  type EquipSlot,
  type ModifierRegistry,
  type SkillRegistry,
  type TriggerRegistry
} from '../../index.js';
import { CARD_SPECS } from '../../data/cards/specs.js';
import { hasActiveSkill } from '../../core/events.js';
import { isInAttackRange } from '../../core/distance.js';
import {
  buildPlayerCardChoices,
  extractChoiceCard,
  getEquippedCards,
  getUsableCards,
  removeUsableCard
} from '../../core/deck.js';

export function registerHuoSkills(
  triggers: TriggerRegistry,
  modifiers: ModifierRegistry,
  skills: SkillRegistry
): void {
  triggers.register({
    id: 'skill_huo_turn_reset',
    timing: 'TurnStart',
    priority: 12,
    *execute(state, payload) {
      const p = state.players.find((x) => x.id === payload.playerId);
      if (!p) return;
      delete p.marks['qiangxi_used'];
      delete p.marks['quhu_used'];
      delete p.marks['tianyi_used'];
      delete p.marks['tianyi_win'];
      delete p.marks['shuangxiong_color'];
      for (const k of Object.keys(p.marks)) {
        if (k.startsWith('qiangxi_tgt_')) delete p.marks[k];
      }
    }
  });

  triggers.register({
    id: 'skill_huo_turn_end',
    timing: 'TurnEnd',
    priority: 12,
    *execute(state) {
      for (const p of state.players) {
        delete p.marks['tianyi_win'];
        delete p.marks['shuangxiong_color'];
      }
    }
  });

  // ===== 1. 典韦：强袭（出牌阶段限2次，失1血或弃1武器，对本回合未指定过的其他角色造成1点伤害）=====
  skills.registerActive({
    skillId: 'qiangxi',
    getPromptInfo: (state, player) => {
      const used = player.marks['qiangxi_used'] ?? 0;
      if (used >= 2) return null;
      const targets = state.players
        .filter((o) => o.alive && o.id !== player.id && !player.marks[`qiangxi_tgt_${o.id}`])
        .map((o) => o.id);
      if (targets.length === 0) return null;
      const weapons = [...getUsableCards(player), ...getEquippedCards(player)].filter(
        (c) => c.subtype === 'weapon'
      );
      return {
        skillId: 'qiangxi',
        name: '强袭',
        description: `出牌阶段限2次（剩${2 - used}次），选1名未指定过的目标，选1张武器弃置或不选牌失去1点体力，对其造成1点伤害。`,
        cardMin: 0,
        cardMax: weapons.length > 0 ? 1 : 0,
        eligibleCardIds: weapons.map((c) => c.id),
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: targets
      };
    },
    *execute(state, player, cardIds, targetIds, helpers) {
      const used = player.marks['qiangxi_used'] ?? 0;
      const target = state.players.find(
        (p) => p.id === targetIds[0] && p.alive && p.id !== player.id && !player.marks[`qiangxi_tgt_${p.id}`]
      );
      if (!target || used >= 2) return;

      player.marks['qiangxi_used'] = used + 1;
      player.marks[`qiangxi_tgt_${target.id}`] = 1;

      if (cardIds.length === 1) {
        yield* helpers.discardCards(player.id, [cardIds[0]]);
        helpers.log('skill', `${player.name} 发动【强袭】，弃置武器牌对 ${target.name} 造成 1 点伤害！`, player.id, [target.id]);
      } else {
        helpers.log('skill', `${player.name} 发动【强袭】，失去 1 点体力对 ${target.name} 造成 1 点伤害！`, player.id, [target.id]);
        yield* helpers.loseHp(player.id, 1);
      }

      if (target.alive && !state.result) {
        yield* helpers.applyDamage({
          sourceId: player.alive ? player.id : null,
          targetId: target.id,
          amount: 1,
          element: 'normal',
          isChainDamage: false,
          prevented: false,
          armorIgnored: false,
          wasChainedBeforeDeduct: target.chained,
          actualDeducted: 0
        });
      }
    }
  });

  // ===== 2. 荀彧：驱虎（拼点）& 节命（受1伤令1人摸至体力上限[至多5]）=====
  skills.registerActive({
    skillId: 'quhu',
    getPromptInfo: (state, player) => {
      if (player.marks['quhu_used'] || player.hand.length === 0) return null;
      const targets = state.players
        .filter((o) => o.alive && o.id !== player.id && o.hp > player.hp && o.hand.length > 0)
        .map((o) => o.id);
      if (targets.length === 0) return null;
      return {
        skillId: 'quhu',
        name: '驱虎',
        description: '出牌阶段限1次，与体力值大于你的一名角色拼点：赢则令其对其攻击范围内你选的角色造成1伤；没赢其对你造成1伤。',
        cardMin: 0,
        cardMax: 0,
        eligibleCardIds: [],
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: targets
      };
    },
    *execute(state, player, _cardIds, targetIds, helpers) {
      const target = state.players.find(
        (p) => p.id === targetIds[0] && p.alive && p.hp > player.hp && p.hand.length > 0
      );
      if (!target || player.marks['quhu_used'] || player.hand.length === 0) return;
      player.marks['quhuo_temp'] = 0;
      player.marks['quhu_used'] = 1;

      const res = yield* helpers.resolvePindian(player.id, target.id, '驱虎');
      if (!res || state.result || !target.alive) return;

      if (res.winner === 'initiator') {
        const inRange = state.players
          .filter((o) => o.alive && o.id !== target.id && isInAttackRange(state, target.id, o.id, modifiers))
          .map((o) => o.id);
        if (inRange.length === 0) return;

        const pick = yield* helpers.ask({
          type: 'choose_target',
          promptId: helpers.nextPromptId(),
          playerId: player.id,
          reason: 'quhu_victim',
          message: `【驱虎】拼点赢！选择 ${target.name} 攻击范围内的一名角色受到其造成的 1 点伤害`,
          minCount: 1,
          maxCount: 1,
          eligibleTargetIds: inRange,
          optional: false
        });
        const vid = pick.type === 'choose_target' && pick.targetIds[0] ? pick.targetIds[0] : inRange[0];
        const victim = state.players.find((o) => o.id === vid && o.alive);
        if (!victim) return;
        helpers.log('skill', `【驱虎】拼点赢！${target.name} 对 ${victim.name} 造成 1 点伤害`, player.id, [target.id, victim.id]);
        yield* helpers.applyDamage({
          sourceId: target.id,
          targetId: victim.id,
          amount: 1,
          element: 'normal',
          isChainDamage: false,
          prevented: false,
          armorIgnored: false,
          wasChainedBeforeDeduct: victim.chained,
          actualDeducted: 0
        });
      } else if (player.alive) {
        helpers.log('skill', `【驱虎】拼点未赢，${target.name} 对 ${player.name} 造成 1 点伤害`, target.id, [player.id]);
        yield* helpers.applyDamage({
          sourceId: target.id,
          targetId: player.id,
          amount: 1,
          element: 'normal',
          isChainDamage: false,
          prevented: false,
          armorIgnored: false,
          wasChainedBeforeDeduct: player.chained,
          actualDeducted: 0
        });
      }
    }
  });

  triggers.register({
    id: 'skill_jieming',
    timing: 'AfterDamageTaken',
    priority: 52,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.prevented || dmg.actualDeducted <= 0) return false;
      const xy = state.players.find((p) => p.id === dmg.targetId);
      return Boolean(xy && hasActiveSkill(xy, 'jieming'));
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const xy = state.players.find((p) => p.id === dmg.targetId)!;
      for (let i = 0; i < dmg.actualDeducted; i++) {
        if (!xy.alive || state.result) break;
        const candidates = state.players.filter(
          (p) => p.alive && p.hand.length < Math.min(5, p.maxHp)
        );
        if (candidates.length === 0) break;

        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: xy.id,
          reason: 'jieming',
          message: `【节命】（第 ${i + 1}/${dmg.actualDeducted} 次）：是否令一名角色将手牌补至体力上限（至多5张）？`,
          options: [
            { id: 'yes', label: '发动【节命】' },
            { id: 'no', label: '不发动' }
          ]
        });
        if (opt.type !== 'choose_option' || opt.optionId !== 'yes') break;

        const pick = yield* helpers.ask({
          type: 'choose_target',
          promptId: helpers.nextPromptId(),
          playerId: xy.id,
          reason: 'jieming_target',
          message: '【节命】：选择一名角色将手牌补至体力上限（至多5张）',
          minCount: 1,
          maxCount: 1,
          eligibleTargetIds: candidates.map((c) => c.id),
          optional: false
        });
        const tid = pick.type === 'choose_target' && pick.targetIds[0] ? pick.targetIds[0] : candidates[0].id;
        const t = state.players.find((p) => p.id === tid && p.alive);
        if (!t) continue;
        const need = Math.min(5, t.maxHp) - t.hand.length;
        if (need > 0) {
          const drawn = helpers.drawCards(t.id, need);
          helpers.log('skill', `${xy.name} 发动【节命】，令 ${t.name} 摸了 ${drawn.length} 张牌`, xy.id, [t.id]);
          yield* helpers.notifyCardsObtained(t.id, drawn);
        }
      }
    }
  });

  // ===== 3. 卧龙诸葛亮：八阵 & 火计 & 看破 =====
  modifiers.register({
    id: 'skill_bazhen',
    virtualEightTrigrams: (_state, player) =>
      hasActiveSkill(player, 'bazhen') && !player.equips.armor
  });

  skills.registerActive({
    skillId: 'huoji',
    getPromptInfo: (state, player, mods) => {
      const reds = player.hand.filter((c) => getCardColor(mods.getEffectiveSuit(state, player, c)) === 'red');
      if (reds.length === 0) return null;
      const targets = state.players
        .filter((t) => {
          if (!t.alive || t.hand.length === 0) return false;
          if (t.id === player.id && player.hand.length < 2) return false;
          return mods.canBeTargetedByCard(state, player, t, 'fire_attack');
        })
        .map((t) => t.id);
      if (targets.length === 0) return null;
      return {
        skillId: 'huoji',
        name: '火计',
        description: '出牌阶段，将一张红色手牌当【火攻】使用。',
        cardMin: 1,
        cardMax: 1,
        eligibleCardIds: reds.map((c) => c.id),
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: targets
      };
    },
    *execute(state, player, cardIds, targetIds, helpers) {
      const target = state.players.find((p) => p.id === targetIds[0] && p.alive);
      if (!target || cardIds.length !== 1) return;
      const prevHand = player.hand.length;
      const removed = removeUsableCard(player, cardIds[0]);
      if (!removed) return;
      helpers.pushTableCard(removed, player.id, '火计火攻');
      helpers.moveToDiscard(removed);
      helpers.log('skill', `${player.name} 发动【火计】，将【${removed.displayName}】当【火攻】对 ${target.name} 使用`, player.id, [target.id], [removed.id]);
      yield* helpers.checkHandEmptied(player.id, prevHand);

      const virtualFireAttack: CardInstance = {
        ...CARD_SPECS['fire_attack'],
        id: removed.id,
        suit: removed.suit,
        rank: removed.rank,
        pack: removed.pack
      };
      yield* helpers.resolveNormalTrick(player, virtualFireAttack, [target.id]);
    }
  });

  skills.registerResponse({
    id: 'skill_kanpo',
    extraNullificationCardIds: (state, player) => {
      if (!hasActiveSkill(player, 'kanpo')) return [];
      return player.hand
        .filter((c) => getCardColor(modifiers.getEffectiveSuit(state, player, c)) === 'black')
        .map((c) => c.id);
    }
  });

  // ===== 4. 庞统：连环（梅花手牌当铁索使用或重铸）& 涅槃（限定技濒死复活）=====
  skills.registerActive({
    skillId: 'lianhuan',
    getPromptInfo: (state, player, mods) => {
      const clubs = player.hand.filter((c) => mods.getEffectiveSuit(state, player, c) === 'club');
      if (clubs.length === 0) return null;
      const targets = state.players
        .filter((o) => o.alive && mods.canBeTargetedByCard(state, player, o, 'iron_chain', clubs[0]))
        .map((o) => o.id);
      return {
        skillId: 'lianhuan',
        name: '连环',
        description: '将一张梅花手牌当【铁索连环】使用（选1~2目标）或重铸（不选目标，弃置摸1牌）。',
        cardMin: 1,
        cardMax: 1,
        eligibleCardIds: clubs.map((c) => c.id),
        targetMin: 0,
        targetMax: Math.min(2, targets.length),
        eligibleTargetIds: targets
      };
    },
    *execute(_state, player, cardIds, targetIds, helpers) {
      if (cardIds.length !== 1) return;
      const prevHand = player.hand.length;
      const removed = removeUsableCard(player, cardIds[0]);
      if (!removed) return;

      if (targetIds.length === 0) {
        helpers.pushTableCard(removed, player.id, '连环重铸');
        helpers.moveToDiscard(removed);
        const drawn = helpers.drawCards(player.id, 1);
        helpers.log('skill', `${player.name} 发动【连环】重铸♣【${removed.displayName}】，摸了一张牌`, player.id, undefined, [removed.id]);
        yield* helpers.checkHandEmptied(player.id, prevHand);
        yield* helpers.notifyCardsObtained(player.id, drawn);
      } else {
        helpers.pushTableCard(removed, player.id, '连环铁索');
        helpers.moveToDiscard(removed);
        helpers.log('skill', `${player.name} 发动【连环】，将♣【${removed.displayName}】当【铁索连环】使用`, player.id, targetIds, [removed.id]);
        yield* helpers.checkHandEmptied(player.id, prevHand);
        const virtualChain: CardInstance = {
          ...CARD_SPECS['iron_chain'],
          id: removed.id,
          suit: removed.suit,
          rank: removed.rank,
          pack: removed.pack
        };
        yield* helpers.resolveNormalTrick(player, virtualChain, targetIds);
      }
    }
  });

  triggers.register({
    id: 'skill_niepan',
    timing: 'DyingStart',
    priority: 85,
    condition: (state, payload) => {
      const pt = state.players.find((p) => p.id === payload.victimId);
      return Boolean(
        pt && pt.alive && pt.hp <= 0 && hasActiveSkill(pt, 'niepan') && !pt.marks['niepan_used']
      );
    },
    *execute(state, payload, helpers) {
      const pt = state.players.find((p) => p.id === payload.victimId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: pt.id,
        reason: 'niepan',
        message: '濒死状态：是否发动限定技【涅槃】（弃置所有牌、复原武将牌、摸3牌、回复至3点体力）？',
        options: [
          { id: 'yes', label: '发动【涅槃】（限定技）' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      pt.marks['niepan_used'] = 1;
      for (const c of pt.hand.splice(0)) helpers.moveToDiscard(c);
      for (const c of pt.woodenOxCards.splice(0)) helpers.moveToDiscard(c);
      for (const c of pt.judgeZone.splice(0)) helpers.moveToDiscard(c);
      const slots: EquipSlot[] = ['weapon', 'armor', 'horsePlus', 'horseMinus', 'treasure'];
      for (const slot of slots) {
        const eq = pt.equips[slot];
        if (eq) {
          pt.equips[slot] = null;
          helpers.moveToDiscard(eq);
        }
      }
      pt.chained = false;
      pt.flipped = false;
      pt.hp = Math.min(pt.maxHp, 3);
      helpers.drawCards(pt.id, 3);
      helpers.log(
        'skill',
        `${pt.name} 发动限定技【涅槃】浴火重生！摸 3 张牌并回复至 ${pt.hp} 点体力！`,
        pt.id
      );
    }
  });

  // ===== 5. 太史慈：天义（拼点赢：杀+1、无距、目标+1；输：本回合不能用杀）=====
  skills.registerActive({
    skillId: 'tianyi',
    getPromptInfo: (state, player) => {
      if (player.marks['tianyi_used'] || player.hand.length === 0) return null;
      const targets = state.players
        .filter((o) => o.alive && o.id !== player.id && o.hand.length > 0)
        .map((o) => o.id);
      if (targets.length === 0) return null;
      return {
        skillId: 'tianyi',
        name: '天义',
        description: '出牌阶段限1次，与一名其他角色拼点：赢则本回合杀+1、无距且可多选1目标；没赢本回合不能出杀。',
        cardMin: 0,
        cardMax: 0,
        eligibleCardIds: [],
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: targets
      };
    },
    *execute(state, player, _cardIds, targetIds, helpers) {
      const target = state.players.find((p) => p.id === targetIds[0] && p.alive && p.hand.length > 0);
      if (!target || player.marks['tianyi_used'] || player.hand.length === 0) return;
      player.marks['tianyi_used'] = 1;

      const res = yield* helpers.resolvePindian(player.id, target.id, '天义');
      if (!res || state.result) return;
      if (res.winner === 'initiator') {
        player.marks['tianyi_win'] = 1;
        helpers.log('skill', `${player.name} 【天义】拼点赢！本回合【杀】次数+1、无距离限制且可多指定1个目标！`, player.id);
      } else {
        player.cannotUseSlashThisTurn = true;
        helpers.log('skill', `${player.name} 【天义】拼点未赢，本回合不能使用【杀】`, player.id);
      }
    }
  });

  modifiers.register({
    id: 'skill_tianyi_mods',
    slashLimitDelta: (_state, player) => (player.marks['tianyi_win'] ? 1 : 0),
    slashDistanceUnlimited: (_state, source) => Boolean(source.marks['tianyi_win']),
    slashExtraTargetsDelta: (_state, player) => (player.marks['tianyi_win'] ? 1 : 0)
  });

  // ===== 6. 袁绍：乱击（两张同花色手牌当万箭齐发）& 血裔（主公技：每有1他群手牌上限+2）=====
  skills.registerActive({
    skillId: 'luanji',
    getPromptInfo: (state, player, mods) => {
      if (player.hand.length < 2) return null;
      const bySuit = new Map<string, CardInstance[]>();
      for (const c of player.hand) {
        const s = mods.getEffectiveSuit(state, player, c);
        const list = bySuit.get(s) ?? [];
        list.push(c);
        bySuit.set(s, list);
      }
      const eligible = Array.from(bySuit.values())
        .filter((l) => l.length >= 2)
        .flat();
      if (eligible.length < 2) return null;
      return {
        skillId: 'luanji',
        name: '乱击',
        description: '出牌阶段，将两张花色相同的手牌当【万箭齐发】使用。',
        cardMin: 2,
        cardMax: 2,
        eligibleCardIds: eligible.map((c) => c.id),
        targetMin: 0,
        targetMax: 0,
        eligibleTargetIds: []
      };
    },
    *execute(_state, player, cardIds, _targetIds, helpers) {
      if (cardIds.length !== 2 || cardIds[0] === cardIds[1]) return;
      const c1 = player.hand.find((c) => c.id === cardIds[0]);
      const c2 = player.hand.find((c) => c.id === cardIds[1]);
      if (!c1 || !c2) return;
      if (helpers.getEffectiveSuit(player.id, c1) !== helpers.getEffectiveSuit(player.id, c2)) {
        return;
      }
      const prevHand = player.hand.length;
      const r1 = removeUsableCard(player, c1.id)!;
      const r2 = removeUsableCard(player, c2.id)!;
      helpers.pushTableCard(r1, player.id, '乱击');
      helpers.pushTableCard(r2, player.id, '乱击');
      helpers.moveToDiscard(r1);
      helpers.moveToDiscard(r2);
      helpers.log('skill', `${player.name} 发动【乱击】，将两张同花色牌当【万箭齐发】使用！`, player.id, undefined, [r1.id, r2.id]);
      yield* helpers.checkHandEmptied(player.id, prevHand);

      const virtualArchery: CardInstance = {
        ...CARD_SPECS['archery_attack'],
        id: r1.id,
        suit: r1.suit,
        rank: r1.rank,
        pack: r1.pack
      };
      yield* helpers.resolveNormalTrick(player, virtualArchery, []);
    }
  });

  modifiers.register({
    id: 'skill_xueyi',
    handLimitDelta: (state, player) => {
      if (!hasActiveSkill(player, 'xueyi')) return 0;
      const otherQun = state.players.filter(
        (o) => o.alive && o.id !== player.id && o.faction === 'qun'
      ).length;
      return otherQun * 2;
    }
  });

  // ===== 7. 颜良&文丑：双雄（摸牌改为判定并获判定牌，本回合不同色手牌当决斗）=====
  triggers.register({
    id: 'skill_shuangxiong_draw',
    timing: 'PhaseBefore',
    priority: 56,
    condition: (state, payload) => {
      if (payload.phase !== 'draw' || !payload.playerId) return false;
      if (state.skippedPhases.includes('draw')) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'shuangxiong'));
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'shuangxiong',
        message: '摸牌阶段：是否发动【双雄】（改为判定并获得判定牌，本回合可将不同色手牌当【决斗】）？',
        options: [
          { id: 'yes', label: '发动【双雄】' },
          { id: 'no', label: '正常摸牌' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      state.skippedPhases.push('draw');
      const judgeCard = yield* helpers.resolveJudge(p.id, '双雄');
      if (!p.alive || state.result) return;
      const color = getCardColor(helpers.getEffectiveSuit(p.id, judgeCard));
      p.marks['shuangxiong_color'] = color === 'red' ? 1 : 2; // 1=red, 2=black
      const taken = helpers.takeCardFromDiscard(judgeCard.id);
      if (taken) {
        p.hand.push(taken);
      }
      helpers.log(
        'skill',
        `${p.name} 发动【双雄】获得判定牌【${judgeCard.displayName}】（${color === 'red' ? '红' : '黑'}），本回合可将${color === 'red' ? '黑色' : '红色'}手牌当【决斗】使用！`,
        p.id
      );
    }
  });

  skills.registerActive({
    skillId: 'shuangxiong',
    getPromptInfo: (state, player, mods) => {
      const judgeColorMark = player.marks['shuangxiong_color'];
      if (!judgeColorMark) return null;
      const wantColor = judgeColorMark === 1 ? 'black' : 'red';
      const cards = player.hand.filter(
        (c) => getCardColor(mods.getEffectiveSuit(state, player, c)) === wantColor
      );
      if (cards.length === 0) return null;
      const targets = state.players
        .filter((o) => o.alive && o.id !== player.id && mods.canBeTargetedByCard(state, player, o, 'duel', cards[0]))
        .map((o) => o.id);
      if (targets.length === 0) return null;
      return {
        skillId: 'shuangxiong',
        name: '双雄(决斗)',
        description: `将一张${wantColor === 'red' ? '红色' : '黑色'}手牌当【决斗】使用。`,
        cardMin: 1,
        cardMax: 1,
        eligibleCardIds: cards.map((c) => c.id),
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: targets
      };
    },
    *execute(state, player, cardIds, targetIds, helpers) {
      const target = state.players.find((p) => p.id === targetIds[0] && p.alive);
      if (!target || cardIds.length !== 1) return;
      const prevHand = player.hand.length;
      const removed = removeUsableCard(player, cardIds[0]);
      if (!removed) return;
      helpers.pushTableCard(removed, player.id, '双雄决斗');
      helpers.moveToDiscard(removed);
      helpers.log('skill', `${player.name} 发动【双雄】，将【${removed.displayName}】当【决斗】对 ${target.name} 使用！`, player.id, [target.id], [removed.id]);
      yield* helpers.checkHandEmptied(player.id, prevHand);

      const virtualDuel: CardInstance = {
        ...CARD_SPECS['duel'],
        id: removed.id,
        suit: removed.suit,
        rank: removed.rank,
        pack: removed.pack
      };
      yield* helpers.resolveDuel(player, target, virtualDuel, false);
    }
  });

  // ===== 8. 庞德：马术(复用) & 鞬出（用杀指定目标后弃其1牌：装备则强中，非装备则目标获此杀）=====
  triggers.register({
    id: 'skill_jianchu',
    timing: 'TargetSpecified',
    priority: 64,
    condition: (state, payload) => {
      const st = payload.slashTarget;
      if (!st) return false;
      const attacker = state.players.find((p) => p.id === st.attackerId);
      const target = state.players.find((p) => p.id === st.targetId);
      if (!attacker || !target || !hasActiveSkill(attacker, 'jianchu')) return false;
      const choices = buildPlayerCardChoices(target, {
        includeHand: true,
        includeEquips: true,
        includeJudge: false
      }).filter((ch) =>
        ch.zone === 'hand' || ch.zone === 'judge'
          ? true
          : modifiers.canDiscardEquip(state, attacker, target, ch.zone as EquipSlot)
      );
      return choices.length > 0;
    },
    *execute(state, payload, helpers) {
      const st = payload.slashTarget!;
      const pd = state.players.find((p) => p.id === st.attackerId)!;
      const target = state.players.find((p) => p.id === st.targetId)!;
      const choices = buildPlayerCardChoices(target, {
        includeHand: true,
        includeEquips: true,
        includeJudge: false
      }).filter((ch) =>
        ch.zone === 'hand' || ch.zone === 'judge'
          ? true
          : helpers.canDiscardPlayerEquip(pd.id, target.id, ch.zone as EquipSlot)
      );
      if (choices.length === 0) return;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: pd.id,
        reason: 'jianchu',
        message: `【鞬出】：是否弃置 ${target.name} 一张牌？（装备牌则此【杀】不可抵消，否则其获得此【杀】）`,
        options: [
          { id: 'yes', label: '发动【鞬出】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const pick = yield* helpers.ask({
        type: 'choose_player_card',
        promptId: helpers.nextPromptId(),
        playerId: pd.id,
        targetId: target.id,
        reason: 'dismantle',
        message: `【鞬出】：选择弃置 ${target.name} 的一张牌`,
        choices
      });
      const idx = pick.type === 'choose_player_card' && choices[pick.choiceIndex] ? pick.choiceIndex : 0;
      const prevHand = target.hand.length;
      const ex = extractChoiceCard(target, choices[idx]);
      if (!ex) return;

      helpers.moveToDiscard(ex.card);
      for (const ox of ex.lostWoodenOxStash) helpers.moveToDiscard(ox);

      if (ex.card.category === 'equip') {
        st.cannotDodge = true;
        helpers.log('skill', `${pd.name} 发动【鞬出】弃置了装备【${ex.card.displayName}】，${target.name} 不可抵消此【杀】！`, pd.id, [target.id]);
      } else {
        helpers.log('skill', `${pd.name} 发动【鞬出】弃置了非装备牌【${ex.card.displayName}】，${target.name} 获得此【杀】`, pd.id, [target.id]);
        const gained: CardInstance[] = [];
        for (const sub of st.slashCard.subcards) {
          const taken = helpers.takeCardFromDiscard(sub.id);
          if (taken) {
            target.hand.push(taken);
            gained.push(taken);
          }
        }
        if (gained.length > 0) {
          yield* helpers.notifyCardsObtained(target.id, gained);
        }
      }

      if (ex.wasEquip) {
        yield* helpers.fireEquipLost(target.id, ex.card);
      } else {
        yield* helpers.checkHandEmptied(target.id, prevHand);
      }
      yield* helpers.notifyCardsLost(target.id, [ex.card], !ex.wasEquip);
    }
  });
}
