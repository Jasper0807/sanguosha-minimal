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
  getEquippedCards,
  getUsableCards,
  hasAnyCardInZones,
  removeUsableCard
} from '../../core/deck.js';
import { getAlivePlayersInOrder } from '../../core/targeting.js';

export function registerWeiLimitBreakSkills(
  triggers: TriggerRegistry,
  modifiers: ModifierRegistry,
  skills: SkillRegistry
): void {
  // Turn cleanup for Wei Limit Break marks
  triggers.register({
    id: 'skill_lb_wei_turn_cleanup',
    timing: 'TurnEnd',
    priority: 10,
    *execute(state) {
      for (const p of state.players) {
        delete p.marks['lb_qingjian_limit_bonus'];
        delete p.marks['lb_tuxi_reduce'];
      }
    }
  });

  // ===== 界曹操：奸雄（摸1牌 + 获得伤害牌）=====
  triggers.register({
    id: 'skill_lb_jianxiong',
    timing: 'AfterDamageTaken',
    priority: 52,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg) return false;
      const target = state.players.find((p) => p.id === dmg.targetId);
      return Boolean(target && hasActiveSkill(target, 'lb_jianxiong'));
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const target = state.players.find((p) => p.id === dmg.targetId)!;
      const subcards: CardInstance[] = dmg.card
        ? 'subcards' in dmg.card
          ? dmg.card.subcards
          : [dmg.card]
        : [];
      const available = subcards.filter((c) =>
        state.discardPile.some((d) => d.id === c.id)
      );

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: target.id,
        reason: 'lb_jianxiong',
        message:
          available.length > 0
            ? `是否发动界【奸雄】，摸一张牌并获得 ${available.map((c) => `【${c.displayName}】`).join('、')}？`
            : '是否发动界【奸雄】，摸一张牌？',
        options: [
          { id: 'yes', label: '发动【奸雄】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const drawn = helpers.drawCards(target.id, 1);
      const gained: CardInstance[] = [...drawn];
      for (const c of available) {
        const taken = helpers.takeCardFromDiscard(c.id);
        if (taken) {
          target.hand.push(taken);
          gained.push(taken);
        }
      }
      helpers.log(
        'skill',
        `${target.name} 发动界【奸雄】，摸1牌${available.length > 0 ? `并获得了 ${available.map((c) => `【${c.displayName}】`).join('、')}` : ''}`,
        target.id
      );
      if (gained.length > 0) {
        yield* helpers.notifyCardsObtained(target.id, gained);
      }
    }
  });

  // ===== 界曹操：护驾（主公技：魏将代闪 + 回合外用闪令主公摸1牌）=====
  skills.registerResponse({
    id: 'skill_lb_hujia',
    *assistDodge(state, target, _source, sourceCard, helpers) {
      if (!hasActiveSkill(target, 'lb_hujia')) return false;
      const weiAllies = getAlivePlayersInOrder(state, target.id, false).filter(
        (p) => p.faction === 'wei'
      );
      if (weiAllies.length === 0) return false;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: target.id,
        reason: 'lb_hujia',
        message: `面对【${sourceCard.displayName}】，是否发动主公技界【护驾】请求魏势力角色替你出【闪】？`,
        options: [
          { id: 'yes', label: '发动【护驾】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return false;

      helpers.log('skill', `${target.name} 发动主公技【护驾】！`, target.id);
      for (const ally of weiAllies) {
        if (!ally.alive || ally.cannotPlayHandCardsThisTurn) continue;
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
            yield* helpers.notifyOutOfTurnCard(ally.id, {
              name: 'dodge',
              displayName: '闪',
              suit: removed.suit,
              rank: removed.rank,
              color: getCardColor(removed.suit),
              element: 'normal',
              subcards: [removed]
            });
            return true;
          }
        }
      }
      return false;
    }
  });

  triggers.register({
    id: 'skill_lb_hujia_draw',
    timing: 'CardPlayedOrUsedOutOfTurn',
    priority: 45,
    condition: (state, payload) => {
      const ctx = payload.outOfTurnCard;
      if (!ctx || ctx.card.name !== 'dodge') return false;
      const actor = state.players.find((p) => p.id === ctx.playerId);
      if (!actor || !actor.alive || actor.faction !== 'wei') return false;
      return state.players.some(
        (l) =>
          l.id !== actor.id &&
          hasActiveSkill(l, 'lb_hujia') &&
          l.marks['lb_hujia_draw_turn'] !== state.turn
      );
    },
    *execute(state, payload, helpers) {
      const actor = state.players.find((p) => p.id === payload.outOfTurnCard!.playerId)!;
      for (const lord of state.players) {
        if (
          lord.id === actor.id ||
          !hasActiveSkill(lord, 'lb_hujia') ||
          lord.marks['lb_hujia_draw_turn'] === state.turn
        ) {
          continue;
        }
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: actor.id,
          reason: 'lb_hujia_draw',
          message: `界【护驾】：是否令主公 ${lord.name} 摸一张牌？`,
          options: [
            { id: 'yes', label: `令 ${lord.name} 摸1牌` },
            { id: 'no', label: '不发动' }
          ]
        });
        if (opt.type === 'choose_option' && opt.optionId === 'yes') {
          lord.marks['lb_hujia_draw_turn'] = state.turn;
          const drawn = helpers.drawCards(lord.id, 1);
          helpers.log('skill', `${actor.name} 触发【护驾】，令 ${lord.name} 摸了一张牌`, actor.id, [lord.id]);
          if (drawn.length > 0) {
            yield* helpers.notifyCardsObtained(lord.id, drawn);
          }
        }
      }
    }
  });

  // ===== 界司马懿：反馈（每受到1点伤害触发1次）=====
  triggers.register({
    id: 'skill_lb_fankui',
    timing: 'AfterDamageTaken',
    priority: 46,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.actualDeducted <= 0 || !dmg.sourceId || dmg.sourceId === dmg.targetId) {
        return false;
      }
      const target = state.players.find((p) => p.id === dmg.targetId);
      const source = state.players.find((p) => p.id === dmg.sourceId);
      return Boolean(
        target &&
          source &&
          source.alive &&
          hasActiveSkill(target, 'lb_fankui') &&
          hasAnyCardInZones(source, false)
      );
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const target = state.players.find((p) => p.id === dmg.targetId)!;
      const source = state.players.find((p) => p.id === dmg.sourceId)!;

      for (let step = 0; step < dmg.actualDeducted; step++) {
        if (state.result || !target.alive || !source.alive || !hasAnyCardInZones(source, false)) {
          break;
        }
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: target.id,
          reason: 'lb_fankui',
          message: `是否发动界【反馈】（第 ${step + 1}/${dmg.actualDeducted} 次），获得 ${source.name} 的一张牌？`,
          options: [
            { id: 'yes', label: '发动【反馈】' },
            { id: 'no', label: '不发动' }
          ]
        });
        if (opt.type !== 'choose_option' || opt.optionId !== 'yes') break;

        const choices = buildPlayerCardChoices(source, {
          includeHand: true,
          includeEquips: true,
          includeJudge: false
        });
        if (choices.length === 0) break;

        const pick = yield* helpers.ask({
          type: 'choose_player_card',
          promptId: helpers.nextPromptId(),
          playerId: target.id,
          targetId: source.id,
          reason: 'snatch',
          message: `界【反馈】：选择获得 ${source.name} 的一张牌`,
          choices
        });
        const idx = pick.type === 'choose_player_card' ? pick.choiceIndex : 0;
        const prevHand = source.hand.length;
        const extracted = extractChoiceCard(source, choices[idx] ?? choices[0]);
        if (!extracted) break;

        target.hand.push(extracted.card);
        for (const ox of extracted.lostWoodenOxStash) helpers.moveToDiscard(ox);
        helpers.log('skill', `${target.name} 发动界【反馈】，获得了 ${source.name} 的一张牌`, target.id, [source.id]);
        if (extracted.wasEquip) {
          yield* helpers.fireEquipLost(source.id, extracted.card);
        }
        yield* helpers.checkHandEmptied(source.id, prevHand);
        yield* helpers.notifyCardsObtained(target.id, [extracted.card]);
      }
    }
  });

  // ===== 界司马懿：鬼才（可用手牌或装备区牌改判）=====
  triggers.register({
    id: 'skill_lb_guicai',
    timing: 'JudgeModify',
    priority: 52,
    condition: (state, payload) => {
      if (!payload.judge) return false;
      return state.players.some(
        (p) =>
          hasActiveSkill(p, 'lb_guicai') &&
          (p.hand.length > 0 || getEquippedCards(p).length > 0)
      );
    },
    *execute(state, payload, helpers) {
      const judge = payload.judge!;
      const active = state.players[state.activePlayerIndex];
      const order = getAlivePlayersInOrder(state, active.id, true);

      for (const p of order) {
        if (!hasActiveSkill(p, 'lb_guicai')) continue;
        const candidates = [...getUsableCards(p), ...getEquippedCards(p)];
        if (candidates.length === 0) continue;

        const resp = yield* helpers.ask({
          type: 'choose_card',
          promptId: helpers.nextPromptId(),
          playerId: p.id,
          reason: 'general_skill',
          message: `界【鬼才】：当前判定牌为【${judge.card.displayName}】，是否用一张手牌或装备牌代替之？`,
          minCount: 1,
          maxCount: 1,
          eligibleCardIds: candidates.map((c) => c.id),
          optional: true
        });
        if (resp.type === 'choose_card' && !resp.cancelled && resp.cardIds.length === 1) {
          const replacement = yield* helpers.removeCardFromPlayer(p.id, resp.cardIds[0]);
          if (replacement) {
            helpers.moveToDiscard(judge.card);
            judge.card = replacement;
            helpers.pushTableCard(replacement, p.id, '界鬼才改判');
            helpers.log(
              'skill',
              `${p.name} 发动界【鬼才】，将判定牌改为【${replacement.displayName}】`,
              p.id,
              [judge.playerId],
              [replacement.id]
            );
          }
        }
      }
    }
  });

  // ===== 界夏侯惇：刚烈（红判1伤 / 黑判弃1牌，每点伤害发动1次）=====
  triggers.register({
    id: 'skill_lb_ganglie',
    timing: 'AfterDamageTaken',
    priority: 42,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.actualDeducted <= 0 || !dmg.sourceId) return false;
      const target = state.players.find((p) => p.id === dmg.targetId);
      const source = state.players.find((p) => p.id === dmg.sourceId);
      return Boolean(target && source && source.alive && hasActiveSkill(target, 'lb_ganglie'));
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const target = state.players.find((p) => p.id === dmg.targetId)!;
      const source = state.players.find((p) => p.id === dmg.sourceId)!;

      for (let step = 0; step < dmg.actualDeducted; step++) {
        if (state.result || !target.alive || !source.alive) break;
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: target.id,
          reason: 'lb_ganglie',
          message: `是否对 ${source.name} 发动界【刚烈】（第 ${step + 1}/${dmg.actualDeducted} 次）？`,
          options: [
            { id: 'yes', label: '发动【刚烈】' },
            { id: 'no', label: '不发动' }
          ]
        });
        if (opt.type !== 'choose_option' || opt.optionId !== 'yes') break;

        const judgeCard = yield* helpers.resolveJudge(target.id, '界刚烈');
        if (state.result || !source.alive) break;

        if (getCardColor(judgeCard.suit) === 'red') {
          helpers.log('skill', `界【刚烈】判定红色，对 ${source.name} 造成 1 点伤害！`, target.id, [source.id]);
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
        } else {
          // Black -> discard 1 card from source (hand or discardable equip)
          const rawChoices = buildPlayerCardChoices(source, {
            includeHand: true,
            includeEquips: true,
            includeJudge: false
          }).filter(
            (ch) => ch.zone === 'hand' || helpers.canDiscardPlayerEquip(target.id, source.id, ch.zone as 'weapon')
          );
          if (rawChoices.length > 0) {
            const pick = yield* helpers.ask({
              type: 'choose_player_card',
              promptId: helpers.nextPromptId(),
              playerId: target.id,
              targetId: source.id,
              reason: 'dismantle',
              message: `界【刚烈】判定黑色：弃置 ${source.name} 的一张牌`,
              choices: rawChoices
            });
            const idx = pick.type === 'choose_player_card' ? pick.choiceIndex : 0;
            const prevHand = source.hand.length;
            const ex = extractChoiceCard(source, rawChoices[idx] ?? rawChoices[0]);
            if (ex) {
              helpers.moveToDiscard(ex.card);
              for (const ox of ex.lostWoodenOxStash) helpers.moveToDiscard(ox);
              helpers.log('skill', `界【刚烈】判定黑色，弃置了 ${source.name} 的【${ex.card.displayName}】`, target.id, [source.id]);
              if (ex.wasEquip) {
                yield* helpers.fireEquipLost(source.id, ex.card);
              }
              yield* helpers.checkHandEmptied(source.id, prevHand);
            }
          }
        }
      }
    }
  });

  // ===== 界夏侯惇：清俭（摸牌阶段外获得牌后，每回合限1次给牌并加当前回合角色手牌上限）=====
  triggers.register({
    id: 'skill_lb_qingjian',
    timing: 'CardObtained',
    priority: 40,
    condition: (state, payload) => {
      if (!payload.playerId || state.phase === 'draw') return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      if (!p || !hasActiveSkill(p, 'lb_qingjian')) return false;
      if (p.marks['lb_qingjian_turn'] === state.turn) return false;
      const hasCards = p.hand.length > 0 || getEquippedCards(p).length > 0;
      const hasOther = state.players.some((o) => o.alive && o.id !== p.id);
      return hasCards && hasOther;
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const allCards = [...p.hand, ...getEquippedCards(p)];
      const others = state.players.filter((o) => o.alive && o.id !== p.id).map((o) => o.id);
      if (allCards.length === 0 || others.length === 0) return;

      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'lb_qingjian',
        message: '摸牌阶段外获得牌：是否发动【清俭】，展示并交给一名其他角色任意张牌？',
        options: [
          { id: 'yes', label: '发动【清俭】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const cardPick = yield* helpers.ask({
        type: 'choose_card',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'general_skill',
        message: '【清俭】：选择要交出的任意张牌',
        minCount: 1,
        maxCount: allCards.length,
        eligibleCardIds: allCards.map((c) => c.id),
        optional: true
      });
      if (cardPick.type !== 'choose_card' || cardPick.cancelled || cardPick.cardIds.length === 0) {
        return;
      }

      const targetPick = yield* helpers.ask({
        type: 'choose_target',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'lb_qingjian_target',
        message: '【清俭】：选择交给哪名其他角色',
        minCount: 1,
        maxCount: 1,
        eligibleTargetIds: others,
        optional: false
      });
      const receiverId =
        targetPick.type === 'choose_target' && targetPick.targetIds[0]
          ? targetPick.targetIds[0]
          : others[0];
      const receiver = state.players.find((x) => x.id === receiverId && x.alive);
      if (!receiver) return;

      p.marks['lb_qingjian_turn'] = state.turn;
      const givenCards: CardInstance[] = [];
      const categories = new Set<string>();
      for (const cid of cardPick.cardIds) {
        const rem = yield* helpers.removeCardFromPlayer(p.id, cid);
        if (rem) {
          receiver.hand.push(rem);
          givenCards.push(rem);
          categories.add(rem.category);
        }
      }
      if (givenCards.length > 0) {
        const active = state.players[state.activePlayerIndex];
        if (active && active.alive) {
          active.marks['lb_qingjian_limit_bonus'] =
            (active.marks['lb_qingjian_limit_bonus'] ?? 0) + categories.size;
        }
        helpers.log(
          'skill',
          `${p.name} 发动【清俭】，交给 ${receiver.name} ${givenCards.length} 张牌（${categories.size} 种类别，当前回合角色手牌上限+${categories.size}）`,
          p.id,
          [receiver.id]
        );
        yield* helpers.notifyCardsObtained(receiver.id, givenCards);
      }
    }
  });

  modifiers.register({
    id: 'skill_lb_qingjian_limit',
    handLimitDelta: (_state, player) => player.marks['lb_qingjian_limit_bonus'] ?? 0
  });

  // ===== 界张辽：突袭（少摸任意张，改为夺取等量其他角色手牌）=====
  triggers.register({
    id: 'skill_lb_tuxi',
    timing: 'PhaseBefore',
    priority: 60,
    condition: (state, payload) => {
      if (payload.phase !== 'draw' || !payload.playerId) return false;
      if (state.skippedPhases.includes('draw')) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      if (!p || !hasActiveSkill(p, 'lb_tuxi')) return false;
      return state.players.some((o) => o.alive && o.id !== p.id && o.hand.length > 0);
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const eligible = state.players
        .filter((o) => o.alive && o.id !== p.id && o.hand.length > 0)
        .map((o) => o.id);
      const maxDraw = Math.max(1, 2 + modifiers.getDrawCountDelta(state, p));
      const maxTargets = Math.min(maxDraw, eligible.length);
      if (maxTargets <= 0) return;

      const resp = yield* helpers.ask({
        type: 'choose_target',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'lb_tuxi',
        message: `是否发动界【突袭】，少摸至多 ${maxTargets} 张牌改为获得等量其他角色的各一张手牌？`,
        minCount: 1,
        maxCount: maxTargets,
        eligibleTargetIds: eligible,
        optional: true
      });
      if (resp.type !== 'choose_target' || resp.cancelled || resp.targetIds.length === 0) return;

      const chosen = getAlivePlayersInOrder(state, p.id, false).filter((t) =>
        resp.targetIds.includes(t.id)
      );
      p.marks['lb_tuxi_reduce'] = chosen.length;
      helpers.log(
        'skill',
        `${p.name} 发动界【突袭】，少摸 ${chosen.length} 张牌并对 ${chosen.map((t) => t.name).join('、')} 夺取手牌`,
        p.id,
        chosen.map((t) => t.id)
      );
      for (const t of chosen) {
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
          message: `界【突袭】：选择获得 ${t.name} 的一张手牌`,
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

  modifiers.register({
    id: 'skill_lb_tuxi_draw_delta',
    drawCountDelta: (_state, player) => -(player.marks['lb_tuxi_reduce'] ?? 0)
  });

  // ===== 界许褚：裸衣（亮顶3牌，跳过摸牌获基本/武器/决斗，直到下回合开始杀/决斗伤+1）=====
  triggers.register({
    id: 'skill_lb_luoyi_clear',
    timing: 'TurnStart',
    priority: 15,
    *execute(state, payload) {
      const p = state.players.find((x) => x.id === payload.playerId);
      if (p) delete p.marks['lb_luoyi_active'];
    }
  });

  triggers.register({
    id: 'skill_lb_luoyi_draw',
    timing: 'PhaseBefore',
    priority: 58,
    condition: (state, payload) => {
      if (payload.phase !== 'draw' || !payload.playerId) return false;
      if (state.skippedPhases.includes('draw')) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'lb_luoyi'));
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const opt1 = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'lb_luoyi_peek',
        message: '是否发动界【裸衣】，亮出牌堆顶三张牌？',
        options: [
          { id: 'yes', label: '亮出牌堆顶3张牌' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt1.type !== 'choose_option' || opt1.optionId !== 'yes') return;

      const revealed = helpers.popTopCards(3);
      if (revealed.length === 0) return;
      for (const c of revealed) {
        helpers.pushTableCard(c, p.id, '界裸衣亮出');
      }
      const matching = revealed.filter(
        (c) => c.category === 'basic' || c.subtype === 'weapon' || c.name === 'duel'
      );
      const rest = revealed.filter((c) => !matching.includes(c));

      helpers.log(
        'skill',
        `${p.name} 【裸衣】亮出：${revealed.map((c) => `【${c.displayName}】`).join('、')}（可获得 ${matching.length} 张）`,
        p.id
      );

      const opt2 = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'lb_luoyi_confirm',
        message: `可获得 ${matching.length} 张牌（${matching.map((c) => c.displayName).join('、') || '无'}）并令下回合开始前【杀】/【决斗】伤害+1，是否跳过摸牌阶段？`,
        options: [
          { id: 'yes', label: `跳过摸牌并发动【裸衣】(+${matching.length}牌)` },
          { id: 'no', label: '放回牌堆顶，正常摸牌' }
        ]
      });

      if (opt2.type === 'choose_option' && opt2.optionId === 'yes') {
        state.skippedPhases.push('draw');
        p.marks['lb_luoyi_active'] = 1;
        p.hand.push(...matching);
        for (const r of rest) helpers.moveToDiscard(r);
        helpers.log(
          'skill',
          `${p.name} 跳过摸牌获得 ${matching.length} 张牌，直到下回合开始【杀】/【决斗】伤害+1！`,
          p.id
        );
      } else {
        helpers.putCardsOnTop(revealed);
      }
    }
  });

  triggers.register({
    id: 'skill_lb_luoyi_damage',
    timing: 'DamageDealt',
    priority: 70,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.prevented || dmg.isChainDamage || !dmg.sourceId || !dmg.card) return false;
      const src = state.players.find((p) => p.id === dmg.sourceId);
      if (!src || !src.marks['lb_luoyi_active']) return false;
      return isSlashCardName(dmg.card.name) || dmg.card.name === 'duel';
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const src = state.players.find((p) => p.id === dmg.sourceId)!;
      dmg.amount += 1;
      helpers.log('skill', `${src.name} 界【裸衣】生效，伤害 +1（当前 ${dmg.amount} 点）`, src.id, [dmg.targetId]);
    }
  });

  // ===== 界郭嘉：遗计（每1点伤害摸2张，再交给至多两名其他角色共计至多2张手牌）=====
  triggers.register({
    id: 'skill_lb_yiji',
    timing: 'AfterDamageTaken',
    priority: 45,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.actualDeducted <= 0) return false;
      const target = state.players.find((p) => p.id === dmg.targetId);
      return Boolean(target && hasActiveSkill(target, 'lb_yiji'));
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const target = state.players.find((p) => p.id === dmg.targetId)!;

      for (let step = 0; step < dmg.actualDeducted && target.alive && !state.result; step++) {
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: target.id,
          reason: 'lb_yiji',
          message: `是否发动界【遗计】（第 ${step + 1}/${dmg.actualDeducted} 次），摸两张牌并可分配至多两张手牌？`,
          options: [
            { id: 'yes', label: '发动【遗计】' },
            { id: 'no', label: '不发动' }
          ]
        });
        if (opt.type !== 'choose_option' || opt.optionId !== 'yes') break;

        const drawn = helpers.drawCards(target.id, 2);
        helpers.log('skill', `${target.name} 发动界【遗计】，摸了 ${drawn.length} 张牌`, target.id);
        if (drawn.length > 0) {
          yield* helpers.notifyCardsObtained(target.id, drawn);
        }

        // Up to 2 cards given to up to 2 other players
        let remainingToGive = 2;
        const alreadyGivenTo = new Set<string>();
        while (remainingToGive > 0 && target.hand.length > 0 && target.alive && !state.result) {
          const others = state.players
            .filter((o) => o.alive && o.id !== target.id && !alreadyGivenTo.has(o.id))
            .map((o) => o.id);
          if (others.length === 0) break;

          const cardPick = yield* helpers.ask({
            type: 'choose_card',
            promptId: helpers.nextPromptId(),
            playerId: target.id,
            reason: 'general_skill',
            message: `界【遗计】：可选择至多 ${remainingToGive} 张手牌交给一名其他角色（或跳过保留）`,
            minCount: 1,
            maxCount: Math.min(remainingToGive, target.hand.length),
            eligibleCardIds: target.hand.map((c) => c.id),
            optional: true
          });
          if (cardPick.type !== 'choose_card' || cardPick.cancelled || cardPick.cardIds.length === 0) {
            break;
          }

          const tgtPick = yield* helpers.ask({
            type: 'choose_target',
            promptId: helpers.nextPromptId(),
            playerId: target.id,
            reason: 'lb_yiji_give',
            message: '界【遗计】：选择交给哪名其他角色',
            minCount: 1,
            maxCount: 1,
            eligibleTargetIds: others,
            optional: false
          });
          const receiverId =
            tgtPick.type === 'choose_target' && tgtPick.targetIds[0]
              ? tgtPick.targetIds[0]
              : others[0];
          const receiver = state.players.find((x) => x.id === receiverId && x.alive);
          if (!receiver) break;

          const prevHand = target.hand.length;
          const given: CardInstance[] = [];
          for (const cid of cardPick.cardIds) {
            const idx = target.hand.findIndex((c) => c.id === cid);
            if (idx !== -1) {
              const card = target.hand.splice(idx, 1)[0];
              receiver.hand.push(card);
              given.push(card);
            }
          }
          if (given.length > 0) {
            remainingToGive -= given.length;
            alreadyGivenTo.add(receiver.id);
            helpers.log('skill', `${target.name} 【遗计】将 ${given.length} 张牌交给了 ${receiver.name}`, target.id, [receiver.id]);
            yield* helpers.checkHandEmptied(target.id, prevHand);
            yield* helpers.notifyCardsObtained(receiver.id, given);
          } else {
            break;
          }
        }
      }
    }
  });

  // ===== 界甄姬：洛神（获得的黑牌本回合不计入手牌上限）=====
  triggers.register({
    id: 'skill_lb_luoshen',
    timing: 'PhaseStart',
    priority: 50,
    condition: (state, payload) => {
      if (payload.phase !== 'prepare' || !payload.playerId) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'lb_luoshen'));
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      let count = 0;
      while (p.alive && !state.result && count < 20) {
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: p.id,
          reason: 'lb_luoshen',
          message: count === 0 ? '准备阶段：是否发动界【洛神】进行判定？' : '界【洛神】获得黑牌！是否继续判定？',
          options: [
            { id: 'yes', label: '判定【洛神】' },
            { id: 'no', label: '停止' }
          ]
        });
        if (opt.type !== 'choose_option' || opt.optionId !== 'yes') break;

        const judgeCard = yield* helpers.resolveJudge(p.id, '界洛神');
        if (state.result || !p.alive) break;
        if (getCardColor(judgeCard.suit) === 'black') {
          const taken = helpers.takeCardFromDiscard(judgeCard.id);
          if (taken) {
            taken.exemptFromHandLimitTurn = state.turn;
            p.hand.push(taken);
            helpers.log(
              'skill',
              `${p.name} 界【洛神】判定黑色，获得【${taken.displayName}】（本回合不计入手牌上限）！`,
              p.id,
              undefined,
              [taken.id]
            );
            yield* helpers.notifyCardsObtained(p.id, [taken]);
          }
          count += 1;
        } else {
          helpers.log('skill', `${p.name} 界【洛神】判定红色，结束判定`, p.id);
          break;
        }
      }
    }
  });

  // ===== 李典：恂恂（摸牌阶段开始看顶4张，2置顶2置底）& 忘隙（造成/受到1点伤害摸2交1）=====
  triggers.register({
    id: 'skill_lb_xunxun',
    timing: 'PhaseStart',
    priority: 60,
    condition: (state, payload) => {
      if (payload.phase !== 'draw' || !payload.playerId) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'lb_xunxun'));
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'lb_xunxun',
        message: '摸牌阶段开始：是否发动【恂恂】观看牌堆顶4张牌，选2张置顶、2张置底？',
        options: [
          { id: 'yes', label: '发动【恂恂】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') return;

      const cards = helpers.popTopCards(4);
      if (cards.length === 0) return;

      const resp = yield* helpers.ask({
        type: 'choose_guanxing',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        message: '【恂恂】：将最想摸到的 2 张牌留在「牌堆顶」，其余 2 张放入「牌堆底」',
        cards
      });

      const byId = new Map(cards.map((c) => [c.id, c]));
      const orderedTop: CardInstance[] = [];
      const orderedBottom: CardInstance[] = [];
      const seen = new Set<number>();

      if (resp.type === 'choose_guanxing') {
        for (const id of resp.topCardIds) {
          const c = byId.get(id);
          if (c && !seen.has(id)) {
            orderedTop.push(c);
            seen.add(id);
          }
        }
        for (const id of resp.bottomCardIds) {
          const c = byId.get(id);
          if (c && !seen.has(id)) {
            orderedBottom.push(c);
            seen.add(id);
          }
        }
      }
      for (const c of cards) {
        if (!seen.has(c.id)) orderedTop.push(c);
      }

      // Normalize strictly to 2 on top, rest on bottom (per official Xunxun wording)
      const targetTopCount = Math.min(2, cards.length);
      while (orderedTop.length > targetTopCount) {
        orderedBottom.unshift(orderedTop.pop()!);
      }
      while (orderedTop.length < targetTopCount && orderedBottom.length > 0) {
        orderedTop.push(orderedBottom.shift()!);
      }

      helpers.putCardsOnTop(orderedTop);
      helpers.putCardsOnBottom(orderedBottom);
      helpers.log(
        'skill',
        `${p.name} 发动【恂恂】，将 ${orderedTop.length} 张置于牌堆顶、${orderedBottom.length} 张置于牌堆底`,
        p.id
      );
    }
  });

  function* runWangxi(
    state: Parameters<TriggerRegistry['register']>[0] extends { execute: (s: infer S, ...a: never[]) => unknown } ? S : never,
    lidianId: string,
    otherId: string,
    amount: number,
    helpers: Parameters<Parameters<TriggerRegistry['register']>[0]['execute']>[2]
  ) {
    const lidian = state.players.find((p) => p.id === lidianId);
    const other = state.players.find((p) => p.id === otherId);
    if (!lidian || !other || lidian.id === other.id) return;

    for (let step = 0; step < amount; step++) {
      if (state.result || !lidian.alive || !other.alive || !hasActiveSkill(lidian, 'lb_wangxi')) {
        break;
      }
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: lidian.id,
        reason: 'lb_wangxi',
        message: `是否对 ${other.name} 发动【忘隙】（第 ${step + 1}/${amount} 次），摸两张牌并交给其一张手牌？`,
        options: [
          { id: 'yes', label: '发动【忘隙】' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type !== 'choose_option' || opt.optionId !== 'yes') break;

      const drawn = helpers.drawCards(lidian.id, 2);
      if (drawn.length > 0) {
        yield* helpers.notifyCardsObtained(lidian.id, drawn);
      }
      if (!lidian.alive || !other.alive || lidian.hand.length === 0) break;

      const pick = yield* helpers.ask({
        type: 'choose_card',
        promptId: helpers.nextPromptId(),
        playerId: lidian.id,
        reason: 'general_skill',
        message: `【忘隙】：选择一张手牌交给 ${other.name}`,
        minCount: 1,
        maxCount: 1,
        eligibleCardIds: lidian.hand.map((c) => c.id),
        optional: false
      });
      const cid =
        pick.type === 'choose_card' && pick.cardIds[0] ? pick.cardIds[0] : lidian.hand[0].id;
      const prevHand = lidian.hand.length;
      const idx = lidian.hand.findIndex((c) => c.id === cid);
      if (idx !== -1) {
        const given = lidian.hand.splice(idx, 1)[0];
        other.hand.push(given);
        helpers.log('skill', `${lidian.name} 发动【忘隙】，摸2牌并交给 ${other.name} 一张牌`, lidian.id, [other.id]);
        yield* helpers.checkHandEmptied(lidian.id, prevHand);
        yield* helpers.notifyCardsObtained(other.id, [given]);
      }
    }
  }

  triggers.register({
    id: 'skill_lb_wangxi_dealt',
    timing: 'AfterDamageDealt',
    priority: 44,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.actualDeducted <= 0 || !dmg.sourceId || dmg.sourceId === dmg.targetId) {
        return false;
      }
      const src = state.players.find((p) => p.id === dmg.sourceId);
      const dst = state.players.find((p) => p.id === dmg.targetId);
      return Boolean(src && dst && dst.alive && hasActiveSkill(src, 'lb_wangxi'));
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      yield* runWangxi(state, dmg.sourceId!, dmg.targetId, dmg.actualDeducted, helpers);
    }
  });

  triggers.register({
    id: 'skill_lb_wangxi_taken',
    timing: 'AfterDamageTaken',
    priority: 44,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.actualDeducted <= 0 || !dmg.sourceId || dmg.sourceId === dmg.targetId) {
        return false;
      }
      const src = state.players.find((p) => p.id === dmg.sourceId);
      const dst = state.players.find((p) => p.id === dmg.targetId);
      return Boolean(src && dst && src.alive && hasActiveSkill(dst, 'lb_wangxi'));
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      yield* runWangxi(state, dmg.targetId, dmg.sourceId!, dmg.actualDeducted, helpers);
    }
  });
}
