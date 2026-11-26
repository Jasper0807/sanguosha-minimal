import { useEffect, useState } from 'react';
import type { DeckVariant, GameMode, SeatConfig } from '@sgs/engine';
import {
  BookOpen,
  Bot,
  Clock,
  Dices,
  Eye,
  Globe,
  Link2,
  LogIn,
  Moon,
  Play,
  PlusCircle,
  Sun,
  Swords,
  User,
  Users
} from 'lucide-react';
import { useGameStore, type AISpeed } from '../store/gameStore';
import { useOnlineStore } from '../store/onlineStore';

interface LobbyViewProps {
  availableModes?: GameMode[];
  availableDecks?: DeckVariant[];
  initialRoomCode?: string | null;
}

export function LobbyView({
  availableModes = ['1v1'],
  availableDecks = ['standard_ex'],
  initialRoomCode = null
}: LobbyViewProps) {
  const {
    theme,
    mode,
    deckVariant,
    generalPack,
    seed,
    seats,
    hostSettings,
    toggleTheme,
    setMode,
    setDeckVariant,
    setGeneralPack,
    setSeed,
    randomizeSeed,
    updateSeat,
    setAllOpponentsAI,
    updateHostSettings,
    startNewGame,
    setShowRulesModal
  } = useGameStore();

  const {
    nickname,
    status: wsStatus,
    detectedTransport,
    errorMessage: onlineError,
    probeTransport,
    setNickname,
    createRoom,
    joinRoom,
    clearError
  } = useOnlineStore();

  const [lobbyTab, setLobbyTab] = useState<'local' | 'online'>(
    initialRoomCode ? 'online' : 'local'
  );
  const [joinCode, setJoinCode] = useState(initialRoomCode ?? '');

  useEffect(() => {
    if (initialRoomCode) {
      setLobbyTab('online');
      setJoinCode(initialRoomCode);
    }
  }, [initialRoomCode]);

  useEffect(() => {
    if (lobbyTab === 'online' && !detectedTransport) {
      void probeTransport();
    }
  }, [lobbyTab, detectedTransport, probeTransport]);

  const modeCards: { id: GameMode; title: string; subtitle: string; seats: string }[] = [
    {
      id: '1v1',
      title: '1v1 纯单挑',
      subtitle: '双方各选1将、初始4牌、无修正禁主公技',
      seats: '2 人'
    },
    {
      id: '2v2',
      title: '2v2 欢乐成双',
      subtitle: '1/4蓝 vs 2/3红 · 1号首回合摸1 · 队友明牌',
      seats: '4 人'
    },
    {
      id: 'identity5',
      title: '五人身份场',
      subtitle: '1主1忠2反1内 · 主公+1血先手 · 奖惩齐全',
      seats: '5 人'
    }
  ];

  const aiSpeedOptions: { id: AISpeed; label: string }[] = [
    { id: 'instant', label: '极速' },
    { id: 'fast', label: '较快' },
    { id: 'normal', label: '正常' },
    { id: 'slow', label: '慢速' }
  ];

  const handleCreateOnlineRoom = () => {
    createRoom(nickname, {
      mode,
      deckVariant,
      generalPack,
      freeGeneralPick: hostSettings.freeGeneralPick,
      timerEnabled: hostSettings.timerEnabled,
      timerSeconds: hostSettings.timerSeconds
    });
  };

  const handleJoinOnlineRoom = () => {
    joinRoom(joinCode, nickname);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Header */}
      <header className="border-b border-stone-300 dark:border-stone-800 bg-white/85 dark:bg-[#1B1E24]/90 backdrop-blur px-6 py-3.5">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#8B2626] text-white flex items-center justify-center font-serif font-bold text-lg shadow-sm">
              杀
            </div>
            <div>
              <h1 className="font-serif font-bold text-lg tracking-tight leading-tight">
                极简三国杀 · Minimal Sanguosha
              </h1>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                纯文本几何极简牌桌 · 严格对齐三国杀 OL 规则
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Local vs Online Mode Switcher */}
            <div className="inline-flex rounded-lg border border-stone-300 dark:border-stone-700 p-0.5 bg-stone-100 dark:bg-stone-900">
              <button
                type="button"
                onClick={() => setLobbyTab('local')}
                className={[
                  'inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-colors',
                  lobbyTab === 'local'
                    ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-white shadow-sm'
                    : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'
                ].join(' ')}
              >
                <Swords className="w-3.5 h-3.5" />
                单机人机
              </button>
              <button
                type="button"
                onClick={() => setLobbyTab('online')}
                className={[
                  'inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-colors',
                  lobbyTab === 'online'
                    ? 'bg-[#8B2626] text-white shadow-sm'
                    : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'
                ].join(' ')}
              >
                <Globe className="w-3.5 h-3.5" />
                好友联机 PvP
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowRulesModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5" />
              规则速查
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              title="切换浅色/深色主题"
              className="p-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Online PvP Entry View */}
      {lobbyTab === 'online' ? (
        <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-8 space-y-6">
          {onlineError && (
            <div className="rounded-xl px-4 py-3 text-xs font-medium bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 flex items-center justify-between">
              <span>{onlineError}</span>
              <button type="button" onClick={clearError} className="underline ml-3">
                关闭
              </button>
            </div>
          )}

          {/* Nickname Bar */}
          <section className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-[#1E2128] p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold flex flex-wrap items-center gap-1.5">
                  <Link2 className="w-4 h-4 text-[#8B2626] dark:text-amber-400" />
                  <span>免注册实时联机 PvP（房间链接直连）</span>
                  {detectedTransport && (
                    <span
                      className={[
                        'text-[10px] font-bold px-2 py-0.5 rounded-full',
                        detectedTransport === 'p2p'
                          ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200'
                          : 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200'
                      ].join(' ')}
                    >
                      {detectedTransport === 'p2p'
                        ? 'WebRTC P2P 零服务器联机'
                        : '权威服务端联机'}
                    </span>
                  )}
                </h2>
                <p className="text-xs text-stone-500 mt-0.5">
                  {detectedTransport === 'p2p'
                    ? '房主浏览器直连托管 · 零后端部署即可用链接邀好友实时 PvP · 断线支持自动重连'
                    : '服务端权威防作弊 · 自动隔离手牌与身份 · 断线 30 秒保留座位并支持无缝重连'}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <label className="text-xs text-stone-500 font-medium">你的昵称</label>
                <input
                  type="text"
                  maxLength={16}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="输入昵称"
                  className="w-40 px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-900 text-sm font-semibold outline-none focus:border-stone-900 dark:focus:border-amber-400"
                />
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Join by Room Code */}
            <section className="rounded-xl border-2 border-stone-300 dark:border-stone-700 bg-white dark:bg-[#1E2128] p-5 shadow-sm flex flex-col justify-between gap-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-base font-serif font-bold">
                  <LogIn className="w-5 h-5 text-[#1E3A5F] dark:text-sky-400" />
                  <span>加入好友房间</span>
                </div>
                <p className="text-xs text-stone-500 leading-relaxed">
                  输入好友发来的 6 位房间码（或直接打开好友发送的 `?room=XXXXXX` 链接），免注册一键入座；若满员自动进入实时观战席。
                </p>
                <input
                  type="text"
                  maxLength={6}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleJoinOnlineRoom();
                  }}
                  placeholder="输入 6 位房间码（如 A7K9P2）"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-900 font-mono text-base tracking-widest uppercase outline-none focus:border-stone-900 dark:focus:border-amber-400"
                />
              </div>

              <button
                type="button"
                disabled={wsStatus === 'connecting' || !joinCode.trim()}
                onClick={handleJoinOnlineRoom}
                className="w-full py-3 rounded-xl bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-45 text-white font-serif font-bold text-sm shadow transition-colors"
              >
                {wsStatus === 'connecting' ? '正在连接房间...' : '加入房间'}
              </button>
            </section>

            {/* Create New Room */}
            <section className="rounded-xl border-2 border-stone-900/80 dark:border-amber-500/70 bg-white dark:bg-[#1E2128] p-5 shadow-sm flex flex-col justify-between gap-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-base font-serif font-bold">
                  <PlusCircle className="w-5 h-5 text-[#8B2626] dark:text-amber-400" />
                  <span>创建新联机房间</span>
                </div>
                <p className="text-xs text-stone-500 leading-relaxed">
                  建房后即得 6 位房间码与专属邀请链接；房主可随时增删 AI 补位、踢人、移交房主、或在对局中实时开关倒计时。
                </p>

                <div className="grid grid-cols-3 gap-1.5">
                  {(['1v1', '2v2', 'identity5'] as GameMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={[
                        'py-1.5 rounded-lg text-xs font-bold border transition-colors',
                        mode === m
                          ? 'bg-stone-900 text-white border-stone-900 dark:bg-amber-600 dark:border-amber-600'
                          : 'border-stone-300 dark:border-stone-700'
                      ].join(' ')}
                    >
                      {m === '1v1' ? '1v1 单挑' : m === '2v2' ? '2v2 欢乐' : '五人身份'}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <select
                    value={deckVariant}
                    onChange={(e) => setDeckVariant(e.target.value as DeckVariant)}
                    className="px-2.5 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-900"
                  >
                    <option value="junzheng_161">军争篇 161张</option>
                    <option value="standard_ex">标准+EX 108张</option>
                  </select>
                  <select
                    value={generalPack}
                    onChange={(e) =>
                      setGeneralPack(
                        e.target.value as 'standard' | 'limit_break' | 'expansion' | 'all' | 'blank'
                      )
                    }
                    className="px-2.5 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-900"
                  >
                    <option value="all">全武将池 89将</option>
                    <option value="expansion">风林火山 32将</option>
                    <option value="limit_break">界限突破 30将</option>
                    <option value="standard">标准包 27将</option>
                    <option value="blank">白板测试将</option>
                  </select>
                </div>
              </div>

              <button
                type="button"
                disabled={wsStatus === 'connecting'}
                onClick={handleCreateOnlineRoom}
                className="w-full py-3 rounded-xl bg-[#8B2626] hover:bg-[#731F1F] disabled:opacity-45 text-white font-serif font-bold text-sm shadow transition-colors"
              >
                {wsStatus === 'connecting' ? '正在创建房间...' : '创建房间并生成邀请链接'}
              </button>
            </section>
          </div>
        </main>
      ) : (
        /* Main Local Content */
        <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Mode + Deck + General Pack + Seats */}
          <div className="lg:col-span-7 space-y-6">
            {/* Mode Picker */}
            <section className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-[#1E2128] p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-bold mb-3">
              <Swords className="w-4 h-4 text-[#8B2626] dark:text-amber-400" />
              <span>选择游戏模式</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {modeCards.map((mc) => {
                const enabled = availableModes.includes(mc.id);
                const active = mode === mc.id;
                return (
                  <button
                    key={mc.id}
                    type="button"
                    disabled={!enabled}
                    onClick={() => setMode(mc.id)}
                    className={[
                      'text-left rounded-xl p-3.5 border-2 transition-all flex flex-col justify-between',
                      active
                        ? 'border-stone-900 dark:border-amber-400 bg-stone-50 dark:bg-stone-800/80 shadow-sm'
                        : 'border-stone-200 dark:border-stone-700 hover:border-stone-400',
                      !enabled ? 'opacity-45 cursor-not-allowed' : ''
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-serif font-bold text-sm">{mc.title}</span>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-stone-200 dark:bg-stone-700">
                        {mc.seats}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] leading-snug text-stone-500 dark:text-stone-400">
                      {mc.subtitle}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Deck Variant & General Pack */}
          <section className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-[#1E2128] p-5 shadow-sm space-y-4">
            <div>
              <div className="text-sm font-bold mb-2.5">牌堆配置</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setDeckVariant('standard_ex')}
                  className={[
                    'text-left rounded-lg p-3 border-2 transition-all',
                    deckVariant === 'standard_ex'
                      ? 'border-stone-900 dark:border-amber-400 bg-stone-50 dark:bg-stone-800'
                      : 'border-stone-200 dark:border-stone-700'
                  ].join(' ')}
                >
                  <div className="font-bold text-sm">标准 + EX（108 张）</div>
                  <div className="text-[11px] text-stone-500 mt-0.5">
                    标准 104 + 寒冰剑/仁王盾/闪电/无懈 EX 4 张
                  </div>
                </button>

                <button
                  type="button"
                  disabled={!availableDecks.includes('junzheng_161')}
                  onClick={() => setDeckVariant('junzheng_161')}
                  className={[
                    'text-left rounded-lg p-3 border-2 transition-all',
                    deckVariant === 'junzheng_161'
                      ? 'border-stone-900 dark:border-amber-400 bg-stone-50 dark:bg-stone-800'
                      : 'border-stone-200 dark:border-stone-700',
                    !availableDecks.includes('junzheng_161') ? 'opacity-45 cursor-not-allowed' : ''
                  ].join(' ')}
                >
                  <div className="font-bold text-sm">军争篇全量（161 张）</div>
                  <div className="text-[11px] text-stone-500 mt-0.5">
                    108 + 军争 52（火雷杀/酒/铁索/火攻/藤甲/狮子）+ 木牛流马
                  </div>
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-stone-200 dark:border-stone-800">
              <div className="text-sm font-bold mb-2.5">武将包选择</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setGeneralPack('standard')}
                  className={[
                    'text-left rounded-lg p-3 border-2 transition-all',
                    generalPack === 'standard'
                      ? 'border-stone-900 dark:border-amber-400 bg-stone-50 dark:bg-stone-800'
                      : 'border-stone-200 dark:border-stone-700'
                  ].join(' ')}
                >
                  <div className="font-bold text-sm">标准包（OL 27 武将）</div>
                  <div className="text-[11px] text-stone-500 mt-0.5">
                    魏7 / 蜀7 / 吴8 / 群5 · 经典标包与 3 主公技
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setGeneralPack('limit_break')}
                  className={[
                    'text-left rounded-lg p-3 border-2 transition-all',
                    generalPack === 'limit_break'
                      ? 'border-stone-900 dark:border-amber-400 bg-stone-50 dark:bg-stone-800'
                      : 'border-stone-200 dark:border-stone-700'
                  ].join(' ')}
                >
                  <div className="font-bold text-sm">界限突破（OL 30 武将）</div>
                  <div className="text-[11px] text-stone-500 mt-0.5">
                    27 界将 + 李典/界徐庶/界公孙瓒 · 含觉醒/限定/额外回合
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setGeneralPack('expansion')}
                  className={[
                    'text-left rounded-lg p-3 border-2 transition-all',
                    generalPack === 'expansion'
                      ? 'border-stone-900 dark:border-amber-400 bg-stone-50 dark:bg-stone-800'
                      : 'border-stone-200 dark:border-stone-700'
                  ].join(' ')}
                >
                  <div className="font-bold text-sm">风林火山（OL 32 武将）</div>
                  <div className="text-[11px] text-stone-500 mt-0.5">
                    风8 / 火8 / 林8 / 山8 · 拼点/翻面/移牌/蛊惑/化身全收录
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setGeneralPack('all')}
                  className={[
                    'text-left rounded-lg p-3 border-2 transition-all',
                    generalPack === 'all'
                      ? 'border-stone-900 dark:border-amber-400 bg-stone-50 dark:bg-stone-800'
                      : 'border-stone-200 dark:border-stone-700'
                  ].join(' ')}
                >
                  <div className="font-bold text-sm">全武将混池（OL 89 武将）</div>
                  <div className="text-[11px] text-stone-500 mt-0.5">
                    标准27 + 界限30 + 风林火山32 · 同名武将自动互斥
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setGeneralPack('blank')}
                  className={[
                    'text-left rounded-lg p-3 border-2 transition-all sm:col-span-2',
                    generalPack === 'blank'
                      ? 'border-stone-900 dark:border-amber-400 bg-stone-50 dark:bg-stone-800'
                      : 'border-stone-200 dark:border-stone-700'
                  ].join(' ')}
                >
                  <div className="font-bold text-sm">白板测试将</div>
                  <div className="text-[11px] text-stone-500 mt-0.5">
                    纯牌面无技能对抗（适合规则基础测试）
                  </div>
                </button>
              </div>
            </div>
          </section>

          {/* Host Seat & AI Bot Management */}
          <section className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-[#1E2128] p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Users className="w-4 h-4 text-[#1E3A5F] dark:text-sky-400" />
                <span>房主座位与 AI 机器人配置</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setAllOpponentsAI(true)}
                  className="px-2.5 py-1 rounded text-xs font-medium bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
                >
                  + 一键补满 AI
                </button>
                <button
                  type="button"
                  onClick={() => setAllOpponentsAI(false)}
                  className="px-2.5 py-1 rounded text-xs font-medium bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
                >
                  全真人轮流操作
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {seats.map((seat, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50/70 dark:bg-stone-900/50"
                >
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <span className="font-mono text-xs font-bold w-8 text-stone-500">
                      #{idx + 1}
                    </span>
                    <input
                      type="text"
                      value={seat.name}
                      onChange={(e) => updateSeat(idx, { name: e.target.value })}
                      className="bg-transparent border-b border-transparent focus:border-stone-400 outline-none text-sm font-medium flex-1 min-w-0"
                    />
                    {mode === '2v2' && (
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          idx === 0 || idx === 3
                            ? 'bg-[#1E3A5F] text-white'
                            : 'bg-[#8B2626] text-white'
                        }`}
                      >
                        {idx === 0 || idx === 3 ? '蓝队' : '红队'}
                      </span>
                    )}
                    {mode === 'identity5' && (
                      <select
                        value={seat.preferredRole ?? ''}
                        onChange={(e) =>
                          updateSeat(idx, {
                            preferredRole: (e.target.value || undefined) as SeatConfig['preferredRole']
                          })
                        }
                        title="调试指定身份（留空则随机）"
                        className="text-[11px] rounded border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 px-1.5 py-0.5"
                      >
                        <option value="">随机身份</option>
                        <option value="lord">主公</option>
                        <option value="loyalist">忠臣</option>
                        <option value="rebel">反贼</option>
                        <option value="renegade">内奸</option>
                      </select>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => updateSeat(idx, { isAI: !seat.isAI })}
                    className={[
                      'inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold border transition-colors shrink-0',
                      seat.isAI
                        ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-200 border-sky-300 dark:border-sky-700'
                        : 'bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-200 border-stone-300 dark:border-stone-600'
                    ].join(' ')}
                  >
                    {seat.isAI ? (
                      <>
                        <Bot className="w-3.5 h-3.5" />
                        AI 机器人
                      </>
                    ) : (
                      <>
                        <User className="w-3.5 h-3.5" />
                        真人玩家
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right Column: Host Timer / Debug / Launch */}
        <div className="lg:col-span-5 space-y-6">
          <section className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-[#1E2128] p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold">
              <Clock className="w-4 h-4 text-amber-600" />
              <span>房主计时与节奏设置（对局中亦可随时调整）</span>
            </div>

            {/* Timer Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">操作倒计时</div>
                <div className="text-[11px] text-stone-500">
                  开启后超时自动结束出牌或放弃可选响应
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  updateHostSettings({ timerEnabled: !hostSettings.timerEnabled })
                }
                className={[
                  'w-11 h-6 rounded-full transition-colors relative',
                  hostSettings.timerEnabled
                    ? 'bg-emerald-600'
                    : 'bg-stone-300 dark:bg-stone-700'
                ].join(' ')}
              >
                <span
                  className={[
                    'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                    hostSettings.timerEnabled ? 'left-5' : 'left-0.5'
                  ].join(' ')}
                />
              </button>
            </div>

            {hostSettings.timerEnabled && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-stone-500">每步时长：</span>
                {[10, 15, 20, 30].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => updateHostSettings({ timerSeconds: sec })}
                    className={[
                      'px-2.5 py-1 rounded text-xs font-mono border',
                      hostSettings.timerSeconds === sec
                        ? 'bg-stone-900 text-white border-stone-900 dark:bg-amber-600 dark:border-amber-600'
                        : 'border-stone-300 dark:border-stone-700'
                    ].join(' ')}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            )}

            {/* AI Speed */}
            <div className="pt-2 border-t border-stone-200 dark:border-stone-800">
              <div className="text-xs font-medium text-stone-500 mb-2">AI 行动节奏</div>
              <div className="grid grid-cols-4 gap-1.5">
                {aiSpeedOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateHostSettings({ aiSpeed: opt.id })}
                    className={[
                      'py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                      hostSettings.aiSpeed === opt.id
                        ? 'bg-stone-900 text-white border-stone-900 dark:bg-amber-600 dark:border-amber-600'
                        : 'border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800'
                    ].join(' ')}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Debug & Acceptance Switches */}
            <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-stone-500">
                <Eye className="w-3.5 h-3.5" />
                <span>验收与调试开关</span>
              </div>

              <label className="flex items-center justify-between text-sm cursor-pointer">
                <span>自由点将模式（显示完整武将池）</span>
                <input
                  type="checkbox"
                  checked={hostSettings.freeGeneralPick}
                  onChange={(e) =>
                    updateHostSettings({ freeGeneralPick: e.target.checked })
                  }
                  className="rounded border-stone-400"
                />
              </label>

              <label className="flex items-center justify-between text-sm cursor-pointer">
                <span>调试明牌（查看 AI 手牌）</span>
                <input
                  type="checkbox"
                  checked={hostSettings.revealAllHands}
                  onChange={(e) =>
                    updateHostSettings({ revealAllHands: e.target.checked })
                  }
                  className="rounded border-stone-400"
                />
              </label>

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-xs text-stone-500">随机种子（可复现）</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(Number(e.target.value) || 1)}
                    className="w-28 px-2 py-1 rounded border border-stone-300 dark:border-stone-700 bg-transparent font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={randomizeSeed}
                    title="随机种子"
                    className="p-1.5 rounded border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800"
                  >
                    <Dices className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </section>

          <button
            type="button"
            onClick={() => startNewGame()}
            className="w-full py-3.5 rounded-xl bg-[#8B2626] hover:bg-[#731F1F] text-white font-serif font-bold text-base shadow-md transition-all flex items-center justify-center gap-2"
          >
            <Play className="w-5 h-5 fill-current" />
            开始对局
          </button>
        </div>
      </main>
      )}
    </div>
  );
}
