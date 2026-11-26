import type { GeneralDefinition, GeneralPackSelection, SkillMeta } from '../../core/types.js';
import { BLANK_GENERALS } from './blank.js';
import { STANDARD_GENERALS } from './standard.js';
import { LIMIT_BREAK_EXTRA_SKILLS, LIMIT_BREAK_GENERALS } from './limitBreak.js';
import {
  EXPANSION_EXTRA_SKILLS,
  EXPANSION_GENERALS,
  FENG_GENERALS,
  HUO_GENERALS,
  LIN_GENERALS,
  SHAN_GENERALS
} from './expansion.js';

export { BLANK_GENERALS } from './blank.js';
export { STANDARD_GENERALS } from './standard.js';
export { LIMIT_BREAK_GENERALS, LIMIT_BREAK_EXTRA_SKILLS } from './limitBreak.js';
export {
  FENG_GENERALS,
  HUO_GENERALS,
  LIN_GENERALS,
  SHAN_GENERALS,
  EXPANSION_GENERALS,
  EXPANSION_EXTRA_SKILLS
};

export const ALL_GENERALS: readonly GeneralDefinition[] = [
  ...STANDARD_GENERALS,
  ...LIMIT_BREAK_GENERALS,
  ...EXPANSION_GENERALS,
  ...BLANK_GENERALS
];

export const ALL_PLAYABLE_GENERALS: readonly GeneralDefinition[] = [
  ...STANDARD_GENERALS,
  ...LIMIT_BREAK_GENERALS,
  ...EXPANSION_GENERALS
];

export function getGeneralPool(
  pack: GeneralPackSelection = 'standard'
): readonly GeneralDefinition[] {
  if (pack === 'blank') return BLANK_GENERALS;
  if (pack === 'standard') return STANDARD_GENERALS;
  if (pack === 'limit_break') return LIMIT_BREAK_GENERALS;
  if (pack === 'expansion') return EXPANSION_GENERALS;
  return ALL_PLAYABLE_GENERALS;
}

export function getGeneralById(id: string): GeneralDefinition {
  return ALL_GENERALS.find((g) => g.id === id) ?? BLANK_GENERALS[0];
}

export function getSkillMetaById(skillId: string): SkillMeta | undefined {
  for (const g of ALL_GENERALS) {
    const found = g.skills.find((s) => s.id === skillId);
    if (found) return found;
  }
  return (
    LIMIT_BREAK_EXTRA_SKILLS.find((s) => s.id === skillId) ??
    EXPANSION_EXTRA_SKILLS.find((s) => s.id === skillId)
  );
}
