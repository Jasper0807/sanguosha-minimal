import {
  getCardColor,
  isSlashCardName,
  type ModifierRegistry,
  type SkillRegistry,
  type TriggerRegistry,
  type VirtualCard
} from '../../index.js';
import { hasActiveSkill } from '../../core/events.js';
import { getDistance, getSlashLimit, isInAttackRange } from '../../core/distance.js';
import { getEquippedCards, getUsableCards, removeUsableCard } from '../../core/deck.js';
import { getAlivePlayersInOrder } from '../../core/targeting.js';

export function registerShuStandardSkills(
  triggers: TriggerRegistry,
  modifiers: ModifierRegistry,
  skills: SkillRegistry
): void {
  // ===== 刘备：仁德 =====
  triggers.register({
    id: 'skill_rende_reset',
    timing: 'TurnStart',
    priority: 10,
    *execute(state, payload) {
      const p = state.players.find((x) => x.id === payload.playerId);
      if (p) {
        delete p.marks['rende_given'];
        delete p.marks['rende_healed'];
      }
    }
  });

  skills.registerActive({
    skillId: 'rende',
    getPromptInfo: (state, player) => {
      if (player.hand.length === 0) return null;
      const others = state.players
        .filter((o) => o.alive && o.id !== player.id)
        .map((o) => o.id);
      if (others.length === 0) return null;
      return {
        skillId: 'rende',
        name: '仁德',
        description: '将任意张手牌交给一名其他角色；本阶段给出第2张时回复1点体力。',
        cardMin: 1,
        cardMax: player.hand.length,
        eligibleCardIds: player.hand.map((c) => c.id),
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: others
      };
    },
    *execute(state, player, cardIds, targetIds, helpers) {
      const target = state.players.find((p) => p.id === targetIds[0] && p.alive);
      if (!target || cardIds.length === 0) return;

      const prevHand = player.hand.length;
      let given = 0;
      for (const cid of cardIds) {
        const idx = player.hand.findIndex((c) => c.id === cid);
        if (idx !== -1) {
          target.hand.push(player.hand.splice(idx, 1)[0]);
          given += 1;
        }
      }
      if (given === 0) return;

      helpers.log(
        'skill',
        `${player.name} 发动【仁德】，将 ${given} 张手牌交给了 ${target.name}`,
        player.id,
        [target.id]
      );
      yield* helpers.checkHandEmptied(player.id, prevHand);

      player.marks['rende_given'] = (player.marks['rende_given'] ?? 0) + given;
      if (player.marks['rende_given'] >= 2 && !player.marks['rende_healed']) {
        player.marks['rende_healed'] = 1;
        const healed = helpers.heal(player.id, 1);
        if (healed > 0) {
          helpers.log(
            'heal',
            `${player.name} 【仁德】给出至少2张牌，回复 1 点体力（HP ${player.hp}/${player.maxHp}）`,
            player.id
          );
        }
      }
    }
  });

  // ===== 刘备：激将（主公技：出牌阶段主动 + 响应协助）=====
  skills.registerActive({
    skillId: 'jijiang',
    getPromptInfo: (state, player, mods) => {
      if (player.slashUsedThisTurn >= getSlashLimit(state, player, mods)) return null;
      const shuAllies = state.players.filter(
        (p) => p.alive && p.id !== player.id && p.faction === 'shu'
      );
      if (shuAllies.length === 0) return null;
      let targets = state.players
        .filter(
          (t) =>
            t.alive &&
            t.id !== player.id &&
            isInAttackRange(state, player.id, t.id, mods) &&
            mods.canBeTargetedByCard(state, player, t, 'slash')
        )
        .map((t) => t.id);
      targets = mods.filterSlashTargets(state, player, targets);
      if (targets.length === 0) return null;

      return {
        skillId: 'jijiang',
        name: '激将',
        description: '主公技：令其他蜀势力角色替你打出一张【杀】，视为你对目标使用之。',
        cardMin: 0,
        cardMax: 0,
        eligibleCardIds: [],
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: targets
      };
    },
    *execute(state, player, _cardIds, targetIds, helpers) {
      const target = state.players.find((p) => p.id === targetIds[0] && p.alive);
      if (!target) return;
      const shuAllies = getAlivePlayersInOrder(state, player.id, false).filter(
        (p) => p.faction === 'shu'
      );
      helpers.log('skill', `${player.name} 对 ${target.name} 发动主公技【激将】！`, player.id, [target.id]);

      for (const ally of shuAllies) {
        if (!ally.alive) continue;
        const extraIds = skills.getExtraSlashCardIds(state, ally);
        const candidates = [...getUsableCards(ally), ...getEquippedCards(ally)].filter(
          (c) => isSlashCardName(c.name) || extraIds.includes(c.id)
        );
        if (candidates.length === 0) continue;

        const resp = yield* helpers.ask({
          type: 'choose_card',
          promptId: helpers.nextPromptId(),
          playerId: ally.id,
          reason: 'general_skill',
          message: `【激将】：是否为 ${player.name} 打出一张【杀】攻击 ${target.name}？`,
          minCount: 1,
          maxCount: 1,
          eligibleCardIds: candidates.map((c) => c.id),
          optional: true
        });
        if (resp.type === 'choose_card' && !resp.cancelled && resp.cardIds.length === 1) {
          const removed = yield* helpers.removeCardFromPlayer(ally.id, resp.cardIds[0]);
          if (removed) {
            helpers.pushTableCard(removed, ally.id, '激将出杀');
            helpers.moveToDiscard(removed);
            helpers.log('skill', `${ally.name} 响应【激将】打出【${removed.displayName}】`, ally.id, [target.id]);
            const vs: VirtualCard = {
              name: isSlashCardName(removed.name) ? removed.name : 'slash',
              displayName: isSlashCardName(removed.name) ? removed.displayName : '杀(激将)',
              suit: removed.suit,
              rank: removed.rank,
              color: getCardColor(removed.suit),
              element: isSlashCardName(removed.name) ? (removed.element ?? 'normal') : 'normal',
              subcards: [removed],
              sourceSkill: 'jijiang'
            };
            yield* helpers.resolveSlash(player, [target], vs, {
              countTowardLimit: true,
              useDrunkBonus: true
            });
            return;
          }
        }
      }
      helpers.log('skill', `无人响应 ${player.name} 的【激将】`, player.id);
    }
  });

  skills.registerResponse({
    id: 'skill_jijiang_resp',
    *assistSlash(state, player, _reason, helpers) {
      if (!hasActiveSkill(player, 'jijiang')) return null;
      const shuAllies = getAlivePlayersInOrder(state, player.id, false).filter(
        (p) => p.faction === 'shu'
      );
      if (shuAllies.length === 0) return null;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: player.id,
        reason: 'jijiang',
        message: '是否发动主公技【激将】，请求其他蜀势力角色替你打出一张【杀】？',
        options: [
          { id: 'yes', label: '发动【激将】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return null;

      for (const ally of shuAllies) {
        const extraIds = skills.getExtraSlashCardIds(state, ally);
        const candidates = [...getUsableCards(ally), ...getEquippedCards(ally)].filter(
          (c) => isSlashCardName(c.name) || extraIds.includes(c.id)
        );
        if (candidates.length === 0) continue;
        const resp = yield* helpers.ask({
          type: 'choose_card',
          promptId: helpers.nextPromptId(),
          playerId: ally.id,
          reason: 'general_skill',
          message: `【激将】：是否为 ${player.name} 打出一张【杀】？`,
          minCount: 1,
          maxCount: 1,
          eligibleCardIds: candidates.map((c) => c.id),
          optional: true
        });
        if (resp.type === 'choose_card' && !resp.cancelled && resp.cardIds.length === 1) {
          const removed = yield* helpers.removeCardFromPlayer(ally.id, resp.cardIds[0]);
          if (removed) {
            helpers.pushTableCard(removed, ally.id, '激将响应');
            helpers.moveToDiscard(removed);
            helpers.log('skill', `${ally.name} 响应【激将】打出了【${removed.displayName}】`, ally.id);
            return {
              name: isSlashCardName(removed.name) ? removed.name : 'slash',
              displayName: '杀(激将)',
              suit: removed.suit,
              rank: removed.rank,
              color: getCardColor(removed.suit),
              element: 'normal',
              subcards: [removed],
              sourceSkill: 'jijiang'
            };
          }
        }
      }
      return null;
    }
  });

  // ===== 关羽：武圣（红牌当杀：出牌阶段 + 响应阶段）=====
  skills.registerActive({
    skillId: 'wusheng',
    getPromptInfo: (state, player, mods) => {
      if (player.slashUsedThisTurn >= getSlashLimit(state, player, mods)) return null;
      const reds = [...getUsableCards(player), ...getEquippedCards(player)].filter(
        (c) => getCardColor(c.suit) === 'red'
      );
      if (reds.length === 0) return null;
      let targets = state.players
        .filter(
          (t) =>
            t.alive &&
            t.id !== player.id &&
            isInAttackRange(state, player.id, t.id, mods) &&
            mods.canBeTargetedByCard(state, player, t, 'slash')
        )
        .map((t) => t.id);
      targets = mods.filterSlashTargets(state, player, targets);
      if (targets.length === 0) return null;
      return {
        skillId: 'wusheng',
        name: '武圣',
        description: '将一张红色牌（手牌或装备区）当【杀】使用。',
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
      const removed = yield* helpers.removeCardFromPlayer(player.id, cardIds[0]);
      if (!removed) return;
      helpers.pushTableCard(removed, player.id, '武圣杀');
      helpers.moveToDiscard(removed);
      helpers.log(
        'skill',
        `${player.name} 发动【武圣】，将【${removed.displayName}】当【杀】对 ${target.name} 使用`,
        player.id,
        [target.id],
        [removed.id]
      );
      const vs: VirtualCard = {
        name: 'slash',
        displayName: '杀(武圣)',
        suit: removed.suit,
        rank: removed.rank,
        color: 'red',
        element: 'normal',
        subcards: [removed],
        sourceSkill: 'wusheng'
      };
      yield* helpers.resolveSlash(player, [target], vs, {
        countTowardLimit: true,
        useDrunkBonus: true
      });
    }
  });

  skills.registerResponse({
    id: 'skill_wusheng_resp',
    extraSlashCardIds: (_state, player) => {
      if (!hasActiveSkill(player, 'wusheng')) return [];
      return [...getUsableCards(player), ...getEquippedCards(player)]
        .filter((c) => getCardColor(c.suit) === 'red')
        .map((c) => c.id);
    }
  });

  // ===== 张飞：咆哮 =====
  modifiers.register({
    id: 'skill_paoxiao',
    slashLimitDelta: (_state, player) => (hasActiveSkill(player, 'paoxiao') ? 9999 : 0)
  });

  // ===== 诸葛亮：观星 & 空城 =====
  triggers.register({
    id: 'skill_guanxing',
    timing: 'PhaseStart',
    priority: 55,
    condition: (state, payload) => {
      if (payload.phase !== 'prepare' || !payload.playerId) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'guanxing'));
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const aliveCount = state.players.filter((x) => x.alive).length;
      const xCount = Math.min(5, Math.max(1, aliveCount));
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'guanxing',
        message: `准备阶段：是否发动【观星】观看牌堆顶 ${xCount} 张牌并调整牌序？`,
        options: [
          { id: 'yes', label: `发动【观星】(${xCount}张)` },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const cards = helpers.popTopCards(xCount);
      if (cards.length === 0) return;

      const resp = yield* helpers.ask({
        type: 'choose_guanxing',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        message: '【观星】：调整置于牌堆顶与牌堆底的牌及顺序',
        cards
      });

      let topCards = cards;
      let bottomCards: typeof cards = [];
      if (resp.type === 'choose_guanxing') {
        const byId = new Map(cards.map((c) => [c.id, c]));
        const seen = new Set<number>();
        topCards = [];
        bottomCards = [];
        for (const id of resp.topCardIds) {
          const c = byId.get(id);
          if (c && !seen.has(id)) {
            topCards.push(c);
            seen.add(id);
          }
        }
        for (const id of resp.bottomCardIds) {
          const c = byId.get(id);
          if (c && !seen.has(id)) {
            bottomCards.push(c);
            seen.add(id);
          }
        }
        // Any omitted card defaults to top
        for (const c of cards) {
          if (!seen.has(c.id)) topCards.push(c);
        }
      }

      helpers.putCardsOnTop(topCards);
      helpers.putCardsOnBottom(bottomCards);
      helpers.log(
        'skill',
        `${p.name} 发动【观星】，将 ${topCards.length} 张置于牌堆顶、${bottomCards.length} 张置于牌堆底`,
        p.id
      );
    }
  });

  modifiers.register({
    id: 'skill_kongcheng',
    canBeTargetedByCard: (_state, _source, target, cardName) => {
      if (!hasActiveSkill(target, 'kongcheng')) return true;
      if (target.hand.length > 0) return true;
      if (isSlashCardName(cardName) || cardName === 'duel') return false;
      return true;
    }
  });

  // ===== 赵云：龙胆（杀当闪、闪当杀）=====
  skills.registerActive({
    skillId: 'longdan',
    getPromptInfo: (state, player, mods) => {
      if (player.slashUsedThisTurn >= getSlashLimit(state, player, mods)) return null;
      const dodges = getUsableCards(player).filter((c) => c.name === 'dodge');
      if (dodges.length === 0) return null;
      let targets = state.players
        .filter(
          (t) =>
            t.alive &&
            t.id !== player.id &&
            isInAttackRange(state, player.id, t.id, mods) &&
            mods.canBeTargetedByCard(state, player, t, 'slash')
        )
        .map((t) => t.id);
      targets = mods.filterSlashTargets(state, player, targets);
      if (targets.length === 0) return null;
      return {
        skillId: 'longdan',
        name: '龙胆',
        description: '将一张【闪】当普通【杀】使用。',
        cardMin: 1,
        cardMax: 1,
        eligibleCardIds: dodges.map((c) => c.id),
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
      helpers.pushTableCard(removed, player.id, '龙胆杀');
      helpers.moveToDiscard(removed);
      helpers.log(
        'skill',
        `${player.name} 发动【龙胆】，将【闪】当【杀】对 ${target.name} 使用`,
        player.id,
        [target.id],
        [removed.id]
      );
      yield* helpers.checkHandEmptied(player.id, prevHand);
      const vs: VirtualCard = {
        name: 'slash',
        displayName: '杀(龙胆)',
        suit: removed.suit,
        rank: removed.rank,
        color: getCardColor(removed.suit),
        element: 'normal',
        subcards: [removed],
        sourceSkill: 'longdan'
      };
      yield* helpers.resolveSlash(player, [target], vs, {
        countTowardLimit: true,
        useDrunkBonus: true
      });
    }
  });

  skills.registerResponse({
    id: 'skill_longdan_resp',
    extraSlashCardIds: (_state, player) => {
      if (!hasActiveSkill(player, 'longdan')) return [];
      return getUsableCards(player)
        .filter((c) => c.name === 'dodge')
        .map((c) => c.id);
    },
    extraDodgeCardIds: (_state, player) => {
      if (!hasActiveSkill(player, 'longdan')) return [];
      return getUsableCards(player)
        .filter((c) => isSlashCardName(c.name))
        .map((c) => c.id);
    }
  });

  // ===== 马超：马术 & 铁骑 =====
  modifiers.register({
    id: 'skill_mashu',
    distanceDelta: (_state, from) => (hasActiveSkill(from, 'mashu') ? -1 : 0)
  });

  triggers.register({
    id: 'skill_tieqi',
    timing: 'TargetSpecified',
    priority: 50,
    condition: (state, payload) => {
      if (!payload.slashTarget) return false;
      const atk = state.players.find((p) => p.id === payload.slashTarget!.attackerId);
      return Boolean(atk && hasActiveSkill(atk, 'tieqi'));
    },
    *execute(state, payload, helpers) {
      const ctx = payload.slashTarget!;
      const atk = state.players.find((p) => p.id === ctx.attackerId)!;
      const dst = state.players.find((p) => p.id === ctx.targetId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: atk.id,
        reason: 'tieqi',
        message: `对 ${dst.name} 使用【杀】，是否发动【铁骑】判定（红色不可闪避）？`,
        options: [
          { id: 'yes', label: '发动【铁骑】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const judgeCard = yield* helpers.resolveJudge(atk.id, '铁骑');
      if (getCardColor(judgeCard.suit) === 'red') {
        ctx.cannotDodge = true;
        helpers.log('skill', `${atk.name} 【铁骑】判定红色，${dst.name} 不可使用【闪】响应！`, atk.id, [dst.id]);
      } else {
        helpers.log('skill', `${atk.name} 【铁骑】判定黑色，未生效`, atk.id);
      }
    }
  });

  // ===== 黄月英：集智 & 奇才 =====
  triggers.register({
    id: 'skill_jizhi',
    timing: 'CardUsed',
    priority: 50,
    condition: (state, payload) => {
      if (!payload.playerId || !payload.card) return false;
      if (payload.card.subtype !== 'normal_trick') return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'jizhi'));
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'jizhi',
        message: '使用普通锦囊牌，是否发动【集智】摸一张牌？',
        options: [
          { id: 'yes', label: '发动【集智】摸1牌' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type === 'choose_option' && opt.optionId === 'yes') {
        helpers.drawCards(p.id, 1);
        helpers.log('skill', `${p.name} 发动【集智】，摸了一张牌`, p.id);
      }
    }
  });

  modifiers.register({
    id: 'skill_qicai',
    trickDistanceUnlimited: (_state, player) => hasActiveSkill(player, 'qicai')
  });

  // Unused import guard for getDistance
  void getDistance;
}
