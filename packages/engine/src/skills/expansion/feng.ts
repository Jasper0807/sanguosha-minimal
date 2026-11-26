import {
  getCardColor,
  getRankLabel,
  getSuitSymbol,
  type CardInstance,
  type CardName,
  type ModifierRegistry,
  type SkillRegistry,
  type TriggerRegistry,
  type VirtualCard
} from '../../index.js';
import { CARD_SPECS } from '../../data/cards/specs.js';
import { hasActiveSkill } from '../../core/events.js';
import { getAttackRange, getDistance } from '../../core/distance.js';
import { getEquippedCards, getUsableCards, removeUsableCard } from '../../core/deck.js';
import { getAlivePlayersInOrder, getPlayableCardInfo } from '../../core/targeting.js';

const GUHUO_DECLARABLE: readonly { name: CardName; label: string }[] = [
  { name: 'peach', label: '【桃】' },
  { name: 'slash', label: '【杀】' },
  { name: 'alcohol', label: '【酒】' },
  { name: 'ex_nihilo', label: '【无中生有】' },
  { name: 'dismantle', label: '【过河拆桥】' },
  { name: 'snatch', label: '【顺手牵羊】' },
  { name: 'duel', label: '【决斗】' },
  { name: 'savage_assault', label: '【南蛮入侵】' },
  { name: 'archery_attack', label: '【万箭齐发】' },
  { name: 'peach_garden', label: '【桃园结义】' },
  { name: 'harvest', label: '【五谷丰登】' },
  { name: 'fire_attack', label: '【火攻】' },
  { name: 'iron_chain', label: '【铁索连环】' }
];

