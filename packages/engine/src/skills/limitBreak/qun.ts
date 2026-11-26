import {
  getCardColor,
  isSlashCardName,
  type EquipSlot,
  type Faction,
  type ModifierRegistry,
  type SkillRegistry,
  type TriggerRegistry,
  type VirtualCard
} from '../../index.js';
import { hasActiveSkill } from '../../core/events.js';
import { getSkillMetaById } from '../../data/generals/index.js';
import {
  buildPlayerCardChoices,
  extractChoiceCard,
  getEquippedCards,
  getUsableCards,
  hasAnyCardInZones
} from '../../core/deck.js';
import { getAlivePlayersInOrder } from '../../core/targeting.js';

export function registerQunLimitBreakSkills(
  triggers: TriggerRegistry,
  modifiers: ModifierRegistry,
  skills: SkillRegistry
): void {
  // Turn-scoped resets for Qun Limit Break skills
  triggers.register({
    id: 'skill_lb_qun_turn_reset',
    timing: 'TurnStart',
    priority: 12,
    *execute(state, payload) {
      const p = state.players.find((x) => x.id === payload.playerId);
      if (!p) return;
      delete p.marks['lb_chuli_used'];
      delete p.marks['lb_shizhan_used'];
      p.marks['lb_jixi_lost_this_turn'] = 0;
    }
  });

  // ===== 界华佗：除疠（出牌限1次，选势力各不相同的其他角色，弃己与这些角色各1牌，黑桃摸1）=====
  skills.registerActive({
    skillId: 'lb_chuli',
    getPromptInfo: (state, player, mods) => {
      if (player.marks['lb_chuli_used']) return null;
      const selfCards = [...getUsableCards(player), ...getEquippedCards(player)];
      if (selfCards.length === 0) return null;
      const eligibleTargets = state.players.filter((o) => {
        if (!o.alive || o.id === player.id) return false;
        const choices = buildPlayerCardChoices(o, {
          includeHand: true,
          includeEquips: true,
          includeJudge: false
        }).filter((ch) =>
          ch.zone === 'hand' || ch.zone === 'judge'
            ? true
            : mods.canDiscardEquip(state, player, o, ch.zone)
        );
        return choices.length > 0;
      });
      if (eligibleTargets.length === 0) return null;
      const uniqueFactions = new Set(eligibleTargets.map((t) => t.faction));
      return {
        skillId: 'lb_chuli',
        name: '除疠',
        description:
          '出牌阶段限1次，选任意名势力各不相同的其他角色，弃置你与这些角色各1张牌，弃黑桃者摸1牌。',
        cardMin: 0,
        cardMax: 0,
        eligibleCardIds: [],
        targetMin: 1,
        targetMax: uniqueFactions.size,
        eligibleTargetIds: eligibleTargets.map((t) => t.id)
      };
    },
    *execute(state, player, _cardIds, targetIds, helpers) {
      if (player.marks['lb_chuli_used'] || targetIds.length === 0) return;

      // Deduplicate by faction (keep first chosen target per faction)
      const seenFactions = new Set<Faction>();
      const validTargets: string[] = [];
      for (const tid of targetIds) {
        const t = state.players.find((p) => p.id === tid && p.alive && p.id !== player.id);
        if (!t || seenFactions.has(t.faction)) continue;
        seenFactions.add(t.faction);
        validTargets.push(t.id);
      }
      if (validTargets.length === 0) return;

      const selfCards = [...getUsableCards(player), ...getEquippedCards(player)];
      if (selfCards.length === 0) return;

      player.marks['lb_chuli_used'] = 1;
      const spadeDrawers: string[] = [];

      // 1. Discard 1 of player's own cards
      const selfResp = yield* helpers.ask({
        type: 'choose_card',
        promptId: helpers.nextPromptId(),
        playerId: player.id,
        reason: 'general_skill',
        message: '【除疠】：请选择弃置自己的一张牌',
        minCount: 1,
        maxCount: 1,
        eligibleCardIds: selfCards.map((c) => c.id),
        optional: false
      });
      const selfCardId =
        selfResp.type === 'choose_card' && selfResp.cardIds.length === 1
          ? selfResp.cardIds[0]
          : selfCards[0].id;
      const selfCardObj = selfCards.find((c) => c.id === selfCardId) ?? selfCards[0];
      if (selfCardObj.suit === 'spade') spadeDrawers.push(player.id);
      yield* helpers.discardCards(player.id, [selfCardObj.id]);

      // 2. Discard 1 card from each chosen target in seat order
      const orderedTargets = getAlivePlayersInOrder(state, player.id).filter((p) =>
        validTargets.includes(p.id)
      );
      for (const t of orderedTargets) {
        if (!t.alive) continue;
        const choices = buildPlayerCardChoices(t, {
          includeHand: true,
          includeEquips: true,
          includeJudge: false
        }).filter((ch) =>
          ch.zone === 'hand' || ch.zone === 'judge'
            ? true
            : helpers.canDiscardPlayerEquip(player.id, t.id, ch.zone)
        );
        if (choices.length === 0) continue;

        const pickResp = yield* helpers.ask({
          type: 'choose_player_card',
          promptId: helpers.nextPromptId(),
          playerId: player.id,
          targetId: t.id,
          reason: 'dismantle',
          message: `【除疠】：选择弃置 ${t.name} 的一张牌`,
          choices
        });
        const idx =
          pickResp.type === 'choose_player_card' &&
          pickResp.choiceIndex >= 0 &&
          pickResp.choiceIndex < choices.length
            ? pickResp.choiceIndex
            : 0;
        const prevHand = t.hand.length;
        const extracted = extractChoiceCard(t, choices[idx]);
        if (!extracted) continue;
        helpers.moveToDiscard(extracted.card);
        for (const ox of extracted.lostWoodenOxStash) {
          helpers.moveToDiscard(ox);
        }
        if (extracted.card.suit === 'spade') {
          spadeDrawers.push(t.id);
        }
        helpers.log(
          'skill',
          `${player.name} 【除疠】弃置了 ${t.name} 的【${extracted.card.displayName}】`,
          player.id,
          [t.id],
          [extracted.card.id]
        );
        if (extracted.wasEquip) {
          yield* helpers.fireEquipLost(t.id, extracted.card);
        } else {
          yield* helpers.checkHandEmptied(t.id, prevHand);
        }
      }

      // 3. Everyone who discarded a Spade draws 1 card
      for (const pid of spadeDrawers) {
        const p = state.players.find((x) => x.id === pid && x.alive);
        if (p) {
          helpers.drawCards(p.id, 1);
          helpers.log('draw', `【除疠】：${p.name} 弃置了黑桃牌，摸 1 张牌`, p.id);
        }
      }
    }
  });

  // ===== 界吕布：利驭（杀伤后获其区域1牌，非装备其摸1，装备则视为对其指定另一人用决斗）=====
  triggers.register({
    id: 'skill_lb_liyu',
    timing: 'AfterDamageDealt',
    priority: 52,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.prevented || !dmg.sourceId || dmg.sourceId === dmg.targetId) return false;
      if (!dmg.card || !isSlashCardName(dmg.card.name)) return false;
      const lvbu = state.players.find((p) => p.id === dmg.sourceId);
      const victim = state.players.find((p) => p.id === dmg.targetId);
      return Boolean(
        lvbu &&
          victim &&
          lvbu.alive &&
          victim.alive &&
          hasActiveSkill(lvbu, 'lb_liyu') &&
          hasAnyCardInZones(victim, true)
      );
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const lvbu = state.players.find((p) => p.id === dmg.sourceId)!;
      const victim = state.players.find((p) => p.id === dmg.targetId)!;
      if (!lvbu.alive || !victim.alive || !hasAnyCardInZones(victim, true)) return;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: lvbu.id,
        reason: 'lb_liyu',
        message: `【利驭】：是否获得 ${victim.name} 区域里的一张牌？`,
        options: [
          { id: 'yes', label: `发动【利驭】获得 ${victim.name} 一张牌` },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const choices = buildPlayerCardChoices(victim, {
        includeHand: true,
        includeEquips: true,
        includeJudge: true
      });
      if (choices.length === 0) return;

      const pickResp = yield* helpers.ask({
        type: 'choose_player_card',
        promptId: helpers.nextPromptId(),
        playerId: lvbu.id,
        targetId: victim.id,
        reason: 'snatch',
        message: `【利驭】：选择获得 ${victim.name} 区域里的一张牌`,
        choices
      });
      const idx =
        pickResp.type === 'choose_player_card' &&
        pickResp.choiceIndex >= 0 &&
        pickResp.choiceIndex < choices.length
          ? pickResp.choiceIndex
          : 0;

      const prevHand = victim.hand.length;
      const extracted = extractChoiceCard(victim, choices[idx]);
      if (!extracted) return;

      delete extracted.card.asDelayedTrick;
      lvbu.hand.push(extracted.card);
      for (const ox of extracted.lostWoodenOxStash) {
        helpers.moveToDiscard(ox);
      }
      helpers.log(
        'skill',
        `${lvbu.name} 发动【利驭】，获得了 ${victim.name} 的【${extracted.card.displayName}】`,
        lvbu.id,
        [victim.id],
        [extracted.card.id]
      );

      if (extracted.wasEquip) {
        yield* helpers.fireEquipLost(victim.id, extracted.card);
      } else if (choices[idx].zone === 'hand') {
        yield* helpers.checkHandEmptied(victim.id, prevHand);
      }
      yield* helpers.notifyCardsObtained(lvbu.id, [extracted.card]);
      if (!lvbu.alive || !victim.alive || state.result) return;

      if (extracted.card.category !== 'equip') {
        helpers.drawCards(victim.id, 1);
        helpers.log(
          'draw',
          `【利驭】：获得的非装备牌，${victim.name} 摸一张牌`,
          victim.id
        );
      } else {
        const duelCandidates = state.players.filter(
          (o) =>
            o.alive &&
            o.id !== lvbu.id &&
            o.id !== victim.id &&
            modifiers.canBeTargetedByCard(state, lvbu, o, 'duel')
        );
        if (duelCandidates.length === 0) return;

        const tgtResp = yield* helpers.ask({
          type: 'choose_target',
          promptId: helpers.nextPromptId(),
          playerId: victim.id,
          reason: 'lb_liyu_duel',
          message: `【利驭】：${lvbu.name} 获得了装备牌，请指定另一名角色成为其虚拟【决斗】的目标`,
          minCount: 1,
          maxCount: 1,
          eligibleTargetIds: duelCandidates.map((o) => o.id),
          optional: false
        });
        const chosenId =
          tgtResp.type === 'choose_target' && tgtResp.targetIds[0]
            ? tgtResp.targetIds[0]
            : duelCandidates[0].id;
        const duelTarget = state.players.find((p) => p.id === chosenId && p.alive);
        if (!duelTarget) return;

        helpers.log(
          'skill',
          `【利驭】：${victim.name} 指定 ${duelTarget.name}，${lvbu.name} 视为对其使用【决斗】！`,
          victim.id,
          [lvbu.id, duelTarget.id]
        );
        const virtualDuel: VirtualCard = {
          name: 'duel',
          displayName: '决斗(利驭)',
          suit: 'none',
          rank: 0,
          color: 'none',
          element: 'normal',
          subcards: [],
          sourceSkill: 'lb_liyu'
        };
        yield* helpers.resolveDuel(lvbu, duelTarget, virtualDuel, false);
      }
    }
  });

  // ===== 界貂蝉：闭月（结束阶段摸1，若空城摸2）=====
  triggers.register({
    id: 'skill_lb_biyue',
    timing: 'PhaseStart',
    priority: 50,
    condition: (state, payload) => {
      if (payload.phase !== 'finish' || !payload.playerId) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'lb_biyue'));
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const count = p.hand.length === 0 ? 2 : 1;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'lb_biyue',
        message: `结束阶段：是否发动界【闭月】摸 ${count} 张牌？`,
        options: [
          { id: 'yes', label: `发动【闭月】摸 ${count} 牌` },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type === 'choose_option' && opt.optionId === 'yes') {
        helpers.drawCards(p.id, count);
        helpers.log('skill', `${p.name} 发动界【闭月】，摸了 ${count} 张牌`, p.id);
      }
    }
  });

  // ===== 界华雄：耀武（锁定技，红牌伤来源摸1，非红牌己摸1）& 势斩（出牌限2次）=====
  triggers.register({
    id: 'skill_lb_yaowu',
    timing: 'DamageTaken',
    priority: 45,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.prevented) return false;
      const target = state.players.find((p) => p.id === dmg.targetId);
      return Boolean(target && hasActiveSkill(target, 'lb_yaowu'));
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const target = state.players.find((p) => p.id === dmg.targetId)!;
      const source = dmg.sourceId ? state.players.find((p) => p.id === dmg.sourceId) : undefined;

      const cardColor = dmg.card
        ? 'color' in dmg.card
          ? dmg.card.color
          : getCardColor(dmg.card.suit)
        : 'none';

      if (cardColor === 'red') {
        if (source && source.alive) {
          helpers.drawCards(source.id, 1);
          helpers.log(
            'skill',
            `${target.name} 触发界【耀武】（红色牌伤害），${source.name} 摸了一张牌`,
            target.id,
            [source.id]
          );
        }
      } else {
        helpers.drawCards(target.id, 1);
        helpers.log(
          'skill',
          `${target.name} 触发界【耀武】（非红色牌伤害），自己摸了一张牌`,
          target.id
        );
      }
    }
  });

  skills.registerActive({
    skillId: 'lb_shizhan',
    getPromptInfo: (state, player, mods) => {
      const used = player.marks['lb_shizhan_used'] ?? 0;
      if (used >= 2) return null;
      const targets = state.players
        .filter(
          (o) =>
            o.alive && o.id !== player.id && mods.canBeTargetedByCard(state, o, player, 'duel')
        )
        .map((o) => o.id);
      if (targets.length === 0) return null;
      return {
        skillId: 'lb_shizhan',
        name: '势斩',
        description: `出牌阶段限2次（剩余${2 - used}次），令一名其他角色视为对你使用一张【决斗】。`,
        cardMin: 0,
        cardMax: 0,
        eligibleCardIds: [],
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: targets
      };
    },
    *execute(state, player, _cardIds, targetIds, helpers) {
      const used = player.marks['lb_shizhan_used'] ?? 0;
      const target = state.players.find(
        (p) => p.id === targetIds[0] && p.alive && p.id !== player.id
      );
      if (!target || used >= 2) return;

      player.marks['lb_shizhan_used'] = used + 1;
      helpers.log(
        'skill',
        `${player.name} 发动【势斩】，令 ${target.name} 视为对自己使用一张【决斗】！`,
        player.id,
        [target.id]
      );
      const virtualDuel: VirtualCard = {
        name: 'duel',
        displayName: '决斗(势斩)',
        suit: 'none',
        rank: 0,
        color: 'none',
        element: 'normal',
        subcards: [],
        sourceSkill: 'lb_shizhan'
      };
      yield* helpers.resolveDuel(target, player, virtualDuel, false);
    }
  });

  // ===== 界袁术：庸肆（锁定摸存活势力数；弃牌开始弃1牌或失1血）& 觊玺（觉醒）=====
  modifiers.register({
    id: 'skill_lb_yongsi_draw',
    drawCountDelta: (state, player) => {
      if (!hasActiveSkill(player, 'lb_yongsi')) return 0;
      const factions = new Set(state.players.filter((p) => p.alive).map((p) => p.faction));
      return factions.size - 2;
    }
  });

  triggers.register({
    id: 'skill_lb_yongsi_discard',
    timing: 'PhaseStart',
    priority: 55,
    condition: (state, payload) => {
      if (payload.phase !== 'discard' || !payload.playerId) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'lb_yongsi'));
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const cards = [...getUsableCards(p), ...getEquippedCards(p)];
      if (cards.length === 0) {
        helpers.log('skill', `${p.name} 【庸肆】无牌可弃，失去 1 点体力`, p.id);
        yield* helpers.loseHp(p.id, 1);
        return;
      }

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'lb_yongsi',
        message: '【庸肆】弃牌阶段开始：请选择弃置一张牌或失去 1 点体力',
        options: [
          { id: 'discard', label: '弃置一张牌' },
          { id: 'lose_hp', label: '失去 1 点体力' }
        ]
      });

      if (opt.type === 'choose_option' && opt.optionId === 'discard') {
        const cardResp = yield* helpers.ask({
          type: 'choose_card',
          promptId: helpers.nextPromptId(),
          playerId: p.id,
          reason: 'general_skill',
          message: '【庸肆】：选择弃置一张牌',
          minCount: 1,
          maxCount: 1,
          eligibleCardIds: cards.map((c) => c.id),
          optional: false
        });
        const cid =
          cardResp.type === 'choose_card' && cardResp.cardIds[0]
            ? cardResp.cardIds[0]
            : cards[0].id;
        yield* helpers.discardCards(p.id, [cid]);
        helpers.log('skill', `${p.name} 触发【庸肆】，弃置了一张牌`, p.id);
      } else {
        helpers.log('skill', `${p.name} 触发【庸肆】，失去 1 点体力`, p.id);
        yield* helpers.loseHp(p.id, 1);
      }
    }
  });

  // Track HP loss during own turn for 觊玺
  triggers.register({
    id: 'skill_lb_jixi_track_damage',
    timing: 'DamageTaken',
    priority: 100,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.prevented || dmg.actualDeducted <= 0) return false;
      const active = state.players[state.activePlayerIndex];
      const p = state.players.find((x) => x.id === dmg.targetId);
      return Boolean(active && p && active.id === p.id && p.skills.includes('lb_jixi'));
    },
    *execute(state, payload) {
      const p = state.players.find((x) => x.id === payload.damage!.targetId);
      if (p) p.marks['lb_jixi_lost_this_turn'] = 1;
    }
  });

  triggers.register({
    id: 'skill_lb_jixi_track_hplost',
    timing: 'HpLost',
    priority: 100,
    condition: (state, payload) => {
      const active = state.players[state.activePlayerIndex];
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(active && p && active.id === p.id && p.skills.includes('lb_jixi'));
    },
    *execute(state, payload) {
      const p = state.players.find((x) => x.id === payload.playerId);
      if (p) p.marks['lb_jixi_lost_this_turn'] = 1;
    }
  });

  triggers.register({
    id: 'skill_lb_jixi_awaken',
    timing: 'TurnEnd',
    priority: 50,
    condition: (state, payload) => {
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'lb_jixi') && !p.marks['lb_jixi_awakened']);
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      if (p.marks['lb_jixi_lost_this_turn']) {
        p.marks['lb_jixi_streak'] = 0;
        return;
      }
      p.marks['lb_jixi_streak'] = (p.marks['lb_jixi_streak'] ?? 0) + 1;
      if (p.marks['lb_jixi_streak'] < 3) return;

      p.marks['lb_jixi_awakened'] = 1;
      helpers.log(
        'skill',
        `${p.name} 连续 3 个回合未失去体力，触发觉醒技【觊玺】，体力上限 +1 并回复 1 点体力！`,
        p.id
      );
      yield* helpers.changeMaxHp(p.id, 1);
      yield* helpers.healAsync(p.id, 1);
      if (!p.alive || state.result) return;

      const lord = state.players.find((x) => x.role === 'lord');
      const lordSkills = lord
        ? lord.skills.filter((sid) => getSkillMetaById(sid)?.type === 'lord')
        : [];
      const lordLabel =
        lordSkills.length > 0
          ? `摸两张牌并获得主公技（${lordSkills.map((id) => getSkillMetaById(id)?.name ?? id).join('/')}）`
          : '摸两张牌';

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'lb_jixi',
        message: '【觊玺】觉醒：请选择一项：',
        options: [
          { id: 'wangzun', label: '获得技能【妄尊】' },
          { id: 'draw_lord', label: lordLabel }
        ]
      });

      if (opt.type === 'choose_option' && opt.optionId === 'wangzun') {
        helpers.gainSkill(p.id, 'wangzun');
        helpers.log('skill', `${p.name} 【觊玺】获得了技能【妄尊】！`, p.id);
      } else {
        helpers.drawCards(p.id, 2);
        for (const sid of lordSkills) {
          helpers.gainSkill(p.id, sid);
        }
        helpers.log(
          'skill',
          `${p.name} 【觊玺】摸了两张牌${lordSkills.length > 0 ? `并获得了主公技 ${lordSkills.join(', ')}` : ''}`,
          p.id
        );
      }
    }
  });

  // ===== 界公孙瓒：义从（锁定距他-1；体力<=2他距己+1）& 趫猛（杀伤后弃区域1牌，坐骑则获得）=====
  modifiers.register({
    id: 'skill_lb_yicong',
    distanceDelta: (_state, from, to) => {
      let delta = 0;
      if (hasActiveSkill(from, 'lb_yicong')) delta -= 1;
      if (hasActiveSkill(to, 'lb_yicong') && to.hp <= 2) delta += 1;
      return delta;
    }
  });

  triggers.register({
    id: 'skill_lb_qiaomeng',
    timing: 'AfterDamageDealt',
    priority: 52,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.prevented || !dmg.sourceId || dmg.sourceId === dmg.targetId) return false;
      if (!dmg.card || !isSlashCardName(dmg.card.name)) return false;
      const gsz = state.players.find((p) => p.id === dmg.sourceId);
      const victim = state.players.find((p) => p.id === dmg.targetId);
      if (!gsz || !victim || !gsz.alive || !victim.alive || !hasActiveSkill(gsz, 'lb_qiaomeng')) {
        return false;
      }
      const choices = buildPlayerCardChoices(victim, {
        includeHand: true,
        includeEquips: true,
        includeJudge: true
      }).filter((ch) =>
        ch.zone === 'hand' || ch.zone === 'judge'
          ? true
          : modifiers.canDiscardEquip(state, gsz, victim, ch.zone as EquipSlot)
      );
      return choices.length > 0;
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const gsz = state.players.find((p) => p.id === dmg.sourceId)!;
      const victim = state.players.find((p) => p.id === dmg.targetId)!;
      if (!gsz.alive || !victim.alive) return;

      const choices = buildPlayerCardChoices(victim, {
        includeHand: true,
        includeEquips: true,
        includeJudge: true
      }).filter((ch) =>
        ch.zone === 'hand' || ch.zone === 'judge'
          ? true
          : helpers.canDiscardPlayerEquip(gsz.id, victim.id, ch.zone as EquipSlot)
      );
      if (choices.length === 0) return;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: gsz.id,
        reason: 'lb_qiaomeng',
        message: `【趫猛】：是否弃置 ${victim.name} 区域里的一张牌？（若为坐骑则获得之）`,
        options: [
          { id: 'yes', label: `发动【趫猛】弃置 ${victim.name} 一张牌` },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const pickResp = yield* helpers.ask({
        type: 'choose_player_card',
        promptId: helpers.nextPromptId(),
        playerId: gsz.id,
        targetId: victim.id,
        reason: 'dismantle',
        message: `【趫猛】：选择弃置 ${victim.name} 区域里的一张牌`,
        choices
      });
      const idx =
        pickResp.type === 'choose_player_card' &&
        pickResp.choiceIndex >= 0 &&
        pickResp.choiceIndex < choices.length
          ? pickResp.choiceIndex
          : 0;

      const prevHand = victim.hand.length;
      const extracted = extractChoiceCard(victim, choices[idx]);
      if (!extracted) return;
      for (const ox of extracted.lostWoodenOxStash) {
        helpers.moveToDiscard(ox);
      }

      const isHorse =
        extracted.card.subtype === 'horse_plus' || extracted.card.subtype === 'horse_minus';
      if (isHorse) {
        delete extracted.card.asDelayedTrick;
        gsz.hand.push(extracted.card);
        helpers.log(
          'skill',
          `${gsz.name} 发动【趫猛】，弃置并获得了 ${victim.name} 的坐骑【${extracted.card.displayName}】！`,
          gsz.id,
          [victim.id],
          [extracted.card.id]
        );
      } else {
        helpers.moveToDiscard(extracted.card);
        helpers.log(
          'skill',
          `${gsz.name} 发动【趫猛】，弃置了 ${victim.name} 的【${extracted.card.displayName}】`,
          gsz.id,
          [victim.id],
          [extracted.card.id]
        );
      }

      if (extracted.wasEquip) {
        yield* helpers.fireEquipLost(victim.id, extracted.card);
      } else if (choices[idx].zone === 'hand') {
        yield* helpers.checkHandEmptied(victim.id, prevHand);
      }
      if (isHorse && gsz.alive) {
        yield* helpers.notifyCardsObtained(gsz.id, [extracted.card]);
      }
    }
  });
}
