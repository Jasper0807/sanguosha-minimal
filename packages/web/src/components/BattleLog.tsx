import type { GameEvent } from '@sgs/engine';
import { Download, ScrollText, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface BattleLogProps {
  events: GameEvent[];
  open: boolean;
  onClose: () => void;
  onExportReplay: () => void;
}

function getEventColor(type: string): string {
  switch (type) {
    case 'damage':
    case 'dying':
    case 'death':
      return 'text-rose-700 dark:text-rose-300 font-medium';
    case 'heal':
      return 'text-emerald-700 dark:text-emerald-300 font-medium';
    case 'trick':
    case 'judge':
      return 'text-amber-700 dark:text-amber-300';
    case 'equip':
      return 'text-sky-700 dark:text-sky-300';
    case 'turn':
      return 'text-stone-900 dark:text-stone-100 font-bold border-t border-stone-200 dark:border-stone-700 pt-2 mt-2';
    case 'gameover':
      return 'text-amber-800 dark:text-amber-200 font-bold bg-amber-50 dark:bg-amber-950/50 p-1.5 rounded';
    default:
      return 'text-stone-600 dark:text-stone-300';
  }
}

export function BattleLog({ events, open, onClose, onExportReplay }: BattleLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  if (!open) return null;

  return (
    <aside className="w-80 shrink-0 border-l border-stone-300 dark:border-stone-700 bg-white/95 dark:bg-[#1B1E24] flex flex-col h-full">
      <div className="px-3 py-2.5 border-b border-stone-200 dark:border-stone-700 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-bold">
          <ScrollText className="w-4 h-4 text-stone-500" />
          <span>战局日志</span>
          <span className="text-xs font-mono text-stone-400">({events.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onExportReplay}
            title="导出复盘 JSON"
            className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="收起日志"
            className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-1 text-xs leading-relaxed">
        {events.map((ev) => (
          <div key={ev.id} className={getEventColor(ev.type)}>
            {ev.type !== 'turn' && (
              <span className="font-mono text-[10px] text-stone-400 mr-1.5">
                T{ev.turn}
              </span>
            )}
            <span>{ev.message}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