export function registerFengSkills(
  triggers: TriggerRegistry,
  modifiers: ModifierRegistry,
  skills: SkillRegistry
): void {
  // Turn-scoped resets for Wind pack
  triggers.register({
    id: 'skill_feng_turn_reset',
    timing: 'TurnStart',
    priority: 12,
    *execute(state, payload) {
      const p = state.players.find((x) => x.id === payload.playerId);
      if (!p) return;
      delete p.marks['qimou_x'];
      delete p.marks['huangtian_used'];
      delete p.marks['guhuo_used'];
    }
  });

  triggers.register({
    id: 'skill_feng_turn_end',
    timing: 'TurnEnd',
    priority: 12,
    *execute(state) {
      for (const p of state.players) {
        delete p.marks['qimou_x'];
        delete p.marks['guhuo_used'];
      }
    }
  });

  // ===== 1. 夏侯渊：神速（三项：跳过判定+摸牌 / 跳过出牌+弃装备 / 跳过弃牌+翻面 -> 视为无距离限制杀）=====
  triggers.register({
    id: 'skill_shensu',
    timing: 'PhaseBefore',
    priority: 62,
    condition: (state, payload) => {
      if (!payload.playerId || !payload.phase) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      if (!p || !hasActiveSkill(p, 'shensu')) return false;
      if (state.skippedPhases.includes(payload.phase)) return false;

      const slashTargets = state.players.filter(
        (o) => o.alive && o.id !== p.id && modifiers.canBeTargetedByCard(state, p, o, 'slash')
      );
      if (slashTargets.length === 0) return false;

      if (payload.phase === 'judge') {
        return !state.skippedPhases.includes('draw');
      }
      if (payload.phase === 'play') {
        const equips = [...getUsableCards(p), ...getEquippedCards(p)].filter(
          (c) => c.category === 'equip'
        );
        return equips.length > 0;
      }
      if (payload.phase === 'discard') {
        return true;
      }
      return false;
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const phase = payload.phase!;
      const targets = state.players
        .filter(
          (o) => o.alive && o.id !== p.id && modifiers.canBeTargetedByCard(state, p, o, 'slash')
        )
        .map((o) => o.id);
      if (targets.length === 0) return;

      const labelMap: Record<string, string> = {
        judge: '发动【神速1】：跳过判定与摸牌阶段，视为使用一张无距离限制【杀】',
        play: '发动【神速2】：跳过出牌阶段并弃置一张装备牌，视为使用一张无距离限制【杀】',
        discard: '发动【神速3】：跳过弃牌阶段并翻面，视为使用一张无距离限制【杀】'
      };
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: `shensu_${phase}`,
        message: labelMap[phase],
        options: [
          { id: 'yes', label: '发动【神速】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      if (phase === 'play') {
        const equips = [...getUsableCards(p), ...getEquippedCards(p)].filter(
          (c) => c.category === 'equip'
        );
        if (equips.length === 0) return;
        const cResp = yield* helpers.ask({
          type: 'choose_card',
          promptId: helpers.nextPromptId(),
          playerId: p.id,
          reason: 'general_skill',
          message: '【神速】：请选择弃置一张装备牌',
          minCount: 1,
          maxCount: 1,
          eligibleCardIds: equips.map((c) => c.id),
          optional: true
        });
        if (cResp.type !== 'choose_card' || cResp.cancelled || cResp.cardIds.length !== 1) return;
        yield* helpers.discardCards(p.id, [cResp.cardIds[0]]);
      }

      const tResp = yield* helpers.ask({
        type: 'choose_target',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'shensu_target',
        message: '【神速】：选择虚拟【杀】的目标（无距离限制）',
        minCount: 1,
        maxCount: 1,
        eligibleTargetIds: targets,
        optional: false
      });
      const tid =
        tResp.type === 'choose_target' && tResp.targetIds[0] ? tResp.targetIds[0] : targets[0];
      const target = state.players.find((x) => x.id === tid && x.alive);
      if (!target) return;

      if (phase === 'judge') {
        state.skippedPhases.push('judge', 'draw');
      } else if (phase === 'play') {
        state.skippedPhases.push('play');
      } else if (phase === 'discard') {
        state.skippedPhases.push('discard');
        yield* helpers.flipPlayer(p.id);
      }

      helpers.log(
        'skill',
        `${p.name} 发动【神速】，视为对 ${target.name} 使用一张无距离限制的【杀】！`,
        p.id,
        [target.id]
      );
      const vs: VirtualCard = {
        name: 'slash',
        displayName: '杀(神速)',
        suit: 'none',
        rank: 0,
        color: 'none',
        element: 'normal',
        subcards: [],
        sourceSkill: 'shensu'
      };
      yield* helpers.resolveSlash(p, [target], vs, {
        countTowardLimit: false,
        useDrunkBonus: false
      });
    }
  });

  // ===== 2. 曹仁：据守 & 解围 =====
  triggers.register({
    id: 'skill_jushou',
    timing: 'PhaseStart',
    priority: 52,
    condition: (state, payload) => {
      if (payload.phase !== 'finish' || !payload.playerId) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'jushou'));
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'jushou',
        message: '结束阶段：是否发动【据守】（翻面摸4牌，然后弃置1张手牌，若为装备则改为使用之）？',
        options: [
          { id: 'yes', label: '发动【据守】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      helpers.log('skill', `${p.name} 发动【据守】，翻面并摸 4 张牌！`, p.id);
      yield* helpers.flipPlayer(p.id);
      if (!p.alive || state.result) return;
      helpers.drawCards(p.id, 4);
      if (p.hand.length === 0) return;

      const cResp = yield* helpers.ask({
        type: 'choose_card',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'general_skill',
        message: '【据守】：选择一张手牌弃置（若为装备牌则改为直接装备之）',
        minCount: 1,
        maxCount: 1,
        eligibleCardIds: p.hand.map((c) => c.id),
        optional: false
      });
      const cid =
        cResp.type === 'choose_card' && cResp.cardIds[0] ? cResp.cardIds[0] : p.hand[0].id;
      const idx = p.hand.findIndex((c) => c.id === cid);
      if (idx === -1) return;
      const prevHand = p.hand.length;
      const [chosen] = p.hand.splice(idx, 1);
      if (chosen.category === 'equip') {
        helpers.log('equip', `${p.name} 【据守】装备了【${chosen.displayName}】`, p.id, undefined, [chosen.id]);
        yield* helpers.putEquipDirectly(p.id, chosen);
        yield* helpers.checkHandEmptied(p.id, prevHand);
      } else {
        helpers.moveToDiscard(chosen);
        helpers.log('discard', `${p.name} 【据守】弃置了【${chosen.displayName}】`, p.id, undefined, [chosen.id]);
        yield* helpers.checkHandEmptied(p.id, prevHand);
      }
    }
  });

  // 解围 Part 1: 装备区里的牌可当【无懈可击】使用
  skills.registerResponse({
    id: 'skill_jiewei_null',
    extraNullificationCardIds: (_state, player) => {
      if (!hasActiveSkill(player, 'jiewei')) return [];
      return getEquippedCards(player).map((c) => c.id);
    }
  });

  // 解围 Part 2: 背面翻至正面时，可弃1牌并移动场上一张牌
  triggers.register({
    id: 'skill_jiewei_flip',
    timing: 'TurnedFaceUp',
    priority: 55,
    condition: (state, payload) => {
      const p = state.players.find((x) => x.id === payload.playerId);
      if (!p || !hasActiveSkill(p, 'jiewei')) return false;
      const cards = [...getUsableCards(p), ...getEquippedCards(p)];
      return cards.length > 0;
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const cards = [...getUsableCards(p), ...getEquippedCards(p)];
      if (cards.length === 0) return;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'jiewei',
        message: '你从背面翻回正面：是否发动【解围】弃置一张牌并移动场上一张牌？',
        options: [
          { id: 'yes', label: '发动【解围】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const cResp = yield* helpers.ask({
        type: 'choose_card',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'general_skill',
        message: '【解围】：选择弃置一张牌',
        minCount: 1,
        maxCount: 1,
        eligibleCardIds: cards.map((c) => c.id),
        optional: true
      });
      if (cResp.type !== 'choose_card' || cResp.cancelled || cResp.cardIds.length !== 1) return;
      yield* helpers.discardCards(p.id, [cResp.cardIds[0]]);
      yield* helpers.moveFieldCard(p.id, '解围');
    }
  });

  // ===== 3. 黄忠：烈弓（出牌阶段用杀指定目标后，若目标手牌>=己体力 OR <=己攻击范围，不可抵消）=====
  triggers.register({
    id: 'skill_liegong',
    timing: 'TargetSpecified',
    priority: 65,
    condition: (state, payload) => {
      const st = payload.slashTarget;
      if (!st || st.cannotDodge || state.phase !== 'play') return false;
      const attacker = state.players.find((p) => p.id === st.attackerId);
      const target = state.players.find((p) => p.id === st.targetId);
      if (!attacker || !target || !hasActiveSkill(attacker, 'liegong')) return false;
      const active = state.players[state.activePlayerIndex];
      if (!active || active.id !== attacker.id) return false;
      const atkRange = getAttackRange(state, attacker, modifiers);
      return target.hand.length >= attacker.hp || target.hand.length <= atkRange;
    },
    *execute(state, payload, helpers) {
      const st = payload.slashTarget!;
      const attacker = state.players.find((p) => p.id === st.attackerId)!;
      const target = state.players.find((p) => p.id === st.targetId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: attacker.id,
        reason: 'liegong',
        message: `【烈弓】：是否令 ${target.name} 不能使用【闪】抵消此【杀】？`,
        options: [
          { id: 'yes', label: '发动【烈弓】（强中）' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type === 'choose_option' && opt.optionId === 'yes') {
        st.cannotDodge = true;
        helpers.log('skill', `${attacker.name} 发动【烈弓】，${target.name} 不可抵消此【杀】！`, attacker.id, [target.id]);
      }
    }
  });

  // ===== 4. 魏延：狂骨（距离<=1造成1点伤后回1血或摸1牌）& 奇谋（限定技）=====
  triggers.register({
    id: 'skill_kuanggu',
    timing: 'AfterDamageDealt',
    priority: 52,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.prevented || !dmg.sourceId || dmg.actualDeducted <= 0) return false;
      const source = state.players.find((p) => p.id === dmg.sourceId);
      if (!source || !hasActiveSkill(source, 'kuanggu')) return false;
      return getDistance(state, source.id, dmg.targetId, modifiers) <= 1;
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const source = state.players.find((p) => p.id === dmg.sourceId)!;
      for (let i = 0; i < dmg.actualDeducted; i++) {
        if (!source.alive || state.result) break;
        const options = [
          ...(source.hp < source.maxHp ? [{ id: 'heal', label: '回复 1 点体力' }] : []),
          { id: 'draw', label: '摸一张牌' },
          { id: 'no', label: '不发动' }
        ];
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: source.id,
          reason: 'kuanggu',
          message: `【狂骨】（第 ${i + 1}/${dmg.actualDeducted} 次）：选择回复 1 点体力或摸一张牌`,
          options
        });
        if (opt.type !== 'choose_option' || opt.optionId === 'no') break;
        if (opt.optionId === 'heal' && source.hp < source.maxHp) {
          yield* helpers.healAsync(source.id, 1);
          helpers.log('skill', `${source.name} 发动【狂骨】，回复 1 点体力`, source.id);
        } else {
          helpers.drawCards(source.id, 1);
          helpers.log('skill', `${source.name} 发动【狂骨】，摸了一张牌`, source.id);
        }
      }
    }
  });

  skills.registerActive({
    skillId: 'qimou',
    getPromptInfo: (_state, player) => {
      if (player.marks['qimou_used'] || player.hp <= 0) return null;
      return {
        skillId: 'qimou',
        name: '奇谋',
        description: '限定技，失去任意点体力，本回合计算与其他角色距离-X且使用【杀】次数+X。',
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
      if (player.marks['qimou_used'] || player.hp <= 0) return;
      const maxX = Math.max(1, player.hp);
      const opts = Array.from({ length: maxX }, (_, i) => ({
        id: String(i + 1),
        label: `失去 ${i + 1} 点体力（距离-${i + 1}，杀次数+${i + 1}）`
      }));
      opts.push({ id: 'cancel', label: '取消' });

      const resp = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: player.id,
        reason: 'qimou',
        message: '限定技【奇谋】：选择失去的体力值 X',
        options: opts
      });
      if (resp.type !== 'choose_option' || resp.optionId === 'cancel') return;
      const x = Number(resp.optionId);
      if (!Number.isFinite(x) || x <= 0) return;

      player.marks['qimou_used'] = 1;
      helpers.log('skill', `${player.name} 发动限定技【奇谋】，失去 ${x} 点体力！`, player.id);
      yield* helpers.loseHp(player.id, x);
      if (player.alive && !state.result) {
        player.marks['qimou_x'] = (player.marks['qimou_x'] ?? 0) + x;
      }
    }
  });

  modifiers.register({
    id: 'skill_qimou_mods',
    distanceDelta: (_state, from) => -(from.marks['qimou_x'] ?? 0),
    slashLimitDelta: (_state, player) => player.marks['qimou_x'] ?? 0
  });

  // ===== 5. 小乔：红颜（锁定技，黑桃视红桃）& 天香（防止伤害转移）=====
  modifiers.register({
    id: 'skill_hongyan',
    suitOverride: (_state, owner, card) => {
      if (hasActiveSkill(owner, 'hongyan') && card.suit === 'spade') {
        return 'heart';
      }
      return null;
    }
  });

  triggers.register({
    id: 'skill_tianxiang',
    timing: 'DamageTaken',
    priority: 75,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.prevented || dmg.amount <= 0) return false;
      const target = state.players.find((p) => p.id === dmg.targetId);
      if (!target || !hasActiveSkill(target, 'tianxiang')) return false;
      const hearts = target.hand.filter(
        (c) => modifiers.getEffectiveSuit(state, target, c) === 'heart'
      );
      const others = state.players.filter((o) => o.alive && o.id !== target.id);
      return hearts.length > 0 && others.length > 0;
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const xq = state.players.find((p) => p.id === dmg.targetId)!;
      const hearts = xq.hand.filter(
        (c) => helpers.getEffectiveSuit(xq.id, c) === 'heart'
      );
      const others = state.players.filter((o) => o.alive && o.id !== xq.id);
      if (hearts.length === 0 || others.length === 0) return;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: xq.id,
        reason: 'tianxiang',
        message: `受到 ${dmg.amount} 点伤害：是否发动【天香】，弃置一张红桃（含红颜黑桃）手牌防止此伤害并转移？`,
        options: [
          { id: 'yes', label: '发动【天香】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const cResp = yield* helpers.ask({
        type: 'choose_card',
        promptId: helpers.nextPromptId(),
        playerId: xq.id,
        reason: 'general_skill',
        message: '【天香】：选择弃置一张红桃（或黑桃）手牌',
        minCount: 1,
        maxCount: 1,
        eligibleCardIds: hearts.map((c) => c.id),
        optional: true
      });
      if (cResp.type !== 'choose_card' || cResp.cancelled || cResp.cardIds.length !== 1) return;

      const tResp = yield* helpers.ask({
        type: 'choose_target',
        promptId: helpers.nextPromptId(),
        playerId: xq.id,
        reason: 'tianxiang_target',
        message: '【天香】：选择承受转移效果的一名其他角色',
        minCount: 1,
        maxCount: 1,
        eligibleTargetIds: others.map((o) => o.id),
        optional: false
      });
      const tid =
        tResp.type === 'choose_target' && tResp.targetIds[0] ? tResp.targetIds[0] : others[0].id;
      const victim = state.players.find((o) => o.id === tid && o.alive);
      if (!victim) return;

      const modeResp = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: xq.id,
        reason: 'tianxiang_mode',
        message: `【天香】目标 ${victim.name}：请选择一项效果`,
        options: [
          { id: 'damage_draw', label: '受来源 1 点伤害并摸已损失体力张牌（至多5）' },
          { id: 'lose_hp_gain', label: '失去 1 点体力并获得你弃置的牌' }
        ]
      });

      const discCard = yield* helpers.removeCardFromPlayer(xq.id, cResp.cardIds[0]);
      if (!discCard) return;
      dmg.prevented = true;
      helpers.moveToDiscard(discCard);
      helpers.log(
        'skill',
        `${xq.name} 发动【天香】，弃置【${discCard.displayName}】防止伤害并指定 ${victim.name}！`,
        xq.id,
        [victim.id],
        [discCard.id]
      );

      if (modeResp.type === 'choose_option' && modeResp.optionId === 'lose_hp_gain') {
        yield* helpers.loseHp(victim.id, 1);
        if (victim.alive && !state.result) {
          const taken = helpers.takeCardFromDiscard(discCard.id);
          if (taken) {
            victim.hand.push(taken);
            yield* helpers.notifyCardsObtained(victim.id, [taken]);
          }
        }
      } else {
        yield* helpers.applyDamage({
          sourceId: dmg.sourceId,
          targetId: victim.id,
          amount: 1,
          element: 'normal',
          isChainDamage: false,
          prevented: false,
          armorIgnored: false,
          wasChainedBeforeDeduct: victim.chained,
          actualDeducted: 0
        });
        if (victim.alive && !state.result) {
          const drawN = Math.min(5, Math.max(0, victim.maxHp - victim.hp));
          if (drawN > 0) {
            helpers.drawCards(victim.id, drawN);
            helpers.log('draw', `【天香】：${victim.name} 摸了 ${drawN} 张牌`, victim.id);
          }
        }
      }
    }
  });

  // ===== 6. 周泰：不屈（锁定技，濒死置“创”）& 奋激 =====
  triggers.register({
    id: 'skill_buqu',
    timing: 'DyingStart',
    priority: 80,
    condition: (state, payload) => {
      const victim = state.players.find((p) => p.id === payload.victimId);
      return Boolean(victim && victim.alive && victim.hp <= 0 && hasActiveSkill(victim, 'buqu'));
    },
    *execute(state, payload, helpers) {
      const zt = state.players.find((p) => p.id === payload.victimId)!;
      if (!zt.removedCards['buqu']) zt.removedCards['buqu'] = [];

      // Keep triggering while hp <= 0 (in case multi-damage puts hp at -1? OL: DyingStart triggers once per dying entry, brings hp to 1 on unique rank!)
      const popped = helpers.popTopCards(1);
      if (popped.length === 0) return;
      const card = popped[0];
      const existingRanks = new Set(zt.removedCards['buqu'].map((c) => c.rank));
      helpers.pushTableCard(card, zt.id, '不屈·创');

      if (!existingRanks.has(card.rank)) {
        zt.removedCards['buqu'].push(card);
        zt.hp = 1;
        helpers.log(
          'skill',
          `${zt.name} 触发【不屈】，将 ${getSuitSymbol(card.suit)}${getRankLabel(card.rank)}【${card.displayName}】置于武将牌上作为“创”（当前 ${zt.removedCards['buqu'].length} 创），体力回复至 1！`,
          zt.id,
          undefined,
          [card.id]
        );
      } else {
        helpers.moveToDiscard(card);
        helpers.log(
          'skill',
          `${zt.name} 触发【不屈】，翻开 ${getSuitSymbol(card.suit)}${getRankLabel(card.rank)} 与已有“创”点数重复，移去此牌！`,
          zt.id,
          undefined,
          [card.id]
        );
      }
    }
  });

  modifiers.register({
    id: 'skill_buqu_handlimit',
    handLimitBaseOverride: (_state, player) => {
      if (!hasActiveSkill(player, 'buqu')) return null;
      const chuang = player.removedCards['buqu'];
      return chuang && chuang.length > 0 ? chuang.length : null;
    }
  });

  triggers.register({
    id: 'skill_fenji',
    timing: 'HandCardsDiscardedOrTaken',
    priority: 45,
    condition: (state, payload) => {
      if (!payload.playerId) return false;
      const victim = state.players.find((p) => p.id === payload.playerId && p.alive);
      if (!victim) return false;
      return state.players.some((p) => hasActiveSkill(p, 'fenji'));
    },
    *execute(state, payload, helpers) {
      const victim = state.players.find((p) => p.id === payload.playerId && p.alive);
      if (!victim) return;
      const ordered = getAlivePlayersInOrder(state, victim.id);
      for (const zt of ordered) {
        if (!hasActiveSkill(zt, 'fenji') || !victim.alive || state.result) continue;
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: zt.id,
          reason: 'fenji',
          message: `${victim.name} 的手牌被弃置或获得：是否发动【奋激】，失去 1 点体力令其摸两张牌？`,
          options: [
            { id: 'yes', label: `发动【奋激】（令 ${victim.name} 摸2牌）` },
            { id: 'no', label: '不发动' }
          ]
        });
        if (opt.type === 'choose_option' && opt.optionId === 'yes') {
          helpers.log('skill', `${zt.name} 发动【奋激】，失去 1 点体力令 ${victim.name} 摸两张牌`, zt.id, [victim.id]);
          yield* helpers.loseHp(zt.id, 1);
          if (victim.alive && !state.result) {
            const drawn = helpers.drawCards(victim.id, 2);
            yield* helpers.notifyCardsObtained(victim.id, drawn);
          }
        }
      }
    }
  });

  // ===== 7. 张角：雷击 & 鬼道 & 黄天（主公技）=====
  triggers.register({
    id: 'skill_leiji',
    timing: 'CardResponded',
    priority: 55,
    condition: (state, payload) => {
      if (!payload.playerId) return false;
      const isDodge =
        payload.card?.name === 'dodge' || payload.virtualCard?.name === 'dodge';
      if (!isDodge) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      if (!p || !hasActiveSkill(p, 'leiji')) return false;
      return state.players.some((o) => o.alive && o.id !== p.id);
    },
    *execute(state, payload, helpers) {
      const zj = state.players.find((x) => x.id === payload.playerId)!;
      const others = state.players.filter((o) => o.alive && o.id !== zj.id);
      if (others.length === 0) return;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: zj.id,
        reason: 'leiji',
        message: '使用或打出【闪】：是否发动【雷击】令一名其他角色进行判定？',
        options: [
          { id: 'yes', label: '发动【雷击】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const tResp = yield* helpers.ask({
        type: 'choose_target',
        promptId: helpers.nextPromptId(),
        playerId: zj.id,
        reason: 'leiji_target',
        message: '【雷击】：选择判定目标',
        minCount: 1,
        maxCount: 1,
        eligibleTargetIds: others.map((o) => o.id),
        optional: false
      });
      const tid =
        tResp.type === 'choose_target' && tResp.targetIds[0] ? tResp.targetIds[0] : others[0].id;
      const target = state.players.find((o) => o.id === tid && o.alive);
      if (!target) return;

      const judgeCard = yield* helpers.resolveJudge(target.id, '雷击');
      if (state.result || !target.alive) return;
      const effSuit = helpers.getEffectiveSuit(target.id, judgeCard);

      if (effSuit === 'spade') {
        helpers.log('skill', `【雷击】判定黑桃！对 ${target.name} 造成 2 点雷电伤害！`, zj.id, [target.id]);
        yield* helpers.applyDamage({
          sourceId: zj.alive ? zj.id : null,
          targetId: target.id,
          amount: 2,
          element: 'thunder',
          isChainDamage: false,
          prevented: false,
          armorIgnored: false,
          wasChainedBeforeDeduct: target.chained,
          actualDeducted: 0
        });
      } else if (effSuit === 'club') {
        helpers.log('skill', `【雷击】判定梅花！${zj.name} 回复 1 点体力并对 ${target.name} 造成 1 点雷电伤害！`, zj.id, [target.id]);
        if (zj.alive) {
          yield* helpers.healAsync(zj.id, 1);
        }
        if (target.alive && !state.result) {
          yield* helpers.applyDamage({
            sourceId: zj.alive ? zj.id : null,
            targetId: target.id,
            amount: 1,
            element: 'thunder',
            isChainDamage: false,
            prevented: false,
            armorIgnored: false,
            wasChainedBeforeDeduct: target.chained,
            actualDeducted: 0
          });
        }
      }
    }
  });

  // 鬼道：用一张黑色牌（手牌或装备）替换判定牌，并获得原判定牌
  triggers.register({
    id: 'skill_guidao',
    timing: 'JudgeModify',
    priority: 58,
    condition: (state, payload) => {
      if (!payload.judge) return false;
      return state.players.some(
        (p) =>
          hasActiveSkill(p, 'guidao') &&
          [...getUsableCards(p), ...getEquippedCards(p)].some(
            (c) => getCardColor(modifiers.getEffectiveSuit(state, p, c)) === 'black'
          )
      );
    },
    *execute(state, payload, helpers) {
      const judge = payload.judge!;
      const ordered = getAlivePlayersInOrder(state, judge.playerId);
      for (const zj of ordered) {
        if (!hasActiveSkill(zj, 'guidao')) continue;
        const blacks = [...getUsableCards(zj), ...getEquippedCards(zj)].filter(
          (c) => getCardColor(helpers.getEffectiveSuit(zj.id, c)) === 'black'
        );
        if (blacks.length === 0) continue;

        const resp = yield* helpers.ask({
          type: 'choose_card',
          promptId: helpers.nextPromptId(),
          playerId: zj.id,
          reason: 'general_skill',
          message: `【鬼道】：当前判定牌 ${getSuitSymbol(judge.card.suit)}${getRankLabel(judge.card.rank)}【${judge.card.displayName}】，是否用一张黑色牌替换并获得原判定牌？`,
          minCount: 1,
          maxCount: 1,
          eligibleCardIds: blacks.map((c) => c.id),
          optional: true
        });
        if (resp.type === 'choose_card' && !resp.cancelled && resp.cardIds.length === 1) {
          const replacement = yield* helpers.removeCardFromPlayer(zj.id, resp.cardIds[0]);
          if (replacement) {
            const oldJudge = judge.card;
            judge.card = replacement;
            zj.hand.push(oldJudge);
            helpers.pushTableCard(replacement, zj.id, '鬼道改判');
            helpers.log(
              'skill',
              `${zj.name} 发动【鬼道】，用 ${getSuitSymbol(replacement.suit)}${getRankLabel(replacement.rank)}【${replacement.displayName}】替换了判定牌并获得原判定牌！`,
              zj.id,
              undefined,
              [replacement.id]
            );
            yield* helpers.notifyCardsObtained(zj.id, [oldJudge]);
          }
        }
      }
    }
  });

  // 黄天（主公技：其他群势力角色出牌阶段限1次交给张角一张闪或闪电）
  skills.registerActive({
    skillId: 'huangtian_give',
    allowWithoutOwnSkill: true,
    getPromptInfo: (state, player) => {
      if (player.faction !== 'qun' || player.marks['huangtian_used']) return null;
      const lords = state.players.filter(
        (l) => l.alive && l.id !== player.id && hasActiveSkill(l, 'huangtian')
      );
      if (lords.length === 0) return null;
      const eligible = player.hand.filter((c) => c.name === 'dodge' || c.name === 'lightning');
      if (eligible.length === 0) return null;
      return {
        skillId: 'huangtian_give',
        name: '黄天(献牌)',
        description: '响应主公张角【黄天】，每阶段限1次交给他一张【闪】或【闪电】。',
        cardMin: 1,
        cardMax: 1,
        eligibleCardIds: eligible.map((c) => c.id),
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: lords.map((l) => l.id)
      };
    },
    *execute(state, player, cardIds, targetIds, helpers) {
      const lord = state.players.find(
        (l) => l.alive && l.id === targetIds[0] && hasActiveSkill(l, 'huangtian')
      );
      if (!lord || cardIds.length !== 1 || player.marks['huangtian_used']) return;
      const idx = player.hand.findIndex(
        (c) => c.id === cardIds[0] && (c.name === 'dodge' || c.name === 'lightning')
      );
      if (idx === -1) return;

      player.marks['huangtian_used'] = 1;
      const prevHand = player.hand.length;
      const [given] = player.hand.splice(idx, 1);
      lord.hand.push(given);
      helpers.log(
        'skill',
        `${player.name} 响应【黄天】，将【${given.displayName}】交给了 ${lord.name}`,
        player.id,
        [lord.id],
        [given.id]
      );
      yield* helpers.checkHandEmptied(player.id, prevHand);
      yield* helpers.notifyCardsObtained(lord.id, [given]);
    }
  });

  // ===== 8. 于吉：蛊惑（每回合限1次，扣置手牌声明基本/普通锦囊，他人质疑：假则作废并摸1，真则质疑者获缠怨）=====
  skills.registerActive({
    skillId: 'guhuo',
    getPromptInfo: (_state, player) => {
      if (player.marks['guhuo_used'] || player.hand.length === 0) return null;
      return {
        skillId: 'guhuo',
        name: '蛊惑',
        description:
          '每回合限1次，扣置一张手牌声明为任意基本牌或普通锦囊牌；其他角色可质疑（假作废并摸1，真质疑者获缠怨）。',
        cardMin: 1,
        cardMax: 1,
        eligibleCardIds: player.hand.map((c) => c.id),
        targetMin: 0,
        targetMax: 0,
        eligibleTargetIds: []
      };
    },
    *execute(state, player, cardIds, _targetIds, helpers) {
      if (player.marks['guhuo_used'] || cardIds.length !== 1) return;
      const realCard = player.hand.find((c) => c.id === cardIds[0]);
      if (!realCard) return;

      // Filter declarable cards to ones legally playable right now
      const legalDeclarations: { name: CardName; label: string; targetIds: string[]; needsTarget: boolean }[] = [];
      for (const decl of GUHUO_DECLARABLE) {
        const fakeCard: CardInstance = {
          ...CARD_SPECS[decl.name],
          id: realCard.id,
          suit: realCard.suit,
          rank: realCard.rank,
          pack: realCard.pack
        };
        const info = getPlayableCardInfo(state, player.id, fakeCard, modifiers);
        if (info) {
          legalDeclarations.push({
            name: decl.name,
            label: decl.label,
            targetIds: info.eligibleTargetIds,
            needsTarget: info.needsTarget
          });
        }
      }
      if (legalDeclarations.length === 0) return;

      const declResp = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: player.id,
        reason: 'guhuo_declare',
        message: `【蛊惑】：选择将扣置的【${realCard.displayName}】声明为何种牌使用`,
        options: [
          ...legalDeclarations.map((d) => ({ id: d.name, label: d.label })),
          { id: 'cancel', label: '取消' }
        ]
      });
      if (declResp.type !== 'choose_option' || declResp.optionId === 'cancel') return;
      const chosenDecl = legalDeclarations.find((d) => d.name === declResp.optionId);
      if (!chosenDecl) return;

      let chosenTargets: string[] = [];
      if (chosenDecl.needsTarget) {
        const tResp = yield* helpers.ask({
          type: 'choose_target',
          promptId: helpers.nextPromptId(),
          playerId: player.id,
          reason: 'guhuo_target',
          message: `【蛊惑】声明${chosenDecl.label}：选择目标`,
          minCount: 1,
          maxCount: 1,
          eligibleTargetIds: chosenDecl.targetIds,
          optional: true
        });
        if (tResp.type !== 'choose_target' || tResp.cancelled || tResp.targetIds.length === 0) {
          return;
        }
        chosenTargets = tResp.targetIds;
      }

      player.marks['guhuo_used'] = 1;
      const prevHand = player.hand.length;
      const removed = removeUsableCard(player, realCard.id);
      if (!removed) return;
      helpers.moveToDiscard(removed);
      yield* helpers.checkHandEmptied(player.id, prevHand);

      helpers.log(
        'skill',
        `${player.name} 发动【蛊惑】，扣置一张手牌声明为${chosenDecl.label}！`,
        player.id,
        chosenTargets
      );

      // Ask all other alive players (without 缠怨) whether to doubt
      const doubters: string[] = [];
      const others = getAlivePlayersInOrder(state, player.id, false);
      for (const other of others) {
        if (other.skills.includes('chanyuan')) continue;
        const qResp = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: other.id,
          reason: 'guhuo_question',
          message: `${player.name} 【蛊惑】声明使用${chosenDecl.label}，你是否质疑？`,
          options: [
            { id: 'trust', label: '不质疑' },
            { id: 'doubt', label: '质疑！' }
          ]
        });
        if (qResp.type === 'choose_option' && qResp.optionId === 'doubt') {
          doubters.push(other.id);
        }
      }

      if (doubters.length > 0) {
        helpers.pushTableCard(removed, player.id, `蛊惑揭示:${removed.displayName}`);
        const isReal =
          removed.name === chosenDecl.name ||
          (chosenDecl.name === 'slash' &&
            (removed.name === 'fire_slash' || removed.name === 'thunder_slash'));
        if (!isReal) {
          helpers.log(
            'skill',
            `【蛊惑】质疑成功！实际为【${removed.displayName}】（假牌），此牌作废，质疑者各摸 1 张牌！`,
            player.id,
            doubters
          );
          for (const did of doubters) {
            const d = state.players.find((x) => x.id === did && x.alive);
            if (d) helpers.drawCards(d.id, 1);
          }
          return;
        }
        helpers.log(
          'skill',
          `【蛊惑】竟然是真牌【${removed.displayName}】！质疑者获得【缠怨】！`,
          player.id,
          doubters
        );
        for (const did of doubters) {
          helpers.gainSkill(did, 'chanyuan');
        }
      }

      // Execute declared card!
      const virtualAsCard: CardInstance = {
        ...CARD_SPECS[chosenDecl.name],
        id: removed.id,
        suit: removed.suit,
        rank: removed.rank,
        pack: removed.pack
      };
      if (chosenDecl.name === 'peach') {
        const healed = yield* helpers.healAsync(player.id, 1);
        helpers.log('heal', `${player.name} 【蛊惑】使用【桃】回复 ${healed} 点体力`, player.id);
      } else if (chosenDecl.name === 'alcohol') {
        player.drunk = true;
        player.drunkUsedThisTurn += 1;
        helpers.log('skill', `${player.name} 【蛊惑】使用【酒】`, player.id);
      } else if (chosenDecl.name === 'slash') {
        const tgt = state.players.find((x) => x.id === chosenTargets[0] && x.alive);
        if (tgt) {
          const vs: VirtualCard = {
            name: 'slash',
            displayName: '杀(蛊惑)',
            suit: removed.suit,
            rank: removed.rank,
            color: getCardColor(removed.suit),
            element: 'normal',
            subcards: [removed],
            sourceSkill: 'guhuo'
          };
          yield* helpers.resolveSlash(player, [tgt], vs, {
            countTowardLimit: true,
            useDrunkBonus: true
          });
        }
      } else {
        yield* helpers.resolveNormalTrick(player, virtualAsCard, chosenTargets);
      }
    }
  });
}
