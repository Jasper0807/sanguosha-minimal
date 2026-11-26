import { getSuitSymbol } from '@sgs/engine';

export default function App() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-lg w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 p-6 shadow-sm">
        <h1 className="text-xl font-bold tracking-tight">极简三国杀 · Minimal Sanguosha</h1>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
          Phase 0 骨架初始化完成（{getSuitSymbol('spade')} {getSuitSymbol('heart')}{' '}
          {getSuitSymbol('club')} {getSuitSymbol('diamond')}）。
        </p>
      </div>
    </main>
  );
}
