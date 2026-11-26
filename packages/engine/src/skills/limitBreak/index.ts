import type { ModifierRegistry, SkillRegistry, TriggerRegistry } from '../../core/events.js';
import { registerWeiLimitBreakSkills } from './wei.js';
import { registerShuLimitBreakSkills } from './shu.js';
import { registerWuLimitBreakSkills } from './wu.js';
import { registerQunLimitBreakSkills } from './qun.js';

export function registerLimitBreakSkills(
  triggers: TriggerRegistry,
  modifiers: ModifierRegistry,
  skills: SkillRegistry
): void {
  registerWeiLimitBreakSkills(triggers, modifiers, skills);
  registerShuLimitBreakSkills(triggers, modifiers, skills);
  registerWuLimitBreakSkills(triggers, modifiers, skills);
  registerQunLimitBreakSkills(triggers, modifiers, skills);
}
