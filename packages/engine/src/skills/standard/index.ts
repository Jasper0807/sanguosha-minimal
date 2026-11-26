import type { ModifierRegistry, SkillRegistry, TriggerRegistry } from '../../core/events.js';
import { registerWeiStandardSkills } from './wei.js';
import { registerShuStandardSkills } from './shu.js';
import { registerWuStandardSkills } from './wu.js';
import { registerQunStandardSkills } from './qun.js';

export function registerStandardSkills(
  triggers: TriggerRegistry,
  modifiers: ModifierRegistry,
  skills: SkillRegistry
): void {
  registerWeiStandardSkills(triggers, modifiers, skills);
  registerShuStandardSkills(triggers, modifiers, skills);
  registerWuStandardSkills(triggers, modifiers, skills);
  registerQunStandardSkills(triggers, modifiers, skills);
}
