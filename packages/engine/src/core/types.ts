export type Suit = 'spade' | 'heart' | 'club' | 'diamond';
export type CardColor = 'red' | 'black' | 'none';
export type CardRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export type CardCategory = 'basic' | 'trick' | 'equip';
export type CardSubtype =
  | 'basic'
  | 'normal_trick'
  | 'delayed_trick'
  | 'weapon'
  | 'armor'
  | 'horse_plus'
  | 'horse_minus'
  | 'treasure';

export type DamageElement = 'normal' | 'fire' | 'thunder';
export type CardPack = 'standard' | 'ex' | 'junzheng' | 'limit_break';

export type CardName =
  // Basic (6)
  | 'slash'
  | 'fire_slash'
  | 'thunder_slash'
  | 'dodge'
  | 'peach'
  | 'alcohol'
  // Normal tricks (12)
  | 'dismantle'
  | 'snatch'
  | 'ex_nihilo'
  | 'duel'
  | 'savage_assault'
  | 'archery_attack'
  | 'peach_garden'
  | 'harvest'
  | 'collateral'
  | 'nullification'
  | 'iron_chain'
  | 'fire_attack'
  // Delayed tricks (3)
  | 'indulgence'
  | 'lightning'
  | 'supply_shortage'
  // Weapons (11)
  | 'zhuge_crossbow'
  | 'double_swords'
  | 'qinggang_sword'
  | 'blade'
  | 'serpent_spear'
  | 'axe'
  | 'halberd'
  | 'kylin_bow'
  | 'ice_sword'
  | 'guding_blade'
  | 'fan'
  // Armor (4)
  | 'eight_trigrams'
  | 'renwang_shield'
  | 'vine_armor'
  | 'silver_lion'
  // +1 Horses (4)
  | 'jueying'
  | 'dilu'
  | 'zhuahuang'
  | 'hualiu'
  // -1 Horses (3)
  | 'chitu'
  | 'dayuan'
  | 'zixing'
  // Treasure (1)
  | 'wooden_ox';

export interface CardSpec {
  name: CardName;
  displayName: string;
  category: CardCategory;
  subtype: CardSubtype;
  element?: DamageElement;
  attackRange?: number;
  shortTag: string;
  description: string;
}

export interface CardInstance extends CardSpec {
  id: number;
  suit: Suit;
  rank: CardRank;
  pack: CardPack;
  /** Temporary delayed-trick identity while sitting in a player's judgeZone (e.g. Da Qiao's Guose) */
  asDelayedTrick?: 'indulgence' | 'supply_shortage' | 'lightning';
  /** If equal to state.turn, this card does not count against hand limit (e.g. LB Zhen Ji Luoshen) */
  exemptFromHandLimitTurn?: number;
}

export interface VirtualCard {
  name: CardName;
  displayName: string;
  suit: Suit | 'none';
  rank: CardRank | 0;
  color: CardColor;
  element: DamageElement;
  subcards: CardInstance[];
  sourceSkill?: string;
}

export type Faction = 'wei' | 'shu' | 'wu' | 'qun';
export type Gender = 'male' | 'female';
export type GeneralPack =
  | 'blank'
  | 'standard'
  | 'limit_break'
  | 'feng'
  | 'huo'
  | 'lin'
  | 'shan';

export type GeneralPackSelection =
  | 'standard'
  | 'limit_break'
  | 'expansion'
  | 'all'
  | 'blank';

export interface PindianResult {
  initiatorId: string;
  targetId: string;
  initiatorCard: CardInstance;
  targetCard: CardInstance;
  winner: 'initiator' | 'target' | 'tie';
}

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  type: 'active' | 'trigger' | 'compulsory' | 'limited' | 'awakening' | 'lord';
}

export interface GeneralDefinition {
  id: string;
  name: string;
  title: string;
  faction: Faction;
  gender: Gender;
  maxHp: number;
  pack: GeneralPack;
  baseGeneralId?: string;
  isLordCandidate?: boolean;
  skills: SkillMeta[];
}

export type GameMode = '1v1' | '2v2' | 'identity5';
export type Role =
  | 'lord'
  | 'loyalist'
  | 'rebel'
  | 'renegade'
  | 'duelist'
  | 'team_a'
  | 'team_b';

