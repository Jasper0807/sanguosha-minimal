import {
  getCardColor,
  isSlashCardName,
  type CardInstance,
  type GameState,
  type PlayerResponse,
  type PlayerState,
  type PromptRequest
} from '../core/types.js';
import type { GameEngine } from '../core/engine.js';
import { getHandLimit, isInAttackRange } from '../core/distance.js';
import { getUsableCards } from '../core/deck.js';
import { getAllPlayableCards } from '../core/targeting.js';

/**
 * Estimates hostility toward the Lord purely from public GameEvents (zero cheating!).
 * Positive score => acted hostile toward Lord (likely Rebel).
 * Negative score => healed/helped Lord (likely Loyalist / Renegade protecting Lord).
 */
function inferLordHostility(state: GameState): Record<string, number> {
  const lord = state.players.find((p) => p.role === 'lord');
  const score: Record<string, number> = {};
  for (const p of state.players) score[p.id] = 0;
  if (!lord) return score;

  for (const ev of state.events) {
    if (!ev.actorId || !ev.targetIds) continue;
    if (ev.actorId === lord.id) continue;
    const hitLord = ev.targetIds.includes(lord.id);
    if (!hitLord) continue;

    if (ev.type === 'damage') {
      score[ev.actorId] = (score[ev.actorId] ?? 0) + 45;
    } else if (ev.type === 'play' || ev.type === 'discard') {
      if (
        ev.message.includes('杀') ||
        ev.message.includes('决斗') ||
        ev.message.includes('火攻') ||
        ev.message.includes('乐不思蜀') ||
        ev.message.includes('兵粮寸断') ||
        ev.message.includes('顺手牵羊') ||
        ev.message.includes('过河拆桥')
      ) {
        score[ev.actorId] = (score[ev.actorId] ?? 0) + 20;
      }
    } else if (ev.type === 'heal') {
      score[ev.actorId] = (score[ev.actorId] ?? 0) - 55;
    }
  }
  return score;
}

/**
 * Returns relationship score of `ai` toward `other`:
 * > 0 => Ally (higher = stronger ally)
 * < 0 => Enemy (lower = higher-priority target)
 */
export function evaluateRelation(
  state: GameState,
  ai: PlayerState,
  other: PlayerState
): number {
  if (ai.id === other.id) return 100;

  if (state.config.mode === '1v1') {
    return -100;
  }

  if (state.config.mode === '2v2') {
    return ai.team === other.team ? 100 : -100;
  }

  // Identity 5 inference
  const lord = state.players.find((p) => p.role === 'lord');
  const hostility = inferLordHostility(state);
  const h = hostility[other.id] ?? 0;

  if (ai.role === 'lord') {
    if (h >= 20) return -90;
    if (h <= -20) return 75;
    return -25; // Unknowns treated cautiously as potential threats
  }

  if (ai.role === 'loyalist') {
    if (other.role === 'lord') return 100;
    if (h >= 20) return -95;
    if (h <= -20) return 30;
    return -40;
  }

  if (ai.role === 'rebel') {
    if (other.role === 'lord') return -100;
    if (h >= 20) return 70; // Fellow rebel who attacked Lord
    if (h <= -20) return -75; // Likely loyalist
    return -15;
  }

  // Renegade: balance until 1v1 against Lord!
  const aliveNonLord = state.players.filter((p) => p.alive && p.role !== 'lord');
  if (aliveNonLord.length === 1 && other.role === 'lord') {
    return -100; // Final 1v1! Kill the Lord!
  }
  if (other.role === 'lord') {
    if (lord && lord.hp <= 2) return 65; // Keep Lord alive while rebels exist!
    return 15;
  }
  // Prioritize eliminating suspected Rebels first, then Loyalists
  if (h >= 20) return -85;
  return -60;
}

/**
 * Intrinsic value of keeping a card in hand (used for Discard phase & Harvest picking).
 */
function cardKeepValue(card: CardInstance, player: PlayerState): number {
  switch (card.name) {
    case 'peach':
      return player.hp < player.maxHp ? 100 : 88;
    case 'ex_nihilo':
      return 92;
    case 'nullification':
      return 78;
    case 'dodge':
      return 72;
    case 'alcohol':
      return player.hp <= 2 ? 75 : 58;
    case 'snatch':
    case 'dismantle':
    case 'indulgence':
    case 'supply_shortage':
      return 68;
    case 'fire_slash':
    case 'thunder_slash':
      return 56;
    case 'slash':
      return 50;
    case 'duel':
    case 'fire_attack':
    case 'savage_assault':
    case 'archery_attack':
      return 60;
    case 'peach_garden':
      return player.hp < player.maxHp ? 66 : 35;
    case 'harvest':
      return 54;
    case 'iron_chain':
      return 45;
    case 'collateral':
      return 42;
    case 'lightning':
      return 20;
    case 'silver_lion':
    case 'eight_trigrams':
    case 'renwang_shield':
    case 'vine_armor':
    case 'wooden_ox':
      return 62;
    default:
      return 40;
  }
}

function weaponScore(card: CardInstance | null, player: PlayerState): number {
  if (!card) return 0;
  const slashCount = getUsableCards(player).filter((c) => isSlashCardName(c.name)).length;
  switch (card.name) {
    case 'zhuge_crossbow':
      return slashCount >= 2 ? 95 : 25;
    case 'qinggang_sword':
      return 80;
    case 'ice_sword':
      return 75;
    case 'guding_blade':
      return 72;
    case 'fan':
      return 74;
    case 'axe':
      return 68;
    case 'blade':
      return 66;
    case 'serpent_spear':
      return 64;
    case 'kylin_bow':
      return 62;
    case 'halberd':
      return 58;
    case 'double_swords':
      return 60;
    default:
      return 40;
  }
}

function armorScore(card: CardInstance | null): number {
  if (!card) return 0;
  switch (card.name) {
    case 'eight_trigrams':
      return 82;
    case 'renwang_shield':
      return 78;
    case 'silver_lion':
      return 74;
    case 'vine_armor':
      return 70;
    default:
      return 40;
  }
}

/**
 * Picks the highest-priority enemy from eligibleTargetIds.
 */
