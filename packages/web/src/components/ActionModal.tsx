import type { CardInstance, PromptRequest } from '@sgs/engine';
import { CardTile } from './CardTile';
import { FACTION_META } from '../utils/labels';

interface ActionModalProps {
  prompt: PromptRequest | null;
  onChooseOption: (optionId: string) => void;
  onChoosePlayerCard: (choiceIndex: number) => void;
  onChooseHarvestCard: (cardId: number) => void;
  onChooseGeneral: (generalId: string) => void;
  onInspectCard: (card: CardInstance) => void;
}

export function ActionModal({
  prompt,
  onChooseOption,
  onChoosePlayerCard,
  onChooseHarvestCard,
  onChooseGeneral,
  onInspectCard
}: ActionModalProps) {
  if (!prompt) return null;

  if (prompt.type === 'choose_option') {
    return (
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-xl bg-white dark:bg-[#1F232B] border border-stone-300 dark:border-stone-700 shadow-2xl p-5">
          <h3 className="text-base font-bold">{prompt.message}</h3>
          <div className="mt-4 flex flex-col gap-2">
            {prompt.options.map((opt, idx) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChooseOption(opt.id)}
                className={[
                  'w-full px-4 py-2.5 rounded-lg text-sm font-semibold border transition-colors text-left flex items-center justify-between',
                  idx === 0
                    ? 'bg-stone-900 text-white border-stone-900 hover:bg-stone-800 dark:bg-amber-600 dark:border-amber-600 dark:hover:bg-amber-500'
                    : 'bg-stone-50 dark:bg-stone-800 text-stone-800 dark:text-stone-100 border-stone-300 dark:border-stone-600 hover:bg-stone-100 dark:hover:bg-stone-700'
                ].join(' ')}
              >
                <span>{opt.label}</span>
                <span className="font-mono text-xs opacity-60">{idx + 1}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (prompt.type === 'choose_player_card') {
    return (
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4">
        <div className="max-w-lg w-full rounded-xl bg-white dark:bg-[#1F232B] border border-stone-300 dark:border-stone-700 shadow-2xl p-5">
          <h3 className="text-base font-bold">{prompt.message}</h3>
          <p className="text-xs text-stone-500 mt-1">点击选择目标区域内的一张牌</p>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto">
            {prompt.choices.map((ch, idx) => (
              <button
                key={`${ch.zone}_${idx}`}
                type="button"
                onClick={() => onChoosePlayerCard(idx)}
                className={[
                  'px-3 py-2.5 rounded-lg text-xs font-semibold border text-left transition-all hover:shadow',
                  ch.zone === 'hand'
                    ? 'bg-stone-100 dark:bg-stone-800 border-stone-300 dark:border-stone-600'
                    : ch.zone === 'judge'
                      ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200'
                      : 'bg-sky-50 dark:bg-sky-950/50 border-sky-300 dark:border-sky-700 text-sky-900 dark:text-sky-200'
                ].join(' ')}
              >
                {ch.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (prompt.type === 'choose_harvest_card') {
    return (
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4">
        <div className="max-w-2xl w-full rounded-xl bg-white dark:bg-[#1F232B] border border-stone-300 dark:border-stone-700 shadow-2xl p-5">
          <h3 className="text-base font-bold">{prompt.message}</h3>
          <div className="mt-4 flex flex-wrap gap-3 justify-center">
            {prompt.pool.map((item) => (
              <CardTile
                key={item.card.id}
                card={item.card}
                disabled={Boolean(item.takenBy)}
                badgeText={item.takenBy ? '已被选走' : item.card.shortTag}
                onClick={() => onChooseHarvestCard(item.card.id)}
                onInspect={onInspectCard}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (prompt.type === 'choose_general') {
    return (
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] flex items-center justify-center p-4">
        <div className="max-w-3xl w-full rounded-xl bg-white dark:bg-[#1F232B] border border-stone-300 dark:border-stone-700 shadow-2xl p-5">
          <h3 className="text-lg font-bold">{prompt.message}</h3>
          <p className="text-xs text-stone-500 mt-1">
            从以下候选武将中选择一位出战（后续 Phase 4 将扩充至全部 89 位三国杀 OL 武将）
          </p>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto">
            {prompt.candidates.map((g) => {
              const fm = FACTION_META[g.faction];
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onChooseGeneral(g.id)}
                  className="text-left rounded-xl border border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-900 hover:border-stone-900 dark:hover:border-amber-400 hover:shadow-md transition-all overflow-hidden flex flex-col"
                >
                  <div className={`h-1.5 w-full ${fm.bar}`} />
                  <div className="p-3 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${fm.badge}`}>
                        {fm.label}
                      </span>
                      <span className="font-mono text-xs text-stone-500">
                        {g.maxHp} 血 · {g.gender === 'male' ? '男' : '女'}
                      </span>
                    </div>
                    <div className="font-serif font-bold text-base mt-1">{g.name}</div>
                    <div className="text-[11px] text-stone-500">{g.title}</div>
                    {g.skills.length === 0 ? (
                      <div className="text-[11px] text-stone-400 mt-1">无技能（标准测试将）</div>
                    ) : (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {g.skills.map((s) => (
                          <span
                            key={s.id}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-stone-200 dark:bg-stone-800 font-semibold"
                          >
                            {s.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
