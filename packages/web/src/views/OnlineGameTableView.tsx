import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Bot,
  Check,
  Clock,
  Copy,
  Eye,
  Home,
  MessageSquare,
  Moon,
  Package,
  RotateCcw,
  ScrollText,
  Sparkles,
  Sun,
  Swords,
  Trophy,
  Volume2,
  VolumeX,
  WifiOff
} from 'lucide-react';
import { useGameStore } from '../store/gameStore';
import { buildRoomInviteUrl, useOnlineStore } from '../store/onlineStore';
import { CardTile } from '../components/CardTile';
import { PlayerSeat } from '../components/PlayerSeat';
import { BattleLog } from '../components/BattleLog';
import { ActionModal } from '../components/ActionModal';
import { ChatDrawer } from '../components/ChatDrawer';
import { FACTION_META, PHASE_LABELS, ROLE_META, TURN_PHASE_ORDER } from '../utils/labels';
import { playTurnAlert } from '../utils/sound';

const DEFAULT_TITLE = '极简三国杀 · Minimal Sanguosha';

export function OnlineGameTableView() {
  const {
    theme,
    showLogDrawer,
    toggleTheme,
    setInspectCard,
    setShowRulesModal,
    setShowLogDrawer
  } = useGameStore();

  const {
    room,
    gamePayload,
    timer,
    serverTimeOffsetMs,
    errorMessage,
    infoNotice,
    muted,
    chatOpen,
    unreadChatCount,
    selectedCardIds,
    selectedTargetIds,
    secondaryTargetId,
    activeSkillId,
    serpentSpearMode,
    woodenOxMode,
    skipSimilarNullification,
    setMuted,
    setChatOpen,
    clearError,
    leaveRoom,
    updateRoomConfig,
    takeoverAI,
    rematchLobby,
    sendChat,
    toggleSelectCard,
    toggleSelectTarget,
    toggleActiveSkill,
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
    respondGuanxing
  } = useOnlineStore();

  const [copied, setCopied] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const lastAlertedPromptRef = useRef<string | null>(null);

  const view = gamePayload?.view ?? null;
  const prompt = view?.pendingPrompt ?? null;
  const isHost = Boolean(room?.you.isHost);
  const isSpectator = Boolean(room?.you.isSpectator);

  // Sync smooth countdown tick from authoritative server deadline
  useEffect(() => {
    if (!timer?.enabled || !timer.deadlineTs) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [timer?.enabled, timer?.deadlineTs, timer?.promptId]);

  const remainingMs = useMemo(() => {
    if (!timer?.enabled || !timer.deadlineTs) return null;
    const estServerNow = nowMs + serverTimeOffsetMs;
    return Math.max(0, timer.deadlineTs - estServerNow);
  }, [timer, nowMs, serverTimeOffsetMs]);

  const secondsLeft = remainingMs !== null ? Math.ceil(remainingMs / 1000) : timer?.seconds ?? 20;

  const selfPlayer = useMemo(() => {
    if (!view) return null;
    if (room?.you.playerId) {
      return view.players.find((p) => p.id === room.you.playerId) ?? view.players[0];
    }
    return view.players[0];
  }, [view, room?.you.playerId]);

  const otherPlayers = useMemo(() => {
    if (!view || !selfPlayer) return [];
    const idx = view.players.findIndex((p) => p.id === selfPlayer.id);
    const ordered = [];
    for (let i = 1; i < view.players.length; i++) {
      ordered.push(view.players[(idx + i) % view.players.length]);
    }
    return ordered;
  }, [view, selfPlayer]);

  const isPromptForSelf = Boolean(
    !isSpectator &&
      gamePayload?.canControl &&
      prompt &&
      selfPlayer &&
      prompt.playerId === selfPlayer.id
  );

  // Turn Alert: Web Audio chime + tab title blinking when waiting on our own input!
  useEffect(() => {
    if (!isPromptForSelf || !prompt) {
      document.title = DEFAULT_TITLE;
      return;
    }

    if (lastAlertedPromptRef.current !== prompt.promptId) {
      lastAlertedPromptRef.current = prompt.promptId;
      if (!muted) {
        playTurnAlert();
      }
    }

    let flash = true;
    document.title = '【轮到你操作】极简三国杀';
    const interval = window.setInterval(() => {
      flash = !flash;
      document.title = flash ? '【轮到你操作】极简三国杀' : DEFAULT_TITLE;
    }, 900);

    return () => {
      window.clearInterval(interval);
      document.title = DEFAULT_TITLE;
    };
  }, [isPromptForSelf, prompt?.promptId, muted]);

  const activeSkillInfo = useMemo(() => {
    if (prompt?.type !== 'play_action' || !activeSkillId) return null;
    return prompt.usableSkills.find((s) => s.skillId === activeSkillId) ?? null;
  }, [prompt, activeSkillId]);

  const selectableTargetIds = useMemo(() => {
    if (!isPromptForSelf || !prompt || !gamePayload || !selfPlayer) {
      return new Set<string>();
    }
    if (prompt.type === 'choose_target') {
      return new Set(prompt.eligibleTargetIds);
    }
    if (prompt.type === 'play_action') {
      if (activeSkillInfo) {
        return new Set(activeSkillInfo.eligibleTargetIds);
      }
      if (serpentSpearMode) {
        return new Set(gamePayload.serpentSpearTargetIds);
      }
      if (woodenOxMode) {
        return new Set(
          gamePayload.view.players
            .filter((p) => p.alive && p.id !== selfPlayer.id)
            .map((p) => p.id)
        );
      }
      const cardId = selectedCardIds[0];
      if (!cardId) return new Set<string>();
      const info = gamePayload.playableInfos.find((i) => i.cardId === cardId);
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
    isPromptForSelf,
    prompt,
    gamePayload,
    selfPlayer,
    activeSkillInfo,
    serpentSpearMode,
    woodenOxMode,
    selectedCardIds,
    selectedTargetIds
  ]);

  const selectedPlayInfo = useMemo(() => {
    if (
      !gamePayload ||
      prompt?.type !== 'play_action' ||
      activeSkillInfo ||
      selectedCardIds.length !== 1
    ) {
      return null;
    }
    return gamePayload.playableInfos.find((i) => i.cardId === selectedCardIds[0]) ?? null;
  }, [gamePayload, prompt, activeSkillInfo, selectedCardIds]);

  const canConfirm = useMemo(() => {
    if (!isPromptForSelf || !prompt) return false;
    if (prompt.type === 'play_action') {
      if (activeSkillInfo) {
        return (
          selectedCardIds.length >= activeSkillInfo.cardMin &&
          selectedCardIds.length <= activeSkillInfo.cardMax &&
          selectedTargetIds.length >= activeSkillInfo.targetMin &&
          selectedTargetIds.length <= activeSkillInfo.targetMax
        );
      }
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
    isPromptForSelf,
    prompt,
    activeSkillInfo,
    serpentSpearMode,
    woodenOxMode,
    selectedCardIds,
    selectedTargetIds,
    secondaryTargetId,
    selectedPlayInfo
  ]);

  const selectableCardIdSet = useMemo(() => {
    const out = new Set<number>();
    if (!isPromptForSelf || !prompt || !selfPlayer) return out;
    if (prompt.type === 'play_action') {
      if (activeSkillInfo) {
        for (const id of activeSkillInfo.eligibleCardIds) out.add(id);
      } else if (serpentSpearMode) {
        for (const c of selfPlayer.hand ?? []) out.add(c.id);
        for (const c of selfPlayer.woodenOxCards ?? []) out.add(c.id);
      } else if (woodenOxMode) {
        for (const c of selfPlayer.hand ?? []) out.add(c.id);
      } else {
        for (const id of prompt.playableCardIds) out.add(id);
      }
    } else if (prompt.type === 'choose_card') {
      for (const id of prompt.eligibleCardIds) out.add(id);
    }
    return out;
  }, [isPromptForSelf, prompt, selfPlayer, activeSkillInfo, serpentSpearMode, woodenOxMode]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!isPromptForSelf || !prompt || !selfPlayer) return;

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
    isPromptForSelf,
    prompt,
    selfPlayer,
    confirmSelection,
    cancelPromptOrSelection,
    endPlayPhase,
    toggleSelectCard,
    respondOption
  ]);

  if (!room || !gamePayload || !view || !selfPlayer) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-stone-500">
        正在同步权威战局状态...
      </div>
    );
  }

  // Online Match Summary Screen
  if (view.result) {
    const { result } = view;
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-3xl w-full rounded-2xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-[#1E2128] shadow-xl overflow-hidden">
          <div className="bg-stone-900 dark:bg-stone-950 text-white px-6 py-6 flex items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 text-amber-400 text-xs font-bold uppercase tracking-wider">
                <Trophy className="w-4 h-4" />
                联机结算 · 房间 {room.roomCode} · 共 {result.totalTurns} 回合
              </div>
              <h2 className="font-serif font-bold text-2xl mt-1">{result.winnerTeam} 获胜</h2>
              <p className="text-sm text-stone-300 mt-1">{result.reason}</p>
            </div>
            <div className="text-right font-mono text-xs text-stone-400 shrink-0">
              <div>模式：{view.mode}</div>
              <div>Seed：{view.seed}</div>
            </div>
          </div>

          <div className="p-6">
            <div className="overflow-x-auto">
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

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={leaveRoom}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-600 hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                <Home className="w-4 h-4" />
                离开房间
              </button>

              {isHost ? (
                <button
                  type="button"
                  onClick={rematchLobby}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-xs font-bold bg-[#8B2626] hover:bg-[#731F1F] text-white"
                >
                  <RotateCcw className="w-4 h-4" />
                  返回房间大厅（原班人马再来一局）
                </button>
              ) : (
                <span className="text-xs text-stone-500">等待房主开启下一局...</span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const disconnectedSeats = room.seats.filter((s) => s.kind === 'human' && !s.connected);
  const selfHand = selfPlayer.hand ?? [];
  const selfOxCards = selfPlayer.woodenOxCards ?? [];
  const isCardSelectable = (cardId: number): boolean => selectableCardIdSet.has(cardId);

  const handleCopyInvite = async () => {
    const inviteUrl = buildRoomInviteUrl(room.roomCode);
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('复制房间链接：', inviteUrl);
    }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top Bar */}
      <header className="shrink-0 h-12 px-4 border-b border-stone-300 dark:border-stone-800 bg-white/95 dark:bg-[#1B1E24] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={leaveRoom}
            className="inline-flex items-center gap-1 text-xs font-medium text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            退出
          </button>

          <button
            type="button"
            onClick={handleCopyInvite}
            title="点击复制好友观战/邀请链接"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-bold bg-stone-900 text-white dark:bg-amber-600"
          >
            <span>{room.roomCode}</span>
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </button>

          {isSpectator && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-200">
              <Eye className="w-3 h-3" />
              观战席
            </span>
          )}

          <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-stone-600 dark:text-stone-300">
            <span>第 {view.turn} 回合</span>
            <span className="text-stone-300 dark:text-stone-700">|</span>
            <span>牌堆 {view.drawPileCount}</span>
            <span>弃牌 {view.discardPileCount}</span>
          </div>
        </div>

        {/* 6-Phase Strip */}
        <div className="hidden md:flex items-center gap-1 bg-stone-100 dark:bg-stone-800/80 px-2 py-1 rounded-lg">
          {TURN_PHASE_ORDER.map((ph) => (
            <span
              key={ph}
              className={[
                'px-2 py-0.5 rounded text-[11px] font-semibold transition-colors',
                view.phase === ph
                  ? 'bg-[#8B2626] text-white'
                  : 'text-stone-500 dark:text-stone-400'
              ].join(' ')}
            >
              {PHASE_LABELS[ph]}
            </span>
          ))}
        </div>

        {/* Right Controls: Authoritative Host Timer, Mute, Chat, Theme, Rules, Log */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="inline-flex items-center rounded-md border border-stone-300 dark:border-stone-700 overflow-hidden">
            <button
              type="button"
              disabled={!isHost}
              onClick={() =>
                updateRoomConfig({ timerEnabled: !room.config.timerEnabled })
              }
              title={isHost ? '房主权限：随时开启/关闭服务端权威倒计时' : '服务端权威倒计时'}
              className={[
                'inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold transition-colors',
                room.config.timerEnabled
                  ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200'
                  : 'text-stone-500',
                !isHost ? 'cursor-default' : ''
              ].join(' ')}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>
                {room.config.timerEnabled
                  ? remainingMs !== null
                    ? `${secondsLeft}s`
                    : `${room.config.timerSeconds}s`
                  : '计时关'}
              </span>
            </button>
            {room.config.timerEnabled && isHost && (
              <select
                value={room.config.timerSeconds}
                onChange={(e) =>
                  updateRoomConfig({ timerSeconds: Number(e.target.value) })
                }
                title="房主调整倒计时秒数"
                className="text-[11px] font-mono bg-transparent border-l border-stone-300 dark:border-stone-700 px-1 py-1 outline-none"
              >
                <option value={10}>10s</option>
                <option value={15}>15s</option>
                <option value={20}>20s</option>
                <option value={30}>30s</option>
              </select>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMuted(!muted)}
            title={muted ? '已静音（点击开启轮次提示音）' : '点击静音轮次提示音'}
            className="p-1.5 rounded-md border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            {muted ? <VolumeX className="w-3.5 h-3.5 text-stone-400" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={() => setChatOpen(!chatOpen)}
            title="房间聊天"
            className={[
              'relative p-1.5 rounded-md border transition-colors',
              chatOpen
                ? 'bg-[#1E3A5F] text-white border-[#1E3A5F]'
                : 'border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300'
            ].join(' ')}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            {unreadChatCount > 0 && !chatOpen && (
              <span className="absolute -top-1 -right-1 px-1 min-w-[16px] h-4 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
                {unreadChatCount > 9 ? '9+' : unreadChatCount}
              </span>
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

      {/* Disconnected Seats & Host AI Takeover Banner */}
      {(disconnectedSeats.length > 0 || errorMessage || infoNotice) && (
        <div className="shrink-0 px-4 py-1.5 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-300 dark:border-amber-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            {disconnectedSeats.map((s) => (
              <div key={s.seatIndex} className="inline-flex items-center gap-2 text-amber-900 dark:text-amber-200">
                <WifiOff className="w-3.5 h-3.5 text-rose-600" />
                <span>
                  {s.seatIndex + 1}号·{s.name}{' '}
                  {s.aiTakeover ? '（AI 托管中，重连可随时收回）' : '已断线（等待重连）'}
                </span>
                {isHost && !s.aiTakeover && (
                  <button
                    type="button"
                    onClick={() => takeoverAI(s.seatIndex)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-stone-900 text-white dark:bg-amber-600 text-[11px] font-bold hover:opacity-90"
                  >
                    <Bot className="w-3 h-3" />
                    切换 AI 托管
                  </button>
                )}
              </div>
            ))}
            {(errorMessage || infoNotice) && (
              <span className="text-rose-700 dark:text-rose-300 font-semibold">
                {errorMessage || infoNotice}
              </span>
            )}
          </div>
          {(errorMessage || infoNotice) && (
            <button type="button" onClick={clearError} className="underline text-[11px]">
              忽略
            </button>
          )}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          {/* Upper Seats & Center Table */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col justify-between gap-4">
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
                const dist = gamePayload.distancesFromViewer[p.id];
                const isTeammate = Boolean(
                  !isSpectator &&
                    view.mode === '2v2' &&
                    selfPlayer.team &&
                    p.team === selfPlayer.team
                );
                return (
                  <PlayerSeat
                    key={p.id}
                    player={p}
                    isActiveTurn={view.activePlayerId === p.id}
                    isSelf={false}
                    isTeammate={isTeammate}
                    distance={dist}
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-stone-800 dark:text-stone-100">
                  {gamePayload.waitingMessage}
                </div>
                {activeSkillInfo && (
                  <span className="text-[11px] font-medium text-amber-800 dark:text-amber-300">
                    【{activeSkillInfo.name}】{activeSkillInfo.description}
                    {activeSkillInfo.cardMax > 0
                      ? ` · 已选牌 ${selectedCardIds.length}/${activeSkillInfo.cardMin === activeSkillInfo.cardMax ? activeSkillInfo.cardMax : `${activeSkillInfo.cardMin}~${activeSkillInfo.cardMax}`}`
                      : ''}
                    {activeSkillInfo.targetMax > 0
                      ? ` · 已选目标 ${selectedTargetIds.length}/${activeSkillInfo.targetMin === activeSkillInfo.targetMax ? activeSkillInfo.targetMax : `${activeSkillInfo.targetMin}~${activeSkillInfo.targetMax}`}`
                      : ''}
                  </span>
                )}
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

              {/* Authoritative Server Countdown Bar */}
              {timer?.enabled && remainingMs !== null && (
                <div className="h-1.5 w-full bg-stone-200 dark:bg-stone-800 rounded-full overflow-hidden">
                  <div
                    className={[
                      'h-full transition-all duration-200',
                      secondsLeft <= 5 ? 'bg-rose-600' : 'bg-amber-500'
                    ].join(' ')}
                    style={{
                      width: `${Math.max(0, Math.min(100, (remainingMs / (timer.seconds * 1000)) * 100))}%`
                    }}
                  />
                </div>
              )}

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

          {/* Bottom Dock */}
          <div className="shrink-0 border-t border-stone-300 dark:border-stone-800 bg-white/95 dark:bg-[#1B1E24] p-3">
            <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-stretch gap-3">
              <div className="lg:w-72 shrink-0 flex flex-col gap-2">
                <PlayerSeat
                  player={selfPlayer}
                  isActiveTurn={view.activePlayerId === selfPlayer.id}
                  isSelf={!isSpectator}
                  selectable={selectableTargetIds.has(selfPlayer.id)}
                  selected={selectedTargetIds.includes(selfPlayer.id)}
                  secondarySelected={secondaryTargetId === selfPlayer.id}
                  selectableCardIds={selectableCardIdSet}
                  selectedCardIds={selectedCardIds}
                  onSelect={() => toggleSelectTarget(selfPlayer.id)}
                  onToggleSelectCard={toggleSelectCard}
                  onInspectCard={setInspectCard}
                />

                {isPromptForSelf &&
                  ((prompt?.type === 'play_action' &&
                    (prompt.usableSkills.length > 0 ||
                      prompt.canUseSerpentSpear ||
                      prompt.canUseWoodenOx)) ||
                    (prompt?.type === 'choose_card' && prompt.canUseSerpentSpear)) && (
                    <div className="flex flex-wrap gap-1.5">
                      {prompt.type === 'play_action' &&
                        prompt.usableSkills.map((sk) => {
                          const isActive = activeSkillId === sk.skillId;
                          return (
                            <button
                              key={sk.skillId}
                              type="button"
                              onClick={() => toggleActiveSkill(sk.skillId)}
                              title={sk.description}
                              className={[
                                'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold border transition-colors',
                                isActive
                                  ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                                  : 'bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-700 hover:bg-amber-100'
                              ].join(' ')}
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              {sk.name}
                            </button>
                          );
                        })}
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
                          丈八蛇矛
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
                          木牛流马
                        </button>
                      )}
                    </div>
                  )}
              </div>

              {/* Hand Area */}
              <div className="flex-1 min-w-0 flex flex-col justify-end">
                {isSpectator ? (
                  <div className="h-[156px] flex flex-col items-center justify-center text-xs text-stone-400 gap-1">
                    <Eye className="w-5 h-5 opacity-60" />
                    <span>实时观战席 · 遵循权威防作弊规则，不展示任何玩家手牌与暗置身份</span>
                  </div>
                ) : (
                  <>
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
                  </>
                )}
              </div>

              {/* Action Buttons */}
              {!isSpectator && (
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
                    {activeSkillInfo
                      ? `发动【${activeSkillInfo.name}】`
                      : woodenOxMode
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
                      activeSkillId ||
                      serpentSpearMode ||
                      woodenOxMode ||
                      (prompt?.type === 'choose_card' && prompt.optional) ||
                      (prompt?.type === 'choose_target' && prompt.optional)) && (
                      <button
                        type="button"
                        onClick={cancelPromptOrSelection}
                        className="w-full py-2 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-600 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                      >
                        {selectedCardIds.length > 0 ||
                        activeSkillId ||
                        serpentSpearMode ||
                        woodenOxMode
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
              )}
            </div>
          </div>
        </div>

        {/* Collapsible Chat Drawer */}
        <ChatDrawer
          messages={room.chat}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          onSend={sendChat}
        />

        {/* Collapsible Battle Log */}
        <BattleLog
          events={view.events}
          open={showLogDrawer}
          onClose={() => setShowLogDrawer(false)}
          onExportReplay={() => {
            const blob = new Blob([JSON.stringify(view.events, null, 2)], {
              type: 'application/json'
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `sgs-online-${room.roomCode}-log.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        />
      </div>

      {isPromptForSelf && (
        <ActionModal
          prompt={prompt}
          onChooseOption={respondOption}
          onChoosePlayerCard={respondPlayerCard}
          onChooseHarvestCard={respondHarvestCard}
          onChooseGeneral={respondGeneral}
          onChooseGuanxing={respondGuanxing}
          onInspectCard={setInspectCard}
        />
      )}
    </div>
  );
}