export type TurnPhase =
  | 'prepare'
  | 'judge'
  | 'draw'
  | 'play'
  | 'discard'
  | 'finish';

export type EquipSlot =
  | 'weapon'
  | 'armor'
  | 'horsePlus'
  | 'horseMinus'
  | 'treasure';

export interface EquipmentSlots {
  weapon: CardInstance | null;
  armor: CardInstance | null;
  horsePlus: CardInstance | null;
  horseMinus: CardInstance | null;
  treasure: CardInstance | null;
}

export interface PlayerStats {
  damageDealt: number;
  damageTaken: number;
  kills: number;
  cardsPlayed: number;
}

export interface PlayerState {
  id: string;
  seat: number;
  name: string;
  isAI: boolean;
  role: Role;
  roleRevealed: boolean;
  team?: 'A' | 'B';
  generalId: string;
  generalName: string;
  generalTitle: string;
  faction: Faction;
  gender: Gender;
  hp: number;
  maxHp: number;
  alive: boolean;
  chained: boolean;
  flipped: boolean;
  drunk: boolean;
  drunkUsedThisTurn: number;
  slashUsedThisTurn: number;
  hand: CardInstance[];
  equips: EquipmentSlots;
  judgeZone: CardInstance[];
  woodenOxCards: CardInstance[];
  woodenOxUsedThisTurn: boolean;
  /** Out-of-game card piles owned by player (e.g. LB Lu Xun Qianxun, Deng Ai Tian, Zhou Tai Chuang) */
  removedCards: Record<string, CardInstance[]>;
  skills: string[];
  disabledSkills: string[];
  /** Sealed non-compulsory skills until current turn ends (LB Ma Chao Tieqi, LB Guan Yu Yijue) */
  nonCompulsoryDisabledThisTurn?: boolean;
  /** Cannot use or play hand cards until current turn ends (LB Guan Yu Yijue black card) */
  cannotPlayHandCardsThisTurn?: boolean;
  /** Cannot use Slash for the rest of this turn (Taishi Ci Tianyi lose) */
  cannotUseSlashThisTurn?: boolean;
  /** Grants an extra turn after current turn finishes (LB Lu Meng Botu) */
  extraTurnPending?: boolean;
  /** Zuo Ci Huashen pool of unused general IDs */
  huashenPool?: string[];
  activeHuashenGeneralId?: string;
  activeHuashenSkillId?: string;
  marks: Record<string, number>;
  stats: PlayerStats;
}

export interface SeatConfig {
  id?: string;
  name: string;
  isAI: boolean;
  preferredRole?: Role;
  generalId?: string;
}

export type DeckVariant = 'standard_ex' | 'junzheng_161';

export interface GameConfig {
  mode: GameMode;
  deckVariant: DeckVariant;
  seed: number;
  seats: SeatConfig[];
  generalPack?: GeneralPackSelection;
  skipGeneralSelection?: boolean;
  debug?: {
    revealAllHands?: boolean;
    freeGeneralPick?: boolean;
  };
}

export interface GameEvent {
  id: number;
  turn: number;
  phase: TurnPhase | 'setup' | 'gameover';
  type: string;
  actorId?: string;
  targetIds?: string[];
  cardIds?: number[];
  message: string;
}

export interface GameResult {
  winnerTeam: string;
  winnerPlayerIds: string[];
  reason: string;
  totalTurns: number;
}

export interface TableCardDisplay {
  card: CardInstance;
  actorId?: string;
  label?: string;
}

export interface HarvestPoolItem {
  card: CardInstance;
  takenBy: string | null;
}

export interface ActiveSkillPromptInfo {
  skillId: string;
  name: string;
  description: string;
  cardMin: number;
  cardMax: number;
  eligibleCardIds: number[];
  targetMin: number;
  targetMax: number;
  eligibleTargetIds: string[];
  needsConfirmOnly?: boolean;
}

export interface PlayPhasePrompt {
  type: 'play_action';
  promptId: string;
  playerId: string;
  message: string;
  playableCardIds: number[];
  canRecastCardIds: number[];
  canUseSerpentSpear: boolean;
  canUseWoodenOx: boolean;
  usableSkillIds: string[];
  usableSkills: ActiveSkillPromptInfo[];
}

