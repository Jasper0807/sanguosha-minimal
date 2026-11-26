import { useEffect, useMemo, useState } from 'react';
import { getDistance, isInAttackRange } from '@sgs/engine';
import {
  ArrowLeft,
  BookOpen,
  Clock,
  Eye,
  EyeOff,
  Moon,
  ScrollText,
  Sun,
  Swords,
  Package
} from 'lucide-react';
import { useGameStore } from '../store/gameStore';
import { CardTile } from '../components/CardTile';
import { PlayerSeat } from '../components/PlayerSeat';
import { BattleLog } from '../components/BattleLog';
import { ActionModal } from '../components/ActionModal';
import { PHASE_LABELS, TURN_PHASE_ORDER } from '../utils/labels';

const AI_DELAY_MS = {
  instant: 20,
  fast: 140,
  normal: 420,
  slow: 850
};

export function GameTableView() {
  const {
    theme,
    engine,
    view,
    viewerId,
    playableInfos,
    hostSettings,
    selectedCardIds,
    selectedTargetIds,
    secondaryTargetId,
    serpentSpearMode,
    woodenOxMode,
    skipSimilarNullification,
    showLogDrawer,
    toggleTheme,
    updateHostSettings,
    returnToLobby,
    toggleSelectCard,
    toggleSelectTarget,
    toggleSerpentSpearMode,
    toggleWoodenOxMode,
    setSkipSimilarNullification,
    confirmSelection,
    cancelPromptOrSelection,
    endPlayPhase,
    doubleClickCard,
    recastSelectedCard,
    respondOption,
    respondPlayerCard,
    respondHarvestCard,
    respondGeneral,
    handleTimeout,
    stepSingleAI,
    setInspectCard,
    setShowRulesModal,
    setShowLogDrawer,
    exportReplayJson
  } = useGameStore();

  const [secondsLeft, setSecondsLeft] = useState(hostSettings.timerSeconds);

  const prompt = view?.pendingPrompt ?? null;
  const rawPromptPlayer = engine?.state.pendingPrompt
    ? engine.state.players.find((p) => p.id === engine.state.pendingPrompt?.playerId)
    : null;
  const waitingForAI = Boolean(rawPromptPlayer?.isAI && !engine?.state.result);

  // Drive AI turns automatically
  useEffect(() => {
    if (!waitingForAI) return;
    const delay = AI_DELAY_MS[hostSettings.aiSpeed];
    const timer = window.setTimeout(() => {
      stepSingleAI();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [waitingForAI, engine?.state.pendingPrompt?.promptId, hostSettings.aiSpeed, stepSingleAI]);

  // Host-controlled countdown timer (can be toggled on/off anytime!)
  useEffect(() => {
    setSecondsLeft(hostSettings.timerSeconds);
  }, [prompt?.promptId, hostSettings.timerSeconds, hostSettings.timerEnabled]);

  useEffect(() => {
    if (!hostSettings.timerEnabled || !prompt || waitingForAI) return;
    const interval = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          handleTimeout();
          return hostSettings.timerSeconds;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [
    hostSettings.timerEnabled,
    hostSettings.timerSeconds,
    prompt?.promptId,
    waitingForAI,
    handleTimeout
  ]);

  const selfPlayer = view?.players.find((p) => p.id === viewerId) ?? view?.players[0];
  const otherPlayers = useMemo(() => {
    if (!view || !selfPlayer) return [];
    const idx = view.players.findIndex((p) => p.id === selfPlayer.id);
    const ordered = [];
    for (let i = 1; i < view.players.length; i++) {
      ordered.push(view.players[(idx + i) % view.players.length]);
    }
    return ordered;
  }, [view, selfPlayer]);

  // Determine which targets are currently selectable
  const selectableTargetIds = useMemo(() => {
    if (!prompt || !engine || !selfPlayer || prompt.playerId !== selfPlayer.id) {
      return new Set<string>();
    }
    if (prompt.type === 'choose_target') {
      return new Set(prompt.eligibleTargetIds);
    }
    if (prompt.type === 'play_action') {
      if (serpentSpearMode) {
        return new Set(
          engine.state.players
            .filter(
              (p) =>
                p.alive &&
                p.id !== selfPlayer.id &&
                isInAttackRange(engine.state, selfPlayer.id, p.id, engine.modifiers)
            )
            .map((p) => p.id)
        );
      }
      if (woodenOxMode) {
        return new Set(
          engine.state.players
            .filter((p) => p.alive && p.id !== selfPlayer.id)
            .map((p) => p.id)
        );
      }
      const cardId = selectedCardIds[0];
      if (!cardId) return new Set<string>();
      const info = playableInfos.find((i) => i.cardId === cardId);
      if (!info || !info.needsTarget) return new Set<string>();

      if (info.secondaryTargetsByPrimary) {
        const primary = selectedTargetIds[0];
        if (!primary) return new Set(info.eligibleTargetIds);
        return new Set([primary, ...(info.secondaryTargetsByPrimary[primary] ?? [])]);
      }
      return new Set(info.eligibleTargetIds);
    }
    return new Set<string>();
  }, [
    prompt,
    engine,
    selfPlayer,
    serpentSpearMode,
    woodenOxMode,
    selectedCardIds,
    selectedTargetIds,
    playableInfos
  ]);

  const selectedPlayInfo = useMemo(() => {
    if (prompt?.type !== 'play_action' || selectedCardIds.length !== 1) return null;
    return playableInfos.find((i) => i.cardId === selectedCardIds[0]) ?? null;
  }, [prompt, selectedCardIds, playableInfos]);

  const canConfirm = useMemo(() => {
    if (!prompt || !selfPlayer || prompt.playerId !== selfPlayer.id) return false;
    if (prompt.type === 'play_action') {
      if (serpentSpearMode) {
        return selectedCardIds.length === 2 && selectedTargetIds.length === 1;
      }
      if (woodenOxMode) {
        return selectedCardIds.length === 1;
      }
      if (!selectedPlayInfo) return false;
      if (selectedPlayInfo.secondaryTargetsByPrimary) {
        return selectedTargetIds.length === 1 && Boolean(secondaryTargetId);
      }
      if (selectedPlayInfo.needsTarget) {
        return selectedTargetIds.length >= selectedPlayInfo.minTargets;
      }
      return true;
    }
    if (prompt.type === 'choose_card') {
      const req = serpentSpearMode && prompt.canUseSerpentSpear ? 2 : prompt.minCount;
      return selectedCardIds.length >= req;
    }
    if (prompt.type === 'choose_target') {
      return selectedTargetIds.length >= prompt.minCount;
    }
    return false;
  }, [
    prompt,
    selfPlayer,
    serpentSpearMode,
    woodenOxMode,
    selectedCardIds,
    selectedTargetIds,
    secondaryTargetId,
    selectedPlayInfo
  ]);

  // Keyboard shortcuts (1-9 select hand card, Enter confirm, Esc cancel, Space end play phase)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!prompt || !selfPlayer || prompt.playerId !== selfPlayer.id) return;

      if (prompt.type === 'choose_option') {
        const num = Number(e.key);
        if (num >= 1 && num <= prompt.options.length) {
          e.preventDefault();
          respondOption(prompt.options[num - 1].id);
        }
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        confirmSelection();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelPromptOrSelection();
      } else if (e.key === ' ' && prompt.type === 'play_action') {
        e.preventDefault();
        endPlayPhase();
      } else if (/^[1-9]$/.test(e.key) && selfPlayer.hand) {
        const idx = Number(e.key) - 1;
        const card = selfPlayer.hand[idx];
        if (card) {
          e.preventDefault();
          toggleSelectCard(card.id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    prompt,
    selfPlayer,
    confirmSelection,
    cancelPromptOrSelection,
    endPlayPhase,
    toggleSelectCard,
    respondOption
  ]);

  if (!view || !selfPlayer || !engine) return null;

  const isCardSelectable = (cardId: number): boolean => {
    if (!prompt || prompt.playerId !== selfPlayer.id) return false;
    if (prompt.type === 'play_action') {
      if (serpentSpearMode) return true;
      if (woodenOxMode) return Boolean(selfPlayer.hand?.some((c) => c.id === cardId));
      return prompt.playableCardIds.includes(cardId);
    }
    if (prompt.type === 'choose_card') {
      return prompt.eligibleCardIds.includes(cardId);
    }
    return false;
  };

  const handleExport = () => {
    const json = exportReplayJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sgs-replay-${view.mode}-seed${view.seed}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selfHand = selfPlayer.hand ?? [];
  const selfOxCards = selfPlayer.woodenOxCards ?? [];
  const isPromptForSelf = Boolean(prompt && prompt.playerId === selfPlayer.id);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top Status & Host Control Bar */}
      <header className="shrink-0 h-12 px-4 border-b border-stone-300 dark:border-stone-800 bg-white/90 dark:bg-[#1B1E24] flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={returnToLobby}
            className="inline-flex items-center gap-1 text-xs font-medium text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            大厅
          </button>

          <span className="px-2 py-0.5 rounded text-xs font-bold bg-stone-900 text-white dark:bg-stone-200 dark:text-stone-900">
            {view.mode === '1v1' ? '1v1 单挑' : view.mode === '2v2' ? '2v2 欢乐成双' : '五人身份场'}
          </span>

          <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-stone-600 dark:text-stone-300">
            <span>第 {view.turn} 回合</span>
            <span className="text-stone-300 dark:text-stone-700">|</span>
            <span>牌堆 {view.drawPileCount}</span>
            <span>弃牌 {view.discardPileCount}</span>
          </div>
        </div>

        {/* 6-Phase Indicator Strip */}
        <div className="hidden md:flex items-center gap-1 bg-stone-100 dark:bg-stone-800/80 px-2 py-1 rounded-lg">
          {TURN_PHASE_ORDER.map((ph) => {
            const active = view.phase === ph;
            return (
              <span
                key={ph}
                className={[
                  'px-2 py-0.5 rounded text-[11px] font-semibold transition-colors',
                  active
                    ? 'bg-[#8B2626] text-white'
                    : 'text-stone-500 dark:text-stone-400'
                ].join(' ')}
              >
                {PHASE_LABELS[ph]}
              </span>
            );
          })}
        </div>

        {/* Right Host Controls: Live Timer Toggle, Debug Reveal, Theme, Rules, Log */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() =>
              updateHostSettings({ timerEnabled: !hostSettings.timerEnabled })
            }
            title="房主权限：随时开启/关闭操作倒计时"
            className={[
              'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors',
              hostSettings.timerEnabled
                ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-400 text-amber-800 dark:text-amber-200'
                : 'border-stone-300 dark:border-stone-700 text-stone-500'
            ].join(' ')}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{hostSettings.timerEnabled ? `计时 ${secondsLeft}s` : '计时关'}</span>
          </button>

          <button
            type="button"
            onClick={() =>
              updateHostSettings({ revealAllHands: !hostSettings.revealAllHands })
            }
            title="切换调试明牌"
            className="p-1.5 rounded-md border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            {hostSettings.revealAllHands ? (
              <Eye className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            title="切换浅/深色主题"
            className="p-1.5 rounded-md border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            {theme === 'light' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={() => setShowRulesModal(true)}
            title="规则速查"
            className="p-1.5 rounded-md border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            <BookOpen className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setShowLogDrawer(!showLogDrawer)}
            title="展开/收起战局日志"
            className={[
              'p-1.5 rounded-md border transition-colors',
              showLogDrawer
                ? 'bg-stone-900 text-white border-stone-900 dark:bg-stone-200 dark:text-stone-900'
                : 'border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300'
            ].join(' ')}
          >
            <ScrollText className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Main Tabletop + Right Collapsible Log */}
      <div className="flex-1 flex min-h-0">
        {/* Tabletop Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Upper Seats & Center Resolution Area */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col justify-between gap-4">
            {/* Opponent / Other Seats Grid */}
            <div
              className={[
                'grid gap-3 mx-auto w-full',
                otherPlayers.length === 1
                  ? 'max-w-sm grid-cols-1'
                  : otherPlayers.length === 3
                    ? 'max-w-5xl grid-cols-1 md:grid-cols-3'
                    : 'max-w-5xl grid-cols-2 lg:grid-cols-4'
              ].join(' ')}
            >
              {otherPlayers.map((p) => {
                const dist = getDistance(engine.state, selfPlayer.id, p.id, engine.modifiers);
                const isTeammate = Boolean(
                  view.mode === '2v2' && selfPlayer.team && p.team === selfPlayer.team
                );
                return (
                  <PlayerSeat
                    key={p.id}
                    player={p}
                    isActiveTurn={view.activePlayerId === p.id}
                    isSelf={false}
                    isTeammate={isTeammate}
                    distance={Number.isFinite(dist) ? dist : undefined}
                    selectable={selectableTargetIds.has(p.id)}
                    selected={selectedTargetIds.includes(p.id)}
                    secondarySelected={secondaryTargetId === p.id}
                    onSelect={() => toggleSelectTarget(p.id)}
                    onInspectCard={setInspectCard}
                  />
                );
              })}
            </div>

            {/* Center Play / Resolution Zone */}
            <div className="max-w-4xl w-full mx-auto rounded-xl border border-stone-300/80 dark:border-stone-700/80 bg-white/60 dark:bg-[#1A1D23]/80 p-3.5 flex flex-col gap-2.5">
              {/* Prompt Status Banner */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-stone-800 dark:text-stone-100">
                  {waitingForAI
                    ? `AI 正在思考：${rawPromptPlayer?.name}...`
                    : prompt
                      ? prompt.message
                      : '结算中...'}
                </div>
                {selectedPlayInfo?.secondaryTargetsByPrimary && (
                  <span className="text-[11px] font-medium text-sky-700 dark:text-sky-300">
                    {selectedTargetIds.length === 0
                      ? '第1步：点击有武器的角色'
                      : !secondaryTargetId
                        ? '第2步：点击其攻击范围内的出杀目标（可点自己）'
                        : '已选定双目标，点击确认'}
                  </span>
                )}
              </div>

              {/* Countdown Progress Bar when Host Timer enabled */}
              {hostSettings.timerEnabled && isPromptForSelf && !waitingForAI && (
                <div className="h-1.5 w-full bg-stone-200 dark:bg-stone-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 transition-all duration-1000"
                    style={{
                      width: `${Math.max(0, (secondsLeft / hostSettings.timerSeconds) * 100)}%`
                    }}
                  />
                </div>
              )}

              {/* Active Table Cards */}
              <div className="min-h-[112px] flex items-center justify-center gap-2.5 overflow-x-auto py-1">
                {view.tableCards.length === 0 ? (
                  <span className="text-xs text-stone-400">出牌展示区 · 本回合尚无出牌记录</span>
                ) : (
                  view.tableCards.map((tc, i) => (
                    <CardTile
                      key={`${tc.card.id}_${i}`}
                      card={tc.card}
                      compact
                      badgeText={tc.label ?? tc.card.shortTag}
                      onInspect={setInspectCard}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Bottom Self Operation Dock */}
          <div className="shrink-0 border-t border-stone-300 dark:border-stone-800 bg-white/95 dark:bg-[#1B1E24] p-3">
            <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-stretch gap-3">
              {/* Left: Self Seat Summary + Active Equipment Buttons */}
              <div className="lg:w-72 shrink-0 flex flex-col gap-2">
                <PlayerSeat
                  player={selfPlayer}
                  isActiveTurn={view.activePlayerId === selfPlayer.id}
                  isSelf
                  selectable={selectableTargetIds.has(selfPlayer.id)}
                  selected={selectedTargetIds.includes(selfPlayer.id)}
                  secondarySelected={secondaryTargetId === selfPlayer.id}
                  onSelect={() => toggleSelectTarget(selfPlayer.id)}
                  onInspectCard={setInspectCard}
                />

                {/* Active Equip Skills Bar (丈八蛇矛 / 木牛流马) */}
                {isPromptForSelf &&
                  ((prompt?.type === 'play_action' &&
                    (prompt.canUseSerpentSpear || prompt.canUseWoodenOx)) ||
                    (prompt?.type === 'choose_card' && prompt.canUseSerpentSpear)) && (
                    <div className="flex flex-wrap gap-1.5">
                      {((prompt.type === 'play_action' && prompt.canUseSerpentSpear) ||
                        (prompt.type === 'choose_card' && prompt.canUseSerpentSpear)) && (
                        <button
                          type="button"
                          onClick={toggleSerpentSpearMode}
                          className={[
                            'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold border transition-colors',
                            serpentSpearMode
                              ? 'bg-[#8B2626] text-white border-[#8B2626]'
                              : 'bg-stone-100 dark:bg-stone-800 border-stone-300 dark:border-stone-600'
                          ].join(' ')}
                        >
                          <Swords className="w-3.5 h-3.5" />
                          丈八蛇矛（选2牌当杀）
                        </button>
                      )}
                      {prompt.type === 'play_action' && prompt.canUseWoodenOx && (
                        <button
                          type="button"
                          onClick={toggleWoodenOxMode}
                          className={[
                            'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold border transition-colors',
                            woodenOxMode
                              ? 'bg-[#1E3A5F] text-white border-[#1E3A5F]'
                              : 'bg-stone-100 dark:bg-stone-800 border-stone-300 dark:border-stone-600'
                          ].join(' ')}
                        >
                          <Package className="w-3.5 h-3.5" />
                          木牛流马（藏牌/转移）
                        </button>
                      )}
                    </div>
                  )}
              </div>

              {/* Center: Hand Cards + Wooden Ox Stashed Cards */}
              <div className="flex-1 min-w-0 flex flex-col justify-end">
                {selfOxCards.length > 0 && (
                  <div className="mb-1.5 flex items-center gap-1.5 overflow-x-auto pb-1">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-200 shrink-0">
                      木牛流马牌 ({selfOxCards.length}/5)
                    </span>
                    {selfOxCards.map((c) => (
                      <CardTile
                        key={c.id}
                        card={c}
                        compact
                        selected={selectedCardIds.includes(c.id)}
                        disabled={!isCardSelectable(c.id)}
                        onClick={() => toggleSelectCard(c.id)}
                        onDoubleClick={() => doubleClickCard(c.id)}
                        onInspect={setInspectCard}
                      />
                    ))}
                  </div>
                )}

                <div className="flex items-end gap-2 overflow-x-auto pt-4 pb-1 px-1 min-h-[156px]">
                  {selfHand.length === 0 ? (
                    <div className="w-full text-center text-xs text-stone-400 my-auto">
                      当前空城（无手牌）
                    </div>
                  ) : (
                    selfHand.map((card, idx) => (
                      <CardTile
                        key={card.id}
                        card={card}
                        hotkey={idx < 9 ? String(idx + 1) : undefined}
                        selected={selectedCardIds.includes(card.id)}
                        disabled={!isCardSelectable(card.id)}
                        onClick={() => toggleSelectCard(card.id)}
                        onDoubleClick={() => doubleClickCard(card.id)}
                        onInspect={setInspectCard}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Right: Confirm / Recast / Cancel / End Play Phase Buttons */}
              <div className="lg:w-48 shrink-0 flex flex-col justify-end gap-2">
                {prompt?.type === 'choose_card' &&
                  prompt.trickKeyForQuickSkip &&
                  isPromptForSelf && (
                    <label className="flex items-center gap-1.5 text-[11px] text-stone-600 dark:text-stone-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={skipSimilarNullification}
                        onChange={(e) => setSkipSimilarNullification(e.target.checked)}
                      />
                      <span>本回合不再询问相同锦囊</span>
                    </label>
                  )}

                <button
                  type="button"
                  disabled={!canConfirm}
                  onClick={confirmSelection}
                  className={[
                    'w-full py-2.5 rounded-lg text-sm font-bold transition-colors',
                    canConfirm
                      ? 'bg-[#8B2626] hover:bg-[#731F1F] text-white shadow-sm'
                      : 'bg-stone-200 dark:bg-stone-800 text-stone-400 cursor-not-allowed'
                  ].join(' ')}
                >
                  {woodenOxMode
                    ? selectedTargetIds.length > 0
                      ? '扣置并转移木牛'
                      : '仅扣置手牌'
                    : '确认 (Enter)'}
                </button>

                {selectedPlayInfo?.canRecast && isPromptForSelf && (
                  <button
                    type="button"
                    onClick={recastSelectedCard}
                    className="w-full py-2 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white transition-colors"
                  >
                    重铸【铁索连环】（弃置摸1）
                  </button>
                )}

                {isPromptForSelf &&
                  (selectedCardIds.length > 0 ||
                    serpentSpearMode ||
                    woodenOxMode ||
                    (prompt?.type === 'choose_card' && prompt.optional) ||
                    (prompt?.type === 'choose_target' && prompt.optional)) && (
                    <button
                      type="button"
                      onClick={cancelPromptOrSelection}
                      className="w-full py-2 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-600 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                    >
                      {selectedCardIds.length > 0 || serpentSpearMode || woodenOxMode
                        ? '取消选择 (Esc)'
                        : '跳过 / 不响应 (Esc)'}
                    </button>
                  )}

                {prompt?.type === 'play_action' && isPromptForSelf && (
                  <button
                    type="button"
                    onClick={endPlayPhase}
                    className="w-full py-2.5 rounded-lg text-xs font-bold bg-stone-900 dark:bg-stone-200 text-white dark:text-stone-900 hover:opacity-90 transition-opacity"
                  >
                    结束出牌 (Space)
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Collapsible Structured Battle Log */}
        <BattleLog
          events={view.events}
          open={showLogDrawer}
          onClose={() => setShowLogDrawer(false)}
          onExportReplay={handleExport}
        />
      </div>

      {/* Modal Prompts (Options / Dismantle-Snatch / Harvest / General Pick) */}
      {isPromptForSelf && (
        <ActionModal
          prompt={prompt}
          onChooseOption={respondOption}
          onChoosePlayerCard={respondPlayerCard}
          onChooseHarvestCard={respondHarvestCard}
          onChooseGeneral={respondGeneral}
          onInspectCard={setInspectCard}
        />
      )}
    </div>
  );
}
