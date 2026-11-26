import type { GeneralDefinition } from '../../core/types.js';

/**
 * Blank / starter archetype generals used during Phase 1–3 before Phase 4 adds all 89 OL generals.
 * Covers all 4 factions and both genders so Double Swords (雌雄双股剑) and faction badges work authentically.
 */
export const BLANK_GENERALS: readonly GeneralDefinition[] = [
  {
    id: 'blank_wei_m',
    name: '魏·步卒',
    title: '白板男将',
    faction: 'wei',
    gender: 'male',
    maxHp: 4,
    pack: 'blank',
    isLordCandidate: true,
    skills: []
  },
  {
    id: 'blank_shu_m',
    name: '蜀·羽林',
    title: '白板男将',
    faction: 'shu',
    gender: 'male',
    maxHp: 4,
    pack: 'blank',
    isLordCandidate: true,
    skills: []
  },
  {
    id: 'blank_wu_f',
    name: '吴·女卫',
    title: '白板女将',
    faction: 'wu',
    gender: 'female',
    maxHp: 4,
    pack: 'blank',
    isLordCandidate: true,
    skills: []
  },
  {
    id: 'blank_qun_f',
    name: '群·巾帼',
    title: '白板女将',
    faction: 'qun',
    gender: 'female',
    maxHp: 4,
    pack: 'blank',
    isLordCandidate: false,
    skills: []
  },
  {
    id: 'blank_wei_f',
    name: '魏·侍女',
    title: '白板女将',
    faction: 'wei',
    gender: 'female',
    maxHp: 4,
    pack: 'blank',
    skills: []
  },
  {
    id: 'blank_shu_f',
    name: '蜀·游侠',
    title: '白板女将',
    faction: 'shu',
    gender: 'female',
    maxHp: 4,
    pack: 'blank',
    skills: []
  },
  {
    id: 'blank_wu_m',
    name: '吴·水师',
    title: '白板男将',
    faction: 'wu',
    gender: 'male',
    maxHp: 4,
    pack: 'blank',
    skills: []
  },
  {
    id: 'blank_qun_m',
    name: '群·骑兵',
    title: '白板男将',
    faction: 'qun',
    gender: 'male',
    maxHp: 4,
    pack: 'blank',
    skills: []
  }
];

export function getGeneralById(id: string): GeneralDefinition {
  return BLANK_GENERALS.find((g) => g.id === id) ?? BLANK_GENERALS[0];
}
