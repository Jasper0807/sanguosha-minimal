import {
  getCardColor,
  isSlashCardName,
  type CardInstance,
  type ModifierRegistry,
  type SkillRegistry,
  type TriggerRegistry
} from '../../index.js';
import { hasActiveSkill } from '../../core/events.js';
import {
  buildPlayerCardChoices,
  extractChoiceCard,
  getUsableCards,
  hasAnyCardInZones,
  removeUsableCard
} from '../../core/deck.js';
import { getAlivePlayersInOrder } from '../../core/targeting.js';

export function registerWeiStandardSkills(
  triggers: TriggerRegistry,
  modifiers: ModifierRegistry,
  skills: SkillRegistry
): void {
  // ===== 曹操：奸雄 =====
  triggers.register({
    id: 'skill_jianxiong',
    timing: 'AfterDamageTaken',
    priority: 50,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || !dmg.card) return false;
      const target = state.players.find((p) => p.id === dmg.targetId);
      if (!target || !hasActiveSkill(target, 'jianxiong')) return false;
      const subcards: CardInstance[] =
        'subcards' in dmg.card ? dmg.card.subcards : [dmg.card];
      return subcards.some((c) => state.discardPile.some((d) => d.id === c.id));
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const target = state.players.find((p) => p.id === dmg.targetId)!;
      const subcards: CardInstance[] =
        'subcards' in dmg.card! ? dmg.card!.subcards : [dmg.card!];
      const available = subcards.filter((c) =>
        state.discardPile.some((d) => d.id === c.id)
      );
      if (available.length === 0) return;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: target.id,
        reason: 'jianxiong',
        message: `是否发动【奸雄】，获得对你造成伤害的牌（${available.map((c) => c.displayName).join('、')}）？`,
        options: [
          { id: 'yes', label: '发动【奸雄】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const gained: CardInstance[] = [];
      for (const c of available) {
        const taken = helpers.takeCardFromDiscard(c.id);
        if (taken) {
          target.hand.push(taken);
          gained.push(taken);
        }
      }
      if (gained.length > 0) {
        helpers.log(
          'skill',
          `${target.name} 发动【奸雄】，获得了 ${gained.map((c) => `【${c.displayName}】`).join('、')}`,
          target.id,
          undefined,
          gained.map((c) => c.id)
        );
      }
    }
  });

  // ===== 曹操：护驾（主公技）=====
  skills.registerResponse({
    id: 'skill_hujia',
    *assistDodge(state, target, _source, sourceCard, helpers) {
      if (!hasActiveSkill(target, 'hujia')) return false;
      const weiAllies = getAlivePlayersInOrder(state, target.id, false).filter(
        (p) => p.faction === 'wei'
      );
      if (weiAllies.length === 0) return false;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: target.id,
        reason: 'hujia',
        message: `面对【${sourceCard.displayName}】，是否发动主公技【护驾】请求魏势力角色替你出【闪】？`,
        options: [
          { id: 'yes', label: '发动【护驾】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return false;

      helpers.log('skill', `${target.name} 发动主公技【护驾】！`, target.id);
      for (const ally of weiAllies) {
        if (!ally.alive) continue;
        const usable = getUsableCards(ally);
        const extraIds = skills.getExtraDodgeCardIds(state, ally);
        const dodges = usable.filter(
          (c) => c.name === 'dodge' || extraIds.includes(c.id)
        );
        if (dodges.length === 0) continue;

        const resp = yield* helpers.ask({
          type: 'choose_card',
          promptId: helpers.nextPromptId(),
          playerId: ally.id,
          reason: 'dodge',
          message: `【护驾】：是否为 ${target.name} 打出一张【闪】？`,
          minCount: 1,
          maxCount: 1,
          eligibleCardIds: dodges.map((c) => c.id),
          optional: true
        });
        if (resp.type === 'choose_card' && !resp.cancelled && resp.cardIds.length === 1) {
          const prevHand = ally.hand.length;
          const removed = removeUsableCard(ally, resp.cardIds[0]);
          if (removed) {
            helpers.pushTableCard(removed, ally.id, '护驾出闪');
            helpers.moveToDiscard(removed);
            helpers.log(
              'skill',
              `${ally.name} 响应【护驾】为 ${target.name} 打出了【${removed.displayName}】`,
              ally.id,
              [target.id],
              [removed.id]
            );
            yield* helpers.checkHandEmptied(ally.id, prevHand);
            return true;
          }
        }
      }
      return false;
    }
  });

  // ===== 司马懿：反馈 =====
  triggers.register({
    id: 'skill_fankui',
    timing: 'AfterDamageTaken',
    priority: 45,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || !dmg.sourceId || dmg.sourceId === dmg.targetId) return false;
      const target = state.players.find((p) => p.id === dmg.targetId);
      const source = state.players.find((p) => p.id === dmg.sourceId);
      if (!target || !source || !source.alive) return false;
      if (!hasActiveSkill(target, 'fankui')) return false;
      return hasAnyCardInZones(source, false);
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const target = state.players.find((p) => p.id === dmg.targetId)!;
      const source = state.players.find((p) => p.id === dmg.sourceId)!;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: target.id,
        reason: 'fankui',
        message: `是否发动【反馈】，获得伤害来源 ${source.name} 的一张牌？`,
        options: [
          { id: 'yes', label: '发动【反馈】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const choices = buildPlayerCardChoices(source, {
        includeHand: true,
        includeEquips: true,
        includeJudge: false
      });
      if (choices.length === 0) return;

      const pick = yield* helpers.ask({
        type: 'choose_player_card',
        promptId: helpers.nextPromptId(),
        playerId: target.id,
        targetId: source.id,
        reason: 'snatch',
        message: `【反馈】：选择获得 ${source.name} 的一张手牌或装备牌`,
        choices
      });
      const idx = pick.type === 'choose_player_card' ? pick.choiceIndex : 0;
      const prevHand = source.hand.length;
      const extracted = extractChoiceCard(source, choices[idx] ?? choices[0]);
      if (!extracted) return;

      target.hand.push(extracted.card);
      for (const ox of extracted.lostWoodenOxStash) helpers.moveToDiscard(ox);
      helpers.log('skill', `${target.name} 发动【反馈】，获得了 ${source.name} 的一张牌`, target.id, [source.id]);
      if (extracted.wasEquip) {
        yield* helpers.fireEquipLost(source.id, extracted.card);
      }
      yield* helpers.checkHandEmptied(source.id, prevHand);
    }
  });

  // ===== 司马懿：鬼才 =====
  triggers.register({
    id: 'skill_guicai',
    timing: 'JudgeModify',
    priority: 50,
    condition: (state, payload) => {
      if (!payload.judge) return false;
      return state.players.some(
        (p) => hasActiveSkill(p, 'guicai') && p.hand.length > 0
      );
    },
    *execute(state, payload, helpers) {
      const judge = payload.judge!;
      const active = state.players[state.activePlayerIndex];
      const order = getAlivePlayersInOrder(state, active.id, true);

      for (const p of order) {
        if (!hasActiveSkill(p, 'guicai') || p.hand.length === 0) continue;
        const resp = yield* helpers.ask({
          type: 'choose_card',
          promptId: helpers.nextPromptId(),
          playerId: p.id,
          reason: 'general_skill',
          message: `【鬼才】：当前判定牌为【${judge.card.displayName}】，是否打出一张手牌代替之？`,
          minCount: 1,
          maxCount: 1,
          eligibleCardIds: p.hand.map((c) => c.id),
          optional: true
        });
        if (resp.type === 'choose_card' && !resp.cancelled && resp.cardIds.length === 1) {
          const prevHand = p.hand.length;
          const idx = p.hand.findIndex((c) => c.id === resp.cardIds[0]);
          if (idx !== -1) {
            const replacement = p.hand.splice(idx, 1)[0];
            helpers.moveToDiscard(judge.card);
            judge.card = replacement;
            helpers.pushTableCard(replacement, p.id, '鬼才改判');
            helpers.log(
              'skill',
              `${p.name} 发动【鬼才】，将判定牌改为【${replacement.displayName}】`,
              p.id,
              [judge.playerId],
              [replacement.id]
            );
            yield* helpers.checkHandEmptied(p.id, prevHand);
          }
        }
      }
    }
  });

  // ===== 夏侯惇：刚烈 =====
  triggers.register({
    id: 'skill_ganglie',
    timing: 'AfterDamageTaken',
    priority: 40,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || !dmg.sourceId) return false;
      const target = state.players.find((p) => p.id === dmg.targetId);
      const source = state.players.find((p) => p.id === dmg.sourceId);
      return Boolean(target && source && source.alive && hasActiveSkill(target, 'ganglie'));
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const target = state.players.find((p) => p.id === dmg.targetId)!;
      const source = state.players.find((p) => p.id === dmg.sourceId)!;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: target.id,
        reason: 'ganglie',
        message: `是否对 ${source.name} 发动【刚烈】进行判定？`,
        options: [
          { id: 'yes', label: '发动【刚烈】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const judgeCard = yield* helpers.resolveJudge(target.id, '刚烈');
      if (state.result || !source.alive) return;
      if (judgeCard.suit === 'heart') {
        helpers.log('skill', `【刚烈】判定红桃，未生效`, target.id);
        return;
      }

      let choseDiscard = false;
      if (source.hand.length >= 2) {
        const srcOpt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: source.id,
          reason: 'ganglie_choice',
          message: `${target.name} 【刚烈】生效！请选择：`,
          options: [
            { id: 'discard', label: '弃置两张手牌' },
            { id: 'damage', label: `受到 ${target.name} 造成的 1 点伤害` }
          ]
        });
        if (srcOpt.type === 'choose_option' && srcOpt.optionId === 'discard') {
          const pick = yield* helpers.ask({
            type: 'choose_card',
            promptId: helpers.nextPromptId(),
            playerId: source.id,
            reason: 'general_skill',
            message: '【刚烈】：请选择弃置两张手牌',
            minCount: 2,
            maxCount: 2,
            eligibleCardIds: source.hand.map((c) => c.id),
            optional: false
          });
          const ids =
            pick.type === 'choose_card' && pick.cardIds.length === 2
              ? pick.cardIds
              : source.hand.slice(0, 2).map((c) => c.id);
          yield* helpers.discardCards(source.id, ids);
          helpers.log('skill', `${source.name} 弃置两张手牌抵消【刚烈】`, source.id);
          choseDiscard = true;
        }
      }

      if (!choseDiscard && source.alive) {
        yield* helpers.applyDamage({
          sourceId: target.alive ? target.id : null,
          targetId: source.id,
          amount: 1,
          element: 'normal',
          isChainDamage: false,
          prevented: false,
          armorIgnored: false,
          wasChainedBeforeDeduct: source.chained,
          actualDeducted: 0
        });
      }
    }
  });

  // ===== 张辽：突袭 =====
  triggers.register({
    id: 'skill_tuxi',
    timing: 'PhaseBefore',
    priority: 60,
    condition: (state, payload) => {
      if (payload.phase !== 'draw' || !payload.playerId) return false;
      if (state.skippedPhases.includes('draw')) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      if (!p || !hasActiveSkill(p, 'tuxi')) return false;
      return state.players.some((o) => o.alive && o.id !== p.id && o.hand.length > 0);
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const eligible = state.players
        .filter((o) => o.alive && o.id !== p.id && o.hand.length > 0)
        .map((o) => o.id);
      if (eligible.length === 0) return;

      const resp = yield* helpers.ask({
        type: 'choose_target',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'tuxi',
        message: '是否发动【突袭】，放弃摸牌改为获得至多两名其他角色的各一张手牌？',
        minCount: 1,
        maxCount: Math.min(2, eligible.length),
        eligibleTargetIds: eligible,
        optional: true
      });
      if (resp.type !== 'choose_target' || resp.cancelled || resp.targetIds.length === 0) return;

      state.skippedPhases.push('draw');
      const targets = getAlivePlayersInOrder(state, p.id, false).filter((t) =>
        resp.targetIds.includes(t.id)
      );
      helpers.log(
        'skill',
        `${p.name} 发动【突袭】，放弃摸牌并对 ${targets.map((t) => t.name).join('、')} 夺取手牌`,
        p.id,
        targets.map((t) => t.id)
      );
      for (const t of targets) {
        if (!t.alive || t.hand.length === 0) continue;
        const choices = buildPlayerCardChoices(t, {
          includeHand: true,
          includeEquips: false,
          includeJudge: false
        });
        const pick = yield* helpers.ask({
          type: 'choose_player_card',
          promptId: helpers.nextPromptId(),
          playerId: p.id,
          targetId: t.id,
          reason: 'snatch',
          message: `【突袭】：选择获得 ${t.name} 的一张手牌`,
          choices
        });
        const idx = pick.type === 'choose_player_card' ? pick.choiceIndex : 0;
        const prevHand = t.hand.length;
        const ex = extractChoiceCard(t, choices[idx] ?? choices[0]);
        if (ex) {
          p.hand.push(ex.card);
          yield* helpers.checkHandEmptied(t.id, prevHand);
        }
      }
    }
  });

  // ===== 许褚：裸衣 =====
  triggers.register({
    id: 'skill_luoyi_draw',
    timing: 'PhaseBefore',
    priority: 55,
    condition: (state, payload) => {
      if (payload.phase !== 'draw' || !payload.playerId) return false;
      if (state.skippedPhases.includes('draw')) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'luoyi'));
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'luoyi',
        message: '是否发动【裸衣】，本回合少摸一张牌，令【杀】与【决斗】伤害 +1？',
        options: [
          { id: 'yes', label: '发动【裸衣】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type === 'choose_option' && opt.optionId === 'yes') {
        p.marks['luoyi_active'] = 1;
        helpers.log('skill', `${p.name} 发动【裸衣】，少摸一张牌，本回合【杀】/【决斗】伤害 +1！`, p.id);
      }
    }
  });

  modifiers.register({
    id: 'skill_luoyi_draw_delta',
    drawCountDelta: (_state, player) => (player.marks['luoyi_active'] ? -1 : 0)
  });

  triggers.register({
    id: 'skill_luoyi_damage',
    timing: 'DamageDealt',
    priority: 70,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.prevented || dmg.isChainDamage || !dmg.sourceId || !dmg.card) return false;
      const src = state.players.find((p) => p.id === dmg.sourceId);
      if (!src || !src.marks['luoyi_active']) return false;
      return isSlashCardName(dmg.card.name) || dmg.card.name === 'duel';
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const src = state.players.find((p) => p.id === dmg.sourceId)!;
      dmg.amount += 1;
      helpers.log('skill', `${src.name} 【裸衣】生效，伤害 +1（当前 ${dmg.amount} 点）`, src.id, [dmg.targetId]);
    }
  });

  triggers.register({
    id: 'skill_luoyi_cleanup',
    timing: 'TurnEnd',
    priority: 10,
    *execute(state, payload) {
      const p = state.players.find((x) => x.id === payload.playerId);
      if (p) delete p.marks['luoyi_active'];
    }
  });

  // ===== 郭嘉：天妒 =====
  triggers.register({
    id: 'skill_tiandu',
    timing: 'JudgeResolved',
    priority: 50,
    condition: (state, payload) => {
      if (!payload.judge) return false;
      const p = state.players.find((x) => x.id === payload.judge!.playerId);
      if (!p || !hasActiveSkill(p, 'tiandu')) return false;
      return state.discardPile.some((c) => c.id === payload.judge!.card.id);
    },
    *execute(state, payload, helpers) {
      const judge = payload.judge!;
      const p = state.players.find((x) => x.id === judge.playerId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'tiandu',
        message: `是否发动【天妒】，获得判定牌【${judge.card.displayName}】？`,
        options: [
          { id: 'yes', label: '发动【天妒】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;
      const taken = helpers.takeCardFromDiscard(judge.card.id);
      if (taken) {
        p.hand.push(taken);
        helpers.log('skill', `${p.name} 发动【天妒】，获得了判定牌【${taken.displayName}】`, p.id, undefined, [taken.id]);
      }
    }
  });

  // ===== 郭嘉：遗计 =====
  triggers.register({
    id: 'skill_yiji',
    timing: 'AfterDamageTaken',
    priority: 45,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.actualDeducted <= 0) return false;
      const target = state.players.find((p) => p.id === dmg.targetId);
      return Boolean(target && hasActiveSkill(target, 'yiji'));
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const target = state.players.find((p) => p.id === dmg.targetId)!;
      for (let step = 0; step < dmg.actualDeducted && target.alive && !state.result; step++) {
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: target.id,
          reason: 'yiji',
          message: `是否发动【遗计】（第 ${step + 1}/${dmg.actualDeducted} 次），观看牌堆顶两张牌并分配？`,
          options: [
            { id: 'yes', label: '发动【遗计】' },
            { id: 'no', label: '不发动' }
          ]
        });
        if (opt.type !== 'choose_option' || opt.optionId !== 'yes') break;

        const cards = helpers.popTopCards(2);
        helpers.log('skill', `${target.name} 发动【遗计】，观看了牌堆顶 ${cards.length} 张牌`, target.id);
        const aliveIds = state.players.filter((x) => x.alive).map((x) => x.id);

        for (const c of cards) {
          const resp = yield* helpers.ask({
            type: 'choose_target',
            promptId: helpers.nextPromptId(),
            playerId: target.id,
            reason: 'yiji_give',
            message: `【遗计】：选择将【${c.displayName}】交给哪名角色（可交给自己）`,
            minCount: 1,
            maxCount: 1,
            eligibleTargetIds: aliveIds,
            optional: false
          });
          const receiverId =
            resp.type === 'choose_target' && resp.targetIds[0] ? resp.targetIds[0] : target.id;
          const receiver = state.players.find((x) => x.id === receiverId && x.alive) ?? target;
          receiver.hand.push(c);
          helpers.log('skill', `${target.name} 将一张【遗计】牌交给了 ${receiver.name}`, target.id, [receiver.id]);
        }
      }
    }
  });

  // ===== 甄姬：倾国 =====
  skills.registerResponse({
    id: 'skill_qingguo',
    extraDodgeCardIds: (_state, player) => {
      if (!hasActiveSkill(player, 'qingguo')) return [];
      return getUsableCards(player)
        .filter((c) => getCardColor(c.suit) === 'black')
        .map((c) => c.id);
    }
  });

  // ===== 甄姬：洛神 =====
  triggers.register({
    id: 'skill_luoshen',
    timing: 'PhaseStart',
    priority: 50,
    condition: (state, payload) => {
      if (payload.phase !== 'prepare' || !payload.playerId) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'luoshen'));
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      let count = 0;
      while (p.alive && !state.result && count < 20) {
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: p.id,
          reason: 'luoshen',
          message: count === 0 ? '准备阶段：是否发动【洛神】进行判定？' : '【洛神】获得黑牌！是否继续判定？',
          options: [
            { id: 'yes', label: '判定【洛神】' },
            { id: 'no', label: '停止' }
          ]
        });
        if (opt.type !== 'choose_option' || opt.optionId !== 'yes') break;

        const judgeCard = yield* helpers.resolveJudge(p.id, '洛神');
        if (state.result || !p.alive) break;
        if (getCardColor(judgeCard.suit) === 'black') {
          const taken = helpers.takeCardFromDiscard(judgeCard.id);
          if (taken) {
            p.hand.push(taken);
            helpers.log('skill', `${p.name} 【洛神】判定黑色，获得【${taken.displayName}】！`, p.id, undefined, [taken.id]);
          }
          count += 1;
        } else {
          helpers.log('skill', `${p.name} 【洛神】判定红色，结束判定`, p.id);
          break;
        }
      }
    }
  });
}
