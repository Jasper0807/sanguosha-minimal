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
import { getDistance } from '../../core/distance.js';
import {
  buildPlayerCardChoices,
  extractChoiceCard,
  getEquippedCards,
  getUsableCards,
  hasAnyCardInZones
} from '../../core/deck.js';
import { getAlivePlayersInOrder } from '../../core/targeting.js';

export function registerLinSkills(
  triggers: TriggerRegistry,
  modifiers: ModifierRegistry,
  skills: SkillRegistry
): void {
  triggers.register({
    id: 'skill_lin_turn_reset',
    timing: 'TurnStart',
    priority: 12,
    *execute(state, payload) {
      const p = state.players.find((x) => x.id === payload.playerId);
      if (!p) return;
      delete p.marks['haoshi_active'];
      delete p.marks['dimeng_used'];
    }
  });

  // ===== 1. 徐晃：断粮（黑基本/装备当兵粮，对手牌>=己无距）& 截辎（锁定技，他跳摸牌摸1）=====
  skills.registerActive({
    skillId: 'duanliang',
    getPromptInfo: (state, player, mods) => {
      const blacks = [...getUsableCards(player), ...getEquippedCards(player)].filter(
        (c) =>
          (c.category === 'basic' || c.category === 'equip') &&
          getCardColor(mods.getEffectiveSuit(state, player, c)) === 'black'
      );
      if (blacks.length === 0) return null;
      const trickNoDist = mods.isTrickDistanceUnlimited(state, player);
      const targets = state.players
        .filter((o) => {
          if (!o.alive || o.id === player.id) return false;
          if (o.judgeZone.some((j) => (j.asDelayedTrick ?? j.name) === 'supply_shortage')) {
            return false;
          }
          const inDist =
            trickNoDist ||
            o.hand.length >= player.hand.length ||
            getDistance(state, player.id, o.id, mods) <= 1;
          return inDist && mods.canBeTargetedByCard(state, player, o, 'supply_shortage', blacks[0]);
        })
        .map((o) => o.id);
      if (targets.length === 0) return null;
      return {
        skillId: 'duanliang',
        name: '断粮',
        description:
          '将一张黑色基本牌或黑色装备牌当【兵粮寸断】使用（对手牌数>=你的角色无距离限制）。',
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
      if (target.judgeZone.some((j) => (j.asDelayedTrick ?? j.name) === 'supply_shortage')) return;
      const removed = yield* helpers.removeCardFromPlayer(player.id, cardIds[0]);
      if (!removed) return;
      removed.asDelayedTrick = 'supply_shortage';
      target.judgeZone.unshift(removed);
      helpers.log(
        'skill',
        `${player.name} 发动【断粮】，将【${removed.displayName}】当【兵粮寸断】置于 ${target.name} 判定区`,
        player.id,
        [target.id],
        [removed.id]
      );
    }
  });

  modifiers.register({
    id: 'skill_duanliang_dist',
    supplyShortageDistanceUnlimited: (_state, source, target) =>
      hasActiveSkill(source, 'duanliang') && target.hand.length >= source.hand.length
  });

  triggers.register({
    id: 'skill_jiezi',
    timing: 'PhaseSkipped',
    priority: 50,
    condition: (state, payload) => {
      if (payload.phase !== 'draw' || !payload.playerId) return false;
      return state.players.some(
        (p) => p.id !== payload.playerId && hasActiveSkill(p, 'jiezi')
      );
    },
    *execute(state, payload, helpers) {
      const skippedId = payload.playerId!;
      const ordered = getAlivePlayersInOrder(state, skippedId, false);
      for (const xh of ordered) {
        if (!hasActiveSkill(xh, 'jiezi')) continue;
        const drawn = helpers.drawCards(xh.id, 1);
        helpers.log('skill', `${xh.name} 触发锁定技【截辎】，摸了一张牌`, xh.id);
        yield* helpers.notifyCardsObtained(xh.id, drawn);
      }
    }
  });

  // ===== 2. 曹丕：行殇（他死亡获其所有牌）& 放逐（受伤令他翻面摸已损体力张）& 颂威（主公技）=====
  triggers.register({
    id: 'skill_xingshang',
    timing: 'BeforePlayerDeathDiscard',
    priority: 60,
    condition: (state, payload) => {
      const victimId = payload.deathLoot?.victimId;
      if (!victimId || payload.deathLoot?.takenById) return false;
      const victim = state.players.find((p) => p.id === victimId);
      if (!victim) return false;
      const hasAny =
        victim.hand.length > 0 ||
        getEquippedCards(victim).length > 0 ||
        victim.woodenOxCards.length > 0;
      if (!hasAny) return false;
      return state.players.some((p) => p.id !== victimId && hasActiveSkill(p, 'xingshang'));
    },
    *execute(state, payload, helpers) {
      const victim = state.players.find((p) => p.id === payload.deathLoot!.victimId)!;
      const ordered = getAlivePlayersInOrder(state, victim.id, false);
      for (const cp of ordered) {
        if (!hasActiveSkill(cp, 'xingshang') || payload.deathLoot!.takenById) continue;
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: cp.id,
          reason: 'xingshang',
          message: `${victim.name} 阵亡：是否发动【行殇】获得其所有手牌与装备牌？`,
          options: [
            { id: 'yes', label: '发动【行殇】' },
            { id: 'no', label: '不发动' }
          ]
        });
        if (opt.type === 'choose_option' && opt.optionId === 'yes') {
          payload.deathLoot!.takenById = cp.id;
          const loot: CardInstance[] = [];
          loot.push(...victim.hand.splice(0));
          loot.push(...victim.woodenOxCards.splice(0));
          const slots = ['weapon', 'armor', 'horsePlus', 'horseMinus', 'treasure'] as const;
          for (const slot of slots) {
            const eq = victim.equips[slot];
            if (eq) {
              victim.equips[slot] = null;
              loot.push(eq);
            }
          }
          cp.hand.push(...loot);
          helpers.log(
            'skill',
            `${cp.name} 发动【行殇】，获得了 ${victim.name} 的全部 ${loot.length} 张牌！`,
            cp.id,
            [victim.id]
          );
          yield* helpers.notifyCardsObtained(cp.id, loot);
          break;
        }
      }
    }
  });

  triggers.register({
    id: 'skill_fangzhu',
    timing: 'AfterDamageTaken',
    priority: 52,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.prevented || dmg.actualDeducted <= 0) return false;
      const cp = state.players.find((p) => p.id === dmg.targetId);
      if (!cp || !hasActiveSkill(cp, 'fangzhu')) return false;
      return state.players.some((o) => o.alive && o.id !== cp.id);
    },
    *execute(state, payload, helpers) {
      const cp = state.players.find((p) => p.id === payload.damage!.targetId)!;
      const others = state.players.filter((o) => o.alive && o.id !== cp.id);
      if (others.length === 0) return;

      const lostHp = Math.max(0, cp.maxHp - cp.hp);
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: cp.id,
        reason: 'fangzhu',
        message: `受到伤害：是否发动【放逐】令一名其他角色翻面并摸 ${lostHp} 张牌？`,
        options: [
          { id: 'yes', label: `发动【放逐】（摸${lostHp}翻面）` },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const pick = yield* helpers.ask({
        type: 'choose_target',
        promptId: helpers.nextPromptId(),
        playerId: cp.id,
        reason: 'fangzhu_target',
        message: `【放逐】：选择一名其他角色翻面并摸 ${lostHp} 张牌`,
        minCount: 1,
        maxCount: 1,
        eligibleTargetIds: others.map((o) => o.id),
        optional: false
      });
      const tid = pick.type === 'choose_target' && pick.targetIds[0] ? pick.targetIds[0] : others[0].id;
      const target = state.players.find((o) => o.id === tid && o.alive);
      if (!target) return;

      helpers.log('skill', `${cp.name} 发动【放逐】，令 ${target.name} 翻面并摸 ${lostHp} 张牌！`, cp.id, [target.id]);
      yield* helpers.flipPlayer(target.id);
      if (target.alive && lostHp > 0 && !state.result) {
        const drawn = helpers.drawCards(target.id, lostHp);
        yield* helpers.notifyCardsObtained(target.id, drawn);
      }
    }
  });

  triggers.register({
    id: 'skill_songwei',
    timing: 'JudgeResolved',
    priority: 45,
    condition: (state, payload) => {
      if (!payload.judge || !payload.playerId) return false;
      const judged = state.players.find((p) => p.id === payload.playerId && p.alive);
      if (!judged || judged.faction !== 'wei') return false;
      const effSuit = modifiers.getEffectiveSuit(state, judged, payload.judge.card);
      if (getCardColor(effSuit) !== 'black') return false;
      return state.players.some((l) => l.id !== judged.id && hasActiveSkill(l, 'songwei'));
    },
    *execute(state, payload, helpers) {
      const judged = state.players.find((p) => p.id === payload.playerId && p.alive)!;
      const lords = getAlivePlayersInOrder(state, judged.id, false).filter((l) =>
        hasActiveSkill(l, 'songwei')
      );
      for (const lord of lords) {
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: judged.id,
          reason: 'songwei',
          message: `黑色判定牌生效：是否响应【颂威】，令主公 ${lord.name} 摸一张牌？`,
          options: [
            { id: 'yes', label: `令 ${lord.name} 摸1牌` },
            { id: 'no', label: '不发动' }
          ]
        });
        if (opt.type === 'choose_option' && opt.optionId === 'yes') {
          const drawn = helpers.drawCards(lord.id, 1);
          helpers.log('skill', `${judged.name} 响应【颂威】，令 ${lord.name} 摸了一张牌`, judged.id, [lord.id]);
          yield* helpers.notifyCardsObtained(lord.id, drawn);
        }
      }
    }
  });

  // ===== 3. 孟获：祸首（南蛮无效 + 替为伤害来源）& 再起（受伤摸牌改亮顶1+已损张，红桃回血）=====
  triggers.register({
    id: 'skill_huoshou',
    timing: 'TrickTargetsSpecified',
    priority: 80,
    condition: (state, payload) => {
      const ctx = payload.trickTargets;
      if (!ctx || ctx.card.name !== 'savage_assault') return false;
      return state.players.some((p) => hasActiveSkill(p, 'huoshou'));
    },
    *execute(state, payload, helpers) {
      const ctx = payload.trickTargets!;
      for (const mh of state.players) {
        if (!hasActiveSkill(mh, 'huoshou')) continue;
        if (ctx.targetIds.includes(mh.id) && !ctx.cancelledTargetIds.includes(mh.id)) {
          ctx.cancelledTargetIds.push(mh.id);
          helpers.log('skill', `${mh.name} 触发锁定技【祸首】，【南蛮入侵】对其无效！`, mh.id);
        }
        if (ctx.actorId !== mh.id) {
          ctx.damageSourceOverrideId = mh.id;
          helpers.log('skill', `${mh.name} 【祸首】生效：代替成为此【南蛮入侵】的伤害来源！`, mh.id);
        }
      }
    }
  });

  triggers.register({
    id: 'skill_zaiqi',
    timing: 'PhaseBefore',
    priority: 56,
    condition: (state, payload) => {
      if (payload.phase !== 'draw' || !payload.playerId) return false;
      if (state.skippedPhases.includes('draw')) return false;
      const mh = state.players.find((x) => x.id === payload.playerId);
      return Boolean(mh && hasActiveSkill(mh, 'zaiqi') && mh.hp < mh.maxHp);
    },
    *execute(state, payload, helpers) {
      const mh = state.players.find((x) => x.id === payload.playerId)!;
      const count = 1 + (mh.maxHp - mh.hp);
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: mh.id,
        reason: 'zaiqi',
        message: `摸牌阶段：是否发动【再起】（改为亮出牌堆顶 ${count} 张牌，红桃回血，其余获得）？`,
        options: [
          { id: 'yes', label: `发动【再起】（亮${count}张）` },
          { id: 'no', label: '正常摸牌' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      state.skippedPhases.push('draw');
      const revealed = helpers.popTopCards(count);
      let heartCount = 0;
      const nonHearts: CardInstance[] = [];
      for (const c of revealed) {
        helpers.pushTableCard(c, mh.id, '再起亮牌');
        if (helpers.getEffectiveSuit(mh.id, c) === 'heart') {
          heartCount += 1;
          helpers.moveToDiscard(c);
        } else {
          nonHearts.push(c);
        }
      }
      if (heartCount > 0) {
        yield* helpers.healAsync(mh.id, heartCount);
      }
      if (nonHearts.length > 0 && mh.alive) {
        mh.hand.push(...nonHearts);
      }
      helpers.log(
        'skill',
        `${mh.name} 发动【再起】亮出 ${revealed.length} 张牌：${heartCount} 张红桃回复体力，获得 ${nonHearts.length} 张牌！`,
        mh.id
      );
    }
  });

  // ===== 4. 祝融：巨象（南蛮无效 + 结算后获得）& 烈刃（杀伤后拼点赢获1牌）=====
  triggers.register({
    id: 'skill_juxiang_immune',
    timing: 'TrickTargetsSpecified',
    priority: 80,
    condition: (state, payload) => {
      const ctx = payload.trickTargets;
      if (!ctx || ctx.card.name !== 'savage_assault') return false;
      return state.players.some(
        (p) => hasActiveSkill(p, 'juxiang') && ctx.targetIds.includes(p.id)
      );
    },
    *execute(state, payload, helpers) {
      const ctx = payload.trickTargets!;
      for (const zr of state.players) {
        if (
          hasActiveSkill(zr, 'juxiang') &&
          ctx.targetIds.includes(zr.id) &&
          !ctx.cancelledTargetIds.includes(zr.id)
        ) {
          ctx.cancelledTargetIds.push(zr.id);
          helpers.log('skill', `${zr.name} 触发锁定技【巨象】，【南蛮入侵】对其无效！`, zr.id);
        }
      }
    }
  });

  triggers.register({
    id: 'skill_juxiang_gain',
    timing: 'TrickResolved',
    priority: 50,
    condition: (state, payload) => {
      if (!payload.card || payload.card.name !== 'savage_assault') return false;
      return state.players.some(
        (p) => p.id !== payload.playerId && hasActiveSkill(p, 'juxiang')
      );
    },
    *execute(state, payload, helpers) {
      const card = payload.card!;
      for (const zr of state.players) {
        if (zr.id === payload.playerId || !hasActiveSkill(zr, 'juxiang')) continue;
        const taken = helpers.takeCardFromDiscard(card.id);
        if (taken) {
          zr.hand.push(taken);
          helpers.log('skill', `${zr.name} 触发【巨象】，获得了【南蛮入侵】！`, zr.id, undefined, [taken.id]);
          yield* helpers.notifyCardsObtained(zr.id, [taken]);
          break;
        }
      }
    }
  });

  triggers.register({
    id: 'skill_lieren',
    timing: 'AfterDamageDealt',
    priority: 52,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.prevented || !dmg.sourceId || dmg.sourceId === dmg.targetId) return false;
      if (!dmg.card || !isSlashCardName(dmg.card.name)) return false;
      const zr = state.players.find((p) => p.id === dmg.sourceId);
      const victim = state.players.find((p) => p.id === dmg.targetId);
      return Boolean(
        zr &&
          victim &&
          hasActiveSkill(zr, 'lieren') &&
          zr.hand.length > 0 &&
          victim.alive &&
          victim.hand.length > 0
      );
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const zr = state.players.find((p) => p.id === dmg.sourceId)!;
      const victim = state.players.find((p) => p.id === dmg.targetId)!;
      if (!zr.alive || !victim.alive || zr.hand.length === 0 || victim.hand.length === 0) return;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: zr.id,
        reason: 'lieren',
        message: `【烈刃】：是否与 ${victim.name} 拼点？（赢则获得其一张牌）`,
        options: [
          { id: 'yes', label: '发动【烈刃】拼点' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const res = yield* helpers.resolvePindian(zr.id, victim.id, '烈刃');
      if (!res || res.winner !== 'initiator' || !zr.alive || !victim.alive || state.result) return;
      if (!hasAnyCardInZones(victim, false)) return;

      const choices = buildPlayerCardChoices(victim, {
        includeHand: true,
        includeEquips: true,
        includeJudge: false
      });
      const pick = yield* helpers.ask({
        type: 'choose_player_card',
        promptId: helpers.nextPromptId(),
        playerId: zr.id,
        targetId: victim.id,
        reason: 'snatch',
        message: `【烈刃】拼点赢！选择获得 ${victim.name} 的一张牌`,
        choices
      });
      const idx = pick.type === 'choose_player_card' && choices[pick.choiceIndex] ? pick.choiceIndex : 0;
      const prevHand = victim.hand.length;
      const ex = extractChoiceCard(victim, choices[idx]);
      if (!ex) return;

      zr.hand.push(ex.card);
      for (const ox of ex.lostWoodenOxStash) helpers.moveToDiscard(ox);
      helpers.log('skill', `${zr.name} 【烈刃】获得了 ${victim.name} 的【${ex.card.displayName}】`, zr.id, [victim.id]);
      if (ex.wasEquip) {
        yield* helpers.fireEquipLost(victim.id, ex.card);
      } else {
        yield* helpers.checkHandEmptied(victim.id, prevHand);
      }
      yield* helpers.notifyCardsLost(victim.id, [ex.card], !ex.wasEquip);
      yield* helpers.notifyCardsObtained(zr.id, [ex.card]);
    }
  });

  // ===== 5. 孙坚：英魂（准备阶段若受伤，选他摸X弃1或摸1弃X）=====
  triggers.register({
    id: 'skill_yinghun',
    timing: 'PhaseStart',
    priority: 52,
    condition: (state, payload) => {
      if (payload.phase !== 'prepare' || !payload.playerId) return false;
      const sj = state.players.find((x) => x.id === payload.playerId);
      if (!sj || !hasActiveSkill(sj, 'yinghun') || sj.hp >= sj.maxHp) return false;
      return state.players.some((o) => o.alive && o.id !== sj.id);
    },
    *execute(state, payload, helpers) {
      const sj = state.players.find((x) => x.id === payload.playerId)!;
      const others = state.players.filter((o) => o.alive && o.id !== sj.id);
      const x = sj.maxHp - sj.hp;
      if (others.length === 0 || x <= 0) return;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: sj.id,
        reason: 'yinghun',
        message: `准备阶段：是否发动【英魂】（X=${x}，令一名其他角色摸X弃1或摸1弃X）？`,
        options: [
          { id: 'yes', label: '发动【英魂】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const tResp = yield* helpers.ask({
        type: 'choose_target',
        promptId: helpers.nextPromptId(),
        playerId: sj.id,
        reason: 'yinghun_target',
        message: `【英魂】：选择一名其他角色（X=${x}）`,
        minCount: 1,
        maxCount: 1,
        eligibleTargetIds: others.map((o) => o.id),
        optional: false
      });
      const tid = tResp.type === 'choose_target' && tResp.targetIds[0] ? tResp.targetIds[0] : others[0].id;
      const target = state.players.find((o) => o.id === tid && o.alive);
      if (!target) return;

      const modeResp = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: sj.id,
        reason: 'yinghun_mode',
        message: `【英魂】对 ${target.name}（X=${x}）：选择一项`,
        options: [
          { id: 'draw_x', label: `令 ${target.name} 摸 ${x} 张牌，然后弃置 1 张牌` },
          { id: 'discard_x', label: `令 ${target.name} 摸 1 张牌，然后弃置 ${x} 张牌` }
        ]
      });

      const drawCnt = modeResp.type === 'choose_option' && modeResp.optionId === 'discard_x' ? 1 : x;
      const discCnt = drawCnt === 1 ? x : 1;
      const drawn = helpers.drawCards(target.id, drawCnt);
      helpers.log('skill', `${sj.name} 发动【英魂】，令 ${target.name} 摸 ${drawn.length} 张牌并弃置 ${discCnt} 张牌`, sj.id, [target.id]);
      yield* helpers.notifyCardsObtained(target.id, drawn);

      if (!target.alive || state.result) return;
      const allCards = [...getUsableCards(target), ...getEquippedCards(target)];
      const actualDisc = Math.min(discCnt, allCards.length);
      if (actualDisc <= 0) return;

      const cResp = yield* helpers.ask({
        type: 'choose_card',
        promptId: helpers.nextPromptId(),
        playerId: target.id,
        reason: 'general_skill',
        message: `【英魂】：请弃置 ${actualDisc} 张牌`,
        minCount: actualDisc,
        maxCount: actualDisc,
        eligibleCardIds: allCards.map((c) => c.id),
        optional: false
      });
      const chosenIds =
        cResp.type === 'choose_card' && cResp.cardIds.length === actualDisc
          ? cResp.cardIds
          : allCards.slice(0, actualDisc).map((c) => c.id);
      yield* helpers.discardCards(target.id, chosenIds);
    }
  });

  // ===== 6. 鲁肃：好施（摸牌多摸2，手牌>5分一半给手牌最少他者）& 缔盟（弃差值换手牌）=====
  triggers.register({
    id: 'skill_haoshi_before',
    timing: 'PhaseBefore',
    priority: 55,
    condition: (state, payload) => {
      if (payload.phase !== 'draw' || !payload.playerId) return false;
      if (state.skippedPhases.includes('draw')) return false;
      const ls = state.players.find((x) => x.id === payload.playerId);
      return Boolean(ls && hasActiveSkill(ls, 'haoshi'));
    },
    *execute(state, payload, helpers) {
      const ls = state.players.find((x) => x.id === payload.playerId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: ls.id,
        reason: 'haoshi',
        message: '摸牌阶段：是否发动【好施】多摸两张牌？（若手牌>5需将一半交给手牌最少者）',
        options: [
          { id: 'yes', label: '发动【好施】(+2摸牌)' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type === 'choose_option' && opt.optionId === 'yes') {
        ls.marks['haoshi_active'] = 1;
        helpers.log('skill', `${ls.name} 发动【好施】，多摸两张牌`, ls.id);
      }
    }
  });

  modifiers.register({
    id: 'skill_haoshi_delta',
    drawCountDelta: (_state, player) => (player.marks['haoshi_active'] ? 2 : 0)
  });

  triggers.register({
    id: 'skill_haoshi_give',
    timing: 'DrawCards',
    priority: 55,
    condition: (state, payload) => {
      const ls = state.players.find((x) => x.id === payload.playerId);
      return Boolean(ls && ls.marks['haoshi_active'] && ls.hand.length > 5);
    },
    *execute(state, payload, helpers) {
      const ls = state.players.find((x) => x.id === payload.playerId)!;
      const others = state.players.filter((o) => o.alive && o.id !== ls.id);
      if (others.length === 0) return;

      const giveCount = Math.floor(ls.hand.length / 2);
      const minHand = Math.min(...others.map((o) => o.hand.length));
      const minPlayers = others.filter((o) => o.hand.length === minHand);

      const cResp = yield* helpers.ask({
        type: 'choose_card',
        promptId: helpers.nextPromptId(),
        playerId: ls.id,
        reason: 'general_skill',
        message: `【好施】：手牌数大于 5，请选择 ${giveCount} 张手牌交给手牌最少的一名其他角色`,
        minCount: giveCount,
        maxCount: giveCount,
        eligibleCardIds: ls.hand.map((c) => c.id),
        optional: false
      });
      const cardIds =
        cResp.type === 'choose_card' && cResp.cardIds.length === giveCount
          ? cResp.cardIds
          : ls.hand.slice(0, giveCount).map((c) => c.id);

      let receiver = minPlayers[0];
      if (minPlayers.length > 1) {
        const tResp = yield* helpers.ask({
          type: 'choose_target',
          promptId: helpers.nextPromptId(),
          playerId: ls.id,
          reason: 'haoshi_target',
          message: `【好施】：选择手牌最少的角色接收 ${giveCount} 张手牌`,
          minCount: 1,
          maxCount: 1,
          eligibleTargetIds: minPlayers.map((p) => p.id),
          optional: false
        });
        if (tResp.type === 'choose_target' && tResp.targetIds[0]) {
          receiver = minPlayers.find((p) => p.id === tResp.targetIds[0]) ?? minPlayers[0];
        }
      }

      const given: CardInstance[] = [];
      for (const cid of cardIds) {
        const idx = ls.hand.findIndex((c) => c.id === cid);
        if (idx !== -1) {
          const [card] = ls.hand.splice(idx, 1);
          receiver.hand.push(card);
          given.push(card);
        }
      }
      helpers.log('skill', `${ls.name} 【好施】将 ${given.length} 张手牌交给了 ${receiver.name}`, ls.id, [receiver.id]);
      yield* helpers.notifyCardsObtained(receiver.id, given);
    }
  });

  skills.registerActive({
    skillId: 'dimeng',
    getPromptInfo: (state, player) => {
      if (player.marks['dimeng_used']) return null;
      const others = state.players.filter((o) => o.alive && o.id !== player.id);
      if (others.length < 2) return null;
      const maxDiscard = getUsableCards(player).length + getEquippedCards(player).length;
      let anyPair = false;
      for (let i = 0; i < others.length; i++) {
        for (let j = i + 1; j < others.length; j++) {
          if (Math.abs(others[i].hand.length - others[j].hand.length) <= maxDiscard) {
            anyPair = true;
            break;
          }
        }
        if (anyPair) break;
      }
      if (!anyPair) return null;
      return {
        skillId: 'dimeng',
        name: '缔盟',
        description: '出牌阶段限1次，选择两名其他角色，弃置等于两者手牌数之差的牌，然后交换两者手牌。',
        cardMin: 0,
        cardMax: 0,
        eligibleCardIds: [],
        targetMin: 2,
        targetMax: 2,
        eligibleTargetIds: others.map((o) => o.id)
      };
    },
    *execute(state, player, _cardIds, targetIds, helpers) {
      if (player.marks['dimeng_used'] || targetIds.length !== 2 || targetIds[0] === targetIds[1]) {
        return;
      }
      const t1 = state.players.find((p) => p.id === targetIds[0] && p.alive);
      const t2 = state.players.find((p) => p.id === targetIds[1] && p.alive);
      if (!t1 || !t2) return;

      const diff = Math.abs(t1.hand.length - t2.hand.length);
      const selfCards = [...getUsableCards(player), ...getEquippedCards(player)];
      if (diff > selfCards.length) return;

      if (diff > 0) {
        const cResp = yield* helpers.ask({
          type: 'choose_card',
          promptId: helpers.nextPromptId(),
          playerId: player.id,
          reason: 'general_skill',
          message: `【缔盟】：请弃置 ${diff} 张牌以交换 ${t1.name}（${t1.hand.length}张）与 ${t2.name}（${t2.hand.length}张）的手牌`,
          minCount: diff,
          maxCount: diff,
          eligibleCardIds: selfCards.map((c) => c.id),
          optional: true
        });
        if (cResp.type !== 'choose_card' || cResp.cancelled || cResp.cardIds.length !== diff) {
          return;
        }
        player.marks['dimeng_used'] = 1;
        yield* helpers.discardCards(player.id, cResp.cardIds);
      } else {
        player.marks['dimeng_used'] = 1;
      }

      const h1 = t1.hand.splice(0);
      const h2 = t2.hand.splice(0);
      t1.hand.push(...h2);
      t2.hand.push(...h1);
      helpers.log(
        'skill',
        `${player.name} 发动【缔盟】，弃置 ${diff} 张牌并交换了 ${t1.name} 与 ${t2.name} 的全部手牌！`,
        player.id,
        [t1.id, t2.id]
      );
      if (h2.length > 0) yield* helpers.notifyCardsObtained(t1.id, h2);
      if (h1.length > 0) yield* helpers.notifyCardsObtained(t2.id, h1);
    }
  });

  // ===== 7. 董卓：酒池 & 肉林 & 崩坏 & 暴虐（主公技）=====
  skills.registerActive({
    skillId: 'jiuchi',
    getPromptInfo: (state, player, mods) => {
      if (player.drunk || player.drunkUsedThisTurn >= 1) return null;
      const spades = player.hand.filter((c) => mods.getEffectiveSuit(state, player, c) === 'spade');
      if (spades.length === 0) return null;
      return {
        skillId: 'jiuchi',
        name: '酒池',
        description: '将一张黑桃手牌当【酒】使用。',
        cardMin: 1,
        cardMax: 1,
        eligibleCardIds: spades.map((c) => c.id),
        targetMin: 0,
        targetMax: 0,
        eligibleTargetIds: []
      };
    },
    *execute(_state, player, cardIds, _targetIds, helpers) {
      if (player.drunk || player.drunkUsedThisTurn >= 1 || cardIds.length !== 1) return;
      const removed = yield* helpers.removeCardFromPlayer(player.id, cardIds[0]);
      if (!removed) return;
      helpers.pushTableCard(removed, player.id, '酒池');
      helpers.moveToDiscard(removed);
      player.drunk = true;
      player.drunkUsedThisTurn += 1;
      helpers.log('skill', `${player.name} 发动【酒池】，将♠【${removed.displayName}】当【酒】使用！`, player.id, undefined, [removed.id]);
    }
  });

  skills.registerResponse({
    id: 'skill_jiuchi_dying',
    extraDyingPeachCardIds: (state, helper, victim) => {
      if (helper.id !== victim.id || !hasActiveSkill(helper, 'jiuchi')) return [];
      return helper.hand
        .filter((c) => modifiers.getEffectiveSuit(state, helper, c) === 'spade')
        .map((c) => c.id);
    }
  });

  modifiers.register({
    id: 'skill_roulin',
    requiredDodges: (_state, attacker, target) => {
      if (hasActiveSkill(attacker, 'roulin') && target.gender === 'female') return 2;
      if (hasActiveSkill(target, 'roulin') && attacker.gender === 'female') return 2;
      return 1;
    }
  });

  triggers.register({
    id: 'skill_benghuai',
    timing: 'PhaseStart',
    priority: 50,
    condition: (state, payload) => {
      if (payload.phase !== 'finish' || !payload.playerId) return false;
      const dz = state.players.find((x) => x.id === payload.playerId);
      if (!dz || !hasActiveSkill(dz, 'benghuai')) return false;
      const minHp = Math.min(...state.players.filter((p) => p.alive).map((p) => p.hp));
      return dz.hp > minHp;
    },
    *execute(state, payload, helpers) {
      const dz = state.players.find((x) => x.id === payload.playerId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: dz.id,
        reason: 'benghuai',
        message: '锁定技【崩坏】：你不是体力值最小的角色，请选择一项',
        options: [
          { id: 'lose_hp', label: '失去 1 点体力' },
          { id: 'lose_max_hp', label: '减少 1 点体力上限' }
        ]
      });
      if (opt.type === 'choose_option' && opt.optionId === 'lose_max_hp') {
        helpers.log('skill', `${dz.name} 触发【崩坏】，减少 1 点体力上限`, dz.id);
        yield* helpers.changeMaxHp(dz.id, -1);
      } else {
        helpers.log('skill', `${dz.name} 触发【崩坏】，失去 1 点体力`, dz.id);
        yield* helpers.loseHp(dz.id, 1);
      }
    }
  });

  triggers.register({
    id: 'skill_baonue',
    timing: 'AfterDamageDealt',
    priority: 45,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.prevented || !dmg.sourceId || dmg.actualDeducted <= 0) return false;
      const source = state.players.find((p) => p.id === dmg.sourceId && p.alive);
      if (!source || source.faction !== 'qun') return false;
      return state.players.some(
        (l) => l.id !== source.id && hasActiveSkill(l, 'baonue') && l.hp < l.maxHp
      );
    },
    *execute(state, payload, helpers) {
      const source = state.players.find((p) => p.id === payload.damage!.sourceId && p.alive)!;
      const lords = getAlivePlayersInOrder(state, source.id, false).filter(
        (l) => hasActiveSkill(l, 'baonue') && l.hp < l.maxHp
      );
      for (const lord of lords) {
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: source.id,
          reason: 'baonue',
          message: `造成伤害：是否响应【暴虐】，令主公 ${lord.name} 判定（黑桃回1血）？`,
          options: [
            { id: 'yes', label: `令 ${lord.name} 进行【暴虐】判定` },
            { id: 'no', label: '不发动' }
          ]
        });
        if (opt.type === 'choose_option' && opt.optionId === 'yes') {
          const judge = yield* helpers.resolveJudge(lord.id, '暴虐');
          if (lord.alive && helpers.getEffectiveSuit(lord.id, judge) === 'spade') {
            yield* helpers.healAsync(lord.id, 1);
            helpers.log('skill', `【暴虐】判定黑桃！${lord.name} 回复 1 点体力`, lord.id);
          }
        }
      }
    }
  });

  // ===== 8. 贾诩：完杀 & 乱武（限定技）& 帷幕（黑锦囊免疫）=====
  modifiers.register({
    id: 'skill_jiaxu_mods',
    canUseDyingPeach: (state, helper, victim) => {
      const active = state.players[state.activePlayerIndex];
      if (!active || !hasActiveSkill(active, 'wansha')) return true;
      // During Jia Xu's turn, only Jia Xu himself and the dying victim may use Peach!
      return helper.id === active.id || helper.id === victim.id;
    },
    canBeTargetedByCard: (state, source, target, cardName, card) => {
      if (!hasActiveSkill(target, 'weimu')) return true;
      const spec = CARD_SPECS[cardName];
      if (!spec || spec.category !== 'trick') return true;
      if (!card) return true;
      const color =
        'color' in card
          ? card.color
          : getCardColor(modifiers.getEffectiveSuit(state, source, card));
      return color !== 'black';
    }
  });

  // Also filter Jia Xu out of AoE black tricks (e.g. black Savage Assault / black Harvest / black Archery)
  triggers.register({
    id: 'skill_weimu_aoe',
    timing: 'TrickTargetsSpecified',
    priority: 85,
    condition: (state, payload) => {
      const ctx = payload.trickTargets;
      if (!ctx) return false;
      const actor = state.players.find((p) => p.id === ctx.actorId);
      const color = actor
        ? getCardColor(modifiers.getEffectiveSuit(state, actor, ctx.card))
        : getCardColor(ctx.card.suit);
      if (color !== 'black') return false;
      return state.players.some(
        (p) => hasActiveSkill(p, 'weimu') && ctx.targetIds.includes(p.id)
      );
    },
    *execute(state, payload, helpers) {
      const ctx = payload.trickTargets!;
      for (const jx of state.players) {
        if (
          hasActiveSkill(jx, 'weimu') &&
          ctx.targetIds.includes(jx.id) &&
          !ctx.cancelledTargetIds.includes(jx.id)
        ) {
          ctx.cancelledTargetIds.push(jx.id);
          helpers.log('skill', `${jx.name} 触发锁定技【帷幕】，免疫黑色锦囊【${ctx.card.displayName}】！`, jx.id);
        }
      }
    }
  });

  skills.registerActive({
    skillId: 'luanwu',
    getPromptInfo: (state, player) => {
      if (player.marks['luanwu_used']) return null;
      if (!state.players.some((o) => o.alive && o.id !== player.id)) return null;
      return {
        skillId: 'luanwu',
        name: '乱武',
        description: '限定技，令所有其他角色依次对其距离最近的另一名角色使用一张【杀】，否则失去1点体力。',
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
      if (player.marks['luanwu_used']) return;
      player.marks['luanwu_used'] = 1;
      helpers.log('skill', `${player.name} 发动限定技【乱武】！天下大乱！`, player.id);

      const others = getAlivePlayersInOrder(state, player.id, false);
      for (const victim of others) {
        if (!victim.alive || state.result) continue;
        const candidates = state.players.filter((o) => o.alive && o.id !== victim.id);
        if (candidates.length === 0) break;

        const minDist = Math.min(
          ...candidates.map((o) => getDistance(state, victim.id, o.id, modifiers))
        );
        const nearest = candidates.filter(
          (o) =>
            getDistance(state, victim.id, o.id, modifiers) === minDist &&
            modifiers.canBeTargetedByCard(state, victim, o, 'slash')
        );

        let slashed = false;
        if (nearest.length > 0) {
          let chosenTarget = nearest[0];
          if (nearest.length > 1) {
            const tResp = yield* helpers.ask({
              type: 'choose_target',
              promptId: helpers.nextPromptId(),
              playerId: victim.id,
              reason: 'luanwu_target',
              message: '【乱武】：选择一名距离最近的角色作为出【杀】目标（或取消以失去1点体力）',
              minCount: 1,
              maxCount: 1,
              eligibleTargetIds: nearest.map((o) => o.id),
              optional: true
            });
            if (tResp.type === 'choose_target' && !tResp.cancelled && tResp.targetIds[0]) {
              chosenTarget = nearest.find((o) => o.id === tResp.targetIds[0]) ?? nearest[0];
              slashed = yield* helpers.askSlashAgainst(
                victim.id,
                chosenTarget.id,
                `【乱武】：请对 ${chosenTarget.name} 使用一张【杀】，否则失去 1 点体力`
              );
            }
          } else {
            slashed = yield* helpers.askSlashAgainst(
              victim.id,
              chosenTarget.id,
              `【乱武】：请对 ${chosenTarget.name} 使用一张【杀】，否则失去 1 点体力`
            );
          }
        }

        if (!slashed && victim.alive && !state.result) {
          yield* helpers.loseHp(victim.id, 1);
        }
      }
    }
  });
}
