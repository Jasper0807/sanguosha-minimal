import type { CardInstance } from '@sgs/engine';
import { getCardColor, getRankLabel, getSuitSymbol } from '@sgs/engine';
import { X } from 'lucide-react';

interface CardDetailModalProps {
  card: CardInstance | null;
  onClose: () => void;
}

export function CardDetailModal({ card, onClose }: CardDetailModalProps) {
  if (!card) return null;
  const isRed = getCardColor(card.suit) === 'red';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="max-w-md w-full rounded-xl bg-white dark:bg-[#1F232B] border border-stone-300 dark:border-stone-700 shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`font-mono text-lg font-bold ${
                isRed ? 'text-red-600' : 'text-stone-900 dark:text-stone-100'
              }`}
            >
              {getSuitSymbol(card.suit)}
              {getRankLabel(card.rank)}
            </span>
            <h3 className="font-serif text-xl font-bold">【{card.displayName}】</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          <span className="px-2 py-0.5 rounded bg-stone-100 dark:bg-stone-800 font-medium">
            {card.shortTag}
          </span>
          <span className="px-2 py-0.5 rounded bg-stone-100 dark:bg-stone-800 font-mono text-stone-500">
            扩展包：{card.pack}
          </span>
          {card.attackRange && (
            <span className="px-2 py-0.5 rounded bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 font-medium">
              攻击范围：{card.attackRange}
            </span>
          )}
        </div>

        <p className="mt-4 text-sm leading-relaxed text-stone-700 dark:text-stone-300">
          {card.description}
        </p>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-stone-900 text-white dark:bg-stone-200 dark:text-stone-900"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
