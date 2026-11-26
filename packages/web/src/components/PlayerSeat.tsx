import type { CardInstance, PublicPlayerView } from '@sgs/engine';
import { getRankLabel, getSuitSymbol } from '@sgs/engine';
import { Bot, Shield, Sword, User, Link2, RotateCw, Wine } from 'lucide-react';
import { FACTION_META, ROLE_META } from '../utils/labels';

interface PlayerSeatProps {
  player: PublicPlayerView;
  isActiveTurn: boolean;
  isSelf: boolean;
  isTeammate?: boolean;
  distance?: number;
  selectable?: boolean;
  selected?: boolean;
  secondarySelected?: boolean;
  selectableCardIds?: Set<number>;
  selectedCardIds?: number[];
  onSelect?: () => void;
  onToggleSelectCard?: (cardId: number) => void;
  onInspectCard?: (card: CardInstance) => void;
}

export function PlayerSeat({
  player,
  isActiveTurn,
  isSelf,
  isTeammate = false,
  distance,
  selectable = false,
  selected = false,
  secondarySelected = false,
  selectableCardIds,
  selectedCardIds = [],
  onSelect,
  onToggleSelectCard,
  onInspectCard
}: PlayerSeatProps) {
  const faction = FACTION_META[player.faction];
  const role = ROLE_META[player.role];

  const equipItems: { label: string; card: CardInstance | null }[] = [
    { label: '武', card: player.equips.weapon },
    { label: '防', card: player.equips.armor },
    { label: '+1', card: player.equips.horsePlus },
    { label: '-1', card: player.equips.horseMinus },
    { label: '宝', card: player.equips.treasure }
  ];

  return (
    <div
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      onClick={() => {
        if (selectable && onSelect) onSelect();
      }}
      onKeyDown={(e) => {
        if (selectable && onSelect && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect();
        }
      }}
      className={[
        'relative rounded-xl border transition-all duration-150 overflow-hidden',
        'bg-white/95 dark:bg-[#1E2128] text-stone-900 dark:text-stone-100',
        !player.alive ? 'opacity-45 grayscale' : '',
        isActiveTurn && player.alive
          ? 'border-amber-500 shadow-md ring-1 ring-amber-400/60'
          : 'border-stone-300 dark:border-stone-700 shadow-sm',
        selectable
          ? 'cursor-pointer ring-2 ring-emerald-500/80 hover:scale-[1.01] hover:shadow-lg'
          : '',
        selected ? 'ring-2 ring-rose-600 dark:ring-rose-400 bg-rose-50/40 dark:bg-rose-950/20' : '',
        secondarySelected ? 'ring-2 ring-sky-600 dark:ring-sky-400' : ''
      ].join(' ')}
    >
      {/* Faction Color Top Strip */}
      <div className={`h-1.5 w-full ${faction.bar}`} />

      <div className="p-2.5 flex flex-col gap-1.5">
        {/* Header: Seat + Faction + General + Role */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold shrink-0 ${faction.badge}`}>
              {faction.label}
            </span>
            <span className="font-serif font-bold text-sm truncate">
              {player.generalName}
            </span>
            <span className="text-[11px] text-stone-400 shrink-0">
              {player.gender === 'male' ? '♂' : '♀'}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${role.cls}`}>
              {role.label}
            </span>
            {distance !== undefined && distance > 0 && player.alive && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 border border-stone-200 dark:border-stone-700">
                距{distance}
              </span>
            )}
          </div>
        </div>

        {/* Subheader: Player name + AI/Human + Hand count */}
        <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
          <div className="flex items-center gap-1 min-w-0">
            {player.isAI ? (
              <Bot className="w-3.5 h-3.5 shrink-0 text-stone-400" />
            ) : (
              <User className="w-3.5 h-3.5 shrink-0 text-stone-500" />
            )}
            <span className="truncate">
              {player.seat + 1}号·{player.name}
              {isSelf ? '（你）' : isTeammate ? '（队友）' : ''}
            </span>
          </div>
          <span className="font-mono text-[11px] font-semibold text-stone-700 dark:text-stone-200">
            手牌 {player.handCount}
            {player.woodenOxCount > 0 ? ` + 木牛${player.woodenOxCount}` : ''}
          </span>
        </div>

        {/* HP Dots & Status Badges */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.max(player.maxHp, 0) }).map((_, i) => (
              <span
                key={i}
                className={[
                  'w-2.5 h-2.5 rounded-full border',
                  i < player.hp
                    ? player.hp <= 1
                      ? 'bg-red-600 border-red-700'
                      : 'bg-emerald-600 border-emerald-700'
                    : 'bg-transparent border-stone-300 dark:border-stone-600'
                ].join(' ')}
              />
            ))}
            <span className="ml-1 font-mono text-[11px] font-semibold text-stone-700 dark:text-stone-300">
              {player.alive ? `HP ${player.hp}/${player.maxHp}` : '已阵亡'}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {player.chained && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200">
                <Link2 className="w-3 h-3" />
                连环
              </span>
            )}
            {player.flipped && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-stone-200 text-stone-800 dark:bg-stone-700 dark:text-stone-100">
                <RotateCw className="w-3 h-3" />
                翻面
              </span>
            )}
            {player.drunk && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                <Wine className="w-3 h-3" />
                酒
              </span>
            )}
          </div>
        </div>

        {/* General Skill Badges */}
        {player.skillDetails && player.skillDetails.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {player.skillDetails.map((sk) => (
              <span
                key={sk.id}
                title={`${sk.name}：${sk.description}`}
                className={[
                  'px-1.5 py-0.5 rounded text-[10px] font-bold cursor-help border',
                  sk.type === 'lord'
                    ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-700'
                    : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 border-stone-200 dark:border-stone-700'
                ].join(' ')}
              >
                {sk.name}
                {sk.type === 'lord' ? '·主' : sk.type === 'compulsory' ? '·锁' : ''}
              </span>
            ))}
          </div>
        )}

        {/* Pile & Huashen Badges (田 / 创 / 谦逊 / 化身) */}
        {((player.removedCardCounts && Object.keys(player.removedCardCounts).length > 0) ||
          player.huashenCount) && (
          <div className="flex flex-wrap gap-1">
            {player.removedCardCounts &&
              Object.entries(player.removedCardCounts).map(([pileKey, cnt]) => {
                const pileLabel =
                  pileKey === 'buqu' || pileKey === 'chuang'
                    ? '创'
                    : pileKey === 'tian'
                      ? '田'
                      : pileKey === 'lb_qianxun'
                        ? '谦逊'
                        : pileKey;
                return (
                  <span
                    key={pileKey}
                    className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700"
                  >
                    {pileLabel}×{cnt}
                  </span>
                );
              })}
            {player.huashenCount && player.huashenCount > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 dark:bg-purple-950/50 text-purple-900 dark:text-purple-200 border border-purple-300 dark:border-purple-700">
                化身×{player.huashenCount}
                {player.activeHuashenGeneralName ? `·${player.activeHuashenGeneralName}` : ''}
              </span>
            )}
          </div>
        )}

        {/* Equipment Strip */}
        <div className="flex flex-wrap gap-1 pt-1 border-t border-stone-100 dark:border-stone-800">
          {equipItems.filter((x) => x.card).length === 0 ? (
            <span className="text-[11px] text-stone-400">无装备</span>
          ) : (
            equipItems.map(({ label, card }) => {
              if (!card) return null;
              const canSelectEquip = Boolean(isSelf && selectableCardIds?.has(card.id) && onToggleSelectCard);
              const isEquipSelected = selectedCardIds.includes(card.id);
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (canSelectEquip) {
                      onToggleSelectCard?.(card.id);
                    } else {
                      onInspectCard?.(card);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onInspectCard?.(card);
                  }}
                  title={
                    canSelectEquip
                      ? `点击选择装备牌【${card.displayName}】（${getSuitSymbol(card.suit)}${getRankLabel(card.rank)}）`
                      : `${card.displayName} (${getSuitSymbol(card.suit)}${getRankLabel(card.rank)})`
                  }
                  className={[
                    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border transition-all',
                    isEquipSelected
                      ? 'bg-[#8B2626] text-white border-[#8B2626] ring-2 ring-rose-400'
                      : canSelectEquip
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 border-emerald-400 ring-1 ring-emerald-400/70 cursor-pointer'
                        : 'bg-sky-50 dark:bg-sky-950/60 text-sky-900 dark:text-sky-200 border-sky-200 dark:border-sky-800 hover:bg-sky-100'
                  ].join(' ')}
                >
                  {label === '武' ? (
                    <Sword className="w-3 h-3 shrink-0" />
                  ) : label === '防' ? (
                    <Shield className="w-3 h-3 shrink-0" />
                  ) : (
                    <span className="font-mono text-[10px] opacity-75">{label}</span>
                  )}
                  <span className="font-medium">{card.displayName}</span>
                  <span
                    className={
                      isEquipSelected
                        ? 'text-[10px] font-mono opacity-90'
                        : card.suit === 'heart' || card.suit === 'diamond'
                          ? 'text-[10px] font-mono text-red-600 dark:text-red-400'
                          : 'text-[10px] font-mono opacity-75'
                    }
                  >
                    {getSuitSymbol(card.suit)}
                    {getRankLabel(card.rank)}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Delayed Tricks (Judge Zone) */}
        {player.judgeZone.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {player.judgeZone.map((jc) => (
              <button
                key={jc.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onInspectCard?.(jc);
                }}
                className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800"
              >
                判定·{jc.displayName} ({getSuitSymbol(jc.suit)}
                {getRankLabel(jc.rank)})
              </button>
            ))}
          </div>
        )}

        {/* Visible Hand Preview (for 2v2 Teammate or Debug Reveal All Hands) */}
        {!isSelf && player.hand && player.hand.length > 0 && (
          <div className="pt-1 border-t border-dashed border-stone-200 dark:border-stone-700">
            <div className="text-[10px] text-stone-400 mb-1">
              {isTeammate ? '队友明牌' : '调试明牌'}
            </div>
            <div className="flex flex-wrap gap-1">
              {player.hand.map((hc) => (
                <button
                  key={hc.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onInspectCard?.(hc);
                  }}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-200 border border-stone-200 dark:border-stone-700 font-mono"
                >
                  <span
                    className={
                      hc.suit === 'heart' || hc.suit === 'diamond'
                        ? 'text-red-600'
                        : 'text-stone-800 dark:text-stone-200'
                    }
                  >
                    {getSuitSymbol(hc.suit)}
                    {getRankLabel(hc.rank)}
                  </span>{' '}
                  {hc.displayName}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