function pickBestEnemy(
  state: GameState,
  ai: PlayerState,
  eligibleIds: string[],
  bonusFn?: (target: PlayerState) => number
): PlayerState | null {
  let best: PlayerState | null = null;
  let bestScore = -Infinity;

  for (const tid of eligibleIds) {
    const t = state.players.find((p) => p.id === tid && p.alive);
    if (!t) continue;
    const rel = evaluateRelation(state, ai, t);
    if (rel >= 0) continue; // Do not target allies!
    let score = -rel + (6 - t.hp) * 18 - t.hand.length * 4;
    if (bonusFn) score += bonusFn(t);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/**
 * Pure stateless deterministic hash for AI variety — NEVER mutates `engine.rng`,
 * preserving 100% bit-exact `GameEngine.replay()` determinism!
 */
function aiHash(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 1, 2654435761)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Decides a valid, intelligent PlayerResponse for an AI player given the current engine state.
 */
export function decideAIAction(engine: GameEngine, playerId: string): PlayerResponse {
  const { state } = engine;
  const prompt = state.pendingPrompt;
  if (!prompt) {
    throw new Error('decideAIAction called with no pendingPrompt');
  }
  const ai = engine.getPlayer(playerId);

  switch (prompt.type) {
    case 'choose_general': {
      // Score by HP + skill count + gentle pure-hash variety so 3-HP technical generals also get played
      const scored = prompt.candidates.map((g, idx) => ({
        g,
        score:
          g.maxHp +
          g.skills.length * 0.4 +
          (aiHash(state.config.seed, state.nextPromptId * 31 + idx * 17 + ai.seat) % 25) * 0.1
      }));
      scored.sort((a, b) => b.score - a.score);
      return { type: 'choose_general', generalId: scored[0].g.id };
    }

    case 'choose_guanxing': {
      // Keep top 2 best cards on top of draw pile, push weaker cards to bottom
      const sorted = [...prompt.cards].sort(
        (a, b) => cardKeepValue(b, ai) - cardKeepValue(a, ai)
      );
      const keepTopCount = Math.min(2, sorted.length);
      return {
        type: 'choose_guanxing',
        topCardIds: sorted.slice(0, keepTopCount).map((c) => c.id),
        bottomCardIds: sorted.slice(keepTopCount).map((c) => c.id)
      };
    }

    case 'choose_harvest_card': {
      const available = prompt.pool.filter((i) => !i.takenBy);
      available.sort((a, b) => cardKeepValue(b.card, ai) - cardKeepValue(a.card, ai));
      return { type: 'choose_harvest_card', cardId: available[0].card.id };
    }

    case 'choose_player_card': {
      const target = engine.getPlayer(prompt.targetId);
      const isAlly = evaluateRelation(state, ai, target) > 0;
      if (isAlly) {
        const judgeIdx = prompt.choices.findIndex((c) => c.zone === 'judge');
        if (judgeIdx !== -1) return { type: 'choose_player_card', choiceIndex: judgeIdx };
      }
      // On enemy: prioritize armor -> +1 horse -> weapon -> hand -> judge
      const zoneOrder = ['armor', 'horsePlus', 'weapon', 'treasure', 'horseMinus', 'hand', 'judge'];
      let bestIdx = 0;
      let bestRank = 999;
      prompt.choices.forEach((c, idx) => {
        const r = zoneOrder.indexOf(c.zone);
        const rank = r === -1 ? 50 : r;
        if (rank < bestRank) {
          bestRank = rank;
          bestIdx = idx;
        }
      });
      return { type: 'choose_player_card', choiceIndex: bestIdx };
    }

    case 'choose_option': {
      switch (prompt.reason) {
        case 'eight_trigrams':
        case 'double_swords':
        case 'kylin_bow':
        case 'fan':
        case 'jianxiong':
        case 'fankui':
        case 'tiandu':
        case 'yiji':
        case 'luoshen':
        case 'guanxing':
        case 'tieqi':
        case 'jizhi':
        case 'keji':
        case 'yingzi':
        case 'lianying':
        case 'xiaoji':
        case 'biyue':
        case 'hujia':
        case 'jijiang':
        case 'lb_jianxiong':
        case 'lb_fankui':
        case 'lb_yiji':
        case 'lb_luoshen':
        case 'lb_xunxun':
        case 'lb_luoyi_peek':
        case 'lb_hujia':
        case 'lb_jijiang':
        case 'lb_tishen':
        case 'lb_guanxing':
        case 'lb_yajiao':
        case 'lb_tieqi':
        case 'lb_jizhi':
        case 'lb_botu':
        case 'lb_lianying':
        case 'lb_liyu':
        case 'lb_biyue':
        case 'lb_qiaomeng':
        case 'liegong':
        case 'xingshang':
        case 'zaiqi':
        case 'shuangxiong':
        case 'jianchu':
        case 'tuntian':
        case 'jiang':
        case 'guzheng':
        case 'xinsheng':
        case 'niepan':
        case 'zhiba_take':
          return { type: 'choose_option', optionId: 'yes' };
        case 'shensu_judge': {
          const hasBadJudge = ai.judgeZone.some(
            (c) => (c.asDelayedTrick ?? c.name) === 'indulgence' || (c.asDelayedTrick ?? c.name) === 'supply_shortage'
          );
          return { type: 'choose_option', optionId: hasBadJudge ? 'yes' : 'no' };
        }
        case 'shensu_play':
        case 'shensu_discard':
          return { type: 'choose_option', optionId: 'no' };
        case 'jushou':
          return { type: 'choose_option', optionId: ai.hand.length <= 2 && !ai.flipped ? 'yes' : 'no' };
        case 'jiewei':
          return { type: 'choose_option', optionId: ai.hand.length >= 2 ? 'yes' : 'no' };
        case 'kuanggu':
        case 'zhiji':
          return {
            type: 'choose_option',
            optionId:
              ai.hp < ai.maxHp && prompt.options.some((o) => o.id === 'heal') ? 'heal' : 'draw'
          };
        case 'qimou':
          return { type: 'choose_option', optionId: prompt.options[0]?.id ?? '1' };
        case 'tianxiang':
          return { type: 'choose_option', optionId: ai.hp <= 2 || ai.hand.length >= 3 ? 'yes' : 'no' };
        case 'tianxiang_mode': {
          const victim = state.players.find((p) => p.alive && prompt.message.includes(p.name));
          if (victim && evaluateRelation(state, ai, victim) < 0 && victim.maxHp - victim.hp >= 2) {
            return { type: 'choose_option', optionId: 'lose_hp_gain' };
          }
          return { type: 'choose_option', optionId: 'damage_draw' };
        }
        case 'fenji': {
          const victim = state.players.find((p) => p.alive && prompt.message.includes(p.name));
          const good = Boolean(victim && evaluateRelation(state, ai, victim) > 0 && ai.hp >= 2);
          return { type: 'choose_option', optionId: good ? 'yes' : 'no' };
        }
        case 'leiji':
        case 'fangzhu': {
          const hasEnemy = state.players.some(
            (p) => p.alive && p.id !== ai.id && evaluateRelation(state, ai, p) < 0
          );
          return { type: 'choose_option', optionId: hasEnemy ? 'yes' : 'no' };
        }
        case 'guhuo_declare': {
          if (ai.hp < ai.maxHp && prompt.options.some((o) => o.id === 'peach')) {
            return { type: 'choose_option', optionId: 'peach' };
          }
          if (prompt.options.some((o) => o.id === 'ex_nihilo')) {
            return { type: 'choose_option', optionId: 'ex_nihilo' };
          }
          const nonCancel = prompt.options.find((o) => o.id !== 'cancel');
          return { type: 'choose_option', optionId: nonCancel ? nonCancel.id : 'cancel' };
        }
        case 'guhuo_question': {
          if (ai.hp <= 1) return { type: 'choose_option', optionId: 'trust' };
          const yuji = state.players.find((p) => p.alive && prompt.message.includes(p.name));
          const hostile = yuji ? evaluateRelation(state, ai, yuji) < 0 : false;
          const roll = aiHash(state.config.seed, state.nextPromptId * 13 + ai.seat) % 100;
          const shouldDoubt = hostile && ai.hp >= 3 && roll < 35;
          return { type: 'choose_option', optionId: shouldDoubt ? 'doubt' : 'trust' };
        }
        case 'jieming': {
          const needyAlly = state.players.some(
            (p) =>
              p.alive &&
              evaluateRelation(state, ai, p) > 0 &&
              p.hand.length < Math.min(5, p.maxHp)
          );
          return { type: 'choose_option', optionId: needyAlly ? 'yes' : 'no' };
        }
        case 'songwei':
        case 'baonue': {
          const lord = state.players.find((p) => p.alive && p.role === 'lord');
          const isAlly = lord ? evaluateRelation(state, ai, lord) > 0 : false;
          return { type: 'choose_option', optionId: isAlly ? 'yes' : 'no' };
        }
        case 'lieren': {
          const hasHigh = ai.hand.some((c) => c.rank >= 9);
          return { type: 'choose_option', optionId: hasHigh || ai.hand.length >= 3 ? 'yes' : 'no' };
        }
        case 'yinghun':
          return { type: 'choose_option', optionId: 'yes' };
        case 'yinghun_mode': {
          const target = state.players.find((p) => p.alive && prompt.message.includes(p.name));
          const isAlly = target ? evaluateRelation(state, ai, target) > 0 : false;
          return { type: 'choose_option', optionId: isAlly ? 'draw_x' : 'discard_x' };
        }
        case 'haoshi': {
          const hasAlly = state.players.some(
            (p) => p.alive && p.id !== ai.id && evaluateRelation(state, ai, p) > 0
          );
          return { type: 'choose_option', optionId: ai.hand.length <= 2 || hasAlly ? 'yes' : 'no' };
        }
        case 'benghuai':
          return { type: 'choose_option', optionId: ai.maxHp > ai.hp ? 'lose_max_hp' : 'lose_hp' };
        case 'qiaobian_judge':
          return {
            type: 'choose_option',
            optionId: ai.judgeZone.length > 0 && ai.hand.length >= 2 ? 'yes' : 'no'
          };
        case 'qiaobian_draw': {
          const enemiesWithCards = state.players.filter(
            (p) => p.alive && p.id !== ai.id && p.hand.length > 0 && evaluateRelation(state, ai, p) < 0
          );
          return {
            type: 'choose_option',
            optionId: enemiesWithCards.length >= 2 && ai.hand.length >= 2 ? 'yes' : 'no'
          };
        }
        case 'qiaobian_play':
          return { type: 'choose_option', optionId: 'no' };
        case 'qiaobian_discard': {
          const excess = ai.hand.length - getHandLimit(state, ai, engine.modifiers);
          return { type: 'choose_option', optionId: excess >= 2 ? 'yes' : 'no' };
        }
        case 'fangquan_skip':
        case 'fangquan_grant': {
          const hasAlly = state.players.some(
            (p) => p.alive && p.id !== ai.id && evaluateRelation(state, ai, p) > 0
          );
          const ok = prompt.reason === 'fangquan_skip' ? hasAlly && ai.hand.length <= 3 : hasAlly;
          return { type: 'choose_option', optionId: ok ? 'yes' : 'no' };
        }
        case 'zhiba_accept':
          return { type: 'choose_option', optionId: ai.hand.length >= 2 ? 'yes' : 'no' };
        case 'guzheng_return':
          return { type: 'choose_option', optionId: prompt.options[0].id };
        case 'beige': {
          const victim = state.players.find((p) => p.alive && prompt.message.includes(p.name));
          const good = Boolean(victim && evaluateRelation(state, ai, victim) > 0 && ai.hand.length >= 2);
          return { type: 'choose_option', optionId: good ? 'yes' : 'no' };
        }
        case 'huashen': {
          if (ai.activeHuashenSkillId && prompt.options.some((o) => o.id === 'keep')) {
            return { type: 'choose_option', optionId: 'keep' };
          }
          const nonKeep = prompt.options.find((o) => o.id !== 'keep');
          return { type: 'choose_option', optionId: nonKeep ? nonKeep.id : prompt.options[0].id };
        }
        case 'lb_luoyi_confirm':
          return {
            type: 'choose_option',
            optionId: prompt.message.includes('获得 0 张') ? 'no' : 'yes'
          };
        case 'lb_wangxi':
        case 'lb_qingjian': {
          const hasAlly = state.players.some(
            (p) => p.alive && p.id !== ai.id && evaluateRelation(state, ai, p) > 0
          );
          if (prompt.reason === 'lb_qingjian') {
            return { type: 'choose_option', optionId: hasAlly && ai.hand.length >= 2 ? 'yes' : 'no' };
          }
          // lb_wangxi: activate if drawing 2 & giving 1 nets +1 card (always good unless target is critical enemy? actually +1 card for self is usually worth it, or always yes when ai.hand <= 3)
          return { type: 'choose_option', optionId: ai.hand.length <= 3 ? 'yes' : 'no' };
        }
        case 'lb_hujia_draw':
        case 'lb_jijiang_draw':
        case 'lb_jiuyuan': {
          const lord = state.players.find((p) => p.alive && prompt.message.includes(p.name));
          const isAlly = lord ? evaluateRelation(state, ai, lord) > 0 : false;
          if (prompt.reason === 'lb_jiuyuan') {
            return { type: 'choose_option', optionId: isAlly && ai.hp >= 2 ? 'yes' : 'no' };
          }
          return { type: 'choose_option', optionId: isAlly ? 'yes' : 'no' };
        }
        case 'ganglie':
        case 'lb_ganglie': {
          const enemyExists = state.players.some(
            (p) => p.alive && prompt.message.includes(p.name) && evaluateRelation(state, ai, p) < 0
          );
          return { type: 'choose_option', optionId: enemyExists ? 'yes' : 'no' };
        }
        case 'lb_yijue_heal': {
          const target = state.players.find((p) => p.alive && prompt.message.includes(p.name));
          return {
            type: 'choose_option',
            optionId: target && evaluateRelation(state, ai, target) > 0 ? 'yes' : 'no'
          };
        }
        case 'lb_jizhi_discard':
          return {
            type: 'choose_option',
            optionId: ai.hand.length > getHandLimit(state, ai, engine.modifiers) ? 'yes' : 'no'
          };
        case 'lb_fenwei': {
          const isHarmful =
            prompt.message.includes('南蛮') ||
            prompt.message.includes('万箭') ||
            prompt.message.includes('铁索');
          return { type: 'choose_option', optionId: isHarmful ? 'yes' : 'no' };
        }
        case 'lb_qinxue':
          return { type: 'choose_option', optionId: ai.hp <= 2 ? 'heal' : 'draw' };
        case 'lb_gongxin_card': {
          const cardOpt = prompt.options.find((o) => o.id.startsWith('card_'));
          return { type: 'choose_option', optionId: cardOpt ? cardOpt.id : prompt.options[0].id };
        }
        case 'lb_gongxin_action':
          return { type: 'choose_option', optionId: 'discard' };
        case 'lb_fanjian':
          return {
            type: 'choose_option',
            optionId: ai.hp <= 1 || ai.hand.length <= 2 ? 'discard_suit' : 'lose_hp'
          };
        case 'lb_qianxun':
          return { type: 'choose_option', optionId: ai.hand.length >= 2 ? 'yes' : 'no' };
        case 'lb_jieyin_mode': {
          const target = state.players.find((p) => p.alive && prompt.message.includes(p.name));
          return {
            type: 'choose_option',
            optionId: target && evaluateRelation(state, ai, target) > 0 ? 'equip' : 'discard'
          };
        }
        case 'lb_yongsi':
          return {
            type: 'choose_option',
            optionId: ai.hp <= 2 || ai.hand.length >= 2 ? 'discard' : 'lose_hp'
          };
        case 'lb_jixi':
          return { type: 'choose_option', optionId: 'draw_lord' };
        case 'lb_rende_basic': {
          if (ai.hp < ai.maxHp && prompt.options.some((o) => o.id === 'peach')) {
            return { type: 'choose_option', optionId: 'peach' };
          }
          if (prompt.options.some((o) => o.id === 'slash')) {
            return { type: 'choose_option', optionId: 'slash' };
          }
          return { type: 'choose_option', optionId: prompt.options[0].id };
        }
        case 'lb_jianyan_declare':
          return { type: 'choose_option', optionId: 'trick' };
        case 'ganglie_choice':
          return {
            type: 'choose_option',
            optionId: ai.hp <= 2 && ai.hand.length >= 2 ? 'discard' : 'damage'
          };
        case 'luoyi': {
          const hasSlashOrDuel = getUsableCards(ai).some(
            (c) => isSlashCardName(c.name) || c.name === 'duel'
          );
          return { type: 'choose_option', optionId: hasSlashOrDuel ? 'yes' : 'no' };
        }
        case 'liuli': {
          const hasNonPeachCard = getUsableCards(ai).some((c) => c.name !== 'peach');
          return {
            type: 'choose_option',
            optionId: ai.hp <= 2 && hasNonPeachCard ? 'yes' : 'no'
          };
        }
        case 'wangzun': {
          const lord = state.players.find((p) => p.role === 'lord');
          const antiLord = lord ? evaluateRelation(state, ai, lord) < 0 : false;
          return { type: 'choose_option', optionId: antiLord ? 'yes' : 'no' };
        }
        case 'yaowu':
          return {
            type: 'choose_option',
            optionId: ai.hp < ai.maxHp ? 'heal' : 'draw'
          };
        case 'fanjian_suit': {
          const suits = ['spade', 'heart', 'club', 'diamond'];
          const pickIdx = aiHash(state.config.seed, state.nextPromptId * 19 + ai.seat) % suits.length;
          return {
            type: 'choose_option',
            optionId: suits[pickIdx]
          };
        }
        case 'double_swords_choice':
          return {
            type: 'choose_option',
            optionId: ai.hand.length >= 3 ? 'discard' : 'let_draw'
          };
        case 'ice_sword':
          return { type: 'choose_option', optionId: 'no' };
        default:
          return { type: 'choose_option', optionId: prompt.options[0].id };
      }
    }

    case 'choose_target': {
      if (
        prompt.reason === 'tuxi' ||
        prompt.reason === 'lb_tuxi' ||
        prompt.reason === 'qiaobian_draw'
      ) {
        const enemies = prompt.eligibleTargetIds
          .map((id) => engine.getPlayer(id))
          .filter((p) => evaluateRelation(state, ai, p) < 0)
          .sort((a, b) => b.hand.length - a.hand.length)
          .slice(0, prompt.maxCount)
          .map((p) => p.id);
        if (enemies.length > 0) {
          return { type: 'choose_target', targetIds: enemies };
        }
        return { type: 'choose_target', targetIds: [], cancelled: true };
      }
      if (
        prompt.reason === 'yiji_give' ||
        prompt.reason === 'lb_yiji_give' ||
        prompt.reason === 'lb_qingjian_target' ||
        prompt.reason === 'lb_yajiao_give' ||
        prompt.reason === 'lb_jianyan_target' ||
        prompt.reason === 'jieming_target' ||
        prompt.reason === 'haoshi_target' ||
        prompt.reason === 'fangquan_target'
      ) {
        const allies = prompt.eligibleTargetIds
          .map((id) => engine.getPlayer(id))
          .filter((p) => evaluateRelation(state, ai, p) > 0)
          .sort((a, b) => a.hand.length - b.hand.length);
        if (allies.length > 0) {
          return { type: 'choose_target', targetIds: [allies[0].id] };
        }
        if (prompt.optional) {
          return { type: 'choose_target', targetIds: [], cancelled: true };
        }
        return { type: 'choose_target', targetIds: [prompt.eligibleTargetIds[0]] };
      }
      if (prompt.reason === 'move_field_source') {
        // Prefer taking an equip from an enemy or removing a delayed trick from an ally
        const allyBadJudge = prompt.eligibleTargetIds
          .map((id) => engine.getPlayer(id))
          .find((p) => evaluateRelation(state, ai, p) > 0 && p.judgeZone.length > 0);
        if (allyBadJudge) {
          return { type: 'choose_target', targetIds: [allyBadJudge.id] };
        }
        const enemy = pickBestEnemy(state, ai, prompt.eligibleTargetIds);
        if (enemy) {
          return { type: 'choose_target', targetIds: [enemy.id] };
        }
        return { type: 'choose_target', targetIds: [], cancelled: true };
      }
      if (prompt.reason === 'move_field_dest') {
        const isJudgeCard =
          prompt.message.includes('乐不思蜀') ||
          prompt.message.includes('兵粮寸断') ||
          prompt.message.includes('闪电');
        if (isJudgeCard) {
          const enemy = pickBestEnemy(state, ai, prompt.eligibleTargetIds);
          if (enemy) return { type: 'choose_target', targetIds: [enemy.id] };
        } else {
          const ally = prompt.eligibleTargetIds
            .map((id) => engine.getPlayer(id))
            .find((p) => evaluateRelation(state, ai, p) > 0);
          if (ally) return { type: 'choose_target', targetIds: [ally.id] };
        }
        return { type: 'choose_target', targetIds: [prompt.eligibleTargetIds[0]] };
      }
      if (prompt.reason === 'lb_fenwei_targets' || prompt.reason === 'lb_lianying_targets') {
        const allies = prompt.eligibleTargetIds
          .map((id) => engine.getPlayer(id))
          .filter((p) => evaluateRelation(state, ai, p) > 0)
          .sort((a, b) => a.hp - b.hp)
          .slice(0, prompt.maxCount)
          .map((p) => p.id);
        if (allies.length >= prompt.minCount) {
          return { type: 'choose_target', targetIds: allies };
        }
        if (prompt.optional) {
          return { type: 'choose_target', targetIds: [], cancelled: true };
        }
        return {
          type: 'choose_target',
          targetIds: prompt.eligibleTargetIds.slice(0, prompt.minCount)
        };
      }
      const enemy = pickBestEnemy(state, ai, prompt.eligibleTargetIds);
      if (enemy) {
        return { type: 'choose_target', targetIds: [enemy.id] };
      }
      if (prompt.optional) {
        return { type: 'choose_target', targetIds: [], cancelled: true };
      }
      return {
        type: 'choose_target',
        targetIds: prompt.eligibleTargetIds.slice(0, prompt.minCount)
      };
    }

    case 'choose_card':
      return decideChooseCard(engine, ai, prompt);

    case 'play_action':
      return decidePlayPhase(engine, ai);
  }
}

function decideChooseCard(
  engine: GameEngine,
  ai: PlayerState,
  prompt: Extract<PromptRequest, { type: 'choose_card' }>
): PlayerResponse {
  const { state } = engine;
  const usable = getUsableCards(ai);
  const eligible = prompt.eligibleCardIds
    .map((id) => usable.find((c) => c.id === id) ?? Object.values(ai.equips).find((e) => e?.id === id))
    .filter((c): c is CardInstance => Boolean(c));

  switch (prompt.reason) {
    case 'dodge': {
      // Always dodge incoming damage!
      if (eligible.length > 0) {
        return { type: 'choose_card', cardIds: [eligible[0].id] };
      }
      return { type: 'choose_card', cardIds: [], cancelled: true };
    }

    case 'slash_duel':
    case 'slash_savage': {
      const realSlashes = eligible.filter((c) => isSlashCardName(c.name));
      if (realSlashes.length > 0) {
        return { type: 'choose_card', cardIds: [realSlashes[0].id] };
      }
      if (prompt.canUseSerpentSpear && eligible.length >= 2 && (ai.hp <= 2 || eligible.length >= 4)) {
        const sorted = [...eligible].sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai));
        return {
          type: 'choose_card',
          cardIds: [sorted[0].id, sorted[1].id],
          useSerpentSpear: true
        };
      }
      return { type: 'choose_card', cardIds: [], cancelled: true };
    }

    case 'slash_collateral':
    case 'slash_blade': {
      const realSlashes = eligible.filter((c) => isSlashCardName(c.name));
      if (realSlashes.length > 0) {
        return { type: 'choose_card', cardIds: [realSlashes[0].id] };
      }
      return { type: 'choose_card', cardIds: [], cancelled: true };
    }

    case 'peach_dying': {
      // Parse whether dying player is self or ally
      const dyingPlayer = state.players.find((p) => p.alive && p.hp <= 0);
      if (!dyingPlayer) {
        return { type: 'choose_card', cardIds: [], cancelled: true };
      }
      const rel = evaluateRelation(state, ai, dyingPlayer);
      if (rel > 0 && eligible.length > 0) {
        // If saving self, prefer Alcohol first to save Peach for allies!
        const alc = eligible.find((c) => c.name === 'alcohol');
        if (dyingPlayer.id === ai.id && alc) {
          return { type: 'choose_card', cardIds: [alc.id] };
        }
        return { type: 'choose_card', cardIds: [eligible[0].id] };
      }
      return { type: 'choose_card', cardIds: [], cancelled: true };
    }

    case 'nullification': {
      const msg = prompt.message;
      // Check if trick hurts self/ally or helps enemy
      const isBeneficialTrick =
        msg.includes('无中生有') || msg.includes('桃园结义') || msg.includes('五谷丰登');
      const isCounteringNull = msg.includes('反制');
      const targetPlayer = state.players.find((p) => msg.includes(p.name));
      const rel = targetPlayer ? evaluateRelation(state, ai, targetPlayer) : 0;

      const shouldPlay = isCounteringNull
        ? rel < 0 && eligible.length > 0
        : isBeneficialTrick
          ? rel < 0 && (msg.includes('无中生有') || ai.hand.length >= 3)
          : rel > 0 &&
            (msg.includes('乐不思蜀') ||
              msg.includes('兵粮寸断') ||
              msg.includes('决斗') ||
              msg.includes('火攻') ||
              msg.includes('顺手牵羊') ||
              msg.includes('南蛮') ||
              msg.includes('万箭') ||
              msg.includes('闪电'));

      if (shouldPlay && eligible.length > 0) {
        return { type: 'choose_card', cardIds: [eligible[0].id] };
      }
      return { type: 'choose_card', cardIds: [], cancelled: true };
    }

    case 'discard_axe': {
      // Use Axe if AI has >= 4 cards and low-value cards to spare
      if (eligible.length >= 4) {
        const sorted = [...eligible].sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai));
        if (cardKeepValue(sorted[0], ai) <= 55 && cardKeepValue(sorted[1], ai) <= 55) {
          return { type: 'choose_card', cardIds: [sorted[0].id, sorted[1].id] };
        }
      }
      return { type: 'choose_card', cardIds: [], cancelled: true };
    }

    case 'fire_attack_show': {
      // Show a suit that appears least or lowest-value card
      const sorted = [...eligible].sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai));
      return { type: 'choose_card', cardIds: [sorted[0].id] };
    }

    case 'fire_attack_discard': {
      const sorted = [...eligible].sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai));
      if (sorted.length > 0 && cardKeepValue(sorted[0], ai) <= 75) {
        return { type: 'choose_card', cardIds: [sorted[0].id] };
      }
      return { type: 'choose_card', cardIds: [], cancelled: true };
    }

    case 'pindian': {
      // Pick highest rank card to maximize win rate!
      const sorted = [...eligible].sort((a, b) => b.rank - a.rank);
      return { type: 'choose_card', cardIds: [sorted[0].id] };
    }

    case 'general_skill': {
      if (prompt.optional) {
        if (prompt.message.includes('鬼才') || prompt.message.includes('鬼道')) {
          return { type: 'choose_card', cardIds: [], cancelled: true };
        }
        if (prompt.message.includes('享乐')) {
          const sorted = [...eligible].sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai));
          if (sorted.length > 0 && cardKeepValue(sorted[0], ai) < 70) {
            return { type: 'choose_card', cardIds: [sorted[0].id] };
          }
          return { type: 'choose_card', cardIds: [], cancelled: true };
        }
        if (prompt.message.includes('激将')) {
          const lord = state.players.find((p) => p.role === 'lord');
          if (lord && evaluateRelation(state, ai, lord) > 0 && eligible.length > 0) {
            return { type: 'choose_card', cardIds: [eligible[0].id] };
          }
          return { type: 'choose_card', cardIds: [], cancelled: true };
        }
        if (prompt.message.includes('诛害')) {
          const target = state.players.find((p) => p.alive && prompt.message.includes(p.name));
          if (target && evaluateRelation(state, ai, target) < 0 && eligible.length > 0) {
            return { type: 'choose_card', cardIds: [eligible[0].id] };
          }
          return { type: 'choose_card', cardIds: [], cancelled: true };
        }
        if (prompt.message.includes('铁骑')) {
          // Discard matching suit card to allow dodging if low HP and spare card
          if (ai.hp <= 2 && eligible.length > 0) {
            const sorted = [...eligible].sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai));
            return { type: 'choose_card', cardIds: [sorted[0].id] };
          }
          return { type: 'choose_card', cardIds: [], cancelled: true };
        }
      }
      const sorted = [...eligible].sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai));
      return {
        type: 'choose_card',
        cardIds: sorted.slice(0, prompt.minCount).map((c) => c.id)
      };
    }

    case 'discard_phase':
    case 'discard_double_swords':
    default: {
      const sorted = [...eligible].sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai));
      return {
        type: 'choose_card',
        cardIds: sorted.slice(0, prompt.minCount).map((c) => c.id)
      };
    }
  }
}

