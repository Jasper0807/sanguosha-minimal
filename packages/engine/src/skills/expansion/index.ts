import type { ModifierRegistry, SkillRegistry, TriggerRegistry } from '../../core/events.js';
import { registerFengSkills } from './feng.js';
import { registerHuoSkills } from './huo.js';
import { registerLinSkills } from './lin.js';
import { registerShanSkills } from './shan.js';

export function registerExpansionSkills(
  triggers: TriggerRegistry,
  modifiers: ModifierRegistry,
  skills: SkillRegistry
): void {
  registerFengSkills(triggers, modifiers, skills);
  registerHuoSkills(triggers, modifiers, skills);
  registerLinSkills(triggers, modifiers, skills);
  registerShanSkills(triggers, modifiers, skills);
}
