import { Download, Home, RotateCcw, Trophy } from 'lucide-react';
import { useGameStore } from '../store/gameStore';
import { FACTION_META, ROLE_META } from '../utils/labels';

export function SummaryView() {
  const { view, rematch, returnToLobby, exportReplayJson } = useGameStore();
  if (!view || !view.result) return null;

  const { result } = view;

  const handleDownload = () => {
    const json = exportReplayJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sgs-replay-${view.mode}-seed${view.seed}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-dvh-screen flex items-center justify-center p-3 sm:p-6 safe-bottom-lg">
      <div className="max-w-3xl w-full rounded-2xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-[#1E2128] shadow-xl overflow-hidden">
        {/* Victory Banner */}
        <div className="bg-stone-900 dark:bg-stone-950 text-white px-4 py-4 sm:px-6 sm:py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-amber-400 text-xs font-bold uppercase tracking-wider">
              <Trophy className="w-4 h-4" />
              对局结算 · 共 {result.totalTurns} 回合
            </div>
            <h2 className="font-serif font-bold text-xl sm:text-2xl mt-1">
              {result.winnerTeam} 获胜
            </h2>
            <p className="text-xs sm:text-sm text-stone-300 mt-1">{result.reason}</p>
          </div>
          <div className="flex sm:flex-col gap-3 sm:gap-0 sm:text-right font-mono text-xs text-stone-400 shrink-0">
            <div>模式：{view.mode}</div>
            <div>Seed：{view.seed}</div>
          </div>
        </div>

        {/* Player Stats */}
        <div className="p-4 sm:p-6">
          {/* Mobile Card List (< sm) */}
          <div className="sm:hidden space-y-2.5">
            {view.players.map((p) => {
              const isWinner = result.winnerPlayerIds.includes(p.id);
              const fm = FACTION_META[p.faction];
              const rm = ROLE_META[p.role];
              return (
                <div
                  key={p.id}
                  className={[
                    'rounded-xl border p-3 space-y-2',
                    isWinner
                      ? 'border-amber-400/70 bg-amber-50/50 dark:bg-amber-950/20'
                      : 'border-stone-200 dark:border-stone-700 bg-stone-50/50 dark:bg-stone-900/40'
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${fm.badge}`}>
                        {fm.label}
                      </span>
                      <span className="font-serif font-bold text-sm truncate">{p.generalName}</span>
                      {isWinner && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500 text-white font-bold shrink-0">
                          胜
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${rm.cls}`}>
                        {rm.label}
                      </span>
                      <span className="text-[11px] text-stone-500">
                        {p.alive ? `活 ${p.hp}/${p.maxHp}` : '阵亡'}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-stone-500 truncate">
                    {p.seat + 1}号 · {p.name}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 pt-1.5 border-t border-stone-200/80 dark:border-stone-700/80 text-center font-mono text-[11px]">
                    <div>
                      <div className="text-[10px] text-stone-400">伤害</div>
                      <div className="font-bold">{p.stats.damageDealt}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-stone-400">承伤</div>
                      <div className="font-bold">{p.stats.damageTaken}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-stone-400">击杀</div>
                      <div className="font-bold">{p.stats.kills}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-stone-400">出牌</div>
                      <div className="font-bold">{p.stats.cardsPlayed}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Stats Table (sm+) */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-stone-200 dark:border-stone-700 text-xs text-stone-500">
                  <th className="py-2 pr-3">座位 / 玩家</th>
                  <th className="py-2 pr-3">武将</th>
                  <th className="py-2 pr-3">身份</th>
                  <th className="py-2 pr-3">状态</th>
                  <th className="py-2 pr-3 text-right">造成伤害</th>
                  <th className="py-2 pr-3 text-right">受到伤害</th>
                  <th className="py-2 pr-3 text-right">击杀</th>
                  <th className="py-2 text-right">出牌</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {view.players.map((p) => {
                  const isWinner = result.winnerPlayerIds.includes(p.id);
                  const fm = FACTION_META[p.faction];
                  const rm = ROLE_META[p.role];
                  return (
                    <tr
                      key={p.id}
                      className={isWinner ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}
                    >
                      <td className="py-2.5 pr-3 font-medium">
                        {p.seat + 1}号 · {p.name}
                        {isWinner && (
                          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-500 text-white font-bold">
                            胜
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold mr-1.5 ${fm.badge}`}>
                          {fm.label}
                        </span>
                        <span className="font-serif font-semibold">{p.generalName}</span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${rm.cls}`}>
                          {rm.label}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-xs">
                        {p.alive ? `存活 (${p.hp}/${p.maxHp})` : '阵亡'}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono">{p.stats.damageDealt}</td>
                      <td className="py-2.5 pr-3 text-right font-mono">{p.stats.damageTaken}</td>
                      <td className="py-2.5 pr-3 text-right font-mono">{p.stats.kills}</td>
                      <td className="py-2.5 text-right font-mono">{p.stats.cardsPlayed}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-5 sm:mt-6 flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
            <button
              type="button"
              onClick={handleDownload}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-2 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-600 hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              <Download className="w-4 h-4" />
              导出复盘录像 JSON
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={returnToLobby}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-2 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-600 hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                <Home className="w-4 h-4" />
                返回大厅
              </button>
              <button
                type="button"
                onClick={rematch}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-5 py-2.5 sm:py-2 rounded-lg text-xs font-bold bg-[#8B2626] hover:bg-[#731F1F] text-white"
              >
                <RotateCcw className="w-4 h-4" />
                再来一局
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
