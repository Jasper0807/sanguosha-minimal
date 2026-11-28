import type { CardInstance } from '@sgs/engine';
import { getCardColor, getRankLabel, getSuitSymbol } from '@sgs/engine';
import { Info } from 'lucide-react';
import { getCardAccentBg, getCardBorderClass } from '../utils/labels';

interface CardTileProps {
  card: CardInstance;
  selected?: boolean;
  disabled?: boolean;
  compact?: boolean;
  badgeText?: string;
  hotkey?: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onInspect?: (card: CardInstance) => void;
}

export function CardTile({
  card,
  selected = false,
  disabled = false,
  compact = false,
  badgeText,
  hotkey,
  onClick,
  onDoubleClick,
  onInspect
}: CardTileProps) {
  const isRed = getCardColor(card.suit) === 'red';
  const suitColor = isRed ? 'text-red-600' : 'text-stone-900';
  const borderCls = getCardBorderClass(card.category, card.subtype);
  const tagCls = getCardAccentBg(card.category, card.subtype);

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => {
        if (!disabled && onClick) onClick();
      }}
      onDoubleClick={() => {
        if (!disabled && onDoubleClick) onDoubleClick();
      }}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ') && onClick) {
          e.preventDefault();
          onClick();
        }
      }}
      className={[
        'relative select-none rounded-lg bg-white text-stone-900 border-2 shadow-sm transition-all duration-150 flex flex-col justify-between shrink-0',
        compact
          ? 'w-[62px] h-[88px] p-1 sm:w-[76px] sm:h-[106px] sm:p-1.5'
          : 'w-[74px] h-[106px] p-1.5 sm:w-[96px] sm:h-[136px] sm:p-2',
        borderCls,
        selected
          ? '-translate-y-2 sm:-translate-y-3 ring-2 ring-stone-900 dark:ring-amber-400 shadow-lg z-20'
          : '',
        disabled
          ? 'opacity-45 cursor-not-allowed'
          : 'cursor-pointer sm:hover:-translate-y-1.5 hover:shadow-md active:scale-[0.98]'
      ].join(' ')}
    >
      {/* Top Row: Suit/Rank + Info button */}
      <div className="flex items-start justify-between leading-none">
        <div className={`flex flex-col items-center font-mono font-bold ${suitColor}`}>
          <span className={compact ? 'text-[11px] sm:text-xs' : 'text-xs sm:text-sm'}>
            {getRankLabel(card.rank)}
          </span>
          <span className={compact ? 'text-xs sm:text-sm -mt-0.5' : 'text-sm sm:text-base -mt-0.5'}>
            {getSuitSymbol(card.suit)}
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          {hotkey && !disabled && (
            <span className="hidden sm:inline-block text-[10px] font-mono px-1 rounded bg-stone-100 text-stone-500 border border-stone-200">
              {hotkey}
            </span>
          )}
          {onInspect && (
            <button
              type="button"
              title="查看牌面说明"
              aria-label={`查看${card.displayName}说明`}
              onClick={(e) => {
                e.stopPropagation();
                onInspect(card);
              }}
              className="p-1 -m-0.5 rounded text-stone-400 hover:text-stone-800 hover:bg-stone-100 transition-colors"
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Center: Card Name */}
      <div className="flex flex-col items-center justify-center text-center px-0.5 my-auto">
        <span
          className={[
            'font-serif font-bold tracking-tight leading-tight text-stone-900',
            compact
              ? 'text-[11px] sm:text-xs'
              : card.displayName.length >= 4
                ? 'text-[11px] sm:text-sm'
                : 'text-sm sm:text-base'
          ].join(' ')}
        >
          {card.displayName}
        </span>
        {card.element && card.element !== 'normal' && (
          <span
            className={[
              'mt-0.5 text-[9px] sm:text-[10px] font-semibold px-1 sm:px-1.5 py-0.5 rounded leading-none',
              card.element === 'fire'
                ? 'bg-orange-100 text-orange-700'
                : 'bg-indigo-100 text-indigo-700'
            ].join(' ')}
          >
            {card.element === 'fire' ? '火' : '雷'}
            <span className="hidden sm:inline">属性</span>
          </span>
        )}
      </div>

      {/* Bottom Tag */}
      <div
        className={`text-center rounded px-1 py-0.5 truncate font-medium ${
          compact ? 'text-[8px] sm:text-[9px]' : 'text-[9px] sm:text-[10px]'
        } ${tagCls}`}
      >
        {badgeText ?? card.shortTag}
      </div>
    </div>
  );
}
