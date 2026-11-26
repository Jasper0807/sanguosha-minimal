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
      // Pick highest maxHp candidate deterministically
      const sorted = [...prompt.candidates].sort((a, b) => b.maxHp - a.maxHp);
      return { type: 'choose_general', generalId: sorted[0].id };
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
          return { type: 'choose_option', optionId: 'yes' };
        case 'double_swords':
        case 'kylin_bow':
          return { type: 'choose_option', optionId: 'yes' };
        case 'double_swords_choice':
          return {
            type: 'choose_option',
            optionId: ai.hand.length >= 3 ? 'discard' : 'let_draw'
          };
        case 'ice_sword':
          // Use Ice Sword to strip cards rather than dealing 1 damage unless enemy is 1 HP
          return { type: 'choose_option', optionId: 'no' };
        case 'fan':
          return { type: 'choose_option', optionId: 'yes' };
        default:
          return { type: 'choose_option', optionId: prompt.options[0].id };
      }
    }

    case 'choose_target': {
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

  // 9. Iron Chain: chain 2 unchained enemies if holding elemental attack, else recast for card cycling!
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
      (p) => p.alive && !p.chained && evaluateRelation(state, ai, p) < 0
    );
    if (hasElemental && unchainedEnemies.length >= 2) {
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
    const enemyInRange = pickBestEnemy(
      state,
      ai,
      state.players
        .filter((p) => p.alive && p.id !== ai.id && isInAttackRange(state, ai.id, p.id, engine.modifiers))
        .map((p) => p.id)
    );
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