function decidePlayPhase(engine: GameEngine, ai: PlayerState): PlayerResponse {
  const { state } = engine;
  const playable = getAllPlayableCards(state, ai.id, engine.modifiers);
  const usable = getUsableCards(ai);
  const findCard = (id: number) => usable.find((c) => c.id === id);

  // 0. Active General Skills (high-value, strictly bounded / no loops!)
  const playPrompt = state.pendingPrompt;
  if (playPrompt?.type === 'play_action' && playPrompt.usableSkills.length > 0) {
    const byId = (sid: string) => playPrompt.usableSkills.find((s) => s.skillId === sid);

    // 孙权制衡 / 界孙权制衡: discard low-value cards once per turn (LB: dump whole hand if <=3 for +1 draw!)
    const zhiheng = byId('zhiheng') ?? byId('lb_zhiheng');
    if (zhiheng) {
      if (zhiheng.skillId === 'lb_zhiheng' && ai.hand.length >= 1 && ai.hand.length <= 3) {
        const allHandIds = ai.hand
          .map((c) => c.id)
          .filter((id) => zhiheng.eligibleCardIds.includes(id));
        if (allHandIds.length === ai.hand.length && allHandIds.length >= 1) {
          return {
            type: 'play_action',
            action: { type: 'activate_skill', skillId: 'lb_zhiheng', cardIds: allHandIds }
          };
        }
      }
      const toDiscard = zhiheng.eligibleCardIds.filter((id) => {
        const c = findCard(id);
        return c ? cardKeepValue(c, ai) < 62 : false;
      });
      if (toDiscard.length >= 1) {
        return {
          type: 'play_action',
          action: { type: 'activate_skill', skillId: zhiheng.skillId, cardIds: toDiscard }
        };
      }
    }

    // 界黄盖苦肉（配诈降摸3+红杀buff）: once per turn when hp >= 2
    const lbKurou = byId('lb_kurou');
    if (lbKurou && ai.hp >= 2) {
      const lowCard = lbKurou.eligibleCardIds
        .map((id) => findCard(id) ?? Object.values(ai.equips).find((e) => e?.id === id))
        .filter((c): c is CardInstance => Boolean(c))
        .sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai))[0];
      if (lowCard) {
        return {
          type: 'play_action',
          action: { type: 'activate_skill', skillId: 'lb_kurou', cardIds: [lowCard.id] }
        };
      }
    }

    // 界关羽义绝: once per turn against best enemy
    const lbYijue = byId('lb_yijue');
    if (lbYijue) {
      const enemy = pickBestEnemy(state, ai, lbYijue.eligibleTargetIds);
      const lowCard = ai.hand
        .filter((c) => lbYijue.eligibleCardIds.includes(c.id))
        .sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai))[0];
      if (enemy && lowCard && cardKeepValue(lowCard, ai) < 78) {
        return {
          type: 'play_action',
          action: {
            type: 'activate_skill',
            skillId: 'lb_yijue',
            cardIds: [lowCard.id],
            targetIds: [enemy.id]
          }
        };
      }
    }

    // 界周瑜反间: once per turn against best enemy
    const lbFanjian = byId('lb_fanjian');
    if (lbFanjian) {
      const enemy = pickBestEnemy(state, ai, lbFanjian.eligibleTargetIds);
      const lowCard = ai.hand
        .filter((c) => lbFanjian.eligibleCardIds.includes(c.id))
        .sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai))[0];
      if (enemy && lowCard && cardKeepValue(lowCard, ai) < 72) {
        return {
          type: 'play_action',
          action: {
            type: 'activate_skill',
            skillId: 'lb_fanjian',
            cardIds: [lowCard.id],
            targetIds: [enemy.id]
          }
        };
      }
    }

    // 界大乔国色: once per turn (strip ally Indulgence or put Indulgence on enemy + draw 1)
    const lbGuose = byId('lb_guose');
    if (lbGuose) {
      const lowDiamond = ai.hand
        .filter((c) => lbGuose.eligibleCardIds.includes(c.id) && cardKeepValue(c, ai) < 82)
        .sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai))[0];
      if (lowDiamond) {
        const allyWithInd = lbGuose.eligibleTargetIds
          .map((id) => engine.getPlayer(id))
          .find(
            (p) =>
              evaluateRelation(state, ai, p) > 0 &&
              p.judgeZone.some((c) => (c.asDelayedTrick ?? c.name) === 'indulgence')
          );
        const enemyTarget = pickBestEnemy(
          state,
          ai,
          lbGuose.eligibleTargetIds.filter(
            (id) => !engine.getPlayer(id).judgeZone.some((c) => (c.asDelayedTrick ?? c.name) === 'indulgence')
          ),
          (t) => t.hand.length * 8
        );
        const chosenTarget = allyWithInd ?? enemyTarget;
        if (chosenTarget) {
          return {
            type: 'play_action',
            action: {
              type: 'activate_skill',
              skillId: 'lb_guose',
              cardIds: [lowDiamond.id],
              targetIds: [chosenTarget.id]
            }
          };
        }
      }
    }

    // 界孙尚香结姻: once per turn
    const lbJieyin = byId('lb_jieyin');
    if (lbJieyin) {
      const maleAlly = lbJieyin.eligibleTargetIds
        .map((id) => engine.getPlayer(id))
        .filter((p) => evaluateRelation(state, ai, p) > 0 && p.hp !== ai.hp)
        .sort((a, b) => a.hp - b.hp)[0];
      const lowHand = ai.hand
        .filter((c) => lbJieyin.eligibleCardIds.includes(c.id))
        .sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai))[0];
      if (maleAlly && lowHand && cardKeepValue(lowHand, ai) < 76) {
        return {
          type: 'play_action',
          action: {
            type: 'activate_skill',
            skillId: 'lb_jieyin',
            cardIds: [lowHand.id],
            targetIds: [maleAlly.id]
          }
        };
      }
    }

    // 界华佗除疠: once per turn against enemies of distinct factions
    const lbChuli = byId('lb_chuli');
    if (lbChuli) {
      const seenFactions = new Set<string>();
      const chosenEnemies: string[] = [];
      for (const tid of lbChuli.eligibleTargetIds) {
        const p = engine.getPlayer(tid);
        if (evaluateRelation(state, ai, p) < 0 && !seenFactions.has(p.faction)) {
          seenFactions.add(p.faction);
          chosenEnemies.push(p.id);
        }
      }
      if (chosenEnemies.length >= 1) {
        return {
          type: 'play_action',
          action: { type: 'activate_skill', skillId: 'lb_chuli', targetIds: chosenEnemies }
        };
      }
    }

    // 界华雄势斩: up to 2x per turn when holding >= 2 Slashes & healthy HP
    const lbShizhan = byId('lb_shizhan');
    if (lbShizhan && ai.hp >= 3) {
      const mySlashes = usable.filter((c) => isSlashCardName(c.name)).length;
      const enemy = pickBestEnemy(state, ai, lbShizhan.eligibleTargetIds, (t) => -t.hand.length * 10);
      if (enemy && mySlashes >= 2) {
        return {
          type: 'play_action',
          action: { type: 'activate_skill', skillId: 'lb_shizhan', targetIds: [enemy.id] }
        };
      }
    }

    // 界徐庶荐言 & 界吕蒙攻心: once per turn
    const lbJianyan = byId('lb_jianyan');
    if (lbJianyan) {
      return {
        type: 'play_action',
        action: { type: 'activate_skill', skillId: 'lb_jianyan' }
      };
    }

    const lbGongxin = byId('lb_gongxin');
    if (lbGongxin) {
      const enemy = pickBestEnemy(state, ai, lbGongxin.eligibleTargetIds);
      if (enemy) {
        return {
          type: 'play_action',
          action: { type: 'activate_skill', skillId: 'lb_gongxin', targetIds: [enemy.id] }
        };
      }
    }

    // 界刘备仁德: give 2 low-value cards to ally once per turn for virtual basic card
    const lbRende = byId('lb_rende');
    if (lbRende && !ai.marks['lb_rende_used_basic'] && ai.hand.length >= 2) {
      const ally = lbRende.eligibleTargetIds
        .map((id) => engine.getPlayer(id))
        .filter((p) => evaluateRelation(state, ai, p) > 0)[0];
      if (ally) {
        const sorted = [...ai.hand].sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai));
        return {
          type: 'play_action',
          action: {
            type: 'activate_skill',
            skillId: 'lb_rende',
            cardIds: [sorted[0].id, sorted[1].id],
            targetIds: [ally.id]
          }
        };
      }
    }

    // 界赵云龙胆: Alcohol -> Peach when wounded
    const lbLongdan = byId('lb_longdan');
    if (lbLongdan && ai.hp < ai.maxHp) {
      const alc = usable.find(
        (c) => c.name === 'alcohol' && lbLongdan.eligibleCardIds.includes(c.id)
      );
      if (alc) {
        return {
          type: 'play_action',
          action: { type: 'activate_skill', skillId: 'lb_longdan', cardIds: [alc.id] }
        };
      }
    }

    // 华佗青囊: heal wounded ally or self
    const qingnang = byId('qingnang');
    if (qingnang) {
      const allyTarget = qingnang.eligibleTargetIds
        .map((id) => engine.getPlayer(id))
        .filter((p) => evaluateRelation(state, ai, p) > 0)
        .sort((a, b) => a.hp - b.hp)[0];
      if (allyTarget) {
        const lowCard = [...ai.hand].sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai))[0];
        if (lowCard) {
          return {
            type: 'play_action',
            action: {
              type: 'activate_skill',
              skillId: 'qingnang',
              cardIds: [lowCard.id],
              targetIds: [allyTarget.id]
            }
          };
        }
      }
    }

    // 孙尚香结姻: heal wounded male ally + self when wounded or spare cards
    const jieyin = byId('jieyin');
    if (jieyin && ai.hand.length >= 2) {
      const maleAlly = jieyin.eligibleTargetIds
        .map((id) => engine.getPlayer(id))
        .filter((p) => evaluateRelation(state, ai, p) > 0)
        .sort((a, b) => a.hp - b.hp)[0];
      if (maleAlly && (ai.hp < ai.maxHp || ai.hand.length >= 4)) {
        const sorted = [...ai.hand].sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai));
        return {
          type: 'play_action',
          action: {
            type: 'activate_skill',
            skillId: 'jieyin',
            cardIds: [sorted[0].id, sorted[1].id],
            targetIds: [maleAlly.id]
          }
        };
      }
    }

    // 黄盖苦肉: use when HP >= 3 and hand < 5
    const kurou = byId('kurou');
    if (kurou && ai.hp >= 3 && ai.hand.length < 5) {
      return {
        type: 'play_action',
        action: { type: 'activate_skill', skillId: 'kurou' }
      };
    }

    // 周瑜反间: target best enemy
    const fanjian = byId('fanjian');
    if (fanjian) {
      const enemy = pickBestEnemy(state, ai, fanjian.eligibleTargetIds);
      if (enemy) {
        return {
          type: 'play_action',
          action: { type: 'activate_skill', skillId: 'fanjian', targetIds: [enemy.id] }
        };
      }
    }

    // 貂蝉离间: pit two enemies against each other
    const lijian = byId('lijian');
    if (lijian) {
      const enemies = lijian.eligibleTargetIds
        .map((id) => engine.getPlayer(id))
        .filter((p) => evaluateRelation(state, ai, p) < 0);
      if (enemies.length >= 2) {
        const lowCard = lijian.eligibleCardIds[0];
        return {
          type: 'play_action',
          action: {
            type: 'activate_skill',
            skillId: 'lijian',
            cardIds: [lowCard],
            targetIds: [enemies[0].id, enemies[1].id]
          }
        };
      }
    }

    // 刘备仁德: give 2 low-value cards to ally when wounded & haven't healed yet
    const rende = byId('rende');
    if (rende && !ai.marks['rende_healed'] && ai.hp < ai.maxHp && ai.hand.length >= 2) {
      const ally = rende.eligibleTargetIds
        .map((id) => engine.getPlayer(id))
        .filter((p) => evaluateRelation(state, ai, p) > 0)[0];
      if (ally) {
        const sorted = [...ai.hand].sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai));
        return {
          type: 'play_action',
          action: {
            type: 'activate_skill',
            skillId: 'rende',
            cardIds: [sorted[0].id, sorted[1].id],
            targetIds: [ally.id]
          }
        };
      }
    }

    // 大乔国色: turn a low-value diamond hand card into Indulgence on enemy
    const guose = byId('guose');
    if (guose) {
      const enemy = pickBestEnemy(state, ai, guose.eligibleTargetIds, (t) => t.hand.length * 8);
      const lowDiamond = ai.hand
        .filter((c) => guose.eligibleCardIds.includes(c.id) && cardKeepValue(c, ai) < 75)
        .sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai))[0];
      if (enemy && lowDiamond) {
        return {
          type: 'play_action',
          action: {
            type: 'activate_skill',
            skillId: 'guose',
            cardIds: [lowDiamond.id],
            targetIds: [enemy.id]
          }
        };
      }
    }

    // 甘宁奇袭: turn a low-value black hand card into Dismantle on enemy
    const qixi = byId('qixi');
    if (qixi) {
      const enemy = pickBestEnemy(state, ai, qixi.eligibleTargetIds);
      const lowBlack = ai.hand
        .filter((c) => qixi.eligibleCardIds.includes(c.id) && cardKeepValue(c, ai) < 62)
        .sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai))[0];
      if (enemy && lowBlack) {
        return {
          type: 'play_action',
          action: {
            type: 'activate_skill',
            skillId: 'qixi',
            cardIds: [lowBlack.id],
            targetIds: [enemy.id]
          }
        };
      }
    }

    // ===== Phase 4C Wind/Fire/Forest/Mountain Active Skills (all strictly bounded / loop-free) =====

    // 邓艾急袭: spend 田 as Snatch on enemy
    const jixiDengai = byId('jixi_dengai');
    if (jixiDengai) {
      const enemy = pickBestEnemy(state, ai, jixiDengai.eligibleTargetIds);
      if (enemy) {
        return {
          type: 'play_action',
          action: { type: 'activate_skill', skillId: 'jixi_dengai', targetIds: [enemy.id] }
        };
      }
    }

    // 典韦强袭: up to 2x/turn against distinct enemies
    const qiangxi = byId('qiangxi');
    if (qiangxi) {
      const enemy = pickBestEnemy(state, ai, qiangxi.eligibleTargetIds);
      if (enemy) {
        const spareWeapon = qiangxi.eligibleCardIds.find((id) =>
          ai.hand.some((c) => c.id === id)
        );
        if (spareWeapon !== undefined) {
          return {
            type: 'play_action',
            action: {
              type: 'activate_skill',
              skillId: 'qiangxi',
              cardIds: [spareWeapon],
              targetIds: [enemy.id]
            }
          };
        }
        if (ai.hp >= 3 || enemy.hp <= 1) {
          return {
            type: 'play_action',
            action: {
              type: 'activate_skill',
              skillId: 'qiangxi',
              cardIds: [],
              targetIds: [enemy.id]
            }
          };
        }
      }
    }

    // 荀彧驱虎: once/turn pindian with higher-HP enemy when holding high card
    const quhu = byId('quhu');
    if (quhu && ai.hand.some((c) => c.rank >= 9)) {
      const enemy = pickBestEnemy(state, ai, quhu.eligibleTargetIds);
      if (enemy) {
        return {
          type: 'play_action',
          action: { type: 'activate_skill', skillId: 'quhu', targetIds: [enemy.id] }
        };
      }
    }

    // 太史慈天义: once/turn pindian when holding >=1 Slash and a decent rank card
    const tianyi = byId('tianyi');
    if (
      tianyi &&
      usable.some((c) => isSlashCardName(c.name)) &&
      ai.hand.some((c) => c.rank >= 8)
    ) {
      const enemy = pickBestEnemy(state, ai, tianyi.eligibleTargetIds);
      if (enemy) {
        return {
          type: 'play_action',
          action: { type: 'activate_skill', skillId: 'tianyi', targetIds: [enemy.id] }
        };
      }
    }

    // 姜维挑衅: once/turn on enemy
    const tiaoxin = byId('tiaoxin');
    if (tiaoxin) {
      const enemy = pickBestEnemy(state, ai, tiaoxin.eligibleTargetIds, (t) => -t.hand.length * 10);
      if (enemy) {
        return {
          type: 'play_action',
          action: { type: 'activate_skill', skillId: 'tiaoxin', targetIds: [enemy.id] }
        };
      }
    }

    // 鲁肃缔盟: once/turn swap ally's small hand with enemy's large hand
    const dimeng = byId('dimeng');
    if (dimeng && dimeng.eligibleTargetIds.length >= 2) {
      const allies = dimeng.eligibleTargetIds
        .map((id) => engine.getPlayer(id))
        .filter((p) => evaluateRelation(state, ai, p) > 0)
        .sort((a, b) => a.hand.length - b.hand.length);
      const enemies = dimeng.eligibleTargetIds
        .map((id) => engine.getPlayer(id))
        .filter((p) => evaluateRelation(state, ai, p) < 0)
        .sort((a, b) => b.hand.length - a.hand.length);
      if (allies.length > 0 && enemies.length > 0) {
        const diff = enemies[0].hand.length - allies[0].hand.length;
        const totalCards = ai.hand.length + Object.values(ai.equips).filter(Boolean).length;
        if (diff >= 2 && diff <= totalCards) {
          return {
            type: 'play_action',
            action: {
              type: 'activate_skill',
              skillId: 'dimeng',
              targetIds: [allies[0].id, enemies[0].id]
            }
          };
        }
      }
    }

    // 贾诩乱武 (限定技): fire when >=2 enemies alive or 1v1 enemy has <=1 hand card
    const luanwu = byId('luanwu');
    if (luanwu) {
      const enemies = state.players.filter(
        (p) => p.alive && p.id !== ai.id && evaluateRelation(state, ai, p) < 0
      );
      if (enemies.length >= 2 || (enemies.length === 1 && enemies[0].hand.length <= 1)) {
        return {
          type: 'play_action',
          action: { type: 'activate_skill', skillId: 'luanwu' }
        };
      }
    }

    // 魏延奇谋 (限定技): fire when healthy & holding >=2 Slashes
    const qimou = byId('qimou');
    if (
      qimou &&
      ai.hp >= 3 &&
      usable.filter((c) => isSlashCardName(c.name)).length >= 2
    ) {
      return {
        type: 'play_action',
        action: { type: 'activate_skill', skillId: 'qimou' }
      };
    }

    // 于吉蛊惑 (1/turn): activate when holding >=2 cards
    const guhuo = byId('guhuo');
    if (guhuo && ai.hand.length >= 2) {
      const lowCard = ai.hand
        .filter((c) => guhuo.eligibleCardIds.includes(c.id))
        .sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai))[0];
      if (lowCard) {
        return {
          type: 'play_action',
          action: { type: 'activate_skill', skillId: 'guhuo', cardIds: [lowCard.id] }
        };
      }
    }

    // 张昭&张纮直谏: equip hand gear directly onto ally for +1 draw
    const zhijian = byId('zhijian');
    if (zhijian) {
      const ally = zhijian.eligibleTargetIds
        .map((id) => engine.getPlayer(id))
        .find((p) => evaluateRelation(state, ai, p) > 0);
      if (ally) {
        const gearId = zhijian.eligibleCardIds.find((id) => {
          const c = findCard(id);
          if (!c) return false;
          if (c.subtype === 'weapon') return !ally.equips.weapon;
          if (c.subtype === 'armor') return !ally.equips.armor;
          if (c.subtype === 'horse_plus') return !ally.equips.horsePlus;
          if (c.subtype === 'horse_minus') return !ally.equips.horseMinus;
          if (c.subtype === 'treasure') return !ally.equips.treasure;
          return false;
        });
        if (gearId !== undefined) {
          return {
            type: 'play_action',
            action: {
              type: 'activate_skill',
              skillId: 'zhijian',
              cardIds: [gearId],
              targetIds: [ally.id]
            }
          };
        }
      }
    }

    // 徐晃断粮: convert low-value black basic/equip into Supply Shortage on enemy
    const duanliang = byId('duanliang');
    if (duanliang) {
      const enemy = pickBestEnemy(state, ai, duanliang.eligibleTargetIds, (t) => t.hand.length * 8);
      const lowBlack = ai.hand
        .filter((c) => duanliang.eligibleCardIds.includes(c.id) && cardKeepValue(c, ai) < 62)
        .sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai))[0];
      if (enemy && lowBlack) {
        return {
          type: 'play_action',
          action: {
            type: 'activate_skill',
            skillId: 'duanliang',
            cardIds: [lowBlack.id],
            targetIds: [enemy.id]
          }
        };
      }
    }

    // 卧龙诸葛亮火计: red hand card -> Fire Attack on enemy when holding >=3 hand cards
    const huoji = byId('huoji');
    if (huoji && ai.hand.length >= 3) {
      const enemy = pickBestEnemy(state, ai, huoji.eligibleTargetIds, (t) =>
        t.equips.armor?.name === 'vine_armor' ? 35 : 0
      );
      const lowRed = ai.hand
        .filter((c) => huoji.eligibleCardIds.includes(c.id) && cardKeepValue(c, ai) < 65)
        .sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai))[0];
      if (enemy && lowRed) {
        return {
          type: 'play_action',
          action: {
            type: 'activate_skill',
            skillId: 'huoji',
            cardIds: [lowRed.id],
            targetIds: [enemy.id]
          }
        };
      }
    }

    // 颜良&文丑双雄: different-color card -> Duel on enemy
    const shuangxiong = byId('shuangxiong');
    if (shuangxiong) {
      const mySlashes = usable.filter((c) => isSlashCardName(c.name)).length;
      const enemy = pickBestEnemy(state, ai, shuangxiong.eligibleTargetIds, (t) => -t.hand.length * 8);
      const lowCard = ai.hand
        .filter((c) => shuangxiong.eligibleCardIds.includes(c.id) && cardKeepValue(c, ai) < 65)
        .sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai))[0];
      if (enemy && lowCard && (mySlashes >= 1 || enemy.hand.length === 0)) {
        return {
          type: 'play_action',
          action: {
            type: 'activate_skill',
            skillId: 'shuangxiong',
            cardIds: [lowCard.id],
            targetIds: [enemy.id]
          }
        };
      }
    }

    // 袁绍乱击: 2 same-suit cards -> Archery Attack when hand >= 4 and no endangered ally
    const luanji = byId('luanji');
    if (luanji && ai.hand.length >= 4) {
      const endangeredAlly = state.players.some(
        (p) => p.alive && p.id !== ai.id && evaluateRelation(state, ai, p) > 0 && p.hp <= 1
      );
      if (!endangeredAlly) {
        const eligibleCards = ai.hand
          .filter((c) => luanji.eligibleCardIds.includes(c.id) && cardKeepValue(c, ai) < 75)
          .sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai));
        for (let i = 0; i < eligibleCards.length; i++) {
          const pair = eligibleCards.find(
            (c, j) => j > i && c.suit === eligibleCards[i].suit
          );
          if (pair) {
            return {
              type: 'play_action',
              action: {
                type: 'activate_skill',
                skillId: 'luanji',
                cardIds: [eligibleCards[i].id, pair.id]
              }
            };
          }
        }
      }
    }

    // 董卓酒池: spade hand card -> Alcohol if holding playable Slash
    const jiuchi = byId('jiuchi');
    if (jiuchi && playable.some((p) => {
      const c = findCard(p.cardId);
      return Boolean(c && isSlashCardName(c.name));
    })) {
      const lowSpade = ai.hand
        .filter((c) => jiuchi.eligibleCardIds.includes(c.id) && cardKeepValue(c, ai) < 62)
        .sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai))[0];
      if (lowSpade) {
        return {
          type: 'play_action',
          action: { type: 'activate_skill', skillId: 'jiuchi', cardIds: [lowSpade.id] }
        };
      }
    }

    // 黄天给牌 (主公技): give Dodge/Lightning to allied Zhang Jiao
    const huangtianGive = byId('huangtian_give');
    if (huangtianGive && ai.hand.length >= 2) {
      const allyLord = huangtianGive.eligibleTargetIds
        .map((id) => engine.getPlayer(id))
        .find((p) => evaluateRelation(state, ai, p) > 0);
      if (allyLord && huangtianGive.eligibleCardIds.length > 0) {
        return {
          type: 'play_action',
          action: {
            type: 'activate_skill',
            skillId: 'huangtian_give',
            cardIds: [huangtianGive.eligibleCardIds[0]],
            targetIds: [allyLord.id]
          }
        };
      }
    }
  }

  // 1. Heal self with Peach immediately when wounded
  const peachInfo = playable.find((p) => findCard(p.cardId)?.name === 'peach');
  if (peachInfo) {
    return { type: 'play_action', action: { type: 'play_card', cardId: peachInfo.cardId } };
  }

  // 2. Ex Nihilo (always draw 2!)
  const exInfo = playable.find((p) => findCard(p.cardId)?.name === 'ex_nihilo');
  if (exInfo) {
    return { type: 'play_action', action: { type: 'play_card', cardId: exInfo.cardId } };
  }

  // 3. Equip upgrades (weapons, armors, horses, wooden ox) — never swap in a loop!
  for (const info of playable) {
    const card = findCard(info.cardId);
    if (!card || card.category !== 'equip') continue;
    if (card.subtype === 'weapon') {
      if (weaponScore(card, ai) > weaponScore(ai.equips.weapon, ai) + 5) {
        return { type: 'play_action', action: { type: 'play_card', cardId: card.id } };
      }
    } else if (card.subtype === 'armor') {
      // Smart Silver Lion heal trick: if wearing Silver Lion and wounded, equip another armor to heal +1!
      const silverHeal = ai.equips.armor?.name === 'silver_lion' && ai.hp < ai.maxHp;
      if (silverHeal || armorScore(card) > armorScore(ai.equips.armor) + 5) {
        return { type: 'play_action', action: { type: 'play_card', cardId: card.id } };
      }
    } else if (card.subtype === 'horse_plus' && !ai.equips.horsePlus) {
      return { type: 'play_action', action: { type: 'play_card', cardId: card.id } };
    } else if (card.subtype === 'horse_minus' && !ai.equips.horseMinus) {
      return { type: 'play_action', action: { type: 'play_card', cardId: card.id } };
    } else if (card.subtype === 'treasure' && !ai.equips.treasure) {
      return { type: 'play_action', action: { type: 'play_card', cardId: card.id } };
    }
  }

  // 4. Peach Garden if net ally healing >= enemy healing
  const gardenInfo = playable.find((p) => findCard(p.cardId)?.name === 'peach_garden');
  if (gardenInfo) {
    let net = 0;
    for (const p of state.players) {
      if (!p.alive || p.hp >= p.maxHp) continue;
      net += evaluateRelation(state, ai, p) > 0 ? 1 : -1;
    }
    if (net > 0 || (ai.hp <= 2 && net >= 0)) {
      return { type: 'play_action', action: { type: 'play_card', cardId: gardenInfo.cardId } };
    }
  }

  // 5. Harvest
  const harvestInfo = playable.find((p) => findCard(p.cardId)?.name === 'harvest');
  if (harvestInfo) {
    return { type: 'play_action', action: { type: 'play_card', cardId: harvestInfo.cardId } };
  }

  // 6. Indulgence & Supply Shortage on highest-threat enemy
  for (const trickName of ['indulgence', 'supply_shortage'] as const) {
    const info = playable.find((p) => findCard(p.cardId)?.name === trickName);
    if (info) {
      const target = pickBestEnemy(state, ai, info.eligibleTargetIds, (t) => t.hand.length * 10);
      if (target) {
        return {
          type: 'play_action',
          action: { type: 'play_card', cardId: info.cardId, targetIds: [target.id] }
        };
      }
    }
  }

  // 7. Snatch & Dismantle (remove ally delayed tricks OR strip enemy cards!)
  for (const trickName of ['snatch', 'dismantle'] as const) {
    const info = playable.find((p) => findCard(p.cardId)?.name === trickName);
    if (!info) continue;
    // Check if an ally has Indulgence or Supply Shortage in judgeZone
    const allyWithBadJudge = info.eligibleTargetIds
      .map((id) => engine.getPlayer(id))
      .find(
        (t) =>
          evaluateRelation(state, ai, t) > 0 &&
          t.judgeZone.some((j) => j.name === 'indulgence' || j.name === 'supply_shortage')
      );
    if (allyWithBadJudge) {
      return {
        type: 'play_action',
        action: { type: 'play_card', cardId: info.cardId, targetIds: [allyWithBadJudge.id] }
      };
    }
    const enemy = pickBestEnemy(state, ai, info.eligibleTargetIds, (t) =>
      (t.equips.armor ? 15 : 0) + (t.equips.weapon ? 10 : 0)
    );
    if (enemy) {
      return {
        type: 'play_action',
        action: { type: 'play_card', cardId: info.cardId, targetIds: [enemy.id] }
      };
    }
  }

  // 8. Collateral (借刀杀人) on armed enemy targeting another enemy (or self if stealing weapon is safe)
  const colInfo = playable.find((p) => findCard(p.cardId)?.name === 'collateral');
  if (colInfo && colInfo.secondaryTargetsByPrimary) {
    const enemyHolder = pickBestEnemy(state, ai, colInfo.eligibleTargetIds);
    if (enemyHolder) {
      const secs = colInfo.secondaryTargetsByPrimary[enemyHolder.id] ?? [];
      const secEnemy = pickBestEnemy(state, ai, secs) ?? (secs.includes(ai.id) ? ai : null);
      if (secEnemy) {
        return {
          type: 'play_action',
          action: {
            type: 'play_card',
            cardId: colInfo.cardId,
            targetIds: [enemyHolder.id],
            secondaryTargetId: secEnemy.id
          }
        };
      }
    }
  }

  // 9. Iron Chain: chain 2 unchained eligible enemies if holding elemental attack, else recast for card cycling!
  const chainInfo = playable.find((p) => findCard(p.cardId)?.name === 'iron_chain');
  if (chainInfo) {
    const hasElemental = usable.some(
      (c) =>
        c.name === 'fire_slash' ||
        c.name === 'thunder_slash' ||
        c.name === 'fire_attack' ||
        (c.name === 'slash' && ai.equips.weapon?.name === 'fan')
    );
    const unchainedEnemies = state.players.filter(
      (p) =>
        p.alive &&
        !p.chained &&
        chainInfo.eligibleTargetIds.includes(p.id) &&
        evaluateRelation(state, ai, p) < 0
    );
    if (hasElemental && unchainedEnemies.length >= 2 && chainInfo.maxTargets >= 2) {
      return {
        type: 'play_action',
        action: {
          type: 'play_card',
          cardId: chainInfo.cardId,
          targetIds: [unchainedEnemies[0].id, unchainedEnemies[1].id]
        }
      };
    }
    // Recast Iron Chain cleanly to cycle 1 fresh card (never causes toggle loops!)
    return {
      type: 'play_action',
      action: { type: 'play_card', cardId: chainInfo.cardId, recast: true }
    };
  }

  // 10. AoE Tricks (Savage Assault / Archery Attack) when allies aren't endangered
  for (const aoeName of ['savage_assault', 'archery_attack'] as const) {
    const info = playable.find((p) => findCard(p.cardId)?.name === aoeName);
    if (!info) continue;
    let enemyCount = 0;
    let endangeredAlly = false;
    for (const p of state.players) {
      if (!p.alive || p.id === ai.id) continue;
      const rel = evaluateRelation(state, ai, p);
      if (rel < 0) enemyCount += 1;
      else if (rel > 0 && p.hp <= 1) endangeredAlly = true;
    }
    if (enemyCount > 0 && !endangeredAlly) {
      return { type: 'play_action', action: { type: 'play_card', cardId: info.cardId } };
    }
  }

  // 11. Fire Attack on enemy when AI has at least 2 hand cards (excluding the fire attack)
  const fireAtkInfo = playable.find((p) => findCard(p.cardId)?.name === 'fire_attack');
  if (fireAtkInfo && ai.hand.length >= 2) {
    const enemy = pickBestEnemy(state, ai, fireAtkInfo.eligibleTargetIds, (t) =>
      t.equips.armor?.name === 'vine_armor' ? 35 : 0
    );
    if (enemy) {
      return {
        type: 'play_action',
        action: { type: 'play_card', cardId: fireAtkInfo.cardId, targetIds: [enemy.id] }
      };
    }
  }

  // 12. Duel on lowest-hand enemy when AI has >= 1 Slash or enemy has 0 cards
  const duelInfo = playable.find((p) => findCard(p.cardId)?.name === 'duel');
  if (duelInfo) {
    const mySlashes = usable.filter((c) => isSlashCardName(c.name)).length;
    const enemy = pickBestEnemy(state, ai, duelInfo.eligibleTargetIds, (t) =>
      t.hand.length === 0 ? 40 : -t.hand.length * 8
    );
    if (enemy && (mySlashes >= 1 || enemy.hand.length === 0)) {
      return {
        type: 'play_action',
        action: { type: 'play_card', cardId: duelInfo.cardId, targetIds: [enemy.id] }
      };
    }
  }

  // 13. Alcohol + Slash combo!
  const slashInfos = playable.filter((p) => {
    const c = findCard(p.cardId);
    return Boolean(c && isSlashCardName(c.name));
  });

  if (slashInfos.length > 0) {
    // Score best (slashCard, target) pair
    let bestCombo: { card: CardInstance; targets: string[]; score: number; asFire?: boolean } | null =
      null;

    for (const sInfo of slashInfos) {
      const card = findCard(sInfo.cardId)!;
      const color = getCardColor(card.suit);
      const hasQinggang = ai.equips.weapon?.name === 'qinggang_sword';

      const validEnemies: { p: PlayerState; score: number; asFire: boolean }[] = [];
      for (const tid of sInfo.eligibleTargetIds) {
        const t = engine.getPlayer(tid);
        if (evaluateRelation(state, ai, t) >= 0) continue;

        let asFire = false;
        let elem = card.element ?? 'normal';
        if (sInfo.canConvertToFireSlash && (t.equips.armor?.name === 'vine_armor' || t.chained)) {
          asFire = true;
          elem = 'fire';
        }
        // Skip targets completely immune via armor
        if (!hasQinggang && t.equips.armor?.name === 'renwang_shield' && color === 'black') {
          continue;
        }
        if (!hasQinggang && t.equips.armor?.name === 'vine_armor' && elem === 'normal') {
          continue;
        }

        let sc = -evaluateRelation(state, ai, t) + (6 - t.hp) * 20 - t.hand.length * 6;
        if (elem === 'fire' && t.equips.armor?.name === 'vine_armor') sc += 45;
        if (ai.equips.weapon?.name === 'guding_blade' && t.hand.length === 0) sc += 40;
        if (elem !== 'normal' && t.chained) sc += 30;
        validEnemies.push({ p: t, score: sc, asFire });
      }

      validEnemies.sort((a, b) => b.score - a.score);
      if (validEnemies.length > 0) {
        const chosen = validEnemies.slice(0, sInfo.maxTargets);
        const totalScore = chosen.reduce((s, x) => s + x.score, 0);
        if (!bestCombo || totalScore > bestCombo.score) {
          bestCombo = {
            card,
            targets: chosen.map((x) => x.p.id),
            score: totalScore,
            asFire: chosen[0].asFire
          };
        }
      }
    }

    if (bestCombo) {
      // Drink Alcohol BEFORE playing Slash if we have it!
      const alcInfo = playable.find((p) => findCard(p.cardId)?.name === 'alcohol');
      if (alcInfo && !ai.drunk) {
        return { type: 'play_action', action: { type: 'play_card', cardId: alcInfo.cardId } };
      }
      return {
        type: 'play_action',
        action: {
          type: 'play_card',
          cardId: bestCombo.card.id,
          targetIds: bestCombo.targets,
          asFireSlash: bestCombo.asFire
        }
      };
    }
  }

  // 14. Serpent Spear in Play phase if over hand limit or enemy is at 1 HP
  const prompt = state.pendingPrompt;
  if (prompt?.type === 'play_action' && prompt.canUseSerpentSpear) {
    const rawTargets = state.players
      .filter(
        (p) =>
          p.alive &&
          p.id !== ai.id &&
          isInAttackRange(state, ai.id, p.id, engine.modifiers) &&
          engine.modifiers.canBeTargetedByCard(state, ai, p, 'slash')
      )
      .map((p) => p.id);
    const legalTargets = engine.modifiers.filterSlashTargets(state, ai, rawTargets);
    const enemyInRange = pickBestEnemy(state, ai, legalTargets);
    const limit = getHandLimit(state, ai, engine.modifiers);
    if (enemyInRange && (ai.hand.length > limit || enemyInRange.hp <= 1) && usable.length >= 2) {
      const sorted = [...usable].sort((a, b) => cardKeepValue(a, ai) - cardKeepValue(b, ai));
      return {
        type: 'play_action',
        action: {
          type: 'serpent_spear',
          cardIds: [sorted[0].id, sorted[1].id],
          targetIds: [enemyInRange.id]
        }
      };
    }
  }

  // 15. Wooden Ox stash if over hand limit (saves a high-value card from Discard phase!)
  if (prompt?.type === 'play_action' && prompt.canUseWoodenOx) {
    const limit = getHandLimit(state, ai, engine.modifiers);
    if (ai.hand.length > limit && ai.hand.length > 0) {
      const bestKeep = [...ai.hand].sort((a, b) => cardKeepValue(b, ai) - cardKeepValue(a, ai))[0];
      return {
        type: 'play_action',
        action: { type: 'wooden_ox_stash', cardId: bestKeep.id }
      };
    }
  }

  // 16. End Play Phase cleanly
  return { type: 'play_action', action: { type: 'end_play_phase' } };
}

/**
 * Runs an entire game to completion using Rule AI for every prompt.
 * Ideal for automated regression tests and Phase 6 500-game stress testing!
 */
export function runAutoGame(engine: GameEngine, maxSteps = 8000): GameState {
  let prompt = engine.start();
  let steps = 0;
  while (prompt && !engine.state.result) {
    steps += 1;
    if (steps > maxSteps) {
      throw new Error(
        `Auto-game exceeded ${maxSteps} steps (possible deadlock at turn ${engine.state.turn}, phase ${engine.state.phase}, prompt ${prompt.type})`
      );
    }
    const resp = decideAIAction(engine, prompt.playerId);
    prompt = engine.submit(resp);
  }
  return engine.state;
}
