import type { CardCategory, CardSubtype, Faction, Role, TurnPhase } from '@sgs/engine';

export const FACTION_META: Record<
  Faction,
  { label: string; bg: string; bar: string; text: string; badge: string }
> = {
  wei: {
    label: '魏',
    bg: 'bg-[#1E3A5F]',
    bar: 'bg-[#1E3A5F]',
    text: 'text-[#1E3A5F] dark:text-[#7BA6DE]',
    badge: 'bg-[#1E3A5F] text-white'
  },
  shu: {
    label: '蜀',
    bg: 'bg-[#8B2626]',
    bar: 'bg-[#8B2626]',
    text: 'text-[#8B2626] dark:text-[#E58080]',
    badge: 'bg-[#8B2626] text-white'
  },
  wu: {
    label: '吴',
    bg: 'bg-[#1E5B3A]',
    bar: 'bg-[#1E5B3A]',
    text: 'text-[#1E5B3A] dark:text-[#6CC492]',
    badge: 'bg-[#1E5B3A] text-white'
  },
  qun: {
    label: '群',
    bg: 'bg-[#7A6A42]',
    bar: 'bg-[#7A6A42]',
    text: 'text-[#7A6A42] dark:text-[#D5C38F]',
    badge: 'bg-[#7A6A42] text-white'
  }
};

export const PHASE_LABELS: Record<TurnPhase, string> = {
  prepare: '准备',
  judge: '判定',
  draw: '摸牌',
  play: '出牌',
  discard: '弃牌',
  finish: '结束'
};

export const TURN_PHASE_ORDER: readonly TurnPhase[] = [
  'prepare',
  'judge',
  'draw',
  'play',
  'discard',
  'finish'
];

export const ROLE_META: Record<Role | 'hidden', { label: string; cls: string }> = {
  lord: { label: '主公', cls: 'bg-amber-600 text-white' },
  loyalist: { label: '忠臣', cls: 'bg-sky-700 text-white' },
  rebel: { label: '反贼', cls: 'bg-emerald-700 text-white' },
  renegade: { label: '内奸', cls: 'bg-stone-700 text-white' },
  duelist: { label: '单挑', cls: 'bg-stone-600 text-white' },
  team_a: { label: '蓝队', cls: 'bg-[#1E3A5F] text-white' },
  team_b: { label: '红队', cls: 'bg-[#8B2626] text-white' },
  hidden: { label: '暗置', cls: 'bg-stone-300 text-stone-700 dark:bg-stone-700 dark:text-stone-300' }
};

export function getCardBorderClass(category: CardCategory, subtype: CardSubtype): string {
  if (subtype === 'delayed_trick') return 'border-rose-500/80';
  if (category === 'trick') return 'border-amber-500/80';
  if (category === 'equip') return 'border-sky-600/80';
  return 'border-stone-300';
}

export function getCardAccentBg(category: CardCategory, subtype: CardSubtype): string {
  if (subtype === 'delayed_trick') return 'bg-rose-50 text-rose-800';
  if (category === 'trick') return 'bg-amber-50 text-amber-800';
  if (category === 'equip') return 'bg-sky-50 text-sky-800';
  return 'bg-stone-100 text-stone-700';
}
