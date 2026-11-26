import { useEffect, useRef, useState } from 'react';
import { QUICK_CHAT_PHRASES, type ChatMessage } from '@sgs/engine';
import { MessageSquare, Send, X } from 'lucide-react';

interface ChatDrawerProps {
  messages: ChatMessage[];
  open: boolean;
  embedded?: boolean;
  onClose?: () => void;
  onSend: (text: string) => void;
}

export function ChatDrawer({
  messages,
  open,
  embedded = false,
  onClose,
  onSend
}: ChatDrawerProps) {
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, open]);

  if (!open && !embedded) return null;

  const submit = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput('');
  };

  return (
    <aside
      className={[
        'flex flex-col bg-white/95 dark:bg-[#1B1E24] border-stone-300 dark:border-stone-800',
        embedded
          ? 'rounded-xl border shadow-sm h-[420px]'
          : 'w-72 shrink-0 border-l h-full'
      ].join(' ')}
    >
      <div className="px-3 py-2.5 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold">
          <MessageSquare className="w-3.5 h-3.5 text-[#1E3A5F] dark:text-sky-400" />
          <span>房间聊天</span>
        </div>
        {!embedded && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 text-xs">
        {messages.length === 0 ? (
          <div className="text-center text-stone-400 py-8">暂无聊天消息，点击下方快捷短语互动</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="leading-relaxed">
              {m.senderRole === 'system' ? (
                <div className="text-[11px] text-stone-500 dark:text-stone-400 bg-stone-100/80 dark:bg-stone-800/60 px-2 py-1 rounded">
                  {m.text}
                </div>
              ) : (
                <div>
                  <span
                    className={[
                      'font-bold mr-1.5',
                      m.senderRole === 'spectator'
                        ? 'text-stone-500'
                        : 'text-[#1E3A5F] dark:text-sky-300'
                    ].join(' ')}
                  >
                    {m.senderName}:
                  </span>
                  <span className="text-stone-800 dark:text-stone-100 break-words">{m.text}</span>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {/* Quick Phrases */}
      <div className="px-2.5 py-2 border-t border-stone-200 dark:border-stone-800 flex flex-wrap gap-1">
        {QUICK_CHAT_PHRASES.map((phrase) => (
          <button
            key={phrase}
            type="button"
            onClick={() => onSend(phrase)}
            className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200 transition-colors"
          >
            {phrase}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="p-2 border-t border-stone-200 dark:border-stone-800 flex items-center gap-1.5">
        <input
          type="text"
          value={input}
          maxLength={120}
          placeholder="输入消息..."
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-xs border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 outline-none focus:border-stone-500"
        />
        <button
          type="button"
          onClick={submit}
          className="p-1.5 rounded-lg bg-stone-900 dark:bg-amber-600 text-white hover:opacity-90 shrink-0"
          title="发送"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </aside>
  );
}
