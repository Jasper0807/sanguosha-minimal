import { useEffect, useState } from 'react';
import type { CardInstance, PromptRequest } from '@sgs/engine';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check } from 'lucide-react';
import { CardTile } from './CardTile';
import { FACTION_META } from '../utils/labels';

interface ActionModalProps {
  prompt: PromptRequest | null;
  onChooseOption: (optionId: string) => void;
  onChoosePlayerCard: (choiceIndex: number) => void;
  onChooseHarvestCard: (cardId: number) => void;
  onChooseGeneral: (generalId: string) => void;
  onChooseGuanxing: (topCardIds: number[], bottomCardIds: number[]) => void;
  onInspectCard: (card: CardInstance) => void;
}

function GuanxingModal({
  promptId,
  message,
  cards,
  onConfirm,
  onInspectCard
}: {
  promptId: string;
  message: string;
  cards: CardInstance[];
  onConfirm: (topCardIds: number[], bottomCardIds: number[]) => void;
  onInspectCard: (card: CardInstance) => void;
}) {
  const [topIds, setTopIds] = useState<number[]>(() => cards.map((c) => c.id));
  const [bottomIds, setBottomIds] = useState<number[]>([]);

  useEffect(() => {
    setTopIds(cards.map((c) => c.id));
    setBottomIds([]);
  }, [promptId, cards]);

  const cardMap = new Map(cards.map((c) => [c.id, c]));

  const moveToBottom = (id: number) => {
    setTopIds((prev) => prev.filter((x) => x !== id));
    setBottomIds((prev) => [...prev, id]);
  };

  const moveToTop = (id: number) => {
    setBottomIds((prev) => prev.filter((x) => x !== id));
    setTopIds((prev) => [...prev, id]);
  };

  const shift = (list: number[], setList: (next: number[]) => void, idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= list.length) return;
    const copy = [...list];
    const tmp = copy[idx];
    copy[idx] = copy[target];
    copy[target] = tmp;
    setList(copy);
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-2.5 sm:p-4">
      <div className="max-w-3xl w-full max-h-[92dvh] overflow-y-auto rounded-xl bg-white dark:bg-[#1F232B] border border-stone-300 dark:border-stone-700 shadow-2xl p-3.5 sm:p-5 flex flex-col gap-3 sm:gap-4 safe-bottom-lg">
        <div>
          <h3 className="text-sm sm:text-base font-bold">{message}</h3>
          <p className="text-[11px] sm:text-xs text-stone-500 mt-0.5">
            自由分配牌堆顶与牌堆底顺序；牌堆顶最左侧的牌将最先被判定或摸出。
          </p>
        </div>

        {/* Top of Draw Pile */}
        <div className="rounded-lg border border-amber-300/80 dark:border-amber-700/60 bg-amber-50/40 dark:bg-amber-950/20 p-2.5 sm:p-3">
          <div className="text-xs font-bold text-amber-900 dark:text-amber-200 mb-2 flex items-center justify-between">
            <span>牌堆顶（从左至右最先翻开 / 摸出）</span>
            <span className="font-mono">{topIds.length} 张</span>
          </div>
          <div className="min-h-[112px] sm:min-h-[126px] flex items-center gap-2.5 sm:gap-3 overflow-x-auto touch-scroll-x pb-1">
            {topIds.length === 0 ? (
              <span className="text-xs text-stone-400">未放置牌堆顶牌</span>
            ) : (
              topIds.map((id, idx) => {
                const card = cardMap.get(id);
                if (!card) return null;
                return (
                  <div key={id} className="flex flex-col items-center gap-1 shrink-0">
                    <CardTile
                      card={card}
                      compact
                      badgeText={`顶#${idx + 1}`}
                      onInspect={onInspectCard}
                    />
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => shift(topIds, setTopIds, idx, -1)}
                        className="p-1.5 sm:p-1 rounded border border-stone-300 dark:border-stone-600 disabled:opacity-30 hover:bg-stone-100 dark:hover:bg-stone-700"
                        title="左移（更先摸出）"
                      >
                        <ArrowLeft className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveToBottom(id)}
                        className="px-1.5 py-1 sm:py-0.5 rounded text-[10px] font-semibold bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900 inline-flex items-center gap-0.5"
                        title="移至牌堆底"
                      >
                        <ArrowDown className="w-3 h-3" />
                        底
                      </button>
                      <button
                        type="button"
                        disabled={idx === topIds.length - 1}
                        onClick={() => shift(topIds, setTopIds, idx, 1)}
                        className="p-1.5 sm:p-1 rounded border border-stone-300 dark:border-stone-600 disabled:opacity-30 hover:bg-stone-100 dark:hover:bg-stone-700"
                        title="右移"
                      >
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Bottom of Draw Pile */}
        <div className="rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-900/50 p-2.5 sm:p-3">
          <div className="text-xs font-bold text-stone-700 dark:text-stone-300 mb-2 flex items-center justify-between">
            <span>牌堆底（按顺序沉底）</span>
            <span className="font-mono">{bottomIds.length} 张</span>
          </div>
          <div className="min-h-[112px] sm:min-h-[126px] flex items-center gap-2.5 sm:gap-3 overflow-x-auto touch-scroll-x pb-1">
            {bottomIds.length === 0 ? (
              <span className="text-xs text-stone-400">未放置牌堆底牌</span>
            ) : (
              bottomIds.map((id, idx) => {
                const card = cardMap.get(id);
                if (!card) return null;
                return (
                  <div key={id} className="flex flex-col items-center gap-1 shrink-0">
                    <CardTile
                      card={card}
                      compact
                      badgeText={`底#${idx + 1}`}
                      onInspect={onInspectCard}
                    />
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => shift(bottomIds, setBottomIds, idx, -1)}
                        className="p-1.5 sm:p-1 rounded border border-stone-300 dark:border-stone-600 disabled:opacity-30 hover:bg-stone-100 dark:hover:bg-stone-700"
                        title="左移"
                      >
                        <ArrowLeft className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveToTop(id)}
                        className="px-1.5 py-1 sm:py-0.5 rounded text-[10px] font-semibold bg-amber-600 text-white inline-flex items-center gap-0.5"
                        title="移至牌堆顶"
                      >
                        <ArrowUp className="w-3 h-3" />
                        顶
                      </button>
                      <button
                        type="button"
                        disabled={idx === bottomIds.length - 1}
                        onClick={() => shift(bottomIds, setBottomIds, idx, 1)}
                        className="p-1.5 sm:p-1 rounded border border-stone-300 dark:border-stone-600 disabled:opacity-30 hover:bg-stone-100 dark:hover:bg-stone-700"
                        title="右移"
                      >
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onConfirm(topIds, bottomIds)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-lg bg-[#8B2626] hover:bg-[#731F1F] text-white text-sm font-bold shadow-sm transition-colors"
          >
            <Check className="w-4 h-4" />
            确认观星排列（顶 {topIds.length} / 底 {bottomIds.length}）
          </button>
        </div>
      </div>
    </div>
  );
}

export function ActionModal({
  prompt,
  onChooseOption,
  onChoosePlayerCard,
  onChooseHarvestCard,
  onChooseGeneral,
  onChooseGuanxing,
  onInspectCard
}: ActionModalProps) {
  if (!prompt) return null;

  if (prompt.type === 'choose_guanxing') {
    return (
      <GuanxingModal
        promptId={prompt.promptId}
        message={prompt.message}
        cards={prompt.cards}
        onConfirm={onChooseGuanxing}
        onInspectCard={onInspectCard}
      />
    );
  }

  if (prompt.type === 'choose_option') {
    return (
      <div className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-3 sm:p-4">
        <div className="max-w-md w-full max-h-[85dvh] overflow-y-auto rounded-xl bg-white dark:bg-[#1F232B] border border-stone-300 dark:border-stone-700 shadow-2xl p-4 sm:p-5 safe-bottom-lg">
          <h3 className="text-sm sm:text-base font-bold">{prompt.message}</h3>
          <div className="mt-3.5 flex flex-col gap-2">
            {prompt.options.map((opt, idx) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChooseOption(opt.id)}
                className={[
                  'w-full min-h-[44px] px-4 py-2.5 rounded-lg text-sm font-semibold border transition-colors text-left flex items-center justify-between gap-2',
                  idx === 0
                    ? 'bg-stone-900 text-white border-stone-900 hover:bg-stone-800 dark:bg-amber-600 dark:border-amber-600 dark:hover:bg-amber-500'
                    : 'bg-stone-50 dark:bg-stone-800 text-stone-800 dark:text-stone-100 border-stone-300 dark:border-stone-600 hover:bg-stone-100 dark:hover:bg-stone-700'
                ].join(' ')}
              >
                <span>{opt.label}</span>
                <span className="hidden sm:inline font-mono text-xs opacity-60">{idx + 1}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (prompt.type === 'choose_player_card') {
    return (
      <div className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-3 sm:p-4">
        <div className="max-w-lg w-full max-h-[85dvh] flex flex-col rounded-xl bg-white dark:bg-[#1F232B] border border-stone-300 dark:border-stone-700 shadow-2xl p-4 sm:p-5 safe-bottom-lg">
          <h3 className="text-sm sm:text-base font-bold shrink-0">{prompt.message}</h3>
          <p className="text-xs text-stone-500 mt-1 shrink-0">点击选择目标区域内的一张牌</p>
          <div className="mt-3.5 overflow-y-auto flex-1 min-h-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {prompt.choices.map((ch, idx) => (
                <button
                  key={`${ch.zone}_${idx}`}
                  type="button"
                  onClick={() => onChoosePlayerCard(idx)}
                  className={[
                    'min-h-[44px] px-3 py-2.5 rounded-lg text-xs font-semibold border text-left transition-all hover:shadow',
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
      </div>
    );
  }

  if (prompt.type === 'choose_harvest_card') {
    return (
      <div className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-3 sm:p-4">
        <div className="max-w-2xl w-full max-h-[88dvh] overflow-y-auto rounded-xl bg-white dark:bg-[#1F232B] border border-stone-300 dark:border-stone-700 shadow-2xl p-4 sm:p-5 safe-bottom-lg">
          <h3 className="text-sm sm:text-base font-bold">{prompt.message}</h3>
          <div className="mt-3.5 flex flex-wrap gap-2 sm:gap-3 justify-center">
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
      <GeneralPickerModal
        promptId={prompt.promptId}
        message={prompt.message}
        candidates={prompt.candidates}
        onChooseGeneral={onChooseGeneral}
      />
    );
  }

  return null;
}

function GeneralPickerModal({
  promptId,
  message,
  candidates,
  onChooseGeneral
}: {
  promptId: string;
  message: string;
  candidates: Extract<PromptRequest, { type: 'choose_general' }>['candidates'];
  onChooseGeneral: (generalId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [factionFilter, setFactionFilter] = useState<'all' | 'wei' | 'shu' | 'wu' | 'qun'>('all');
  const [packFilter, setPackFilter] = useState<'all' | 'standard' | 'limit_break' | 'expansion'>('all');

  useEffect(() => {
    setQuery('');
    setFactionFilter('all');
    setPackFilter('all');
  }, [promptId]);

  const showFilters = candidates.length > 8;
  const q = query.trim().toLowerCase();
  const filtered = candidates.filter((g) => {
    if (factionFilter !== 'all' && g.faction !== factionFilter) return false;
    if (packFilter === 'standard' && g.pack !== 'standard') return false;
    if (packFilter === 'limit_break' && g.pack !== 'limit_break') return false;
    if (
      packFilter === 'expansion' &&
      g.pack !== 'feng' &&
      g.pack !== 'huo' &&
      g.pack !== 'lin' &&
      g.pack !== 'shan'
    ) {
      return false;
    }
    if (q) {
      const hay = [
        g.name,
        g.title,
        ...g.skills.map((s) => `${s.name} ${s.description}`)
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const packBadgeLabel = (pack: string): string => {
    if (pack === 'standard') return '标';
    if (pack === 'limit_break') return '界';
    if (pack === 'feng') return '风';
    if (pack === 'huo') return '火';
    if (pack === 'lin') return '林';
    if (pack === 'shan') return '山';
    return '';
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-2 sm:p-4">
      <div className="max-w-4xl w-full rounded-xl bg-white dark:bg-[#1F232B] border border-stone-300 dark:border-stone-700 shadow-2xl p-3 sm:p-5 flex flex-col max-h-[92dvh] sm:max-h-[88vh] safe-bottom">
        <div className="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base sm:text-lg font-bold">{message}</h3>
            <p className="text-[11px] sm:text-xs text-stone-500 mt-0.5">
              选择一位武将出战（共 {filtered.length}/{candidates.length} 位）
            </p>
          </div>
          {showFilters && (
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索武将 / 技能名..."
              className="px-3 py-2 sm:py-1.5 rounded-lg text-base sm:text-xs border border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-900 outline-none focus:ring-2 focus:ring-amber-500/60 w-full sm:w-52"
            />
          )}
        </div>

        {showFilters && (
          <div className="shrink-0 mt-2.5 flex flex-wrap items-center gap-1.5 sm:gap-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  ['all', '全势力'],
                  ['wei', '魏'],
                  ['shu', '蜀'],
                  ['wu', '吴'],
                  ['qun', '群']
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFactionFilter(key)}
                  className={[
                    'px-2.5 py-1.5 sm:px-2 sm:py-1 rounded font-semibold border transition-colors',
                    factionFilter === key
                      ? 'bg-stone-900 text-white border-stone-900 dark:bg-amber-600 dark:border-amber-600'
                      : 'bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-300 border-stone-200 dark:border-stone-700 hover:bg-stone-100'
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="hidden sm:inline text-stone-300 dark:text-stone-700">|</span>
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  ['all', '全包'],
                  ['standard', '标准 27'],
                  ['limit_break', '界限 30'],
                  ['expansion', '风林火山 32']
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPackFilter(key)}
                  className={[
                    'px-2.5 py-1.5 sm:px-2 sm:py-1 rounded font-semibold border transition-colors',
                    packFilter === key
                      ? 'bg-[#8B2626] text-white border-[#8B2626]'
                      : 'bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-300 border-stone-200 dark:border-stone-700 hover:bg-stone-100'
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3 sm:mt-4 overflow-y-auto pr-0.5 flex-1 min-h-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
          {filtered.map((g) => {
            const fm = FACTION_META[g.faction];
            const pb = packBadgeLabel(g.pack);
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => onChooseGeneral(g.id)}
                className="text-left rounded-xl border border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-900 hover:border-stone-900 dark:hover:border-amber-400 hover:shadow-md active:scale-[0.99] transition-all overflow-hidden flex flex-col"
              >
                <div className={`h-1.5 w-full ${fm.bar}`} />
                <div className="p-2 sm:p-3 flex flex-col gap-1 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1">
                      <span className={`px-1 sm:px-1.5 py-0.5 rounded text-[10px] font-bold ${fm.badge}`}>
                        {fm.label}
                      </span>
                      {pb && (
                        <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-stone-200 dark:bg-stone-800 text-stone-600 dark:text-stone-300">
                          {pb}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[11px] sm:text-xs text-stone-500 whitespace-nowrap">
                      {g.maxHp}血·{g.gender === 'male' ? '男' : '女'}
                    </span>
                  </div>
                  <div className="font-serif font-bold text-sm sm:text-base mt-0.5">{g.name}</div>
                  <div className="text-[10px] sm:text-[11px] text-stone-500">{g.title}</div>
                  {g.skills.length === 0 ? (
                    <div className="text-[11px] text-stone-400 mt-1">无技能（标准测试将）</div>
                  ) : (
                    <div className="mt-1 sm:mt-1.5 flex flex-col gap-1">
                      {g.skills.map((s) => (
                        <div
                          key={s.id}
                          title={`${s.name}：${s.description}`}
                          className="text-[10px] leading-snug text-stone-600 dark:text-stone-300"
                        >
                          <span
                            className={[
                              'inline-block px-1 py-0.2 rounded font-bold mr-1',
                              s.type === 'lord'
                                ? 'bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-100'
                                : 'bg-stone-200 dark:bg-stone-800 text-stone-800 dark:text-stone-100'
                            ].join(' ')}
                          >
                            {s.name}
                            {s.type === 'lord' ? '·主' : ''}
                          </span>
                          <span className="line-clamp-2 opacity-80">{s.description}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full py-8 text-center text-xs text-stone-400">
              未找到匹配的武将，请调整筛选条件
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
