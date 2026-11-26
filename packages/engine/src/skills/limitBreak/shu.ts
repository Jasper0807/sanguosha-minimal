import {
  getCardColor,
  isSlashCardName,
  type CardInstance,
  type ModifierRegistry,
  type SkillRegistry,
  type TriggerRegistry,
  type VirtualCard
} from '../../index.js';
import { hasActiveSkill } from '../../core/events.js';
import { getSlashLimit, isInAttackRange } from '../../core/distance.js';
import {
  buildPlayerCardChoices,
  extractChoiceCard,
  getEquippedCards,
  getUsableCards,
  hasAnyCardInZones,
  removeUsableCard
} from '../../core/deck.js';
import { getAlivePlayersInOrder } from '../../core/targeting.js';

export function registerShuLimitBreakSkills(
  triggers: TriggerRegistry,
  modifiers: ModifierRegistry,
  skills: SkillRegistry
): void {
  // Turn-scoped resets for Shu Limit Break skills
  triggers.register({
    id: 'skill_lb_shu_turn_reset',
    timing: 'TurnStart',
    priority: 12,
    *execute(state, payload) {
      const p = state.players.find((x) => x.id === payload.playerId);
      if (!p) return;
      delete p.marks['lb_rende_given'];
      delete p.marks['lb_rende_used_basic'];
      delete p.marks['lb_yijue_used'];
      delete p.marks['lb_paoxiao_bonus'];
      delete p.marks['lb_jizhi_limit'];
      delete p.marks['lb_jianyan_used'];
      for (const k of Object.keys(p.marks)) {
        if (k.startsWith('lb_rende_tgt_')) delete p.marks[k];
      }
    }
  });

  triggers.register({
    id: 'skill_lb_shu_turn_end',
    timing: 'TurnEnd',
    priority: 12,
    *execute(state) {
      for (const p of state.players) {
        delete p.marks['lb_paoxiao_bonus'];
        delete p.marks['lb_jizhi_limit'];
        for (const k of Object.keys(p.marks)) {
          if (k.startsWith('lb_yijue_black_from_')) delete p.marks[k];
        }
      }
    }
  });

  // ===== 界刘备：仁德（每名角色限1次，给第2张时视为使用基本牌）=====
  skills.registerActive({
    skillId: 'lb_rende',
    getPromptInfo: (state, player) => {
      if (player.hand.length === 0) return null;
      const eligibleOthers = state.players
        .filter(
          (o) =>
            o.alive &&
            o.id !== player.id &&
            !player.marks[`lb_rende_tgt_${o.id}`]
        )
        .map((o) => o.id);
      if (eligibleOthers.length === 0) return null;
      return {
        skillId: 'lb_rende',
        name: '仁德',
        description:
          '出牌阶段每名角色限1次，交给任意张手牌；本阶段累计给出2张时可视为使用一张基本牌。',
        cardMin: 1,
        cardMax: player.hand.length,
        eligibleCardIds: player.hand.map((c) => c.id),
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: eligibleOthers
      };
    },
    *execute(state, player, cardIds, targetIds, helpers) {
      const target = state.players.find((p) => p.id === targetIds[0] && p.alive);
      if (!target || cardIds.length === 0 || player.marks[`lb_rende_tgt_${target.id}`]) {
        return;
      }

      const prevHand = player.hand.length;
      const given: CardInstance[] = [];
      for (const cid of cardIds) {
        const idx = player.hand.findIndex((c) => c.id === cid);
        if (idx !== -1) {
          const c = player.hand.splice(idx, 1)[0];
          target.hand.push(c);
          given.push(c);
        }
      }
      if (given.length === 0) return;

      player.marks[`lb_rende_tgt_${target.id}`] = 1;
      helpers.log(
        'skill',
        `${player.name} 发动界【仁德】，将 ${given.length} 张手牌交给了 ${target.name}`,
        player.id,
        [target.id]
      );
      yield* helpers.checkHandEmptied(player.id, prevHand);
      yield* helpers.notifyCardsObtained(target.id, given);

      const prevGiven = player.marks['lb_rende_given'] ?? 0;
      const nextGiven = prevGiven + given.length;
      player.marks['lb_rende_given'] = nextGiven;

      if (nextGiven >= 2 && !player.marks['lb_rende_used_basic'] && player.alive && !state.result) {
        player.marks['lb_rende_used_basic'] = 1;
        const options: { id: string; label: string }[] = [];
        if (player.hp < player.maxHp) {
          options.push({ id: 'peach', label: '视为使用【桃】（回复1血）' });
        }
        if (!player.drunk && player.drunkUsedThisTurn < 1) {
          options.push({ id: 'alcohol', label: '视为使用【酒】（下张杀伤害+1）' });
        }
        const canSlash = player.slashUsedThisTurn < getSlashLimit(state, player, modifiers);
        let slashTargets: string[] = [];
        if (canSlash) {
          slashTargets = state.players
            .filter(
              (t) =>
                t.alive &&
                t.id !== player.id &&
                isInAttackRange(state, player.id, t.id, modifiers) &&
                modifiers.canBeTargetedByCard(state, player, t, 'slash')
            )
            .map((t) => t.id);
          slashTargets = modifiers.filterSlashTargets(state, player, slashTargets);
          if (slashTargets.length > 0) {
            options.push({ id: 'slash', label: '视为使用一张普通【杀】' });
          }
        }
        options.push({ id: 'no', label: '不使用基本牌' });

        if (options.length > 1) {
          const opt = yield* helpers.ask({
            type: 'choose_option',
            promptId: helpers.nextPromptId(),
            playerId: player.id,
            reason: 'lb_rende_basic',
            message: '界【仁德】已给出至少2张牌：是否视为使用一张基本牌？',
            options
          });
          if (opt.type === 'choose_option') {
            if (opt.optionId === 'peach') {
              const healed = yield* helpers.healAsync(player.id, 1);
              if (healed > 0) {
                helpers.log('heal', `${player.name} 界【仁德】视为使用【桃】，回复 ${healed} 点体力`, player.id);
              }
            } else if (opt.optionId === 'alcohol') {
              player.drunk = true;
              player.drunkUsedThisTurn += 1;
              helpers.log('skill', `${player.name} 界【仁德】视为使用【酒】`, player.id);
            } else if (opt.optionId === 'slash' && slashTargets.length > 0) {
              const tgtPick = yield* helpers.ask({
                type: 'choose_target',
                promptId: helpers.nextPromptId(),
                playerId: player.id,
                reason: 'lb_rende_slash',
                message: '界【仁德】：选择视为使用【杀】的目标',
                minCount: 1,
                maxCount: 1,
                eligibleTargetIds: slashTargets,
                optional: true
              });
              if (tgtPick.type === 'choose_target' && !tgtPick.cancelled && tgtPick.targetIds[0]) {
                const dst = state.players.find((p) => p.id === tgtPick.targetIds[0] && p.alive);
                if (dst) {
                  const vs: VirtualCard = {
                    name: 'slash',
                    displayName: '杀(仁德)',
                    suit: 'none',
                    rank: 0,
                    color: 'none',
                    element: 'normal',
                    subcards: [],
                    sourceSkill: 'lb_rende'
                  };
                  yield* helpers.resolveSlash(player, [dst], vs, {
                    countTowardLimit: true,
                    useDrunkBonus: true
                  });
                }
              }
            }
          }
        }
      }
    }
  });

  // ===== 界刘备：激将（主公技：蜀将代杀 + 回合外用杀令主公摸1牌）=====
  skills.registerActive({
    skillId: 'lb_jijiang',
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
        skillId: 'lb_jijiang',
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
      helpers.log('skill', `${player.name} 对 ${target.name} 发动主公技界【激将】！`, player.id, [target.id]);

      for (const ally of shuAllies) {
        if (!ally.alive || ally.cannotPlayHandCardsThisTurn) continue;
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
          message: `界【激将】：是否为 ${player.name} 打出一张【杀】攻击 ${target.name}？`,
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
              sourceSkill: 'lb_jijiang'
            };
            yield* helpers.notifyOutOfTurnCard(ally.id, vs);
            yield* helpers.resolveSlash(player, [target], vs, {
              countTowardLimit: true,
              useDrunkBonus: true
            });
            return;
          }
        }
      }
    }
  });

  skills.registerResponse({
    id: 'skill_lb_jijiang_resp',
    *assistSlash(state, player, _reason, helpers) {
      if (!hasActiveSkill(player, 'lb_jijiang')) return null;
      const shuAllies = getAlivePlayersInOrder(state, player.id, false).filter(
        (p) => p.faction === 'shu'
      );
      if (shuAllies.length === 0) return null;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: player.id,
        reason: 'lb_jijiang',
        message: '是否发动主公技界【激将】，请求其他蜀势力角色替你打出一张【杀】？',
        options: [
          { id: 'yes', label: '发动【激将】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return null;

      for (const ally of shuAllies) {
        if (!ally.alive || ally.cannotPlayHandCardsThisTurn) continue;
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
          message: `界【激将】：是否为 ${player.name} 打出一张【杀】？`,
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
            const vs: VirtualCard = {
              name: isSlashCardName(removed.name) ? removed.name : 'slash',
              displayName: '杀(激将)',
              suit: removed.suit,
              rank: removed.rank,
              color: getCardColor(removed.suit),
              element: 'normal',
              subcards: [removed],
              sourceSkill: 'lb_jijiang'
            };
            yield* helpers.notifyOutOfTurnCard(ally.id, vs);
            return vs;
          }
        }
      }
      return null;
    }
  });

  triggers.register({
    id: 'skill_lb_jijiang_draw',
    timing: 'CardPlayedOrUsedOutOfTurn',
    priority: 45,
    condition: (state, payload) => {
      const ctx = payload.outOfTurnCard;
      if (!ctx || !isSlashCardName(ctx.card.name)) return false;
      const actor = state.players.find((p) => p.id === ctx.playerId);
      if (!actor || !actor.alive || actor.faction !== 'shu') return false;
      return state.players.some(
        (l) =>
          l.id !== actor.id &&
          hasActiveSkill(l, 'lb_jijiang') &&
          l.marks['lb_jijiang_draw_turn'] !== state.turn
      );
    },
    *execute(state, payload, helpers) {
      const actor = state.players.find((p) => p.id === payload.outOfTurnCard!.playerId)!;
      for (const lord of state.players) {
        if (
          lord.id === actor.id ||
          !hasActiveSkill(lord, 'lb_jijiang') ||
          lord.marks['lb_jijiang_draw_turn'] === state.turn
        ) {
          continue;
        }
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: actor.id,
          reason: 'lb_jijiang_draw',
          message: `界【激将】：是否令主公 ${lord.name} 摸一张牌？`,
          options: [
            { id: 'yes', label: `令 ${lord.name} 摸1牌` },
            { id: 'no', label: '不发动' }
          ]
        });
        if (opt.type === 'choose_option' && opt.optionId === 'yes') {
          lord.marks['lb_jijiang_draw_turn'] = state.turn;
          const drawn = helpers.drawCards(lord.id, 1);
          helpers.log('skill', `${actor.name} 触发【激将】，令 ${lord.name} 摸了一张牌`, actor.id, [lord.id]);
          if (drawn.length > 0) {
            yield* helpers.notifyCardsObtained(lord.id, drawn);
          }
        }
      }
    }
  });

  // ===== 界关羽：武圣（红牌当杀 + 方块杀无距离限制）& 义绝 =====
  modifiers.register({
    id: 'skill_lb_wusheng_diamond_range',
    slashDistanceUnlimited: (_state, source, _target, card) => {
      if (!hasActiveSkill(source, 'lb_wusheng')) return false;
      return card?.suit === 'diamond';
    }
  });

  skills.registerActive({
    skillId: 'lb_wusheng',
    getPromptInfo: (state, player, mods) => {
      if (player.slashUsedThisTurn >= getSlashLimit(state, player, mods)) return null;
      const reds = [...getUsableCards(player), ...getEquippedCards(player)].filter(
        (c) => getCardColor(c.suit) === 'red'
      );
      if (reds.length === 0) return null;
      const hasDiamond = reds.some((c) => c.suit === 'diamond');
      let targets = state.players
        .filter(
          (t) =>
            t.alive &&
            t.id !== player.id &&
            (hasDiamond || isInAttackRange(state, player.id, t.id, mods)) &&
            mods.canBeTargetedByCard(state, player, t, 'slash')
        )
        .map((t) => t.id);
      targets = mods.filterSlashTargets(state, player, targets);
      if (targets.length === 0) return null;
      return {
        skillId: 'lb_wusheng',
        name: '武圣',
        description: '将一张红色牌当【杀】使用；方块牌当【杀】无距离限制。',
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
      const cardPreview = [...getUsableCards(player), ...getEquippedCards(player)].find(
        (c) => c.id === cardIds[0]
      );
      if (!cardPreview || getCardColor(cardPreview.suit) !== 'red') return;
      // Validate distance for Heart cards (Diamond ignores distance!)
      if (
        cardPreview.suit !== 'diamond' &&
        !isInAttackRange(state, player.id, target.id, modifiers)
      ) {
        return;
      }

      const removed = yield* helpers.removeCardFromPlayer(player.id, cardIds[0]);
      if (!removed) return;
      helpers.pushTableCard(removed, player.id, '界武圣杀');
      helpers.moveToDiscard(removed);
      helpers.log(
        'skill',
        `${player.name} 发动界【武圣】，将【${removed.displayName}】当【杀】对 ${target.name} 使用`,
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
        sourceSkill: 'lb_wusheng'
      };
      yield* helpers.resolveSlash(player, [target], vs, {
        countTowardLimit: true,
        useDrunkBonus: true
      });
    }
  });

  skills.registerResponse({
    id: 'skill_lb_wusheng_resp',
    extraSlashCardIds: (_state, player) => {
      if (!hasActiveSkill(player, 'lb_wusheng')) return [];
      return [...getUsableCards(player), ...getEquippedCards(player)]
        .filter((c) => getCardColor(c.suit) === 'red')
        .map((c) => c.id);
    }
  });

  skills.registerActive({
    skillId: 'lb_yijue',
    getPromptInfo: (state, player) => {
      if (player.marks['lb_yijue_used']) return null;
      const costCards = [...getUsableCards(player), ...getEquippedCards(player)];
      if (costCards.length === 0) return null;
      const targets = state.players
        .filter((o) => o.alive && o.id !== player.id && o.hand.length > 0)
        .map((o) => o.id);
      if (targets.length === 0) return null;
      return {
        skillId: 'lb_yijue',
        name: '义绝',
        description:
          '出牌阶段限1次，弃1牌令目标展示1张手牌：黑色封技能+禁手牌+红桃杀伤+1；红色获得之并可令其回1血。',
        cardMin: 1,
        cardMax: 1,
        eligibleCardIds: costCards.map((c) => c.id),
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: targets
      };
    },
    *execute(state, player, cardIds, targetIds, helpers) {
      const target = state.players.find((p) => p.id === targetIds[0] && p.alive);
      if (!target || cardIds.length !== 1 || target.hand.length === 0 || player.marks['lb_yijue_used']) {
        return;
      }
      player.marks['lb_yijue_used'] = 1;
      yield* helpers.discardCards(player.id, [cardIds[0]]);
      if (!target.alive || target.hand.length === 0) return;

      const showResp = yield* helpers.ask({
        type: 'choose_card',
        promptId: helpers.nextPromptId(),
        playerId: target.id,
        reason: 'general_skill',
        message: `${player.name} 发动了【义绝】，请选择展示一张手牌`,
        minCount: 1,
        maxCount: 1,
        eligibleCardIds: target.hand.map((c) => c.id),
        optional: false
      });
      const shownId =
        showResp.type === 'choose_card' && showResp.cardIds[0]
          ? showResp.cardIds[0]
          : target.hand[0].id;
      const shownIdx = target.hand.findIndex((c) => c.id === shownId);
      const shownCard = target.hand[shownIdx === -1 ? 0 : shownIdx];
      if (!shownCard) return;

      helpers.pushTableCard(shownCard, target.id, '义绝展示');
      if (getCardColor(shownCard.suit) === 'black') {
        target.nonCompulsoryDisabledThisTurn = true;
        target.cannotPlayHandCardsThisTurn = true;
        target.marks[`lb_yijue_black_from_${player.id}`] = state.turn;
        helpers.log(
          'skill',
          `${target.name} 展示黑色牌【${shownCard.displayName}】，本回合非锁定技失效、不能使用/打出手牌，且受 ${player.name} 红桃【杀】伤害+1！`,
          player.id,
          [target.id]
        );
      } else {
        const prevHand = target.hand.length;
        const idx = target.hand.findIndex((c) => c.id === shownCard.id);
        if (idx !== -1) {
          const taken = target.hand.splice(idx, 1)[0];
          player.hand.push(taken);
          helpers.log('skill', `${target.name} 展示红色牌【${taken.displayName}】，${player.name} 获得了此牌`, player.id, [target.id]);
          yield* helpers.checkHandEmptied(target.id, prevHand);
          yield* helpers.notifyCardsObtained(player.id, [taken]);
        }
        if (target.alive && target.hp < target.maxHp && !state.result) {
          const healOpt = yield* helpers.ask({
            type: 'choose_option',
            promptId: helpers.nextPromptId(),
            playerId: player.id,
            reason: 'lb_yijue_heal',
            message: `【义绝】：是否令 ${target.name} 回复 1 点体力？`,
            options: [
              { id: 'yes', label: `令 ${target.name} 回复1血` },
              { id: 'no', label: '不回复' }
            ]
          });
          if (healOpt.type === 'choose_option' && healOpt.optionId === 'yes') {
            yield* helpers.healAsync(target.id, 1);
          }
        }
      }
    }
  });

  triggers.register({
    id: 'skill_lb_yijue_heart_bonus',
    timing: 'DamageDealt',
    priority: 65,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.prevented || dmg.isChainDamage || !dmg.sourceId || !dmg.card) return false;
      if (!isSlashCardName(dmg.card.name) || dmg.card.suit !== 'heart') return false;
      const target = state.players.find((p) => p.id === dmg.targetId);
      return Boolean(target && target.marks[`lb_yijue_black_from_${dmg.sourceId}`] === state.turn);
    },
    *execute(_state, payload, helpers) {
      payload.damage!.amount += 1;
      helpers.log('skill', `【义绝】红桃【杀】生效，伤害+1（当前 ${payload.damage!.amount} 点）`, payload.damage!.sourceId ?? undefined, [payload.damage!.targetId]);
    }
  });

  // ===== 界张飞：咆哮（无限杀 + 被闪下张杀伤+1）& 替身（限定技）=====
  modifiers.register({
    id: 'skill_lb_paoxiao_limit',
    slashLimitDelta: (_state, player) => (hasActiveSkill(player, 'lb_paoxiao') ? 9999 : 0)
  });

  triggers.register({
    id: 'skill_lb_paoxiao_missed',
    timing: 'SlashMissed',
    priority: 50,
    condition: (state, payload) => {
      if (!payload.playerId) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'lb_paoxiao'));
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      p.marks['lb_paoxiao_bonus'] = (p.marks['lb_paoxiao_bonus'] ?? 0) + 1;
      helpers.log('skill', `${p.name} 界【咆哮】触发，本回合下一次【杀】伤害+${p.marks['lb_paoxiao_bonus']}！`, p.id);
    }
  });

  triggers.register({
    id: 'skill_lb_paoxiao_damage',
    timing: 'DamageDealt',
    priority: 68,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.prevented || dmg.isChainDamage || !dmg.sourceId || !dmg.card) return false;
      if (!isSlashCardName(dmg.card.name)) return false;
      const src = state.players.find((p) => p.id === dmg.sourceId);
      return Boolean(src && (src.marks['lb_paoxiao_bonus'] ?? 0) > 0);
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const src = state.players.find((p) => p.id === dmg.sourceId)!;
      const bonus = src.marks['lb_paoxiao_bonus'] ?? 0;
      delete src.marks['lb_paoxiao_bonus'];
      dmg.amount += bonus;
      helpers.log('skill', `${src.name} 界【咆哮】增伤生效，【杀】伤害+${bonus}（当前 ${dmg.amount} 点）`, src.id, [dmg.targetId]);
    }
  });

  triggers.register({
    id: 'skill_lb_tishen',
    timing: 'PhaseStart',
    priority: 56,
    condition: (state, payload) => {
      if (payload.phase !== 'prepare' || !payload.playerId) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(
        p &&
          hasActiveSkill(p, 'lb_tishen') &&
          !p.marks['lb_tishen_used'] &&
          p.hp < p.maxHp
      );
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const missing = p.maxHp - p.hp;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'lb_tishen',
        message: `准备阶段：是否发动限定技【替身】，回复所有体力（+${missing}血）并摸 ${missing} 张牌？`,
        options: [
          { id: 'yes', label: `发动【替身】（回${missing}血摸${missing}牌）` },
          { id: 'no', label: '保留限定技' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      p.marks['lb_tishen_used'] = 1;
      const healed = yield* helpers.healAsync(p.id, missing);
      if (healed > 0) {
        const drawn = helpers.drawCards(p.id, healed);
        helpers.log(
          'skill',
          `${p.name} 发动限定技【替身】，回复 ${healed} 点体力并摸了 ${drawn.length} 张牌！`,
          p.id
        );
        if (drawn.length > 0) {
          yield* helpers.notifyCardsObtained(p.id, drawn);
        }
      }
    }
  });

  // ===== 界诸葛亮：观星（5张/<4人改3张；全放底结束阶段再观星）=====
  triggers.register({
    id: 'skill_lb_guanxing',
    timing: 'PhaseStart',
    priority: 55,
    condition: (state, payload) => {
      if (!payload.playerId) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      if (!p || !hasActiveSkill(p, 'lb_guanxing')) return false;
      if (payload.phase === 'prepare') return true;
      if (payload.phase === 'finish' && p.marks['lb_guanxing_finish'] === state.turn) {
        return true;
      }
      return false;
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const aliveCount = state.players.filter((x) => x.alive).length;
      const xCount = aliveCount < 4 ? 3 : 5;
      const isFinish = payload.phase === 'finish';

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'lb_guanxing',
        message: `${isFinish ? '结束阶段' : '准备阶段'}：是否发动界【观星】观看牌堆顶 ${xCount} 张牌？`,
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
        message: '界【观星】：调整牌堆顶与牌堆底顺序（准备阶段全置底可于结束阶段再观星）',
        cards
      });

      let topCards = cards;
      let bottomCards: CardInstance[] = [];
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
        for (const c of cards) {
          if (!seen.has(c.id)) topCards.push(c);
        }
      }

      helpers.putCardsOnTop(topCards);
      helpers.putCardsOnBottom(bottomCards);
      if (!isFinish && topCards.length === 0) {
        p.marks['lb_guanxing_finish'] = state.turn;
      }
      helpers.log(
        'skill',
        `${p.name} 发动界【观星】，将 ${topCards.length} 张置于牌堆顶、${bottomCards.length} 张置于牌堆底`,
        p.id
      );
    }
  });

  // ===== 界赵云：龙胆（杀↔闪、酒↔桃）& 涯角 =====
  skills.registerActive({
    skillId: 'lb_longdan',
    getPromptInfo: (state, player, mods) => {
      const usable = getUsableCards(player);
      const canSlash = player.slashUsedThisTurn < getSlashLimit(state, player, mods);
      let slashTargets: string[] = [];
      if (canSlash) {
        slashTargets = state.players
          .filter(
            (t) =>
              t.alive &&
              t.id !== player.id &&
              isInAttackRange(state, player.id, t.id, mods) &&
              mods.canBeTargetedByCard(state, player, t, 'slash')
          )
          .map((t) => t.id);
        slashTargets = mods.filterSlashTargets(state, player, slashTargets);
      }

      const eligibleCards = usable.filter((c) => {
        if (c.name === 'dodge') return canSlash && slashTargets.length > 0;
        if (c.name === 'alcohol') return player.hp < player.maxHp;
        if (c.name === 'peach') return !player.drunk && player.drunkUsedThisTurn < 1;
        return false;
      });
      if (eligibleCards.length === 0) return null;

      return {
        skillId: 'lb_longdan',
        name: '龙胆',
        description: '将【闪】当【杀】、【酒】当【桃】回复体力，或将【桃】当【酒】使用。',
        cardMin: 1,
        cardMax: 1,
        eligibleCardIds: eligibleCards.map((c) => c.id),
        targetMin: 0,
        targetMax: slashTargets.length > 0 ? 1 : 0,
        eligibleTargetIds: slashTargets
      };
    },
    *execute(state, player, cardIds, targetIds, helpers) {
      if (cardIds.length !== 1) return;
      const preview = getUsableCards(player).find((c) => c.id === cardIds[0]);
      if (!preview) return;

      if (preview.name === 'dodge') {
        let target = targetIds[0]
          ? state.players.find((p) => p.id === targetIds[0] && p.alive)
          : undefined;
        if (!target) {
          let slashTargets = state.players
            .filter(
              (t) =>
                t.alive &&
                t.id !== player.id &&
                isInAttackRange(state, player.id, t.id, modifiers) &&
                modifiers.canBeTargetedByCard(state, player, t, 'slash')
            )
            .map((t) => t.id);
          slashTargets = modifiers.filterSlashTargets(state, player, slashTargets);
          if (slashTargets.length === 0) return;
          const pick = yield* helpers.ask({
            type: 'choose_target',
            promptId: helpers.nextPromptId(),
            playerId: player.id,
            reason: 'lb_longdan_target',
            message: '界【龙胆】：选择将【闪】当【杀】攻击的目标',
            minCount: 1,
            maxCount: 1,
            eligibleTargetIds: slashTargets,
            optional: true
          });
          if (pick.type !== 'choose_target' || pick.cancelled || !pick.targetIds[0]) return;
          target = state.players.find((p) => p.id === pick.targetIds[0] && p.alive);
        }
        if (!target) return;

        const prevHand = player.hand.length;
        const removed = removeUsableCard(player, preview.id);
        if (!removed) return;
        helpers.pushTableCard(removed, player.id, '龙胆杀');
        helpers.moveToDiscard(removed);
        yield* helpers.checkHandEmptied(player.id, prevHand);
        const vs: VirtualCard = {
          name: 'slash',
          displayName: '杀(龙胆)',
          suit: removed.suit,
          rank: removed.rank,
          color: getCardColor(removed.suit),
          element: 'normal',
          subcards: [removed],
          sourceSkill: 'lb_longdan'
        };
        yield* helpers.resolveSlash(player, [target], vs, {
          countTowardLimit: true,
          useDrunkBonus: true
        });
      } else if (preview.name === 'alcohol' && player.hp < player.maxHp) {
        const prevHand = player.hand.length;
        const removed = removeUsableCard(player, preview.id);
        if (!removed) return;
        helpers.pushTableCard(removed, player.id, '龙胆桃');
        helpers.moveToDiscard(removed);
        yield* helpers.checkHandEmptied(player.id, prevHand);
        const healed = yield* helpers.healAsync(player.id, 1);
        helpers.log('heal', `${player.name} 发动界【龙胆】，将【酒】当【桃】回复 ${healed} 点体力`, player.id);
      } else if (preview.name === 'peach' && !player.drunk && player.drunkUsedThisTurn < 1) {
        const prevHand = player.hand.length;
        const removed = removeUsableCard(player, preview.id);
        if (!removed) return;
        helpers.pushTableCard(removed, player.id, '龙胆酒');
        helpers.moveToDiscard(removed);
        yield* helpers.checkHandEmptied(player.id, prevHand);
        player.drunk = true;
        player.drunkUsedThisTurn += 1;
        helpers.log('skill', `${player.name} 发动界【龙胆】，将【桃】当【酒】使用！`, player.id);
      }
    }
  });

  skills.registerResponse({
    id: 'skill_lb_longdan_resp',
    extraSlashCardIds: (_state, player) => {
      if (!hasActiveSkill(player, 'lb_longdan')) return [];
      return getUsableCards(player)
        .filter((c) => c.name === 'dodge')
        .map((c) => c.id);
    },
    extraDodgeCardIds: (_state, player) => {
      if (!hasActiveSkill(player, 'lb_longdan')) return [];
      return getUsableCards(player)
        .filter((c) => isSlashCardName(c.name))
        .map((c) => c.id);
    },
    extraDyingPeachCardIds: (_state, helper) => {
      if (!hasActiveSkill(helper, 'lb_longdan')) return [];
      return getUsableCards(helper)
        .filter((c) => c.name === 'alcohol')
        .map((c) => c.id);
    }
  });

  triggers.register({
    id: 'skill_lb_yajiao',
    timing: 'CardPlayedOrUsedOutOfTurn',
    priority: 50,
    condition: (state, payload) => {
      const ctx = payload.outOfTurnCard;
      if (!ctx) return false;
      const p = state.players.find((x) => x.id === ctx.playerId);
      return Boolean(p && hasActiveSkill(p, 'lb_yajiao'));
    },
    *execute(state, payload, helpers) {
      const ctx = payload.outOfTurnCard!;
      const p = state.players.find((x) => x.id === ctx.playerId)!;
      const usedCategory =
        'category' in ctx.card
          ? ctx.card.category
          : ctx.card.subcards[0]?.category ?? 'basic';

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'lb_yajiao',
        message: '回合外使用/打出手牌：是否发动【涯角】展示牌堆顶一张牌？',
        options: [
          { id: 'yes', label: '发动【涯角】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const popped = helpers.popTopCards(1);
      if (popped.length === 0) return;
      const topCard = popped[0];
      helpers.pushTableCard(topCard, p.id, '涯角展示');

      if (topCard.category === usedCategory) {
        const aliveIds = state.players.filter((x) => x.alive).map((x) => x.id);
        const pick = yield* helpers.ask({
          type: 'choose_target',
          promptId: helpers.nextPromptId(),
          playerId: p.id,
          reason: 'lb_yajiao_give',
          message: `【涯角】类别相同（【${topCard.displayName}】）：选择令一名角色获得此牌`,
          minCount: 1,
          maxCount: 1,
          eligibleTargetIds: aliveIds,
          optional: true
        });
        if (pick.type === 'choose_target' && !pick.cancelled && pick.targetIds[0]) {
          const receiver = state.players.find((x) => x.id === pick.targetIds[0] && x.alive);
          if (receiver) {
            receiver.hand.push(topCard);
            helpers.log('skill', `${p.name} 【涯角】类别相同，令 ${receiver.name} 获得了【${topCard.displayName}】`, p.id, [receiver.id]);
            yield* helpers.notifyCardsObtained(receiver.id, [topCard]);
            return;
          }
        }
        helpers.moveToDiscard(topCard);
      } else {
        helpers.moveToDiscard(topCard);
        const threatening = state.players
          .filter(
            (o) =>
              o.alive &&
              o.id !== p.id &&
              isInAttackRange(state, o.id, p.id, modifiers) &&
              hasAnyCardInZones(o, true)
          )
          .map((o) => o.id);
        if (threatening.length === 0) {
          helpers.log('skill', `${p.name} 【涯角】展示【${topCard.displayName}】类别不同，无合法弃牌目标`, p.id);
          return;
        }
        const pick = yield* helpers.ask({
          type: 'choose_target',
          promptId: helpers.nextPromptId(),
          playerId: p.id,
          reason: 'lb_yajiao_discard',
          message: `【涯角】类别不同：可选择攻击范围内包含你的一名角色弃置其区域内一张牌`,
          minCount: 1,
          maxCount: 1,
          eligibleTargetIds: threatening,
          optional: true
        });
        if (pick.type === 'choose_target' && !pick.cancelled && pick.targetIds[0]) {
          const victim = state.players.find((x) => x.id === pick.targetIds[0] && x.alive);
          if (victim) {
            const choices = buildPlayerCardChoices(victim, {
              includeHand: true,
              includeEquips: true,
              includeJudge: true
            }).filter(
              (ch) =>
                ch.zone === 'hand' ||
                ch.zone === 'judge' ||
                helpers.canDiscardPlayerEquip(p.id, victim.id, ch.zone as 'weapon')
            );
            if (choices.length > 0) {
              const cardPick = yield* helpers.ask({
                type: 'choose_player_card',
                promptId: helpers.nextPromptId(),
                playerId: p.id,
                targetId: victim.id,
                reason: 'dismantle',
                message: `【涯角】：弃置 ${victim.name} 区域内的一张牌`,
                choices
              });
              const idx = cardPick.type === 'choose_player_card' ? cardPick.choiceIndex : 0;
              const prevHand = victim.hand.length;
              const ex = extractChoiceCard(victim, choices[idx] ?? choices[0]);
              if (ex) {
                helpers.moveToDiscard(ex.card);
                for (const ox of ex.lostWoodenOxStash) helpers.moveToDiscard(ox);
                helpers.log('skill', `${p.name} 【涯角】弃置了 ${victim.name} 的【${ex.card.displayName}】`, p.id, [victim.id]);
                if (ex.wasEquip) yield* helpers.fireEquipLost(victim.id, ex.card);
                yield* helpers.checkHandEmptied(victim.id, prevHand);
              }
            }
          }
        }
      }
    }
  });

  // ===== 界马超：铁骑（封非锁定技 + 判定同花色弃牌否则强中）=====
  triggers.register({
    id: 'skill_lb_tieqi',
    timing: 'TargetSpecified',
    priority: 52,
    condition: (state, payload) => {
      if (!payload.slashTarget) return false;
      const atk = state.players.find((p) => p.id === payload.slashTarget!.attackerId);
      return Boolean(atk && hasActiveSkill(atk, 'lb_tieqi'));
    },
    *execute(state, payload, helpers) {
      const ctx = payload.slashTarget!;
      const atk = state.players.find((p) => p.id === ctx.attackerId)!;
      const dst = state.players.find((p) => p.id === ctx.targetId)!;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: atk.id,
        reason: 'lb_tieqi',
        message: `对 ${dst.name} 使用【杀】，是否发动界【铁骑】（封非锁定技+判花色强中）？`,
        options: [
          { id: 'yes', label: '发动【铁骑】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      dst.nonCompulsoryDisabledThisTurn = true;
      helpers.log('skill', `${atk.name} 发动界【铁骑】，${dst.name} 本回合非锁定技失效！`, atk.id, [dst.id]);

      const judgeCard = yield* helpers.resolveJudge(atk.id, '界铁骑');
      if (state.result || !dst.alive) return;

      const matching = [...getUsableCards(dst), ...getEquippedCards(dst)].filter(
        (c) => c.suit === judgeCard.suit
      );
      if (matching.length === 0) {
        ctx.cannotDodge = true;
        helpers.log('skill', `${dst.name} 无 ${judgeCard.suit} 花色牌可弃，不可抵消此【杀】！`, atk.id, [dst.id]);
        return;
      }

      const discResp = yield* helpers.ask({
        type: 'choose_card',
        promptId: helpers.nextPromptId(),
        playerId: dst.id,
        reason: 'general_skill',
        message: `界【铁骑】：请弃置一张 ${judgeCard.suit} 花色牌，否则不能抵消此【杀】`,
        minCount: 1,
        maxCount: 1,
        eligibleCardIds: matching.map((c) => c.id),
        optional: true
      });
      if (discResp.type === 'choose_card' && !discResp.cancelled && discResp.cardIds.length === 1) {
        yield* helpers.discardCards(dst.id, [discResp.cardIds[0]]);
        helpers.log('skill', `${dst.name} 弃置同花色牌抵御界【铁骑】`, dst.id);
      } else {
        ctx.cannotDodge = true;
        helpers.log('skill', `${dst.name} 未弃置同花色牌，不可抵消此【杀】！`, atk.id, [dst.id]);
      }
    }
  });

  // ===== 界黄月英：集智（摸1；基本牌可弃并+1手牌上限）& 奇才（锦囊无距 + 防具/宝物不被他人弃置）=====
  triggers.register({
    id: 'skill_lb_jizhi',
    timing: 'CardUsed',
    priority: 52,
    condition: (state, payload) => {
      if (!payload.playerId || !payload.card) return false;
      if (payload.card.subtype !== 'normal_trick') return false;
      if (payload.virtualCard?.sourceSkill) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'lb_jizhi'));
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'lb_jizhi',
        message: '使用非转化锦囊牌，是否发动界【集智】摸一张牌？',
        options: [
          { id: 'yes', label: '发动【集智】摸1牌' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const drawn = helpers.drawCards(p.id, 1);
      if (drawn.length === 0) return;
      const card = drawn[0];
      helpers.log('skill', `${p.name} 发动界【集智】，摸了一张牌`, p.id);
      yield* helpers.notifyCardsObtained(p.id, drawn);

      if (card.category === 'basic' && p.hand.some((c) => c.id === card.id) && p.alive && !state.result) {
        const discOpt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: p.id,
          reason: 'lb_jizhi_discard',
          message: `【集智】摸到基本牌【${card.displayName}】，是否弃置它令本回合手牌上限+1？`,
          options: [
            { id: 'yes', label: '弃置并手牌上限+1' },
            { id: 'no', label: '保留此牌' }
          ]
        });
        if (discOpt.type === 'choose_option' && discOpt.optionId === 'yes') {
          yield* helpers.discardCards(p.id, [card.id]);
          p.marks['lb_jizhi_limit'] = (p.marks['lb_jizhi_limit'] ?? 0) + 1;
          helpers.log('skill', `${p.name} 弃置【${card.displayName}】，本回合手牌上限+1`, p.id);
        }
      }
    }
  });

  modifiers.register({
    id: 'skill_lb_jizhi_limit_delta',
    handLimitDelta: (_state, player) => player.marks['lb_jizhi_limit'] ?? 0
  });

  modifiers.register({
    id: 'skill_lb_qicai',
    trickDistanceUnlimited: (_state, player) => hasActiveSkill(player, 'lb_qicai'),
    canDiscardEquip: (_state, actor, target, slot) => {
      if (!hasActiveSkill(target, 'lb_qicai')) return true;
      if (actor.id === target.id) return true;
      return slot !== 'armor' && slot !== 'treasure';
    }
  });

  // ===== 界徐庶：诛害 + 潜心(觉醒) + 荐言 =====
  triggers.register({
    id: 'skill_lb_zhuhai',
    timing: 'PhaseStart',
    priority: 48,
    condition: (state, payload) => {
      if (payload.phase !== 'finish' || !payload.playerId) return false;
      const turnPlayer = state.players.find((x) => x.id === payload.playerId);
      if (!turnPlayer || !turnPlayer.alive) return false;
      if ((state.turnDamageDealtByPlayer[turnPlayer.id] ?? 0) <= 0) return false;
      return state.players.some(
        (p) => p.id !== turnPlayer.id && hasActiveSkill(p, 'lb_zhuhai')
      );
    },
    *execute(state, payload, helpers) {
      const turnPlayer = state.players.find((x) => x.id === payload.playerId)!;
      const order = getAlivePlayersInOrder(state, turnPlayer.id, false);
      for (const p of order) {
        if (state.result || !turnPlayer.alive || !hasActiveSkill(p, 'lb_zhuhai')) continue;
        if (!modifiers.canBeTargetedByCard(state, p, turnPlayer, 'slash')) continue;
        const extraIds = skills.getExtraSlashCardIds(state, p);
        const slashes = [...getUsableCards(p), ...getEquippedCards(p)].filter(
          (c) => isSlashCardName(c.name) || extraIds.includes(c.id)
        );
        if (slashes.length === 0) continue;

        const resp = yield* helpers.ask({
          type: 'choose_card',
          promptId: helpers.nextPromptId(),
          playerId: p.id,
          reason: 'general_skill',
          message: `【诛害】：${turnPlayer.name} 本回合造成过伤害，是否对其使用一张【杀】？`,
          minCount: 1,
          maxCount: 1,
          eligibleCardIds: slashes.map((c) => c.id),
          optional: true
        });
        if (resp.type === 'choose_card' && !resp.cancelled && resp.cardIds.length === 1) {
          const removed = yield* helpers.removeCardFromPlayer(p.id, resp.cardIds[0]);
          if (removed) {
            helpers.pushTableCard(removed, p.id, '诛害杀');
            helpers.moveToDiscard(removed);
            helpers.log('skill', `${p.name} 发动【诛害】，对 ${turnPlayer.name} 使用【${removed.displayName}】！`, p.id, [turnPlayer.id]);
            const vs: VirtualCard = {
              name: isSlashCardName(removed.name) ? removed.name : 'slash',
              displayName: isSlashCardName(removed.name) ? removed.displayName : '杀(诛害)',
              suit: removed.suit,
              rank: removed.rank,
              color: getCardColor(removed.suit),
              element: isSlashCardName(removed.name) ? (removed.element ?? 'normal') : 'normal',
              subcards: [removed],
              sourceSkill: 'lb_zhuhai'
            };
            yield* helpers.notifyOutOfTurnCard(p.id, vs);
            yield* helpers.resolveSlash(p, [turnPlayer], vs, {
              countTowardLimit: false,
              useDrunkBonus: false
            });
          }
        }
      }
    }
  });

  triggers.register({
    id: 'skill_lb_qianxin',
    timing: 'AfterDamageDealt',
    priority: 55,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.actualDeducted <= 0 || !dmg.sourceId) return false;
      const src = state.players.find((p) => p.id === dmg.sourceId);
      return Boolean(
        src &&
          hasActiveSkill(src, 'lb_qianxin') &&
          !src.marks['lb_qianxin_awake'] &&
          src.hp < src.maxHp
      );
    },
    *execute(state, payload, helpers) {
      const src = state.players.find((p) => p.id === payload.damage!.sourceId)!;
      src.marks['lb_qianxin_awake'] = 1;
      helpers.log('skill', `${src.name} 觉醒技【潜心】触发！减少1点体力上限并获得【荐言】！`, src.id);
      yield* helpers.changeMaxHp(src.id, -1);
      if (src.alive) {
        helpers.gainSkill(src.id, 'lb_jianyan');
      }
    }
  });

  skills.registerActive({
    skillId: 'lb_jianyan',
    getPromptInfo: (state, player) => {
      if (player.marks['lb_jianyan_used']) return null;
      const males = state.players.filter((p) => p.alive && p.gender === 'male');
      if (males.length === 0) return null;
      return {
        skillId: 'lb_jianyan',
        name: '荐言',
        description: '出牌阶段限1次，声明一种类别或颜色，亮出牌堆顶直至符合，令一名男性角色获得之。',
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
      if (player.marks['lb_jianyan_used']) return;
      player.marks['lb_jianyan_used'] = 1;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: player.id,
        reason: 'lb_jianyan_declare',
        message: '【荐言】：请选择声明一种牌的类别或颜色',
        options: [
          { id: 'basic', label: '基本牌' },
          { id: 'trick', label: '锦囊牌' },
          { id: 'equip', label: '装备牌' },
          { id: 'red', label: '红色牌' },
          { id: 'black', label: '黑色牌' }
        ]
      });
      const decl = opt.type === 'choose_option' ? opt.optionId : 'trick';

      const matches = (c: CardInstance): boolean => {
        if (decl === 'basic' || decl === 'trick' || decl === 'equip') return c.category === decl;
        return getCardColor(c.suit) === decl;
      };

      const missed: CardInstance[] = [];
      let found: CardInstance | null = null;
      const maxSearch = Math.max(1, state.drawPile.length + state.discardPile.length);
      for (let i = 0; i < maxSearch; i++) {
        const popped = helpers.popTopCards(1);
        if (popped.length === 0) break;
        const c = popped[0];
        if (matches(c)) {
          found = c;
          break;
        }
        missed.push(c);
      }

      if (found) {
        helpers.pushTableCard(found, player.id, '荐言亮出');
        const males = state.players.filter((p) => p.alive && p.gender === 'male').map((p) => p.id);
        const pick = yield* helpers.ask({
          type: 'choose_target',
          promptId: helpers.nextPromptId(),
          playerId: player.id,
          reason: 'lb_jianyan_target',
          message: `【荐言】找到【${found.displayName}】，选择令哪名男性角色获得此牌`,
          minCount: 1,
          maxCount: 1,
          eligibleTargetIds: males,
          optional: false
        });
        const rid = pick.type === 'choose_target' && pick.targetIds[0] ? pick.targetIds[0] : males[0];
        const receiver = state.players.find((p) => p.id === rid && p.alive) ?? player;
        receiver.hand.push(found);
        helpers.log('skill', `${player.name} 【荐言】令 ${receiver.name} 获得了【${found.displayName}】`, player.id, [receiver.id]);
        yield* helpers.notifyCardsObtained(receiver.id, [found]);
      }
      for (const m of missed) helpers.moveToDiscard(m);
    }
  });
}
