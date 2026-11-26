import {
  getCardColor,
  isSlashCardName,
  type CardInstance,
  type ModifierRegistry,
  type SkillRegistry,
  type TriggerRegistry
} from '../../index.js';
import { CARD_SPECS } from '../../data/cards/specs.js';
import { hasActiveSkill } from '../../core/events.js';
import { getHandLimit, isInAttackRange } from '../../core/distance.js';
import {
  buildPlayerCardChoices,
  extractChoiceCard,
  getEquippedCards,
  getUsableCards,
  hasAnyCardInZones
} from '../../core/deck.js';

export function registerWuStandardSkills(
  triggers: TriggerRegistry,
  modifiers: ModifierRegistry,
  skills: SkillRegistry
): void {
  // Turn-scoped resets for Wu once-per-turn skills
  triggers.register({
    id: 'skill_wu_turn_reset',
    timing: 'TurnStart',
    priority: 10,
    *execute(state, payload) {
      const p = state.players.find((x) => x.id === payload.playerId);
      if (p) {
        delete p.marks['zhiheng_used'];
        delete p.marks['fanjian_used'];
        delete p.marks['jieyin_used'];
        delete p.marks['yingzi_active'];
        delete p.marks['keji_slashed'];
      }
    }
  });

  // ===== 孙权：制衡 =====
  skills.registerActive({
    skillId: 'zhiheng',
    getPromptInfo: (_state, player) => {
      if (player.marks['zhiheng_used']) return null;
      const allCards = [...getUsableCards(player), ...getEquippedCards(player)];
      if (allCards.length === 0) return null;
      return {
        skillId: 'zhiheng',
        name: '制衡',
        description: '出牌阶段限1次，弃置任意张牌（手牌或装备区），摸等量的牌。',
        cardMin: 1,
        cardMax: allCards.length,
        eligibleCardIds: allCards.map((c) => c.id),
        targetMin: 0,
        targetMax: 0,
        eligibleTargetIds: []
      };
    },
    *execute(_state, player, cardIds, _targetIds, helpers) {
      if (player.marks['zhiheng_used'] || cardIds.length === 0) return;
      player.marks['zhiheng_used'] = 1;
      const count = cardIds.length;
      yield* helpers.discardCards(player.id, cardIds);
      const drawn = helpers.drawCards(player.id, count);
      helpers.log(
        'skill',
        `${player.name} 发动【制衡】，弃置 ${count} 张牌并摸了 ${drawn.length} 张牌`,
        player.id
      );
    }
  });

  // ===== 孙权：救援（主公技·锁定技）=====
  modifiers.register({
    id: 'skill_jiuyuan',
    peachHealBonus: (_state, helper, victim) => {
      if (!hasActiveSkill(victim, 'jiuyuan')) return 0;
      if (helper.id === victim.id || helper.faction !== 'wu') return 0;
      return 1;
    }
  });

  // ===== 甘宁：奇袭（黑牌当过河拆桥）=====
  skills.registerActive({
    skillId: 'qixi',
    getPromptInfo: (state, player, mods) => {
      const blacks = [...getUsableCards(player), ...getEquippedCards(player)].filter(
        (c) => getCardColor(c.suit) === 'black'
      );
      if (blacks.length === 0) return null;
      const targets = state.players
        .filter(
          (t) =>
            t.alive &&
            t.id !== player.id &&
            hasAnyCardInZones(t, true) &&
            mods.canBeTargetedByCard(state, player, t, 'dismantle')
        )
        .map((t) => t.id);
      if (targets.length === 0) return null;
      return {
        skillId: 'qixi',
        name: '奇袭',
        description: '将一张黑色牌（手牌或装备区）当【过河拆桥】使用。',
        cardMin: 1,
        cardMax: 1,
        eligibleCardIds: blacks.map((c) => c.id),
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: targets
      };
    },
    *execute(state, player, cardIds, targetIds, helpers) {
      const target = state.players.find((p) => p.id === targetIds[0] && p.alive);
      if (!target || cardIds.length !== 1) return;
      const removed = yield* helpers.removeCardFromPlayer(player.id, cardIds[0]);
      if (!removed) return;
      helpers.pushTableCard(removed, player.id, '奇袭拆桥');
      helpers.moveToDiscard(removed);
      helpers.log(
        'skill',
        `${player.name} 发动【奇袭】，将【${removed.displayName}】当【过河拆桥】对 ${target.name} 使用`,
        player.id,
        [target.id],
        [removed.id]
      );
      const virtualDismantle: CardInstance = {
        ...CARD_SPECS['dismantle'],
        id: removed.id,
        suit: removed.suit,
        rank: removed.rank,
        pack: removed.pack
      };
      yield* helpers.resolveNormalTrick(player, virtualDismantle, [target.id]);
    }
  });

  // ===== 吕蒙：克己 =====
  triggers.register({
    id: 'skill_keji',
    timing: 'PhaseBefore',
    priority: 50,
    condition: (state, payload) => {
      if (payload.phase !== 'discard' || !payload.playerId) return false;
      if (state.skippedPhases.includes('discard')) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      if (!p || !hasActiveSkill(p, 'keji')) return false;
      if (p.slashUsedThisTurn > 0 || p.marks['keji_slashed']) return false;
      return p.hand.length > getHandLimit(state, p, modifiers);
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'keji',
        message: '本回合出牌阶段未使用或打出过【杀】，是否发动【克己】跳过弃牌阶段？',
        options: [
          { id: 'yes', label: '发动【克己】跳过弃牌' },
          { id: 'no', label: '正常弃牌' }
        ]
      });
      if (opt.type === 'choose_option' && opt.optionId === 'yes') {
        state.skippedPhases.push('discard');
        helpers.log('skill', `${p.name} 发动【克己】，跳过弃牌阶段！`, p.id);
      }
    }
  });

  // ===== 黄盖：苦肉 =====
  skills.registerActive({
    skillId: 'kurou',
    getPromptInfo: (_state, player) => {
      if (!player.alive) return null;
      return {
        skillId: 'kurou',
        name: '苦肉',
        description: '出牌阶段，失去1点体力，然后摸两张牌。',
        cardMin: 0,
        cardMax: 0,
        eligibleCardIds: [],
        targetMin: 0,
        targetMax: 0,
        eligibleTargetIds: [],
        needsConfirmOnly: true
      };
    },
    *execute(state, player, _cardIds, _targetIds, helpers) {
      helpers.log('skill', `${player.name} 发动【苦肉】，失去 1 点体力！`, player.id);
      yield* helpers.loseHp(player.id, 1);
      if (player.alive && !state.result) {
        const drawn = helpers.drawCards(player.id, 2);
        helpers.log('draw', `${player.name} 【苦肉】摸了 ${drawn.length} 张牌`, player.id);
      }
    }
  });

  // ===== 周瑜：英姿 & 反间 =====
  triggers.register({
    id: 'skill_yingzi',
    timing: 'PhaseBefore',
    priority: 55,
    condition: (state, payload) => {
      if (payload.phase !== 'draw' || !payload.playerId) return false;
      if (state.skippedPhases.includes('draw')) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'yingzi'));
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'yingzi',
        message: '摸牌阶段：是否发动【英姿】多摸一张牌？',
        options: [
          { id: 'yes', label: '发动【英姿】(+1摸牌)' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type === 'choose_option' && opt.optionId === 'yes') {
        p.marks['yingzi_active'] = 1;
        helpers.log('skill', `${p.name} 发动【英姿】，本回合多摸一张牌`, p.id);
      }
    }
  });

  modifiers.register({
    id: 'skill_yingzi_delta',
    drawCountDelta: (_state, player) => (player.marks['yingzi_active'] ? 1 : 0)
  });

  skills.registerActive({
    skillId: 'fanjian',
    getPromptInfo: (state, player) => {
      if (player.marks['fanjian_used'] || player.hand.length === 0) return null;
      const others = state.players
        .filter((o) => o.alive && o.id !== player.id)
        .map((o) => o.id);
      if (others.length === 0) return null;
      return {
        skillId: 'fanjian',
        name: '反间',
        description: '出牌阶段限1次，令一名其他角色选花色并抽取你一张手牌，花色不同则受1点伤害。',
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
      if (!target || player.hand.length === 0 || player.marks['fanjian_used']) return;
      player.marks['fanjian_used'] = 1;

      helpers.log('skill', `${player.name} 对 ${target.name} 发动【反间】！`, player.id, [target.id]);
      const suitOpt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: target.id,
        reason: 'fanjian_suit',
        message: `${player.name} 发动了【反间】，请选择一种花色：`,
        options: [
          { id: 'spade', label: '♠ 黑桃' },
          { id: 'heart', label: '♥ 红桃' },
          { id: 'club', label: '♣ 梅花' },
          { id: 'diamond', label: '♦ 方块' }
        ]
      });
      const chosenSuit = suitOpt.type === 'choose_option' ? suitOpt.optionId : 'spade';

      const choices = buildPlayerCardChoices(player, {
        includeHand: true,
        includeEquips: false,
        includeJudge: false
      });
      const pick = yield* helpers.ask({
        type: 'choose_player_card',
        promptId: helpers.nextPromptId(),
        playerId: target.id,
        targetId: player.id,
        reason: 'snatch',
        message: `【反间】：抽取 ${player.name} 的一张手牌`,
        choices
      });
      const idx = pick.type === 'choose_player_card' ? pick.choiceIndex : 0;
      const prevHand = player.hand.length;
      const ex = extractChoiceCard(player, choices[idx] ?? choices[0]);
      if (!ex) return;

      target.hand.push(ex.card);
      helpers.pushTableCard(ex.card, target.id, '反间展示');
      helpers.log(
        'skill',
        `${target.name} 选择花色 ${chosenSuit}，抽到了【${ex.card.displayName}】（${ex.card.suit}）`,
        target.id,
        [player.id],
        [ex.card.id]
      );
      yield* helpers.checkHandEmptied(player.id, prevHand);

      if (ex.card.suit !== chosenSuit && target.alive && !state.result) {
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

  // ===== 大乔：国色 & 流离 =====
  skills.registerActive({
    skillId: 'guose',
    getPromptInfo: (state, player, mods) => {
      const diamonds = [...getUsableCards(player), ...getEquippedCards(player)].filter(
        (c) => c.suit === 'diamond'
      );
      if (diamonds.length === 0) return null;
      const targets = state.players
        .filter(
          (t) =>
            t.alive &&
            t.id !== player.id &&
            !t.judgeZone.some((j) => (j.asDelayedTrick ?? j.name) === 'indulgence') &&
            mods.canBeTargetedByCard(state, player, t, 'indulgence')
        )
        .map((t) => t.id);
      if (targets.length === 0) return null;
      return {
        skillId: 'guose',
        name: '国色',
        description: '将一张方块牌（手牌或装备区）当【乐不思蜀】置于一名其他角色判定区。',
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
      if (!target || cardIds.length !== 1) return;
      const removed = yield* helpers.removeCardFromPlayer(player.id, cardIds[0]);
      if (!removed) return;
      removed.asDelayedTrick = 'indulgence';
      target.judgeZone.push(removed);
      helpers.log(
        'skill',
        `${player.name} 发动【国色】，将♦牌【${removed.displayName}】当【乐不思蜀】置于 ${target.name} 判定区`,
        player.id,
        [target.id],
        [removed.id]
      );
    }
  });

  triggers.register({
    id: 'skill_liuli',
    timing: 'TargetConfirmed',
    priority: 60,
    condition: (state, payload) => {
      const ctx = payload.slashTarget;
      if (!ctx) return false;
      const target = state.players.find((p) => p.id === ctx.targetId);
      const attacker = state.players.find((p) => p.id === ctx.attackerId);
      if (!target || !attacker || !hasActiveSkill(target, 'liuli')) return false;
      const discardable = [...getUsableCards(target), ...getEquippedCards(target)];
      if (discardable.length === 0) return false;
      return state.players.some(
        (other) =>
          other.alive &&
          other.id !== target.id &&
          other.id !== attacker.id &&
          isInAttackRange(state, target.id, other.id, modifiers) &&
          modifiers.canBeTargetedByCard(state, attacker, other, ctx.slashCard.name)
      );
    },
    *execute(state, payload, helpers) {
      const ctx = payload.slashTarget!;
      const target = state.players.find((p) => p.id === ctx.targetId)!;
      const attacker = state.players.find((p) => p.id === ctx.attackerId)!;
      const validRedirectIds = state.players
        .filter(
          (other) =>
            other.alive &&
            other.id !== target.id &&
            other.id !== attacker.id &&
            isInAttackRange(state, target.id, other.id, modifiers) &&
            modifiers.canBeTargetedByCard(state, attacker, other, ctx.slashCard.name)
        )
        .map((o) => o.id);
      if (validRedirectIds.length === 0) return;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: target.id,
        reason: 'liuli',
        message: `成为 ${attacker.name} 【杀】的目标，是否发动【流离】弃置一张牌转移给攻击范围内其他角色？`,
        options: [
          { id: 'yes', label: '发动【流离】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const discardable = [...getUsableCards(target), ...getEquippedCards(target)];
      const cardResp = yield* helpers.ask({
        type: 'choose_card',
        promptId: helpers.nextPromptId(),
        playerId: target.id,
        reason: 'general_skill',
        message: '【流离】：选择弃置一张牌（手牌或装备区）',
        minCount: 1,
        maxCount: 1,
        eligibleCardIds: discardable.map((c) => c.id),
        optional: true
      });
      if (cardResp.type !== 'choose_card' || cardResp.cancelled || cardResp.cardIds.length !== 1) return;

      const tgtResp = yield* helpers.ask({
        type: 'choose_target',
        promptId: helpers.nextPromptId(),
        playerId: target.id,
        reason: 'liuli_target',
        message: '【流离】：选择将此【杀】转移给哪名角色',
        minCount: 1,
        maxCount: 1,
        eligibleTargetIds: validRedirectIds,
        optional: true
      });
      if (tgtResp.type !== 'choose_target' || tgtResp.cancelled || tgtResp.targetIds.length !== 1) return;

      yield* helpers.discardCards(target.id, [cardResp.cardIds[0]]);
      const newTarget = state.players.find((p) => p.id === tgtResp.targetIds[0])!;
      ctx.redirectedTargetId = newTarget.id;
      helpers.log(
        'skill',
        `${target.name} 发动【流离】，将 ${attacker.name} 的【杀】转移给了 ${newTarget.name}！`,
        target.id,
        [newTarget.id]
      );
    }
  });

  // ===== 陆逊：谦逊 & 连营 =====
  modifiers.register({
    id: 'skill_qianxun',
    canBeTargetedByCard: (_state, _source, target, cardName) => {
      if (!hasActiveSkill(target, 'qianxun')) return true;
      return cardName !== 'snatch' && cardName !== 'indulgence';
    }
  });

  triggers.register({
    id: 'skill_lianying',
    timing: 'HandEmptied',
    priority: 50,
    condition: (state, payload) => {
      if (!payload.playerId) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'lianying') && p.hand.length === 0);
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'lianying',
        message: '失去最后的手牌，是否发动【连营】摸一张牌？',
        options: [
          { id: 'yes', label: '发动【连营】摸1牌' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type === 'choose_option' && opt.optionId === 'yes') {
        helpers.drawCards(p.id, 1);
        helpers.log('skill', `${p.name} 发动【连营】，摸了一张牌`, p.id);
      }
    }
  });

  // ===== 孙尚香：结姻 & 枭姬 =====
  skills.registerActive({
    skillId: 'jieyin',
    getPromptInfo: (state, player) => {
      if (player.marks['jieyin_used'] || player.hand.length < 2) return null;
      const woundedMales = state.players
        .filter(
          (o) => o.alive && o.id !== player.id && o.gender === 'male' && o.hp < o.maxHp
        )
        .map((o) => o.id);
      if (woundedMales.length === 0) return null;
      return {
        skillId: 'jieyin',
        name: '结姻',
        description: '出牌阶段限1次，弃置两张手牌，令你与一名已受伤的男性角色各回复1点体力。',
        cardMin: 2,
        cardMax: 2,
        eligibleCardIds: player.hand.map((c) => c.id),
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: woundedMales
      };
    },
    *execute(state, player, cardIds, targetIds, helpers) {
      const target = state.players.find((p) => p.id === targetIds[0] && p.alive);
      if (!target || cardIds.length !== 2 || player.marks['jieyin_used']) return;
      player.marks['jieyin_used'] = 1;
      yield* helpers.discardCards(player.id, cardIds);
      const hSelf = helpers.heal(player.id, 1);
      const hOther = helpers.heal(target.id, 1);
      helpers.log(
        'heal',
        `${player.name} 对 ${target.name} 发动【结姻】，各自回复体力（+${hSelf}/+${hOther}）`,
        player.id,
        [target.id]
      );
    }
  });

  triggers.register({
    id: 'skill_xiaoji',
    timing: 'EquipLost',
    priority: 55,
    condition: (state, payload) => {
      if (!payload.playerId) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'xiaoji'));
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'xiaoji',
        message: '失去装备区里的牌，是否发动【枭姬】摸两张牌？',
        options: [
          { id: 'yes', label: '发动【枭姬】摸2牌' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type === 'choose_option' && opt.optionId === 'yes') {
        const drawn = helpers.drawCards(p.id, 2);
        helpers.log('skill', `${p.name} 发动【枭姬】，摸了 ${drawn.length} 张牌`, p.id);
      }
    }
  });

  void isSlashCardName;
}
