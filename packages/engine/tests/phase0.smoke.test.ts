import { describe, expect, it } from 'vitest';
import {
  buildClientView,
  getAttackRange,
  getDistance,
  isInAttackRange,
  ModifierRegistry,
  SeededRng,
  TriggerRegistry,
  type CardInstance,
  type GameState,
  type PlayerState
} from '../src/index.js';

function makeMockCard(id: number, overrides: Partial<CardInstance> = {}): CardInstance {
  return {
    id,
    name: 'slash',
    displayName: '杀',
    suit: 'spade',
    rank: 7,
    category: 'basic',
    subtype: 'basic',
    pack: 'standard',
    shortTag: '基本牌',
    description: '对攻击范围内的一名角色造成1点伤害。',
    ...overrides
  };
}

function makePlayer(id: string, seat: number, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    seat,
    name: id,
    isAI: false,
    role: 'duelist',
    roleRevealed: true,
    generalId: 'blank_male',
    generalName: '白板武将',
    generalTitle: '标准测试',
    faction: 'shu',
    gender: 'male',
    hp: 4,
    maxHp: 4,
    alive: true,
    chained: false,
    flipped: false,
    drunk: false,
    drunkUsedThisTurn: 0,
    slashUsedThisTurn: 0,
    hand: [],
    equips: {
      weapon: null,
      armor: null,
      horsePlus: null,
      horseMinus: null,
      treasure: null
    },
    judgeZone: [],
    woodenOxCards: [],
    woodenOxUsedThisTurn: false,
    removedCards: {},
    skills: [],
    disabledSkills: [],
    marks: {},
    stats: { damageDealt: 0, damageTaken: 0, kills: 0, cardsPlayed: 0 },
    ...overrides
  };
}

function makeState(players: PlayerState[], mode: '1v1' | '2v2' | 'identity5' = '2v2'): GameState {
  return {
    config: {
      mode,
      deckVariant: 'standard_ex',
      seed: 42,
      seats: players.map((p) => ({ id: p.id, name: p.name, isAI: p.isAI }))
    },
    turn: 1,
    round: 1,
    activePlayerIndex: 0,
    phase: 'play',
    skippedPhases: [],
    players,
    drawPile: [],
    discardPile: [],
    tableCards: [],
    harvestPool: [],
    events: [],
    nextEventId: 1,
    nextPromptId: 1,
    pendingPrompt: null,
    result: null,
    nullificationSkipByPlayer: {},
    emptyDeckTurnCounter: 0,
    turnSuitsDiscarded: [],
    turnDamageDealtByPlayer: {},
    extraTurnQueue: [],
    actionLog: []
  };
}

describe('Phase 0 core primitives', () => {
  it('SeededRng is 100% deterministic for identical seeds', () => {
    const rngA = new SeededRng(12345);
    const rngB = new SeededRng(12345);
    const seqA = rngA.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const seqB = rngB.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(seqA).toEqual(seqB);
  });

  it('calculates circular seat distance, horses, weapons, and modifiers', () => {
    const p1 = makePlayer('p1', 0);
    const p2 = makePlayer('p2', 1);
    const p3 = makePlayer('p3', 2);
    const p4 = makePlayer('p4', 3);
    const state = makeState([p1, p2, p3, p4], '2v2');

    expect(getDistance(state, 'p1', 'p1')).toBe(0);
    expect(getDistance(state, 'p1', 'p2')).toBe(1);
    expect(getDistance(state, 'p1', 'p3')).toBe(2);
    expect(getDistance(state, 'p1', 'p4')).toBe(1);
    expect(isInAttackRange(state, 'p1', 'p3')).toBe(false);

    // Equip +1 defense horse on p2 -> p1 to p2 becomes 2
    p2.equips.horsePlus = makeMockCard(1, {
      name: 'jueying',
      subtype: 'horse_plus',
      category: 'equip'
    });
    expect(getDistance(state, 'p1', 'p2')).toBe(2);

    // Equip -1 offense horse on p1 -> p1 to p2 returns to 1, p1 to p3 becomes 1
    p1.equips.horseMinus = makeMockCard(2, {
      name: 'chitu',
      subtype: 'horse_minus',
      category: 'equip'
    });
    expect(getDistance(state, 'p1', 'p2')).toBe(1);
    expect(getDistance(state, 'p1', 'p3')).toBe(1);

    // Equip Kylin Bow (range 5) on p1 + modifier
    p1.equips.weapon = makeMockCard(3, {
      name: 'kylin_bow',
      subtype: 'weapon',
      category: 'equip',
      attackRange: 5
    });
    const modifiers = new ModifierRegistry();
    modifiers.register({ id: 'test_range', attackRangeDelta: () => 1 });
    expect(getAttackRange(state, p1, modifiers)).toBe(6);

    // Dead seats collapse distance
    p2.alive = false;
    p1.equips.horseMinus = null;
    expect(getDistance(state, 'p1', 'p3')).toBe(1);
  });

  it('TriggerRegistry orders handlers by descending priority', () => {
    const reg = new TriggerRegistry();
    reg.register({
      id: 'low',
      timing: 'DamageTaken',
      priority: 10,
      *execute() {
        /* noop */
      }
    });
    reg.register({
      id: 'high',
      timing: 'DamageTaken',
      priority: 50,
      *execute() {
        /* noop */
      }
    });
    expect(reg.getHandlers('DamageTaken').map((h) => h.id)).toEqual(['high', 'low']);
  });

  it('buildClientView reveals teammate hand in 2v2 and hides enemy hand/hidden roles', () => {
    const p1 = makePlayer('p1', 0, {
      team: 'A',
      role: 'team_a',
      hand: [makeMockCard(1)]
    });
    const p2 = makePlayer('p2', 1, {
      team: 'B',
      role: 'team_b',
      hand: [makeMockCard(2)]
    });
    const p3 = makePlayer('p3', 2, {
      team: 'B',
      role: 'team_b',
      hand: [makeMockCard(3)]
    });
    const p4 = makePlayer('p4', 3, {
      team: 'A',
      role: 'team_a',
      hand: [makeMockCard(4)]
    });
    const state = makeState([p1, p2, p3, p4], '2v2');

    const view = buildClientView(state, 'p1');
    expect(view.players[0].hand?.length).toBe(1);
    expect(view.players[1].hand).toBeNull();
    expect(view.players[2].hand).toBeNull();
    expect(view.players[3].hand?.length).toBe(1); // Teammate hand visible in 2v2!
  });
});
