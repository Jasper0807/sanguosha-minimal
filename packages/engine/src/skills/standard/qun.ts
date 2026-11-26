import {
  getCardColor,
  isSlashCardName,
  type ModifierRegistry,
  type SkillRegistry,
  type TriggerRegistry,
  type VirtualCard
} from '../../index.js';
import { hasActiveSkill } from '../../core/events.js';
import { isInAttackRange } from '../../core/distance.js';
import { getEquippedCards, getUsableCards } from '../../core/deck.js';

export function registerQunStandardSkills(
  triggers: TriggerRegistry,
  modifiers: ModifierRegistry,
  skills: SkillRegistry
): void {
  triggers.register({
    id: 'skill_qun_turn_reset',
    timing: 'TurnStart',
    priority: 10,
    *execute(state, payload) {
      const p = state.players.find((x) => x.id === payload.playerId);
      if (p) {
        delete p.marks['qingnang_used'];
        delete p.marks['lijian_used'];
        delete p.marks['wangzun_limit_minus'];
      }
    }
  });

  // ===== 华佗：急救（回合外红牌当桃）& 青囊 =====
  skills.registerResponse({
    id: 'skill_jijiu',
    extraDyingPeachCardIds: (state, helper) => {
      if (!hasActiveSkill(helper, 'jijiu')) return [];
      const active = state.players[state.activePlayerIndex];
      if (active && active.id === helper.id) return []; // Strictly outside own turn!
      return [...getUsableCards(helper), ...getEquippedCards(helper)]
        .filter((c) => getCardColor(c.suit) === 'red')
        .map((c) => c.id);
    }
  });

  skills.registerActive({
    skillId: 'qingnang',
    getPromptInfo: (state, player) => {
      if (player.marks['qingnang_used'] || player.hand.length === 0) return null;
      const wounded = state.players
        .filter((p) => p.alive && p.hp < p.maxHp)
        .map((p) => p.id);
      if (wounded.length === 0) return null;
      return {
        skillId: 'qingnang',
        name: '青囊',
        description: '出牌阶段限1次，弃置一张手牌并令一名已受伤的角色回复1点体力。',
        cardMin: 1,
        cardMax: 1,
        eligibleCardIds: player.hand.map((c) => c.id),
        targetMin: 1,
        targetMax: 1,
        eligibleTargetIds: wounded
      };
    },
    *execute(state, player, cardIds, targetIds, helpers) {
      const target = state.players.find((p) => p.id === targetIds[0] && p.alive);
      if (!target || cardIds.length !== 1 || player.marks['qingnang_used']) return;
      player.marks['qingnang_used'] = 1;
      yield* helpers.discardCards(player.id, [cardIds[0]]);
      const healed = helpers.heal(target.id, 1);
      helpers.log(
        'heal',
        `${player.name} 发动【青囊】，令 ${target.name} 回复 ${healed} 点体力（HP ${target.hp}/${target.maxHp}）`,
        player.id,
        [target.id]
      );
    }
  });

  // ===== 吕布：无双 =====
  modifiers.register({
    id: 'skill_wushuang',
    requiredDodges: (_state, attacker) => (hasActiveSkill(attacker, 'wushuang') ? 2 : 1),
    requiredDuelSlashes: (_state, _responder, opponent) =>
      hasActiveSkill(opponent, 'wushuang') ? 2 : 1
  });

  // ===== 貂蝉：离间 & 闭月 =====
  skills.registerActive({
    skillId: 'lijian',
    getPromptInfo: (state, player) => {
      if (player.marks['lijian_used']) return null;
      const discardable = [...getUsableCards(player), ...getEquippedCards(player)];
      if (discardable.length === 0) return null;
      const aliveMales = state.players
        .filter((p) => p.alive && p.gender === 'male')
        .map((p) => p.id);
      if (aliveMales.length < 2) return null;
      return {
        skillId: 'lijian',
        name: '离间',
        description: '出牌阶段限1次，弃置一张牌并选择两名男性角色（先选者对后选者使用不可无懈的决斗）。',
        cardMin: 1,
        cardMax: 1,
        eligibleCardIds: discardable.map((c) => c.id),
        targetMin: 2,
        targetMax: 2,
        eligibleTargetIds: aliveMales
      };
    },
    *execute(state, player, cardIds, targetIds, helpers) {
      if (player.marks['lijian_used'] || cardIds.length !== 1 || targetIds.length !== 2) return;
      const user = state.players.find((p) => p.id === targetIds[0] && p.alive);
      const target = state.players.find((p) => p.id === targetIds[1] && p.alive);
      if (!user || !target || user.id === target.id) return;

      player.marks['lijian_used'] = 1;
      yield* helpers.discardCards(player.id, [cardIds[0]]);
      helpers.log(
        'skill',
        `${player.name} 发动【离间】，令 ${user.name} 对 ${target.name} 使用不可【无懈可击】的【决斗】！`,
        player.id,
        [user.id, target.id]
      );
      const virtualDuel: VirtualCard = {
        name: 'duel',
        displayName: '决斗(离间)',
        suit: 'none',
        rank: 0,
        color: 'none',
        element: 'normal',
        subcards: [],
        sourceSkill: 'lijian'
      };
      yield* helpers.resolveDuel(user, target, virtualDuel, true);
    }
  });

  triggers.register({
    id: 'skill_biyue',
    timing: 'PhaseStart',
    priority: 50,
    condition: (state, payload) => {
      if (payload.phase !== 'finish' || !payload.playerId) return false;
      const p = state.players.find((x) => x.id === payload.playerId);
      return Boolean(p && hasActiveSkill(p, 'biyue'));
    },
    *execute(state, payload, helpers) {
      const p = state.players.find((x) => x.id === payload.playerId)!;
      const opt = yield* helpers.ask({
        type: 'choose_option',
        promptId: helpers.nextPromptId(),
        playerId: p.id,
        reason: 'biyue',
        message: '结束阶段：是否发动【闭月】摸一张牌？',
        options: [
          { id: 'yes', label: '发动【闭月】摸1牌' },
          { id: 'no', label: '不发动' }
        ]
      });
      if (opt.type === 'choose_option' && opt.optionId === 'yes') {
        helpers.drawCards(p.id, 1);
        helpers.log('skill', `${p.name} 发动【闭月】，摸了一张牌`, p.id);
      }
    }
  });

  // ===== 华雄：耀武（锁定技）=====
  triggers.register({
    id: 'skill_yaowu',
    timing: 'DamageTaken',
    priority: 45,
    condition: (state, payload) => {
      const dmg = payload.damage;
      if (!dmg || dmg.prevented || !dmg.sourceId || !dmg.card) return false;
      if (!isSlashCardName(dmg.card.name)) return false;
      const color = 'color' in dmg.card ? dmg.card.color : getCardColor(dmg.card.suit);
      if (color !== 'red') return false;
      const target = state.players.find((p) => p.id === dmg.targetId);
      const source = state.players.find((p) => p.id === dmg.sourceId);
      return Boolean(target && source && source.alive && hasActiveSkill(target, 'yaowu'));
    },
    *execute(state, payload, helpers) {
      const dmg = payload.damage!;
      const target = state.players.find((p) => p.id === dmg.targetId)!;
      const source = state.players.find((p) => p.id === dmg.sourceId)!;

      if (source.hp < source.maxHp) {
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: source.id,
          reason: 'yaowu',
          message: `${target.name} 【耀武】触发（红色【杀】），请选择一项：`,
          options: [
            { id: 'heal', label: '回复 1 点体力' },
            { id: 'draw', label: '摸一张牌' }
          ]
        });
        if (opt.type === 'choose_option' && opt.optionId === 'heal') {
          helpers.heal(source.id, 1);
          helpers.log('heal', `【耀武】触发：${source.name} 回复了 1 点体力`, source.id);
          return;
        }
      }
      helpers.drawCards(source.id, 1);
      helpers.log('draw', `【耀武】触发：${source.name} 摸了一张牌`, source.id);
    }
  });

  // ===== 袁术：妄尊 & 同疾 =====
  triggers.register({
    id: 'skill_wangzun',
    timing: 'PhaseStart',
    priority: 52,
    condition: (state, payload) => {
      if (payload.phase !== 'prepare' || !payload.playerId) return false;
      const turnPlayer = state.players.find((x) => x.id === payload.playerId);
      if (!turnPlayer || turnPlayer.role !== 'lord') return false;
      return state.players.some(
        (p) => p.id !== turnPlayer.id && hasActiveSkill(p, 'wangzun')
      );
    },
    *execute(state, payload, helpers) {
      const lord = state.players.find((x) => x.id === payload.playerId)!;
      for (const p of state.players) {
        if (p.id === lord.id || !hasActiveSkill(p, 'wangzun')) continue;
        const opt = yield* helpers.ask({
          type: 'choose_option',
          promptId: helpers.nextPromptId(),
          playerId: p.id,
          reason: 'wangzun',
          message: `主公 ${lord.name} 的准备阶段：是否发动【妄尊】摸一张牌并令其本回合手牌上限 -1？`,
          options: [
            { id: 'yes', label: '发动【妄尊】' },
            { id: 'no', label: '不发动' }
          ]
        });
        if (opt.type === 'choose_option' && opt.optionId === 'yes') {
          helpers.drawCards(p.id, 1);
          lord.marks['wangzun_limit_minus'] = (lord.marks['wangzun_limit_minus'] ?? 0) + 1;
          helpers.log(
            'skill',
            `${p.name} 发动【妄尊】，摸了一张牌，${lord.name} 本回合手牌上限 -1`,
            p.id,
            [lord.id]
          );
        }
      }
    }
  });

  modifiers.register({
    id: 'skill_wangzun_hand_limit',
    handLimitDelta: (_state, player) => -(player.marks['wangzun_limit_minus'] ?? 0)
  });

  modifiers.register({
    id: 'skill_tongji',
    filterSlashTargets: (state, source, eligibleTargetIds) => {
      const tongjiHolders = state.players.filter(
        (p) =>
          p.alive &&
          p.id !== source.id &&
          hasActiveSkill(p, 'tongji') &&
          p.hand.length > p.hp &&
          isInAttackRange(state, source.id, p.id, modifiers)
      );
      if (tongjiHolders.length === 0) return eligibleTargetIds;
      const forcedIds = new Set(tongjiHolders.map((p) => p.id));
      return eligibleTargetIds.filter((id) => forcedIds.has(id));
    }
  });
}