export interface ChooseCardPrompt {
  type: 'choose_card';
  promptId: string;
  playerId: string;
  reason:
    | 'dodge'
    | 'slash_duel'
    | 'slash_savage'
    | 'slash_collateral'
    | 'slash_blade'
    | 'peach_dying'
    | 'nullification'
    | 'discard_phase'
    | 'discard_axe'
    | 'discard_double_swords'
    | 'fire_attack_show'
    | 'fire_attack_discard'
    | 'serpent_spear'
    | 'wooden_ox_stash'
    | 'pindian'
    | 'general_skill';
  message: string;
  minCount: number;
  maxCount: number;
  eligibleCardIds: number[];
  optional: boolean;
  canUseSerpentSpear?: boolean;
  trickKeyForQuickSkip?: string;
}

export interface ChooseTargetPrompt {
  type: 'choose_target';
  promptId: string;
  playerId: string;
  reason: string;
  message: string;
  minCount: number;
  maxCount: number;
  eligibleTargetIds: string[];
  optional: boolean;
}

export interface PromptOption {
  id: string;
  label: string;
  description?: string;
}

export interface ChooseOptionPrompt {
  type: 'choose_option';
  promptId: string;
  playerId: string;
  reason: string;
  message: string;
  options: PromptOption[];
  optional?: boolean;
}

export interface PlayerCardChoice {
  zone: 'hand' | EquipSlot | 'judge';
  cardId?: number;
  handIndex?: number;
  label: string;
}

export interface ChoosePlayerCardPrompt {
  type: 'choose_player_card';
  promptId: string;
  playerId: string;
  targetId: string;
  reason: 'dismantle' | 'snatch' | 'ice_sword' | 'kylin_bow' | 'move_field_card';
  message: string;
  choices: PlayerCardChoice[];
}

export interface ChooseHarvestCardPrompt {
  type: 'choose_harvest_card';
  promptId: string;
  playerId: string;
  message: string;
  pool: HarvestPoolItem[];
}

export interface ChooseGeneralPrompt {
  type: 'choose_general';
  promptId: string;
  playerId: string;
  message: string;
  candidates: GeneralDefinition[];
}

export interface ChooseGuanxingPrompt {
  type: 'choose_guanxing';
  promptId: string;
  playerId: string;
  message: string;
  cards: CardInstance[];
}

export type PromptRequest =
  | PlayPhasePrompt
  | ChooseCardPrompt
  | ChooseTargetPrompt
  | ChooseOptionPrompt
  | ChoosePlayerCardPrompt
  | ChooseHarvestCardPrompt
  | ChooseGeneralPrompt
  | ChooseGuanxingPrompt;

export interface PlayCardAction {
  type: 'play_card';
  cardId: number;
  targetIds?: string[];
  secondaryTargetId?: string;
  asFireSlash?: boolean;
  recast?: boolean;
}

export interface SerpentSpearAction {
  type: 'serpent_spear';
  cardIds: [number, number];
  targetIds: string[];
  asFireSlash?: boolean;
}

export interface WoodenOxStashAction {
  type: 'wooden_ox_stash';
  cardId: number;
  transferTargetId?: string;
}

export interface ActivateSkillAction {
  type: 'activate_skill';
  skillId: string;
  cardIds?: number[];
  targetIds?: string[];
}

export interface EndPlayPhaseAction {
  type: 'end_play_phase';
}

export type PlayPhaseResponse =
  | PlayCardAction
  | SerpentSpearAction
  | WoodenOxStashAction
  | ActivateSkillAction
  | EndPlayPhaseAction;

export type PlayerResponse =
  | { type: 'play_action'; action: PlayPhaseResponse }
  | {
      type: 'choose_card';
      cardIds: number[];
      cancelled?: boolean;
      useSerpentSpear?: boolean;
      skipSimilarTrickThisTurn?: boolean;
    }
  | { type: 'choose_target'; targetIds: string[]; cancelled?: boolean }
  | { type: 'choose_option'; optionId: string }
  | { type: 'choose_player_card'; choiceIndex: number }
  | { type: 'choose_harvest_card'; cardId: number }
  | { type: 'choose_general'; generalId: string }
  | { type: 'choose_guanxing'; topCardIds: number[]; bottomCardIds: number[] };

export interface RecordedAction {
  promptId: string;
  playerId: string;
  response: PlayerResponse;
}

