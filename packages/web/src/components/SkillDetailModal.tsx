import { X } from 'lucide-react';

export interface InspectedSkill {
  generalName: string;
  name: string;
  description: string;
  type?: string;
}

interface SkillDetailModalProps {
  skill: InspectedSkill | null;
  onClose: () => void;
}

function getSkillTypeLabel(type?: string): string | null {
  if (type === 'lord') return '主公技';
  if (type === 'compulsory') return '锁定技';
  if (type === 'limited') return '限定技';
  if (type === 'awakening') return '觉醒技';
  return null;
}

export function SkillDetailModal({ skill, onClose }: SkillDetailModalProps) {
  if (!skill) return null;
  const typeLabel = getSkillTypeLabel(skill.type);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-w-md w-full rounded-xl bg-white dark:bg-[#1F232B] border border-stone-300 dark:border-stone-700 shadow-2xl p-4 sm:p-5 safe-bottom-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-stone-500 dark:text-stone-400">
              {skill.generalName} · 武将技能
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <h3 className="font-serif text-lg sm:text-xl font-bold">【{skill.name}】</h3>
              {typeLabel && (
                <span
                  className={[
                    'px-2 py-0.5 rounded text-[11px] font-bold',
                    skill.type === 'lord'
                      ? 'bg-amber-100 dark:bg-amber-900/70 text-amber-900 dark:text-amber-100'
                      : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200'
                  ].join(' ')}
                >
                  {typeLabel}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭技能说明"
            className="p-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-stone-700 dark:text-stone-200">
          {skill.description}
        </p>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-stone-900 text-white dark:bg-stone-200 dark:text-stone-900"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
