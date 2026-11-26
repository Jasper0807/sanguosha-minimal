import {
  isSlashCardName,
  type CardInstance,
  type EquipSlot,
  type GeneralDefinition,
  type ModifierRegistry,
  type PlayerState,
  type SkillRegistry,
  type TriggerHelpers,
  type TriggerRegistry
} from '../../index.js';
import { CARD_SPECS } from '../../data/cards/specs.js';
import { ALL_PLAYABLE_GENERALS, getGeneralById, getSkillMetaById } from '../../data/generals/index.js';
import { hasActiveSkill } from '../../core/events.js';
import { getDistance, isInAttackRange } from '../../core/distance.js';
import {
  buildPlayerCardChoices,
  extractChoiceCard,
  getEquipSlot,
  getEquippedCards,
  getUsableCards,
  removeUsableCard
} from '../../core/deck.js';
import { getAlivePlayersInOrder } from '../../core/targeting.js';

function getEligibleHuashenSkills(gen: GeneralDefinition): string[] {
  return gen.skills
    .filter(
      (s) =>
        s.type !== 'lord' &&
        s.type !== 'awakening' &&
        s.type !== 'limited' &&
        s.id !== 'huashen' &&
        s.id !== 'xinsheng'
    )
    .map((s) => s.id);
}

function drawUnusedGeneralForHuashen(
  state: { players: PlayerState[] },
  zuoci: PlayerState,
  rngIndexFn: (max: number) => number
): GeneralDefinition | null {
  const usedIds = new Set<string>(state.players.map((p) => p.generalId));
  for (const hid of zuoci.huashenPool ?? []) usedIds.add(hid);
  const candidates = ALL_PLAYABLE_GENERALS.filter(
    (g) => !usedIds.has(g.id) && g.id !== 'exp_zuoci' && getEligibleHuashenSkills(g).length > 0
  );
  if (candidates.length === 0) return null;
  return candidates[rngIndexFn(candidates.length)] ?? candidates[0];
}

function* promptSelectHuashen(
  zc: PlayerState,
  helpers: TriggerHelpers,
  allowKeepCurrent: boolean
) {
  const pool = zc.huashenPool ?? [];
  if (pool.length === 0) return;

  const skillOptions: { id: string; label: string; genId: string; skillId: string }[] = [];
  for (const gid of pool) {
    const gen = getGeneralById(gid);
    for (const sid of getEligibleHuashenSkills(gen)) {
      const meta = getSkillMetaById(sid);
      skillOptions.push({
        id: `${gid}::${sid}`,
        label: `${gen.name} · 【${meta?.name ?? sid}】`,
        genId: gid,
        skillId: sid
      });
    }
  }
  if (skillOptions.length === 0) return;

  const resp = yield* helpers.ask({
    type: 'choose_option',
    promptId: helpers.nextPromptId(),
    playerId: zc.id,
    reason: 'huashen',
    message: '【化身】：选择要展示的化身武将与技能',
    options: [
      ...skillOptions.map((o) => ({ id: o.id, label: o.label })),
      ...(allowKeepCurrent ? [{ id: 'keep', label: '保持当前化身不变' }] : [])
    ]
  });

  if (resp.type !== 'choose_option' || resp.optionId === 'keep') return;
  const picked = skillOptions.find((o) => o.id === resp.optionId) ?? skillOptions[0];
  if (!picked) return;

  if (zc.activeHuashenSkillId && zc.activeHuashenSkillId !== picked.skillId) {
    helpers.removeSkill(zc.id, zc.activeHuashenSkillId);
  }
  const gen = getGeneralById(picked.genId);
  zc.activeHuashenGeneralId = gen.id;
  zc.activeHuashenSkillId = picked.skillId;
  zc.faction = gen.faction;
  zc.gender = gen.gender;
  helpers.gainSkill(zc.id, picked.skillId);
  const meta = getSkillMetaById(picked.skillId);
  helpers.log(
    'skill',
    `${zc.name} 【化身】为 ${gen.name}（${gen.faction}），获得技能【${meta?.name ?? picked.skillId}】！`,
    zc.id
  );
}

