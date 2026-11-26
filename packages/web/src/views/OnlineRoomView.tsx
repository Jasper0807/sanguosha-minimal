import { useState } from 'react';
import type { GameMode } from '@sgs/engine';
import {
  ArrowLeft,
  BookOpen,
  Bot,
  Check,
  Clock,
  Copy,
  Crown,
  Eye,
  Moon,
  Play,
  Sun,
  User,
  UserMinus,
  UserPlus,
  Wifi,
  WifiOff
} from 'lucide-react';
import { useGameStore } from '../store/gameStore';
import { useOnlineStore } from '../store/onlineStore';
import { ChatDrawer } from '../components/ChatDrawer';

export function OnlineRoomView() {
  const { theme, toggleTheme, setShowRulesModal } = useGameStore();
  const {
    status,
    room,
    errorMessage,
    infoNotice,
    clearError,
    leaveRoom,
    swapSeat,
    setReady,
    updateRoomConfig,
    addAI,
    removeAI,
    kickSeat,
    transferHost,
    startOnlineGame,
    sendChat
  } = useOnlineStore();

  const [copied, setCopied] = useState(false);

  if (!room) return null;

  const inviteUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?room=${room.roomCode}`
      : `/?room=${room.roomCode}`;

  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('复制以下房间邀请链接发送给好友：', inviteUrl);
    }
  };

  const isHost = room.you.isHost;
  const mySeat =
    room.you.seatIndex !== null ? room.seats[room.you.seatIndex] ?? null : null;

  const hasEmptySeat = room.seats.some((s) => s.kind === 'empty');
  const unreadySeat = room.seats.find(
    (s) => s.kind === 'human' && !s.isHost && !s.ready
  );
  const canStart = isHost && !hasEmptySeat && !unreadySeat;

  const startBlockReason = hasEmptySeat
    ? '还有空位未填满（等待好友加入或点击「+ AI」补位）'
    : unreadySeat
      ? `等待 ${unreadySeat.name} 点击准备`
      : null;

  const fillEmptyWithAI = () => {
    room.seats.forEach((s) => {
      if (s.kind === 'empty') addAI(s.seatIndex);
    });
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-stone-300 dark:border-stone-800 bg-white/90 dark:bg-[#1B1E24]/95 px-5 py-3">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={leaveRoom}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              离开房间
            </button>

            <div className="flex items-center gap-2">
              <span className="text-xs text-stone-500">房间号</span>
              <span className="font-mono font-bold text-base tracking-widest px-2.5 py-0.5 rounded-md bg-stone-900 text-white dark:bg-amber-600">
                {room.roomCode}
              </span>
              <button
                type="button"
                onClick={handleCopyInvite}
                className={[
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors',
                  copied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[#8B2626] hover:bg-[#731F1F] text-white'
                ].join(' ')}
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? '已复制邀请链接！' : '复制好友邀请链接'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={[
                'inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold',
                status === 'connected'
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                  : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
              ].join(' ')}
            >
              {status === 'connected' ? (
                <Wifi className="w-3 h-3" />
              ) : (
                <WifiOff className="w-3 h-3" />
              )}
              {status === 'connected' ? '已联机' : '重连中...'}
            </span>

            <button
              type="button"
              onClick={() => setShowRulesModal(true)}
              className="p-2 rounded-lg border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800"
              title="规则速查"
            >
              <BookOpen className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 rounded-lg border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800"
              title="切换浅/深色主题"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Alerts */}
      {(errorMessage || infoNotice) && (
        <div className="max-w-6xl w-full mx-auto px-5 pt-4">
          <div className="rounded-lg px-4 py-2.5 text-xs font-medium bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 flex items-center justify-between">
            <span>{errorMessage || infoNotice}</span>
            <button type="button" onClick={clearError} className="underline ml-3">
              关闭
            </button>
          </div>
        </div>
      )}

      {/* Main Layout */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-5 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 cols: Seats + Spectators + Config */}
        <div className="lg:col-span-7 space-y-5">
          {/* Invite Link Box */}
          <section className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-[#1E2128] p-4 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-bold text-stone-700 dark:text-stone-200">
                免注册邀请链接（发给好友打开即可直接入座）
              </div>
              <div className="font-mono text-xs text-stone-500 truncate mt-0.5">{inviteUrl}</div>
            </div>
            <button
              type="button"
              onClick={handleCopyInvite}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-600 hover:bg-stone-100 dark:hover:bg-stone-800 shrink-0"
            >
              {copied ? '已复制' : '复制链接'}
            </button>
          </section>

          {/* Seats Card */}
          <section className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-[#1E2128] p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="text-sm font-bold">
                  房间座位（{room.seats.filter((s) => s.kind !== 'empty').length}/{room.seats.length}）
                </h2>
                <p className="text-[11px] text-stone-500">
                  点击任意空位可自由换座或从观战席入座
                </p>
              </div>
              {isHost && hasEmptySeat && (
                <button
                  type="button"
                  onClick={fillEmptyWithAI}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-200 border border-sky-300 dark:border-sky-700 hover:bg-sky-100"
                >
                  <Bot className="w-3.5 h-3.5" />
                  一键 AI 补满空位
                </button>
              )}
            </div>

            <div className="space-y-2.5">
              {room.seats.map((seat) => {
                const isMe = room.you.seatIndex === seat.seatIndex;
                const team2v2 =
                  room.config.mode === '2v2'
                    ? seat.seatIndex === 0 || seat.seatIndex === 3
                      ? '蓝队'
                      : '红队'
                    : null;

                return (
                  <div
                    key={seat.seatIndex}
                    className={[
                      'flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border transition-colors',
                      isMe
                        ? 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/20'
                        : 'border-stone-200 dark:border-stone-700 bg-stone-50/60 dark:bg-stone-900/40'
                    ].join(' ')}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono text-xs font-bold text-stone-500 w-7">
                        #{seat.seatIndex + 1}
                      </span>
                      {team2v2 && (
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            team2v2 === '蓝队'
                              ? 'bg-[#1E3A5F] text-white'
                              : 'bg-[#8B2626] text-white'
                          }`}
                        >
                          {team2v2}
                        </span>
                      )}

                      {seat.kind === 'empty' ? (
                        <span className="text-xs text-stone-400 italic">空位（等待加入）</span>
                      ) : (
                        <div className="flex items-center gap-1.5 min-w-0">
                          {seat.kind === 'ai' ? (
                            <Bot className="w-4 h-4 text-sky-600 shrink-0" />
                          ) : (
                            <User className="w-4 h-4 text-stone-700 dark:text-stone-200 shrink-0" />
                          )}
                          <span className="text-sm font-semibold truncate">
                            {seat.name}
                            {isMe ? '（你）' : ''}
                          </span>
                          {seat.isHost && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-100">
                              <Crown className="w-3 h-3" />
                              房主
                            </span>
                          )}
                          {seat.kind === 'human' && !seat.connected && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">
                              断线重连中
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {seat.kind === 'empty' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => swapSeat(seat.seatIndex)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold border border-stone-300 dark:border-stone-600 hover:bg-stone-100 dark:hover:bg-stone-800"
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            坐这里
                          </button>
                          {isHost && (
                            <button
                              type="button"
                              onClick={() => addAI(seat.seatIndex)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-200 border border-sky-300 dark:border-sky-700"
                            >
                              <Bot className="w-3.5 h-3.5" />
                              + AI
                            </button>
                          )}
                        </>
                      ) : seat.kind === 'ai' ? (
                        <>
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200">
                            AI 已就绪
                          </span>
                          {isHost && (
                            <button
                              type="button"
                              onClick={() => removeAI(seat.seatIndex)}
                              className="px-2 py-1 rounded text-xs font-semibold border border-stone-300 dark:border-stone-600 hover:bg-rose-50 hover:text-rose-700"
                            >
                              移除 AI
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <span
                            className={[
                              'px-2 py-0.5 rounded text-[11px] font-semibold',
                              seat.ready
                                ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200'
                                : 'bg-stone-200 dark:bg-stone-800 text-stone-600 dark:text-stone-400'
                            ].join(' ')}
                          >
                            {seat.isHost ? '房主' : seat.ready ? '已准备' : '未准备'}
                          </span>
                          {isHost && !isMe && (
                            <>
                              {seat.connected && (
                                <button
                                  type="button"
                                  onClick={() => transferHost(seat.seatIndex)}
                                  title="移交房主权限"
                                  className="p-1.5 rounded border border-stone-300 dark:border-stone-600 hover:bg-amber-50 text-amber-700 dark:text-amber-300"
                                >
                                  <Crown className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => kickSeat(seat.seatIndex)}
                                title="踢出房间"
                                className="p-1.5 rounded border border-stone-300 dark:border-stone-600 hover:bg-rose-50 text-rose-700 dark:text-rose-300"
                              >
                                <UserMinus className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Spectators */}
            {room.spectators.length > 0 && (
              <div className="mt-4 pt-3 border-t border-stone-200 dark:border-stone-800 flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 text-stone-500 font-semibold">
                  <Eye className="w-3.5 h-3.5" />
                  观战席 ({room.spectators.length})：
                </span>
                {room.spectators.map((sp) => (
                  <span
                    key={sp.id}
                    className="px-2 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200"
                  >
                    {sp.name}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Room Rules & Host Timer Config */}
          <section className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-[#1E2128] p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">
                对局规则配置{isHost ? '（房主可调）' : '（由房主配置）'}
              </h2>
              <span className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
                服务端权威防作弊 · 自动隔离手牌与身份
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(['1v1', '2v2', 'identity5'] as GameMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={!isHost}
                  onClick={() => updateRoomConfig({ mode: m })}
                  className={[
                    'px-3 py-2 rounded-lg text-xs font-bold border-2 transition-colors',
                    room.config.mode === m
                      ? 'border-stone-900 dark:border-amber-400 bg-stone-50 dark:bg-stone-800'
                      : 'border-stone-200 dark:border-stone-700 opacity-75',
                    !isHost ? 'cursor-default' : ''
                  ].join(' ')}
                >
                  {m === '1v1' ? '1v1 单挑 (2人)' : m === '2v2' ? '2v2 欢乐成双 (4人)' : '五人身份场 (5人)'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700">
                <span className="text-stone-500">牌堆</span>
                {isHost ? (
                  <select
                    value={room.config.deckVariant}
                    onChange={(e) =>
                      updateRoomConfig({
                        deckVariant: e.target.value as 'standard_ex' | 'junzheng_161'
                      })
                    }
                    className="bg-transparent font-semibold outline-none"
                  >
                    <option value="junzheng_161">军争篇全量 (161张)</option>
                    <option value="standard_ex">标准 + EX (108张)</option>
                  </select>
                ) : (
                  <span className="font-semibold">
                    {room.config.deckVariant === 'junzheng_161' ? '军争 161张' : '标准+EX 108张'}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700">
                <span className="text-stone-500">武将包</span>
                {isHost ? (
                  <select
                    value={room.config.generalPack}
                    onChange={(e) =>
                      updateRoomConfig({
                        generalPack: e.target.value as
                          | 'standard'
                          | 'limit_break'
                          | 'expansion'
                          | 'all'
                          | 'blank'
                      })
                    }
                    className="bg-transparent font-semibold outline-none"
                  >
                    <option value="all">全武将混池 (OL 89将)</option>
                    <option value="expansion">风林火山 (OL 32将)</option>
                    <option value="limit_break">界限突破 (OL 30将)</option>
                    <option value="standard">标准包 (OL 27将)</option>
                    <option value="blank">白板测试将</option>
                  </select>
                ) : (
                  <span className="font-semibold">
                    {room.config.generalPack === 'all'
                      ? '全武将混池 89将'
                      : room.config.generalPack === 'expansion'
                        ? '风林火山 32将'
                        : room.config.generalPack === 'limit_break'
                          ? '界限突破 30将'
                          : room.config.generalPack === 'standard'
                            ? '标准包 27将'
                            : '白板测试将'}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-stone-200 dark:border-stone-800 text-xs">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!isHost}
                  checked={room.config.freeGeneralPick}
                  onChange={(e) => updateRoomConfig({ freeGeneralPick: e.target.checked })}
                />
                <span>自由点将模式（不限随机候选）</span>
              </label>

              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!isHost}
                    checked={room.config.timerEnabled}
                    onChange={(e) => updateRoomConfig({ timerEnabled: e.target.checked })}
                  />
                  <span>权威倒计时</span>
                </label>
                {room.config.timerEnabled && (
                  <select
                    disabled={!isHost}
                    value={room.config.timerSeconds}
                    onChange={(e) =>
                      updateRoomConfig({ timerSeconds: Number(e.target.value) })
                    }
                    className="px-1.5 py-0.5 rounded border border-stone-300 dark:border-stone-700 bg-transparent font-mono"
                  >
                    <option value={10}>10s</option>
                    <option value={15}>15s</option>
                    <option value={20}>20s</option>
                    <option value={30}>30s</option>
                  </select>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* Right 5 cols: Action Button + Room Chat */}
        <div className="lg:col-span-5 space-y-5">
          {/* Launch / Ready Card */}
          <section className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-[#1E2128] p-5 shadow-sm space-y-3">
            {isHost ? (
              <>
                <button
                  type="button"
                  disabled={!canStart}
                  onClick={startOnlineGame}
                  className={[
                    'w-full py-3.5 rounded-xl font-serif font-bold text-base shadow-md transition-all flex items-center justify-center gap-2',
                    canStart
                      ? 'bg-[#8B2626] hover:bg-[#731F1F] text-white'
                      : 'bg-stone-200 dark:bg-stone-800 text-stone-400 cursor-not-allowed'
                  ].join(' ')}
                >
                  <Play className="w-5 h-5 fill-current" />
                  开始联机对局
                </button>
                {startBlockReason && (
                  <p className="text-xs text-center text-stone-500">{startBlockReason}</p>
                )}
              </>
            ) : mySeat ? (
              <button
                type="button"
                onClick={() => setReady(!mySeat.ready)}
                className={[
                  'w-full py-3.5 rounded-xl font-serif font-bold text-base shadow-md transition-all',
                  mySeat.ready
                    ? 'bg-stone-200 dark:bg-stone-700 text-stone-800 dark:text-stone-100 hover:bg-stone-300'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                ].join(' ')}
              >
                {mySeat.ready ? '取消准备' : '点击准备'}
              </button>
            ) : (
              <div className="text-center text-xs text-stone-500 py-2">
                你当前在观战席。对局开始后将自动进入实时观战画面，或点击左侧任意空位入座参战。
              </div>
            )}
          </section>

          <ChatDrawer messages={room.chat} open embedded onSend={sendChat} />
        </div>
      </main>
    </div>
  );
}
