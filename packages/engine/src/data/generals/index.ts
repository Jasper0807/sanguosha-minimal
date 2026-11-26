import type { GeneralDefinition, SkillMeta } from '../../core/types.js';
import { BLANK_GENERALS } from './blank.js';
import { STANDARD_GENERALS } from './standard.js';

export { BLANK_GENERALS } from './blank.js';
export { STANDARD_GENERALS } from './standard.js';

export const ALL_GENERALS: readonly GeneralDefinition[] = [
  ...STANDARD_GENERALS,
  ...BLANK_GENERALS
];

export function getGeneralPool(
  pack: 'standard' | 'blank' | 'all' = 'standard'
): readonly GeneralDefinition[] {
  if (pack === 'blank') return BLANK_GENERALS;
  if (pack === 'standard') return STANDARD_GENERALS;
  return ALL_GENERALS;
}

export function getGeneralById(id: string): GeneralDefinition {
  return ALL_GENERALS.find((g) => g.id === id) ?? BLANK_GENERALS[0];
}

export function getSkillMetaById(skillId: string): SkillMeta | undefined {
  for (const g of ALL_GENERALS) {
    const found = g.skills.find((s) => s.id === skillId);
    if (found) return found;
  }
  return undefined;
}