export function registerShanSkills(
  triggers: TriggerRegistry,
  modifiers: ModifierRegistry,
  skills: SkillRegistry
): void {
  triggers.register({
    id: 'skill_shan_turn_reset',
    timing: 'TurnStart',
    priority: 12,
    *execute(state, payload) {
      const p = state.players.find((x) => x.id === payload.playerId);
      if (!p) return;
      delete p.marks['tiaoxin_used'];
      delete p.marks['fangquan_skipped'];
      delete p.marks['zhiba_used'];
    }
  });

  // ===== 1. 张郃：巧变（弃1手牌跳过判定/摸牌/出牌/弃牌；跳摸获至多2人1手牌；跳出移场上1牌）=====
  triggers.register({
    id: 'skill_qiaobian',
    timing: 'PhaseBefore',
    priority: 61,
    condition: (state, payload) => {
      if (!payload.playerId || !payload.phase) return false;
      if (payload.phase === 'prepare' || payload.phase === 'finish') return false;
      if (state.skippedPhases.includes(payload.phase)) return false;
      const zh = state.players.find((x) => x.id === payload.playerId);
      return Boolean(zh && hasActiveSkill(zh, 'qiaobian') && zh.hand.length > 0);
    },
    *execute(state, payload, helpers) {
      const zh = state.players.find((x) => x.id === payload.playerId)!;
      const phase = payload.phase!;
      const phaseNames: Record<string, string> = {
        judge: '判定阶段',
        draw: '摸牌阶段（可偷至多2人各1手牌）',
        play: '出牌阶段（可移动场上一张牌）',
        discard: '弃牌阶段'
      };
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: zh.id,
        reason: `qiaobian_${phase}`,
        message: `【巧变】：是否弃置一张手牌跳过${phaseNames[phase]}？`,
        options: [
          { id: 'yes', label: `发动【巧变】跳过${phase}` },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const cResp = yield* helpers.ask({
        type: 'choose_card',
        promptId: helpers.nextPromptId(),
        playerId: zh.id,
        reason: 'general_skill',
        message: '【巧变】：选择弃置一张手牌',
        minCount: 1,
        maxCount: 1,
        eligibleCardIds: zh.hand.map((c) => c.id),
        optional: true
      });
      if (cResp.type !== 'choose_card' || cResp.cancelled || cResp.cardIds.length !== 1) return;

      yield* helpers.discardCards(zh.id, [cResp.cardIds[0]]);
      state.skippedPhases.push(phase);
      helpers.log('skill', `${zh.name} 发动【巧变】，弃置一张手牌跳过 ${phase} 阶段！`, zh.id);

      if (!zh.alive || state.result) return;

      if (phase === 'draw') {
        const withHand = state.players.filter((o) => o.alive && o.id !== zh.id && o.hand.length > 0);
        if (withHand.length === 0) return;
        const tResp = yield* helpers.ask({
          type: 'choose_target',
          promptId: helpers.nextPromptId(),
          playerId: zh.id,
          reason: 'qiaobian_draw',
          message: '【巧变】：选择至多两名有手牌的其他角色，各获得其一张手牌',
          minCount: 1,
          maxCount: Math.min(2, withHand.length),
          eligibleTargetIds: withHand.map((o) => o.id),
          optional: true
        });
        if (tResp.type === 'choose_target' && !tResp.cancelled && tResp.targetIds.length > 0) {
          for (const tid of tResp.targetIds.slice(0, 2)) {
            const victim = state.players.find((o) => o.id === tid && o.alive && o.hand.length > 0);
            if (!victim) continue;
            const choices = buildPlayerCardChoices(victim, {
              includeHand: true,
              includeEquips: false,
              includeJudge: false
            });
            const pick = yield* helpers.ask({
              type: 'choose_player_card',
              promptId: helpers.nextPromptId(),
              playerId: zh.id,
              targetId: victim.id,
              reason: 'snatch',
              message: `【巧变】：从 ${victim.name} 获得一张手牌`,
              choices
            });
            const idx = pick.type === 'choose_player_card' && choices[pick.choiceIndex] ? pick.choiceIndex : 0;
            const prevHand = victim.hand.length;
            const ex = extractChoiceCard(victim, choices[idx]);
            if (ex) {
              zh.hand.push(ex.card);
              yield* helpers.checkHandEmptied(victim.id, prevHand);
              yield* helpers.notifyCardsLost(victim.id, [ex.card], true);
              yield* helpers.notifyCardsObtained(zh.id, [ex.card]);
            }
          }
        }
      } else if (phase === 'play') {
        yield* helpers.moveFieldCard(zh.id, '巧变');
      }
    }
  });

  // ===== 2. 邓艾：屯田（回合外失牌判定非红桃置田，距离-田数）& 凿险（觉醒）& 急袭（田当顺手）=====
  triggers.register({
    id: 'skill_tuntian',
    timing: 'CardsLost',
    priority: 50,
    condition: (state, payload) => {
      if (!payload.playerId || !payload.lostCards || payload.lostCards.length === 0) return false;
      const active = state.players[state.activePlayerIndex];
      if (active && active.id === payload.playerId) return false;
      const da = state.players.find((p) => p.id === payload.playerId);
      return Boolean(da && hasActiveSkill(da, 'tuntian'));
    },
    *execute(state, payload, helpers) {
      const da = state.players.find((p) => p.id === payload.playerId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: da.id,
        reason: 'tuntian',
        message: '回合外失去牌：是否发动【屯田】进行判定？（非红桃置于武将牌上称为“田”）',
        options: [
          { id: 'yes', label: '发动【屯田】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const judge = yield* helpers.resolveJudge(da.id, '屯田');
      if (!da.alive || state.result) return;
      if (helpers.getEffectiveSuit(da.id, judge) !== 'heart') {
        const taken = helpers.takeCardFromDiscard(judge.id);
        if (taken) {
          if (!da.removedCards['tian']) da.removedCards['tian'] = [];
          da.removedCards['tian'].push(taken);
          helpers.log(
            'skill',
            `${da.name} 【屯田】判定非红桃，将【${taken.displayName}】置为“田”（当前 ${da.removedCards['tian'].length} 田）`,
            da.id
          );
        }
      }
    }
  });

  modifiers.register({
    id: 'skill_tuntian_dist',
    distanceDelta: (_state, from) => {
      if (!hasActiveSkill(from, 'tuntian')) return 0;
      return -(from.removedCards['tian']?.length ?? 0);
    }
  });

  triggers.register({
    id: 'skill_zaoxian',
    timing: 'PhaseStart',
    priority: 62,
    condition: (state, payload) => {
      if (payload.phase !== 'prepare' || !payload.playerId) return false;
      const da = state.players.find((x) => x.id === payload.playerId);
      if (!da || !hasActiveSkill(da, 'zaoxian') || da.marks['zaoxian_awakened']) return false;
      return (da.removedCards['tian']?.length ?? 0) >= 3;
    },
    *execute(state, payload, helpers) {
      const da = state.players.find((x) => x.id === payload.playerId)!;
      da.marks['zaoxian_awakened'] = 1;
      helpers.log('skill', `${da.name} 触发觉醒技【凿险】，减少 1 点体力上限并获得【急袭】！`, da.id);
      yield* helpers.changeMaxHp(da.id, -1);
      if (da.alive && !state.result) {
        helpers.gainSkill(da.id, 'jixi_dengai');
      }
    }
  });

  skills.registerActive({
    skillId: 'jixi_dengai',
    getPromptInfo: (state, player, mods) => {
      const tian = player.removedCards['tian'] ?? [];
      if (tian.length === 0) return null;
      const trickNoDist = mods.isTrickDistanceUnlimited(state, player);
      const targets = state.players
        .filter((o) => {
          if (!o.alive || o.id === player.id) return false;
          const hasCards =
            o.hand.length > 0 || getEquippedCards(o).length > 0 || o.judgeZone.length > 0;
          if (!hasCards) return false;
          const inDist = trickNoDist || getDistance(state, player.id, o.id, mods) <= 1;
          return inDist && mods.canBeTargetedByCard(state, player, o, 'snatch');
        })
        .map((o) => o.id);
      if (targets.length === 0) return null;
      return {
        skillId: 'jixi_dengai',
        name: '急袭',
        description: `移去一张“田”（当前 ${tian.length} 张），视为对距离1以内角色使用【顺手牵羊】。`,
        cardMin: 0,
        cardMax: 0,
        eligibleCardIds: [],
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: targets
      };
    },
    *execute(state, player, _cardIds, targetIds, helpers) {
      const tian = player.removedCards['tian'];
      const target = state.players.find((p) => p.id === targetIds[0] && p.alive);
      if (!tian || tian.length === 0 || !target) return;

      const spent = tian.pop()!;
      helpers.pushTableCard(spent, player.id, '急袭顺手');
      helpers.moveToDiscard(spent);
      helpers.log('skill', `${player.name} 发动【急袭】，移去一张“田”对 ${target.name} 使用【顺手牵羊】！`, player.id, [target.id], [spent.id]);

      const virtualSnatch: CardInstance = {
        ...CARD_SPECS['snatch'],
        id: spent.id,
        suit: spent.suit,
        rank: spent.rank,
        pack: spent.pack
      };
      yield* helpers.resolveNormalTrick(player, virtualSnatch, [target.id]);
    }
  });

  // ===== 3. 姜维：挑衅（限1次，令攻击范围含己者出杀，否则弃其1牌）& 志继（空城觉醒）=====
  skills.registerActive({
    skillId: 'tiaoxin',
    getPromptInfo: (state, player, mods) => {
      if (player.marks['tiaoxin_used']) return null;
      const targets = state.players
        .filter(
          (o) =>
            o.alive &&
            o.id !== player.id &&
            isInAttackRange(state, o.id, player.id, mods)
        )
        .map((o) => o.id);
      if (targets.length === 0) return null;
      return {
        skillId: 'tiaoxin',
        name: '挑衅',
        description: '出牌阶段限1次，令攻击范围内包含你的一名角色对你使用【杀】，否则你弃置其一张牌。',
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
      if (!target || player.marks['tiaoxin_used']) return;
      player.marks['tiaoxin_used'] = 1;
      helpers.log('skill', `${player.name} 对 ${target.name} 发动【挑衅】！`, player.id, [target.id]);

      const slashed = yield* helpers.askSlashAgainst(
        target.id,
        player.id,
        `【挑衅】：请对 ${player.name} 使用一张【杀】，否则其弃置你一张牌`
      );
      if (slashed || !player.alive || !target.alive || state.result) return;

      const choices = buildPlayerCardChoices(target, {
        includeHand: true,
        includeEquips: true,
        includeJudge: false
      }).filter((ch) =>
        ch.zone === 'hand' || ch.zone === 'judge'
          ? true
          : helpers.canDiscardPlayerEquip(player.id, target.id, ch.zone as EquipSlot)
      );
      if (choices.length === 0) return;

      const pick = yield* helpers.ask({
        type: 'choose_player_card',
        promptId: helpers.nextPromptId(),
        playerId: player.id,
        targetId: target.id,
        reason: 'dismantle',
        message: `【挑衅】：${target.name} 未出【杀】，选择弃置其一张牌`,
        choices
      });
      const idx = pick.type === 'choose_player_card' && choices[pick.choiceIndex] ? pick.choiceIndex : 0;
      const prevHand = target.hand.length;
      const ex = extractChoiceCard(target, choices[idx]);
      if (!ex) return;

      helpers.moveToDiscard(ex.card);
      for (const ox of ex.lostWoodenOxStash) helpers.moveToDiscard(ox);
      helpers.log('skill', `${player.name} 【挑衅】弃置了 ${target.name} 的【${ex.card.displayName}】`, player.id, [target.id]);
      if (ex.wasEquip) {
        yield* helpers.fireEquipLost(target.id, ex.card);
      } else {
        yield* helpers.checkHandEmptied(target.id, prevHand);
      }
      yield* helpers.notifyCardsLost(target.id, [ex.card], !ex.wasEquip);
    }
  });

  triggers.register({
    id: 'skill_zhiji',
    timing: 'PhaseStart',
    priority: 62,
    condition: (state, payload) => {
      if (payload.phase !== 'prepare' || !payload.playerId) return false;
      const jw = state.players.find((x) => x.id === payload.playerId);
      return Boolean(
        jw && hasActiveSkill(jw, 'zhiji') && !jw.marks['zhiji_awakened'] && jw.hand.length === 0
      );
    },
    *execute(state, payload, helpers) {
      const jw = state.players.find((x) => x.id === payload.playerId)!;
      jw.marks['zhiji_awakened'] = 1;
      helpers.log('skill', `${jw.name} 空城触发觉醒技【志继】！`, jw.id);
      if (jw.hp < jw.maxHp) {
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: jw.id,
          reason: 'zhiji',
          message: '【志继】觉醒：选择回复 1 点体力或摸两张牌',
          options: [
            { id: 'heal', label: '回复 1 点体力' },
            { id: 'draw', label: '摸两张牌' }
          ]
        });
        if (opt.type === 'choose_option' && opt.optionId === 'heal') {
          yield* helpers.healAsync(jw.id, 1);
        } else {
          helpers.drawCards(jw.id, 2);
        }
      } else {
        helpers.drawCards(jw.id, 2);
      }
      yield* helpers.changeMaxHp(jw.id, -1);
      if (jw.alive && !state.result) {
        helpers.gainSkill(jw.id, 'guanxing');
        helpers.log('skill', `${jw.name} 觉醒获得技能【观星】！`, jw.id);
      }
    }
  });

  // ===== 4. 刘禅：享乐（杀需弃基本牌否则无效）& 放权（跳过出牌，结束弃1牌令他额外回合）& 若愚（主公觉醒）=====
  triggers.register({
    id: 'skill_xiangle',
    timing: 'TargetConfirmed',
    priority: 72,
    condition: (state, payload) => {
      const st = payload.slashTarget;
      if (!st || st.cancelled) return false;
      const target = state.players.find((p) => p.id === st.targetId);
      return Boolean(target && hasActiveSkill(target, 'xiangle'));
    },
    *execute(state, payload, helpers) {
      const st = payload.slashTarget!;
      const attacker = state.players.find((p) => p.id === st.attackerId && p.alive);
      const ls = state.players.find((p) => p.id === st.targetId)!;
      if (!attacker) {
        st.cancelled = true;
        return;
      }

      const basics = attacker.hand.filter((c) => c.category === 'basic');
      if (basics.length === 0) {
        st.cancelled = true;
        helpers.log('skill', `${ls.name} 触发【享乐】，${attacker.name} 无基本牌可弃，此【杀】无效！`, ls.id);
        return;
      }

      const resp = yield* helpers.ask({
        type: 'choose_card',
        promptId: helpers.nextPromptId(),
        playerId: attacker.id,
        reason: 'general_skill',
        message: `${ls.name} 触发【享乐】：是否弃置一张基本牌，否则此【杀】无效？`,
        minCount: 1,
        maxCount: 1,
        eligibleCardIds: basics.map((c) => c.id),
        optional: true
      });
      if (resp.type === 'choose_card' && !resp.cancelled && resp.cardIds.length === 1) {
        yield* helpers.discardCards(attacker.id, [resp.cardIds[0]]);
      } else {
        st.cancelled = true;
        helpers.log('skill', `${ls.name} 【享乐】生效：${attacker.name} 未弃基本牌，此【杀】无效！`, ls.id);
      }
    }
  });

  triggers.register({
    id: 'skill_fangquan_skip',
    timing: 'PhaseBefore',
    priority: 55,
    condition: (state, payload) => {
      if (payload.phase !== 'play' || !payload.playerId) return false;
      if (state.skippedPhases.includes('play')) return false;
      const ls = state.players.find((x) => x.id === payload.playerId);
      return Boolean(
        ls &&
          hasActiveSkill(ls, 'fangquan') &&
          state.players.some((o) => o.alive && o.id !== ls.id)
      );
    },
    *execute(state, payload, helpers) {
      const ls = state.players.find((x) => x.id === payload.playerId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: ls.id,
        reason: 'fangquan_skip',
        message: '出牌阶段：是否发动【放权】跳过出牌阶段？（回合结束可弃1手牌令一名其他角色执行额外回合）',
        options: [
          { id: 'yes', label: '发动【放权】跳过出牌' },
          { id: 'no', label: '正常出牌' }
        ]
      });
      if (opt.type === 'choose_option' && opt.optionId === 'yes') {
        state.skippedPhases.push('play');
        ls.marks['fangquan_skipped'] = 1;
        helpers.log('skill', `${ls.name} 发动【放权】，跳过出牌阶段！`, ls.id);
      }
    }
  });

  triggers.register({
    id: 'skill_fangquan_grant',
    timing: 'TurnEnd',
    priority: 55,
    condition: (state, payload) => {
      const ls = state.players.find((x) => x.id === payload.playerId);
      return Boolean(
        ls &&
          ls.alive &&
          ls.marks['fangquan_skipped'] &&
          ls.hand.length > 0 &&
          state.players.some((o) => o.alive && o.id !== ls.id)
      );
    },
    *execute(state, payload, helpers) {
      const ls = state.players.find((x) => x.id === payload.playerId)!;
      const others = state.players.filter((o) => o.alive && o.id !== ls.id);
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: ls.id,
        reason: 'fangquan_grant',
        message: '回合结束：是否弃置一张手牌，令一名其他角色执行一个额外回合？',
        options: [
          { id: 'yes', label: '弃1手牌赐予额外回合' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const cResp = yield* helpers.ask({
        type: 'choose_card',
        promptId: helpers.nextPromptId(),
        playerId: ls.id,
        reason: 'general_skill',
        message: '【放权】：选择弃置一张手牌',
        minCount: 1,
        maxCount: 1,
        eligibleCardIds: ls.hand.map((c) => c.id),
        optional: true
      });
      if (cResp.type !== 'choose_card' || cResp.cancelled || cResp.cardIds.length !== 1) return;

      const tResp = yield* helpers.ask({
        type: 'choose_target',
        promptId: helpers.nextPromptId(),
        playerId: ls.id,
        reason: 'fangquan_target',
        message: '【放权】：选择执行额外回合的一名其他角色',
        minCount: 1,
        maxCount: 1,
        eligibleTargetIds: others.map((o) => o.id),
        optional: false
      });
      const tid = tResp.type === 'choose_target' && tResp.targetIds[0] ? tResp.targetIds[0] : others[0].id;
      const target = state.players.find((o) => o.id === tid && o.alive);
      if (!target) return;

      yield* helpers.discardCards(ls.id, [cResp.cardIds[0]]);
      helpers.queueExtraTurn(target.id);
      helpers.log('skill', `${ls.name} 【放权】令 ${target.name} 执行一个额外回合！`, ls.id, [target.id]);
    }
  });

  triggers.register({
    id: 'skill_ruoyu',
    timing: 'PhaseStart',
    priority: 62,
    condition: (state, payload) => {
      if (payload.phase !== 'prepare' || !payload.playerId) return false;
      const ls = state.players.find((x) => x.id === payload.playerId);
      if (!ls || !hasActiveSkill(ls, 'ruoyu') || ls.marks['ruoyu_awakened']) return false;
      const minHp = Math.min(...state.players.filter((p) => p.alive).map((p) => p.hp));
      return ls.hp <= minHp;
    },
    *execute(state, payload, helpers) {
      const ls = state.players.find((x) => x.id === payload.playerId)!;
      ls.marks['ruoyu_awakened'] = 1;
      helpers.log('skill', `${ls.name} 触发主公觉醒技【若愚】，体力上限+1、回复1点体力并获得【激将】！`, ls.id);
      yield* helpers.changeMaxHp(ls.id, 1);
      yield* helpers.healAsync(ls.id, 1);
      if (ls.alive && !state.result) {
        helpers.gainSkill(ls.id, 'jijiang');
      }
    }
  });

  // ===== 5. 孙策：激昂（决斗或红杀指定/成为目标摸1）& 魂姿（1血觉醒获英姿英魂）& 制霸（主公技）=====
  triggers.register({
    id: 'skill_jiang_slash_user',
    timing: 'TargetSpecified',
    priority: 48,
    condition: (state, payload) => {
      const st = payload.slashTarget;
      if (!st || st.slashCard.color !== 'red') return false;
      const p = state.players.find((x) => x.id === st.attackerId);
      return Boolean(p && hasActiveSkill(p, 'jiang'));
    },
    *execute(state, payload, helpers) {
      const sc = state.players.find((x) => x.id === payload.slashTarget!.attackerId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: sc.id,
        reason: 'jiang',
        message: '使用红色【杀】指定目标：是否发动【激昂】摸一张牌？',
        options: [
          { id: 'yes', label: '发动【激昂】摸1牌' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type === 'choose_option' && opt.optionId === 'yes') {
        const drawn = helpers.drawCards(sc.id, 1);
        helpers.log('skill', `${sc.name} 发动【激昂】，摸了一张牌`, sc.id);
        yield* helpers.notifyCardsObtained(sc.id, drawn);
      }
    }
  });

  triggers.register({
    id: 'skill_jiang_slash_target',
    timing: 'TargetConfirmed',
    priority: 48,
    condition: (state, payload) => {
      const st = payload.slashTarget;
      if (!st || st.slashCard.color !== 'red') return false;
      const p = state.players.find((x) => x.id === st.targetId);
      return Boolean(p && hasActiveSkill(p, 'jiang'));
    },
    *execute(state, payload, helpers) {
      const sc = state.players.find((x) => x.id === payload.slashTarget!.targetId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: sc.id,
        reason: 'jiang',
        message: '成为红色【杀】的目标：是否发动【激昂】摸一张牌？',
        options: [
          { id: 'yes', label: '发动【激昂】摸1牌' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type === 'choose_option' && opt.optionId === 'yes') {
        const drawn = helpers.drawCards(sc.id, 1);
        helpers.log('skill', `${sc.name} 发动【激昂】，摸了一张牌`, sc.id);
        yield* helpers.notifyCardsObtained(sc.id, drawn);
      }
    }
  });

  triggers.register({
    id: 'skill_jiang_duel',
    timing: 'DuelTargeted',
    priority: 48,
    condition: (state, payload) => {
      const ids = [payload.duelUserId, payload.duelTargetId].filter(Boolean) as string[];
      return ids.some((id) => {
        const p = state.players.find((x) => x.id === id);
        return Boolean(p && hasActiveSkill(p, 'jiang'));
      });
    },
    *execute(state, payload, helpers) {
      const ids = Array.from(
        new Set([payload.duelUserId, payload.duelTargetId].filter(Boolean) as string[])
      );
      for (const id of ids) {
        const sc = state.players.find((x) => x.id === id);
        if (!sc || !hasActiveSkill(sc, 'jiang')) continue;
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: sc.id,
          reason: 'jiang',
          message: '参与【决斗】：是否发动【激昂】摸一张牌？',
          options: [
            { id: 'yes', label: '发动【激昂】摸1牌' },
            { id: 'no', label: '不发动' }
          ]
        });
        if (opt.type === 'choose_option' && opt.optionId === 'yes') {
          const drawn = helpers.drawCards(sc.id, 1);
          helpers.log('skill', `${sc.name} 发动【激昂】，摸了一张牌`, sc.id);
          yield* helpers.notifyCardsObtained(sc.id, drawn);
        }
      }
    }
  });

  triggers.register({
    id: 'skill_hunzi',
    timing: 'PhaseStart',
    priority: 62,
    condition: (state, payload) => {
      if (payload.phase !== 'prepare' || !payload.playerId) return false;
      const sc = state.players.find((x) => x.id === payload.playerId);
      return Boolean(
        sc && hasActiveSkill(sc, 'hunzi') && !sc.marks['hunzi_awakened'] && sc.hp === 1
      );
    },
    *execute(state, payload, helpers) {
      const sc = state.players.find((x) => x.id === payload.playerId)!;
      sc.marks['hunzi_awakened'] = 1;
      helpers.log('skill', `${sc.name} 触发觉醒技【魂姿】，减少 1 点体力上限并获得【英姿】与【英魂】！`, sc.id);
      yield* helpers.changeMaxHp(sc.id, -1);
      if (sc.alive && !state.result) {
        helpers.gainSkill(sc.id, 'yingzi');
        helpers.gainSkill(sc.id, 'yinghun');
      }
    }
  });

  // 制霸（主公技：其他吴势力角色出牌阶段限1次与孙策拼点）
  skills.registerActive({
    skillId: 'zhiba_pindian',
    allowWithoutOwnSkill: true,
    getPromptInfo: (state, player) => {
      if (player.faction !== 'wu' || player.marks['zhiba_used'] || player.hand.length === 0) {
        return null;
      }
      const lords = state.players.filter(
        (l) => l.alive && l.id !== player.id && hasActiveSkill(l, 'zhiba') && l.hand.length > 0
      );
      if (lords.length === 0) return null;
      return {
        skillId: 'zhiba_pindian',
        name: '制霸(拼点)',
        description: '响应主公孙策【制霸】，出牌阶段限1次与其拼点；若你没赢，孙策可获得两张拼点牌。',
        cardMin: 0,
        cardMax: 0,
        eligibleCardIds: [],
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: lords.map((l) => l.id)
      };
    },
    *execute(state, player, _cardIds, targetIds, helpers) {
      const lord = state.players.find(
        (l) => l.alive && l.id === targetIds[0] && hasActiveSkill(l, 'zhiba') && l.hand.length > 0
      );
      if (!lord || player.marks['zhiba_used'] || player.hand.length === 0) return;
      player.marks['zhiba_used'] = 1;

      if (lord.marks['hunzi_awakened']) {
        const ref = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: lord.id,
          reason: 'zhiba_accept',
          message: `${player.name} 请求与你进行【制霸】拼点（你已觉醒魂姿，可拒绝）：`,
          options: [
            { id: 'yes', label: '接受拼点' },
            { id: 'no', label: '拒绝拼点' }
          ]
        });
        if (ref.type === 'choose_option' && ref.optionId === 'no') {
          helpers.log('skill', `${lord.name} 拒绝了 ${player.name} 的【制霸】拼点`, lord.id);
          return;
        }
      }

      const res = yield* helpers.resolvePindian(player.id, lord.id, '制霸');
      if (!res || state.result || !lord.alive) return;
      if (res.winner !== 'initiator') {
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: lord.id,
          reason: 'zhiba_take',
          message: `【制霸】拼点成功：是否获得两张拼点牌？`,
          options: [
            { id: 'yes', label: '获得两张拼点牌' },
            { id: 'no', label: '不获得' }
          ]
        });
        if (opt.type === 'choose_option' && opt.optionId === 'yes') {
          const gained: CardInstance[] = [];
          for (const cid of [res.initiatorCard.id, res.targetCard.id]) {
            const taken = helpers.takeCardFromDiscard(cid);
            if (taken) {
              lord.hand.push(taken);
              gained.push(taken);
            }
          }
          if (gained.length > 0) {
            helpers.log('skill', `${lord.name} 【制霸】获得了两张拼点牌`, lord.id);
            yield* helpers.notifyCardsObtained(lord.id, gained);
          }
        }
      }
    }
  });

  // ===== 6. 张昭&张纮：直谏（手牌装备置入他者装备区摸1）& 固政（他弃牌阶段结束还1拿其余）=====
  skills.registerActive({
    skillId: 'zhijian',
    getPromptInfo: (state, player) => {
      const handEquips = player.hand.filter((c) => c.category === 'equip');
      if (handEquips.length === 0) return null;
      const others = state.players.filter((o) => o.alive && o.id !== player.id);
      if (others.length === 0) return null;
      const eligibleCards = handEquips.filter((eq) => {
        const slot = getEquipSlot(eq);
        return Boolean(slot && others.some((o) => !o.equips[slot]));
      });
      if (eligibleCards.length === 0) return null;
      return {
        skillId: 'zhijian',
        name: '直谏',
        description: '将手牌中一张装备牌置入一名其他角色的空装备栏，然后摸一张牌。',
        cardMin: 1,
        cardMax: 1,
        eligibleCardIds: eligibleCards.map((c) => c.id),
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: others.map((o) => o.id)
      };
    },
    *execute(state, player, cardIds, targetIds, helpers) {
      const target = state.players.find((p) => p.id === targetIds[0] && p.alive && p.id !== player.id);
      if (!target || cardIds.length !== 1) return;
      const cardObj = player.hand.find((c) => c.id === cardIds[0] && c.category === 'equip');
      if (!cardObj) return;
      const slot = getEquipSlot(cardObj);
      if (!slot || target.equips[slot]) return;

      const prevHand = player.hand.length;
      const removed = removeUsableCard(player, cardObj.id);
      if (!removed) return;
      helpers.log('skill', `${player.name} 发动【直谏】，将【${removed.displayName}】置入 ${target.name} 装备区并摸一张牌`, player.id, [target.id], [removed.id]);
      yield* helpers.putEquipDirectly(target.id, removed);
      yield* helpers.checkHandEmptied(player.id, prevHand);
      if (player.alive && !state.result) {
        const drawn = helpers.drawCards(player.id, 1);
        yield* helpers.notifyCardsObtained(player.id, drawn);
      }
    }
  });

  triggers.register({
    id: 'skill_guzheng',
    timing: 'DiscardPhaseDiscarded',
    priority: 52,
    condition: (state, payload) => {
      if (!payload.playerId || !payload.discardedInPhaseCards || payload.discardedInPhaseCards.length === 0) {
        return false;
      }
      return state.players.some(
        (p) => p.id !== payload.playerId && hasActiveSkill(p, 'guzheng')
      );
    },
    *execute(state, payload, helpers) {
      const active = state.players.find((p) => p.id === payload.playerId && p.alive);
      if (!active) return;
      const cardsInDiscard = payload.discardedInPhaseCards!.filter((c) =>
        state.discardPile.some((d) => d.id === c.id)
      );
      if (cardsInDiscard.length === 0) return;

      const ordered = getAlivePlayersInOrder(state, active.id, false);
      for (const ez of ordered) {
        if (!hasActiveSkill(ez, 'guzheng')) continue;
        const stillInDiscard = cardsInDiscard.filter((c) =>
          state.discardPile.some((d) => d.id === c.id)
        );
        if (stillInDiscard.length === 0) break;

        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: ez.id,
          reason: 'guzheng',
          message: `${active.name} 弃牌阶段弃置了 ${stillInDiscard.length} 张牌：是否发动【固政】（还其1张，余牌归你）？`,
          options: [
            { id: 'yes', label: '发动【固政】' },
            { id: 'no', label: '不发动' }
          ]
        });
        if (opt.type !== 'choose_option' || opt.optionId !== 'yes') continue;

        const pickResp = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: ez.id,
          reason: 'guzheng_return',
          message: `【固政】：选择一张牌返还给 ${active.name}`,
          options: stillInDiscard.map((c) => ({
            id: `card_${c.id}`,
            label: `返还【${c.displayName}】`
          }))
        });
        const chosenId =
          pickResp.type === 'choose_option' && pickResp.optionId.startsWith('card_')
            ? Number(pickResp.optionId.replace('card_', ''))
            : stillInDiscard[0].id;

        const returned = helpers.takeCardFromDiscard(chosenId) ?? helpers.takeCardFromDiscard(stillInDiscard[0].id);
        if (returned) {
          active.hand.push(returned);
          yield* helpers.notifyCardsObtained(active.id, [returned]);
        }

        const rest: CardInstance[] = [];
        for (const c of stillInDiscard) {
          if (returned && c.id === returned.id) continue;
          const t = helpers.takeCardFromDiscard(c.id);
          if (t) {
            ez.hand.push(t);
            rest.push(t);
          }
        }
        helpers.log(
          'skill',
          `${ez.name} 发动【固政】，返还 ${active.name} 1 张牌，并获得其余 ${rest.length} 张弃牌！`,
          ez.id,
          [active.id]
        );
        if (rest.length > 0) {
          yield* helpers.notifyCardsObtained(ez.id, rest);
        }
        break;
      }
    }
  });

  // ===== 7. 蔡文姬：悲歌 & 断肠 =====
  triggers.register({
    id: 'skill_beige',
    timing: 'AfterDamageTaken',
    priority: 52,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.prevented || dmg.actualDeducted <= 0) return false;
      if (!dmg.card || !isSlashCardName(dmg.card.name)) return false;
      const victim = state.players.find((p) => p.id === dmg.targetId && p.alive);
      if (!victim) return false;
      return state.players.some(
        (p) =>
          hasActiveSkill(p, 'beige') &&
          getUsableCards(p).length + getEquippedCards(p).length > 0
      );
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const victim = state.players.find((p) => p.id === dmg.targetId && p.alive);
      if (!victim) return;
      const source = dmg.sourceId ? state.players.find((p) => p.id === dmg.sourceId) : undefined;

      const ordered = getAlivePlayersInOrder(state, victim.id);
      for (const cwj of ordered) {
        if (!hasActiveSkill(cwj, 'beige') || !victim.alive || state.result) continue;
        const cards = [...getUsableCards(cwj), ...getEquippedCards(cwj)];
        if (cards.length === 0) continue;

        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: cwj.id,
          reason: 'beige',
          message: `${victim.name} 受到【杀】的伤害：是否发动【悲歌】弃置一张牌令其判定？`,
          options: [
            { id: 'yes', label: '发动【悲歌】' },
            { id: 'no', label: '不发动' }
          ]
        });
        if (opt.type !== 'choose_option' || opt.optionId !== 'yes') continue;

        const cResp = yield* helpers.ask({
          type: 'choose_card',
          promptId: helpers.nextPromptId(),
          playerId: cwj.id,
          reason: 'general_skill',
          message: '【悲歌】：选择弃置一张牌',
          minCount: 1,
          maxCount: 1,
          eligibleCardIds: cards.map((c) => c.id),
          optional: true
        });
        if (cResp.type !== 'choose_card' || cResp.cancelled || cResp.cardIds.length !== 1) continue;

        yield* helpers.discardCards(cwj.id, [cResp.cardIds[0]]);
        const judge = yield* helpers.resolveJudge(victim.id, '悲歌');
        if (state.result) return;
        const effSuit = helpers.getEffectiveSuit(victim.id, judge);

        if (effSuit === 'heart' && victim.alive) {
          yield* helpers.healAsync(victim.id, 1);
          helpers.log('skill', `【悲歌】判定红桃：${victim.name} 回复 1 点体力`, cwj.id, [victim.id]);
        } else if (effSuit === 'diamond' && victim.alive) {
          const drawn = helpers.drawCards(victim.id, 2);
          helpers.log('skill', `【悲歌】判定方片：${victim.name} 摸两张牌`, cwj.id, [victim.id]);
          yield* helpers.notifyCardsObtained(victim.id, drawn);
        } else if (effSuit === 'club' && source && source.alive) {
          const srcCards = [...getUsableCards(source), ...getEquippedCards(source)];
          const discN = Math.min(2, srcCards.length);
          if (discN > 0) {
            const dResp = yield* helpers.ask({
              type: 'choose_card',
              promptId: helpers.nextPromptId(),
              playerId: source.id,
              reason: 'general_skill',
              message: `【悲歌】判定梅花：请弃置 ${discN} 张牌`,
              minCount: discN,
              maxCount: discN,
              eligibleCardIds: srcCards.map((c) => c.id),
              optional: false
            });
            const ids =
              dResp.type === 'choose_card' && dResp.cardIds.length === discN
                ? dResp.cardIds
                : srcCards.slice(0, discN).map((c) => c.id);
            yield* helpers.discardCards(source.id, ids);
          }
          helpers.log('skill', `【悲歌】判定梅花：${source.name} 弃置 ${discN} 张牌`, cwj.id, [source.id]);
        } else if (effSuit === 'spade' && source && source.alive) {
          helpers.log('skill', `【悲歌】判定黑桃：${source.name} 翻面！`, cwj.id, [source.id]);
          yield* helpers.flipPlayer(source.id);
        }
      }
    }
  });

  triggers.register({
    id: 'skill_duanchang',
    timing: 'PlayerDied',
    priority: 80,
    condition: (state, payload) => {
      if (!payload.victimId || !payload.killerId) return false;
      const victim = state.players.find((p) => p.id === payload.victimId);
      const killer = state.players.find((p) => p.id === payload.killerId && p.alive);
      return Boolean(victim && killer && victim.skills.includes('duanchang'));
    },
    *execute(state, payload, helpers) {
      const victim = state.players.find((p) => p.id === payload.victimId)!;
      const killer = state.players.find((p) => p.id === payload.killerId)!;
      killer.skills = [];
      helpers.log(
        'skill',
        `${victim.name} 触发锁定技【断肠】，${killer.name} 失去所有武将技能！`,
        victim.id,
        [killer.id]
      );
    }
  });

  // ===== 8. 左慈：化身（游戏开始得2化身，回合开始/结束可换）& 新生（受1伤加1化身）=====
  triggers.register({
    id: 'skill_huashen_init',
    timing: 'GameStart',
    priority: 70,
    *execute(state, _payload, helpers) {
      for (const zc of state.players) {
        if (!hasActiveSkill(zc, 'huashen')) continue;
        zc.huashenPool = [];
        for (let i = 0; i < 2; i++) {
          const picked = drawUnusedGeneralForHuashen(state, zc, (max) =>
            (state.config.seed + zc.seat * 13 + i * 7) % max
          );
          if (picked) zc.huashenPool.push(picked.id);
        }
        helpers.log(
          'skill',
          `${zc.name} 【化身】获得了 ${zc.huashenPool.map((id) => getGeneralById(id).name).join('、')} 作为化身牌！`,
          zc.id
        );
        yield* promptSelectHuashen(zc, helpers, false);
      }
    }
  });

  triggers.register({
    id: 'skill_huashen_swap_start',
    timing: 'TurnStart',
    priority: 65,
    condition: (state, payload) => {
      const zc = state.players.find((p) => p.id === payload.playerId);
      return Boolean(zc && hasActiveSkill(zc, 'huashen') && (zc.huashenPool?.length ?? 0) > 0);
    },
    *execute(state, payload, helpers) {
      const zc = state.players.find((p) => p.id === payload.playerId)!;
      yield* promptSelectHuashen(zc, helpers, true);
    }
  });

  triggers.register({
    id: 'skill_huashen_swap_end',
    timing: 'TurnEnd',
    priority: 30,
    condition: (state, payload) => {
      const zc = state.players.find((p) => p.id === payload.playerId);
      return Boolean(zc && hasActiveSkill(zc, 'huashen') && (zc.huashenPool?.length ?? 0) > 0);
    },
    *execute(state, payload, helpers) {
      const zc = state.players.find((p) => p.id === payload.playerId)!;
      yield* promptSelectHuashen(zc, helpers, true);
    }
  });

  triggers.register({
    id: 'skill_xinsheng',
    timing: 'AfterDamageTaken',
    priority: 52,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.prevented || dmg.actualDeducted <= 0) return false;
      const zc = state.players.find((p) => p.id === dmg.targetId);
      return Boolean(zc && hasActiveSkill(zc, 'xinsheng'));
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const zc = state.players.find((p) => p.id === dmg.targetId)!;
      if (!zc.huashenPool) zc.huashenPool = [];
      for (let i = 0; i < dmg.actualDeducted; i++) {
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: zc.id,
          reason: 'xinsheng',
          message: `【新生】（第 ${i + 1}/${dmg.actualDeducted} 次）：是否获得一张新的化身牌？`,
          options: [
            { id: 'yes', label: '发动【新生】获得新化身' },
            { id: 'no', label: '不发动' }
          ]
        });
        if (opt.type !== 'choose_option' || opt.optionId !== 'yes') break;
        const picked = drawUnusedGeneralForHuashen(state, zc, (max) =>
          (state.config.seed + state.turn * 17 + zc.huashenPool!.length * 11) % max
        );
        if (picked) {
          zc.huashenPool.push(picked.id);
          helpers.log('skill', `${zc.name} 发动【新生】，获得新化身牌【${picked.name}】！`, zc.id);
        }
      }
    }
  });
}
