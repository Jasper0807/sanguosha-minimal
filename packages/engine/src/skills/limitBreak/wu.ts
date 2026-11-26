import {
  getCardColor,
  getRankLabel,
  getSuitSymbol,
  isSlashCardName,
  type CardInstance,
  type EquipSlot,
  type ModifierRegistry,
  type SkillRegistry,
  type TriggerRegistry
} from '../../index.js';
import { hasActiveSkill } from '../../core/events.js';
import {
  getEquipSlot,
  getEquippedCards,
  getUsableCards,
  removeHandOrEquipCard
} from '../../core/deck.js';
import { getAlivePlayersInOrder } from '../../core/targeting.js';

export function registerWuLimitBreakSkills(
  triggers: TriggerRegistry,
  modifiers: ModifierRegistry,
  skills: SkillRegistry
): void {
  // Turn-scoped resets for Wu Limit Break skills
  triggers.register({
    id: 'skill_lb_wu_turn_reset',
    timing: 'TurnStart',
    priority: 12,
    *execute(state, payload) {
      const p = state.players.find((x) => x.id === payload.playerId);
      if (!p) return;
      delete p.marks['lb_zhiheng_used'];
      delete p.marks['lb_gongxin_used'];
      delete p.marks['lb_kurou_used'];
      delete p.marks['lb_zhaxiang_slash_bonus'];
      delete p.marks['lb_zhaxiang_red_buff'];
      delete p.marks['lb_fanjian_used'];
      delete p.marks['lb_guose_used'];
      delete p.marks['lb_jieyin_used'];
    }
  });

  triggers.register({
    id: 'skill_lb_wu_turn_end',
    timing: 'TurnEnd',
    priority: 12,
    *execute(state) {
      for (const p of state.players) {
        delete p.marks['lb_zhaxiang_slash_bonus'];
        delete p.marks['lb_zhaxiang_red_buff'];
      }
    }
  });

  // ===== 界孙权：制衡（弃置所有手牌额外摸1张）=====
  skills.registerActive({
    skillId: 'lb_zhiheng',
    getPromptInfo: (_state, player) => {
      if (player.marks['lb_zhiheng_used']) return null;
      const allCards = [...getUsableCards(player), ...getEquippedCards(player)];
      if (allCards.length === 0) return null;
      return {
        skillId: 'lb_zhiheng',
        name: '制衡',
        description:
          '出牌阶段限1次，弃置任意张牌并摸等量张牌；若弃置了所有手牌，额外摸1张牌。',
        cardMin: 1,
        cardMax: allCards.length,
        eligibleCardIds: allCards.map((c) => c.id),
        targetMin: 0,
        targetMax: 0,
        eligibleTargetIds: []
      };
    },
    *execute(_state, player, cardIds, _targetIds, helpers) {
      if (player.marks['lb_zhiheng_used'] || cardIds.length === 0) return;
      player.marks['lb_zhiheng_used'] = 1;
      const discardedAllHand =
        player.hand.length > 0 && player.hand.every((c) => cardIds.includes(c.id));
      const count = cardIds.length;
      yield* helpers.discardCards(player.id, cardIds);
      const drawTotal = discardedAllHand ? count + 1 : count;
      const drawn = helpers.drawCards(player.id, drawTotal);
      helpers.log(
        'skill',
        `${player.name} 发动界【制衡】，弃置 ${count} 张牌${discardedAllHand ? '（清空全部手牌，额外+1）' : ''}，摸了 ${drawn.length} 张牌`,
        player.id
      );
    }
  });

  // ===== 界孙权：救援（主公技，他吴回合内回血且体力>=主公可改令主公回1并摸1）=====
  triggers.register({
    id: 'skill_lb_jiuyuan',
    timing: 'BeforeHeal',
    priority: 55,
    condition: (state, payload) => {
      const ctx = payload.beforeHeal;
      if (!ctx || ctx.cancelled || ctx.amount <= 0) return false;
      const target = state.players.find((p) => p.id === ctx.targetId && p.alive);
      if (!target || target.faction !== 'wu') return false;
      const active = state.players[state.activePlayerIndex];
      if (!active || active.id !== target.id) return false;
      return state.players.some(
        (lord) =>
          lord.alive &&
          lord.id !== target.id &&
          hasActiveSkill(lord, 'lb_jiuyuan') &&
          lord.hp < lord.maxHp &&
          target.hp >= lord.hp
      );
    },
    *execute(state, payload, helpers) {
      const ctx = payload.beforeHeal!;
      const target = state.players.find((p) => p.id === ctx.targetId && p.alive);
      if (!target) return;
      const lords = getAlivePlayersInOrder(state, target.id).filter(
        (lord) =>
          lord.id !== target.id &&
          hasActiveSkill(lord, 'lb_jiuyuan') &&
          lord.hp < lord.maxHp &&
          target.hp >= lord.hp
      );
      for (const lord of lords) {
        if (ctx.cancelled || ctx.amount <= 0) break;
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: target.id,
          reason: 'lb_jiuyuan',
          message: `界【救援】：是否改为令主公 ${lord.name} 回复 1 点体力，然后你摸一张牌？`,
          options: [
            { id: 'yes', label: `令 ${lord.name} 回1血并摸1牌` },
            { id: 'no', label: '自己正常回血' }
          ]
        });
        if (opt.type === 'choose_option' && opt.optionId === 'yes') {
          ctx.amount -= 1;
          if (ctx.amount <= 0) ctx.cancelled = true;
          helpers.heal(lord.id, 1);
          const drawn = helpers.drawCards(target.id, 1);
          helpers.log(
            'skill',
            `${target.name} 响应界【救援】，改为令 ${lord.name} 回复 1 点体力并摸了 ${drawn.length} 张牌`,
            target.id,
            [lord.id]
          );
          break;
        }
      }
    }
  });

  // ===== 界甘宁：奋威（限定技，多目标锦囊令任意目标无效）=====
  triggers.register({
    id: 'skill_lb_fenwei',
    timing: 'TrickTargetsSpecified',
    priority: 65,
    condition: (state, payload) => {
      const ctx = payload.trickTargets;
      if (!ctx || ctx.targetIds.length < 2) return false;
      const remaining = ctx.targetIds.filter((id) => !ctx.cancelledTargetIds.includes(id));
      if (remaining.length === 0) return false;
      return state.players.some(
        (p) => hasActiveSkill(p, 'lb_fenwei') && !p.marks['lb_fenwei_used']
      );
    },
    *execute(state, payload, helpers) {
      const ctx = payload.trickTargets!;
      const ordered = getAlivePlayersInOrder(state, ctx.actorId);
      for (const gn of ordered) {
        if (!hasActiveSkill(gn, 'lb_fenwei') || gn.marks['lb_fenwei_used']) continue;
        const remaining = ctx.targetIds.filter((id) => !ctx.cancelledTargetIds.includes(id));
        if (remaining.length === 0) break;

        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: gn.id,
          reason: 'lb_fenwei',
          message: `【${ctx.card.displayName}】指定了 ${remaining.length} 名目标，是否发动限定技【奋威】令此牌对任意目标无效？`,
          options: [
            { id: 'yes', label: '发动【奋威】（限定技）' },
            { id: 'no', label: '不发动' }
          ]
        });
        if (opt.type !== 'choose_option' || opt.optionId !== 'yes') continue;

        const tgtResp = yield* helpers.ask({
          type: 'choose_target',
          promptId: helpers.nextPromptId(),
          playerId: gn.id,
          reason: 'lb_fenwei_targets',
          message: `【奋威】：选择要令【${ctx.card.displayName}】对其无效的角色（1~${remaining.length}名）`,
          minCount: 1,
          maxCount: remaining.length,
          eligibleTargetIds: remaining,
          optional: true
        });
        if (tgtResp.type !== 'choose_target' || tgtResp.targetIds.length === 0) continue;

        gn.marks['lb_fenwei_used'] = 1;
        const picked = tgtResp.targetIds.filter((id) => remaining.includes(id));
        for (const id of picked) {
          if (!ctx.cancelledTargetIds.includes(id)) {
            ctx.cancelledTargetIds.push(id);
          }
        }
        const names = picked
          .map((id) => state.players.find((p) => p.id === id)?.name ?? id)
          .join('、');
        helpers.log(
          'skill',
          `${gn.name} 发动限定技【奋威】，令【${ctx.card.displayName}】对 ${names} 无效！`,
          gn.id,
          picked
        );
      }
    }
  });

  // ===== 界吕蒙：勤学（觉醒技）& 攻心 & 博图 =====
  triggers.register({
    id: 'skill_lb_qinxue',
    timing: 'PhaseStart',
    priority: 62,
    condition: (state, payload) => {
      if ((payload.phase !== 'prepare' && payload.phase !== 'finish') || !payload.playerId) {
        return false;
      }
      const p = state.players.find((x) => x.id === payload.playerId);
      if (!p || !hasActiveSkill(p, 'lb_qinxue') || p.marks['lb_qinxue_awakened']) return false;
      return p.hand.length - p.hp >= 2;
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      p.marks['lb_qinxue_awakened'] = 1;
      helpers.log(
        'skill',
        `${p.name} 触发觉醒技【勤学】（手牌 ${p.hand.length}，体力 ${p.hp}），减 1 点体力上限！`,
        p.id
      );
      yield* helpers.changeMaxHp(p.id, -1);
      if (!p.alive || state.result) return;

      if (p.hp < p.maxHp) {
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: p.id,
          reason: 'lb_qinxue',
          message: '【勤学】觉醒：选择回复 1 点体力或摸两张牌',
          options: [
            { id: 'heal', label: '回复 1 点体力' },
            { id: 'draw', label: '摸两张牌' }
          ]
        });
        if (opt.type === 'choose_option' && opt.optionId === 'heal') {
          yield* helpers.healAsync(p.id, 1);
        } else {
          helpers.drawCards(p.id, 2);
        }
      } else {
        helpers.drawCards(p.id, 2);
      }

      helpers.gainSkill(p.id, 'lb_gongxin');
      helpers.log('skill', `${p.name} 觉醒获得技能【攻心】！`, p.id);
    }
  });

  // 攻心（勤学觉醒获得）
  skills.registerActive({
    skillId: 'lb_gongxin',
    getPromptInfo: (state, player) => {
      if (player.marks['lb_gongxin_used']) return null;
      const others = state.players
        .filter((o) => o.alive && o.id !== player.id && o.hand.length > 0)
        .map((o) => o.id);
      if (others.length === 0) return null;
      return {
        skillId: 'lb_gongxin',
        name: '攻心',
        description:
          '出牌阶段限1次，观看一名其他角色的手牌，然后可展示其中一张红桃牌弃置或置于牌堆顶。',
        cardMin: 0,
        cardMax: 0,
        eligibleCardIds: [],
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: others
      };
    },
    *execute(state, player, _cardIds, targetIds, helpers) {
      const target = state.players.find((p) => p.id === targetIds[0] && p.alive);
      if (!target || target.hand.length === 0 || player.marks['lb_gongxin_used']) return;
      player.marks['lb_gongxin_used'] = 1;

      const handSummary = target.hand
        .map((c) => `${getSuitSymbol(c.suit)}${getRankLabel(c.rank)}【${c.displayName}】`)
        .join('、');
      helpers.log('skill', `${player.name} 对 ${target.name} 发动【攻心】，观看了其手牌`, player.id, [
        target.id
      ]);

      const hearts = target.hand.filter((c) => c.suit === 'heart');
      if (hearts.length === 0) {
        yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: player.id,
          reason: 'lb_gongxin_view',
          message: `【攻心】观看 ${target.name} 手牌（共 ${target.hand.length} 张，无红桃牌）：${handSummary}`,
          options: [{ id: 'ok', label: '确认' }]
        });
        return;
      }

      const pickResp = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: player.id,
        reason: 'lb_gongxin_card',
        message: `【攻心】${target.name} 手牌：${handSummary}。请选择一张红桃牌进行展示操作：`,
        options: [
          ...hearts.map((c) => ({
            id: `card_${c.id}`,
            label: `展示 ♥${getRankLabel(c.rank)}【${c.displayName}】`
          })),
          { id: 'none', label: '不操作' }
        ]
      });

      if (pickResp.type !== 'choose_option' || !pickResp.optionId.startsWith('card_')) return;
      const cid = Number(pickResp.optionId.replace('card_', ''));
      const idx = target.hand.findIndex((c) => c.id === cid);
      if (idx === -1) return;
      const chosen = target.hand[idx];

      const actResp = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: player.id,
        reason: 'lb_gongxin_action',
        message: `【攻心】展示了 ♥${getRankLabel(chosen.rank)}【${chosen.displayName}】，请选择处理方式：`,
        options: [
          { id: 'discard', label: '弃置此牌' },
          { id: 'top', label: '置于牌堆顶' }
        ]
      });

      const prevHand = target.hand.length;
      const [removed] = target.hand.splice(idx, 1);
      if (actResp.type === 'choose_option' && actResp.optionId === 'top') {
        helpers.putCardsOnTop([removed]);
        helpers.log(
          'skill',
          `${player.name} 【攻心】将 ${target.name} 的 ♥${getRankLabel(removed.rank)}【${removed.displayName}】置于牌堆顶`,
          player.id,
          [target.id],
          [removed.id]
        );
      } else {
        helpers.moveToDiscard(removed);
        helpers.log(
          'skill',
          `${player.name} 【攻心】弃置了 ${target.name} 的 ♥${getRankLabel(removed.rank)}【${removed.displayName}】`,
          player.id,
          [target.id],
          [removed.id]
        );
      }
      yield* helpers.checkHandEmptied(target.id, prevHand);
    }
  });

  // 博图（回合结束时若本回合弃牌堆入了4种花色，执行额外回合，每轮限 min(3, 存活数) 次）
  triggers.register({
    id: 'skill_lb_botu',
    timing: 'TurnEnd',
    priority: 45,
    condition: (state, payload) => {
      const p = state.players.find((x) => x.id === payload.playerId);
      if (!p || !hasActiveSkill(p, 'lb_botu')) return false;
      const suits = state.turnSuitsDiscarded;
      if (
        !suits.includes('spade') ||
        !suits.includes('heart') ||
        !suits.includes('club') ||
        !suits.includes('diamond')
      ) {
        return false;
      }
      const aliveCount = state.players.filter((x) => x.alive).length;
      const roundLimit = Math.min(3, aliveCount);
      const usedThisRound =
        p.marks['lb_botu_round'] === state.round ? (p.marks['lb_botu_used'] ?? 0) : 0;
      return usedThisRound < roundLimit;
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'lb_botu',
        message: '本回合置入弃牌堆的牌已集齐四种花色，是否发动【博图】执行一个额外回合？',
        options: [
          { id: 'yes', label: '发动【博图】（额外回合）' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type === 'choose_option' && opt.optionId === 'yes') {
        if (p.marks['lb_botu_round'] !== state.round) {
          p.marks['lb_botu_round'] = state.round;
          p.marks['lb_botu_used'] = 0;
        }
        p.marks['lb_botu_used'] = (p.marks['lb_botu_used'] ?? 0) + 1;
        p.extraTurnPending = true;
        helpers.log('skill', `${p.name} 发动【博图】，获得一个额外回合！`, p.id);
      }
    }
  });

  // ===== 界黄盖：苦肉 & 诈降 =====
  skills.registerActive({
    skillId: 'lb_kurou',
    getPromptInfo: (_state, player) => {
      if (player.marks['lb_kurou_used']) return null;
      const cards = [...getUsableCards(player), ...getEquippedCards(player)];
      if (cards.length === 0) return null;
      return {
        skillId: 'lb_kurou',
        name: '苦肉',
        description: '出牌阶段限1次，弃置一张牌，然后失去1点体力。',
        cardMin: 1,
        cardMax: 1,
        eligibleCardIds: cards.map((c) => c.id),
        targetMin: 0,
        targetMax: 0,
        eligibleTargetIds: []
      };
    },
    *execute(_state, player, cardIds, _targetIds, helpers) {
      if (player.marks['lb_kurou_used'] || cardIds.length !== 1) return;
      player.marks['lb_kurou_used'] = 1;
      yield* helpers.discardCards(player.id, [cardIds[0]]);
      helpers.log('skill', `${player.name} 发动界【苦肉】，弃置 1 张牌并失去 1 点体力！`, player.id);
      yield* helpers.loseHp(player.id, 1);
    }
  });

  triggers.register({
    id: 'skill_lb_zhaxiang',
    timing: 'HpLost',
    priority: 60,
    condition: (state, payload) => {
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'lb_zhaxiang') && (payload.hpLostAmount ?? 0) > 0);
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const times = payload.hpLostAmount ?? 1;
      const inOwnPlayPhase =
        state.players[state.activePlayerIndex]?.id === p.id && state.phase === 'play';

      for (let i = 0; i < times; i++) {
        if (!p.alive || state.result) break;
        const drawn = helpers.drawCards(p.id, 3);
        if (inOwnPlayPhase) {
          p.marks['lb_zhaxiang_slash_bonus'] = (p.marks['lb_zhaxiang_slash_bonus'] ?? 0) + 1;
          p.marks['lb_zhaxiang_red_buff'] = 1;
        }
        helpers.log(
          'skill',
          `${p.name} 触发锁定技【诈降】，摸了 ${drawn.length} 张牌${inOwnPlayPhase ? '（本回合出杀上限+1，红杀无距离限制且不可闪避）' : ''}`,
          p.id
        );
      }
    }
  });

  modifiers.register({
    id: 'skill_lb_zhaxiang_mods',
    slashLimitDelta: (_state, player) => player.marks['lb_zhaxiang_slash_bonus'] ?? 0,
    slashDistanceUnlimited: (_state, source, _target, card) => {
      if (!source.marks['lb_zhaxiang_red_buff'] || !card) return false;
      if (!isSlashCardName(card.name)) return false;
      const color = 'color' in card ? card.color : getCardColor(card.suit);
      return color === 'red';
    }
  });

  triggers.register({
    id: 'skill_lb_zhaxiang_cannot_dodge',
    timing: 'TargetSpecified',
    priority: 72,
    condition: (state, payload) => {
      const st = payload.slashTarget;
      if (!st || st.slashCard.color !== 'red') return false;
      const attacker = state.players.find((p) => p.id === st.attackerId);
      return Boolean(attacker && attacker.marks['lb_zhaxiang_red_buff']);
    },
    *execute(state, payload, helpers) {
      const st = payload.slashTarget!;
      st.cannotDodge = true;
      const attacker = state.players.find((p) => p.id === st.attackerId)!;
      helpers.log(
        'skill',
        `${attacker.name} 【诈降】生效：此红色【杀】不可被【闪】抵消！`,
        attacker.id,
        [st.targetId]
      );
    }
  });

  // ===== 界周瑜：英姿（锁定摸3 & 手牌上限=体力上限）& 反间 =====
  modifiers.register({
    id: 'skill_lb_yingzi',
    drawCountDelta: (_state, player) => (hasActiveSkill(player, 'lb_yingzi') ? 1 : 0),
    handLimitBaseOverride: (_state, player) =>
      hasActiveSkill(player, 'lb_yingzi') ? player.maxHp : null
  });

  skills.registerActive({
    skillId: 'lb_fanjian',
    getPromptInfo: (state, player) => {
      if (player.marks['lb_fanjian_used'] || player.hand.length === 0) return null;
      const others = state.players
        .filter((o) => o.alive && o.id !== player.id)
        .map((o) => o.id);
      if (others.length === 0) return null;
      return {
        skillId: 'lb_fanjian',
        name: '反间',
        description:
          '出牌阶段限1次，展示并交给一名其他角色一张手牌，其选：弃置所有同花色牌，或失去1点体力。',
        cardMin: 1,
        cardMax: 1,
        eligibleCardIds: player.hand.map((c) => c.id),
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: others
      };
    },
    *execute(state, player, cardIds, targetIds, helpers) {
      const target = state.players.find((p) => p.id === targetIds[0] && p.alive);
      if (!target || cardIds.length !== 1 || player.marks['lb_fanjian_used']) return;
      const idx = player.hand.findIndex((c) => c.id === cardIds[0]);
      if (idx === -1) return;

      player.marks['lb_fanjian_used'] = 1;
      const prevHand = player.hand.length;
      const [given] = player.hand.splice(idx, 1);
      target.hand.push(given);
      const suitSym = getSuitSymbol(given.suit);
      helpers.log(
        'skill',
        `${player.name} 对 ${target.name} 发动界【反间】，展示并交出 ${suitSym}${getRankLabel(given.rank)}【${given.displayName}】`,
        player.id,
        [target.id],
        [given.id]
      );
      yield* helpers.checkHandEmptied(player.id, prevHand);
      yield* helpers.notifyCardsObtained(target.id, [given]);
      if (!target.alive || state.result) return;

      const sameSuitHand = target.hand.filter((c) => c.suit === given.suit);
      const sameSuitEquips = getEquippedCards(target).filter((c) => c.suit === given.suit);
      const totalSameSuit = sameSuitHand.length + sameSuitEquips.length;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: target.id,
        reason: 'lb_fanjian',
        message: `${player.name} 发动界【反间】（花色 ${suitSym}），请选择一项：`,
        options: [
          {
            id: 'discard_suit',
            label: `展示手牌并弃置所有 ${suitSym} 牌（共 ${totalSameSuit} 张）`
          },
          { id: 'lose_hp', label: '失去 1 点体力' }
        ]
      });

      if (opt.type === 'choose_option' && opt.optionId === 'discard_suit') {
        const toDiscardIds = [
          ...target.hand.filter((c) => c.suit === given.suit).map((c) => c.id),
          ...getEquippedCards(target)
            .filter((c) => c.suit === given.suit)
            .map((c) => c.id)
        ];
        if (toDiscardIds.length > 0) {
          yield* helpers.discardCards(target.id, toDiscardIds);
        }
        helpers.log(
          'skill',
          `${target.name} 选择弃置所有 ${suitSym} 牌（共 ${toDiscardIds.length} 张）`,
          target.id
        );
      } else {
        helpers.log('skill', `${target.name} 选择失去 1 点体力`, target.id);
        yield* helpers.loseHp(target.id, 1);
      }
    }
  });

  // ===== 界大乔：国色（限1次，贴乐或拆乐后摸1牌）=====
  skills.registerActive({
    skillId: 'lb_guose',
    getPromptInfo: (state, player, mods) => {
      if (player.marks['lb_guose_used']) return null;
      const diamonds = [...getUsableCards(player), ...getEquippedCards(player)].filter(
        (c) => c.suit === 'diamond'
      );
      if (diamonds.length === 0) return null;
      const targets = state.players
        .filter((t) => {
          if (!t.alive) return false;
          const hasIndulgence = t.judgeZone.some(
            (c) => (c.asDelayedTrick ?? c.name) === 'indulgence'
          );
          if (hasIndulgence) return true; // Option 2: discard existing Indulgence
          return t.id !== player.id && mods.canBeTargetedByCard(state, player, t, 'indulgence');
        })
        .map((t) => t.id);
      if (targets.length === 0) return null;
      return {
        skillId: 'lb_guose',
        name: '国色',
        description:
          '出牌阶段限1次，选一张方块牌：对无乐者当【乐不思蜀】使用，或弃置场上一张【乐不思蜀】；然后摸1张牌。',
        cardMin: 1,
        cardMax: 1,
        eligibleCardIds: diamonds.map((c) => c.id),
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: targets
      };
    },
    *execute(state, player, cardIds, targetIds, helpers) {
      const target = state.players.find((p) => p.id === targetIds[0] && p.alive);
      if (!target || cardIds.length !== 1 || player.marks['lb_guose_used']) return;

      const existingIdx = target.judgeZone.findIndex(
        (c) => (c.asDelayedTrick ?? c.name) === 'indulgence'
      );
      const removed = yield* helpers.removeCardFromPlayer(player.id, cardIds[0]);
      if (!removed) return;
      player.marks['lb_guose_used'] = 1;

      if (existingIdx !== -1) {
        helpers.moveToDiscard(removed);
        const [removedInd] = target.judgeZone.splice(existingIdx, 1);
        helpers.moveToDiscard(removedInd);
        helpers.log(
          'skill',
          `${player.name} 发动界【国色】，弃置♦【${removed.displayName}】并弃置了 ${target.name} 判定区的【乐不思蜀】`,
          player.id,
          [target.id],
          [removed.id, removedInd.id]
        );
      } else if (target.id !== player.id) {
        removed.asDelayedTrick = 'indulgence';
        target.judgeZone.unshift(removed);
        helpers.log(
          'skill',
          `${player.name} 发动界【国色】，将♦【${removed.displayName}】当【乐不思蜀】置于 ${target.name} 判定区`,
          player.id,
          [target.id],
          [removed.id]
        );
      } else {
        helpers.moveToDiscard(removed);
      }

      if (player.alive && !state.result) {
        helpers.drawCards(player.id, 1);
        helpers.log('draw', `${player.name} 界【国色】摸了一张牌`, player.id);
      }
    }
  });

  // ===== 界陆逊：谦逊（单目标锦囊生效前将手牌移出游戏至回合结束）& 连营（令至多X名角色各摸1牌）=====
  triggers.register({
    id: 'skill_lb_qianxun',
    timing: 'SingleTrickBeforeEffect',
    priority: 65,
    condition: (state, payload) => {
      const ctx = payload.singleTrick;
      if (!ctx) return false;
      if (!ctx.isDelayed && ctx.actorId === ctx.targetId) return false;
      const target = state.players.find((p) => p.id === ctx.targetId);
      return Boolean(target && hasActiveSkill(target, 'lb_qianxun') && target.hand.length > 0);
    },
    *execute(state, payload, helpers) {
      const ctx = payload.singleTrick!;
      const target = state.players.find((p) => p.id === ctx.targetId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: target.id,
        reason: 'lb_qianxun',
        message: `【${ctx.card.displayName}】即将对你生效，是否发动界【谦逊】将全部 ${target.hand.length} 张手牌移出游戏直到回合结束？`,
        options: [
          { id: 'yes', label: '发动【谦逊】（移出全部手牌）' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const prevHand = target.hand.length;
      const moved = target.hand.splice(0, target.hand.length);
      if (!target.removedCards['lb_qianxun']) {
        target.removedCards['lb_qianxun'] = [];
      }
      target.removedCards['lb_qianxun'].push(...moved);
      helpers.log(
        'skill',
        `${target.name} 发动界【谦逊】，将 ${moved.length} 张手牌移出游戏直到回合结束！`,
        target.id
      );
      yield* helpers.checkHandEmptied(target.id, prevHand);
    }
  });

  triggers.register({
    id: 'skill_lb_lianying',
    timing: 'HandEmptied',
    priority: 52,
    condition: (state, payload) => {
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'lb_lianying') && (payload.lostHandCount ?? 1) >= 1);
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const alive = getAlivePlayersInOrder(state, p.id);
      const maxTargets = Math.min(payload.lostHandCount ?? 1, alive.length);
      if (maxTargets <= 0) return;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'lb_lianying',
        message: `你失去了最后 ${payload.lostHandCount ?? 1} 张手牌，是否发动界【连营】令至多 ${maxTargets} 名角色各摸一张牌？`,
        options: [
          { id: 'yes', label: `发动【连营】（至多${maxTargets}人摸1牌）` },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const tgtResp = yield* helpers.ask({
        type: 'choose_target',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'lb_lianying_targets',
        message: `界【连营】：选择 1~${maxTargets} 名角色各摸一张牌`,
        minCount: 1,
        maxCount: maxTargets,
        eligibleTargetIds: alive.map((a) => a.id),
        optional: false
      });
      const chosenIds =
        tgtResp.type === 'choose_target' && tgtResp.targetIds.length > 0
          ? tgtResp.targetIds.slice(0, maxTargets)
          : [p.id];
      for (const tid of chosenIds) {
        const t = state.players.find((x) => x.id === tid && x.alive);
        if (t) helpers.drawCards(t.id, 1);
      }
      const names = chosenIds
        .map((id) => state.players.find((x) => x.id === id)?.name ?? id)
        .join('、');
      helpers.log('skill', `${p.name} 发动界【连营】，令 ${names} 各摸了一张牌`, p.id, chosenIds);
    }
  });

  // ===== 界孙尚香：结姻（选男性，弃1手牌或将1装备置入其装备区；体力大者摸1，小者回1）=====
  skills.registerActive({
    skillId: 'lb_jieyin',
    getPromptInfo: (state, player) => {
      if (player.marks['lb_jieyin_used']) return null;
      const males = state.players.filter(
        (o) => o.alive && o.id !== player.id && o.gender === 'male'
      );
      if (males.length === 0) return null;
      const eligibleCards: CardInstance[] = [...player.hand];
      // Equipped cards can only be placed if at least one male has that equip slot empty
      for (const eq of getEquippedCards(player)) {
        const slot = getEquipSlot(eq);
        if (slot && males.some((m) => !m.equips[slot])) {
          eligibleCards.push(eq);
        }
      }
      if (eligibleCards.length === 0) return null;
      return {
        skillId: 'lb_jieyin',
        name: '结姻',
        description:
          '出牌阶段限1次，选一名男性并弃1手牌或将1装备置入其空装备栏；体力大者摸1牌、小者回1血。',
        cardMin: 1,
        cardMax: 1,
        eligibleCardIds: eligibleCards.map((c) => c.id),
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: males.map((m) => m.id)
      };
    },
    *execute(state, player, cardIds, targetIds, helpers) {
      const target = state.players.find(
        (p) => p.id === targetIds[0] && p.alive && p.gender === 'male' && p.id !== player.id
      );
      if (!target || cardIds.length !== 1 || player.marks['lb_jieyin_used']) return;

      const cid = cardIds[0];
      const inHand = player.hand.find((c) => c.id === cid);
      const inEquip = getEquippedCards(player).find((c) => c.id === cid);
      if (!inHand && !inEquip) return;

      const cardObj = inHand ?? inEquip!;
      const equipSlot: EquipSlot | null = getEquipSlot(cardObj);
      const canPutEquip = Boolean(equipSlot && !target.equips[equipSlot]);

      // Equipped card from own equip zone can only be placed into target's empty equip slot
      if (inEquip && !canPutEquip) return;

      let putIntoEquip = Boolean(inEquip);
      if (inHand && canPutEquip) {
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: player.id,
          reason: 'lb_jieyin_mode',
          message: `界【结姻】：将【${cardObj.displayName}】置入 ${target.name} 的装备区，还是直接弃置？`,
          options: [
            { id: 'equip', label: `置入 ${target.name} 装备区` },
            { id: 'discard', label: '弃置此手牌' }
          ]
        });
        putIntoEquip = opt.type === 'choose_option' && opt.optionId === 'equip';
      }

      player.marks['lb_jieyin_used'] = 1;
      const prevHand = player.hand.length;
      const removed = removeHandOrEquipCard(player, cid);
      if (!removed) return;
      for (const ox of removed.lostWoodenOxStash) {
        helpers.moveToDiscard(ox);
      }

      if (putIntoEquip) {
        helpers.log(
          'skill',
          `${player.name} 发动界【结姻】，将【${removed.card.displayName}】置入 ${target.name} 装备区`,
          player.id,
          [target.id],
          [removed.card.id]
        );
        yield* helpers.putEquipDirectly(target.id, removed.card);
      } else {
        helpers.moveToDiscard(removed.card);
        helpers.log(
          'skill',
          `${player.name} 发动界【结姻】，弃置了【${removed.card.displayName}】`,
          player.id,
          [target.id],
          [removed.card.id]
        );
      }

      if (removed.wasEquip) {
        yield* helpers.fireEquipLost(player.id, removed.card);
      } else {
        yield* helpers.checkHandEmptied(player.id, prevHand);
      }

      if (!player.alive || !target.alive || state.result) return;

      if (player.hp > target.hp) {
        helpers.drawCards(player.id, 1);
        yield* helpers.healAsync(target.id, 1);
        helpers.log(
          'skill',
          `界【结姻】结算：${player.name} 摸1牌，${target.name} 回1血`,
          player.id,
          [target.id]
        );
      } else if (target.hp > player.hp) {
        helpers.drawCards(target.id, 1);
        yield* helpers.healAsync(player.id, 1);
        helpers.log(
          'skill',
          `界【结姻】结算：${target.name} 摸1牌，${player.name} 回1血`,
          player.id,
          [target.id]
        );
      }
    }
  });
}