export interface DamageContext {
  sourceId: string | null;
  targetId: string;
  amount: number;
  element: DamageElement;
  card?: CardInstance | VirtualCard;
  isChainDamage: boolean;
  prevented: boolean;
  armorIgnored: boolean;
  wasChainedBeforeDeduct: boolean;
  actualDeducted: number;
}

export interface JudgeContext {
  playerId: string;
  reason: string;
  card: CardInstance;
}

export interface GameState {
  config: GameConfig;
  turn: number;
  round: number;
  activePlayerIndex: number;
  phase: TurnPhase | 'setup' | 'gameover';
  skippedPhases: TurnPhase[];
  players: PlayerState[];
  drawPile: CardInstance[];
  discardPile: CardInstance[];
  tableCards: TableCardDisplay[];
  harvestPool: HarvestPoolItem[];
  events: GameEvent[];
  nextEventId: number;
  nextPromptId: number;
  pendingPrompt: PromptRequest | null;
  result: GameResult | null;
  /** Per-player set of trick keys auto-skipped for Nullification in the current turn */
  nullificationSkipByPlayer: Record<string, string[]>;
  /** Consecutive draw-exhaustion counter for tie protection */
  emptyDeckTurnCounter: number;
  /** Distinct suits placed into discardPile during the current turn (LB Lu Meng Botu) */
  turnSuitsDiscarded: Suit[];
  /** Damage dealt by each player during the current turn (LB Xu Shu Zhuhai) */
  turnDamageDealtByPlayer: Record<string, number>;
  /** Queued playerIds for extra turns after current turn ends (Liu Shan Fangquan / LB Lu Meng Botu) */
  extraTurnQueue: string[];
  /** Event-sourced response log for deterministic replay */
  actionLog: RecordedAction[];
}

export interface PublicPlayerView {
  id: string;
  seat: number;
  name: string;
  isAI: boolean;
  role: Role | 'hidden';
  roleRevealed: boolean;
  team?: 'A' | 'B';
  generalId: string;
  generalName: string;
  generalTitle: string;
  faction: Faction;
  gender: Gender;
  hp: number;
  maxHp: number;
  alive: boolean;
  chained: boolean;
  flipped: boolean;
  drunk: boolean;
  slashUsedThisTurn: number;
  handCount: number;
  hand: CardInstance[] | null;
  equips: EquipmentSlots;
  judgeZone: CardInstance[];
  woodenOxCount: number;
  woodenOxCards: CardInstance[] | null;
  woodenOxUsedThisTurn: boolean;
  skills: string[];
  skillDetails: SkillMeta[];
  removedCardCounts?: Record<string, number>;
  huashenCount?: number;
  activeHuashenGeneralName?: string;
  marks: Record<string, number>;
  stats: PlayerStats;
}

export interface ClientView {
  viewerId: string;
  mode: GameMode;
  deckVariant: DeckVariant;
  seed: number;
  turn: number;
  round: number;
  activePlayerId: string;
  phase: TurnPhase | 'setup' | 'gameover';
  drawPileCount: number;
  discardPileCount: number;
  recentDiscards: CardInstance[];
  tableCards: TableCardDisplay[];
  harvestPool: HarvestPoolItem[];
  players: PublicPlayerView[];
  pendingPrompt: PromptRequest | null;
  events: GameEvent[];
  result: GameResult | null;
}

export function getCardColor(suit: Suit | 'none'): CardColor {
  if (suit === 'heart' || suit === 'diamond') return 'red';
  if (suit === 'spade' || suit === 'club') return 'black';
  return 'none';
}

export function isSlashCardName(name: CardName): boolean {
  return name === 'slash' || name === 'fire_slash' || name === 'thunder_slash';
}

export function getSuitSymbol(suit: Suit | 'none'): string {
  switch (suit) {
    case 'spade':
      return '♠';
    case 'heart':
      return '♥';
    case 'club':
      return '♣';
    case 'diamond':
      return '♦';
    default:
      return '◇';
  }
}

export function getRankLabel(rank: CardRank | 0): string {
  switch (rank) {
    case 1:
      return 'A';
    case 11:
      return 'J';
    case 12:
      return 'Q';
    case 13:
      return 'K';
    case 0:
      return '-';
    default:
      return String(rank);
  }
}
