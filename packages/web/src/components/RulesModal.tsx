import { X } from 'lucide-react';

interface RulesModalProps {
  open: boolean;
  onClose: () => void;
}

export function RulesModal({ open, onClose }: RulesModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="max-w-2xl w-full max-h-[82vh] overflow-y-auto rounded-xl bg-white dark:bg-[#1F232B] border border-stone-300 dark:border-stone-700 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-700 pb-3">
          <h3 className="text-lg font-bold">三国杀 OL 核心规则速查</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4 text-sm leading-relaxed text-stone-700 dark:text-stone-300">
          <section>
            <h4 className="font-bold text-stone-900 dark:text-stone-100">1. 回合六阶段</h4>
            <p className="mt-1">
              准备阶段 → 判定阶段（后置先判 LIFO）→ 摸牌阶段（默认摸 2 张）→ 出牌阶段（默认限 1 张杀、1 张酒）→ 弃牌阶段（手牌上限 = 当前体力值）→ 结束阶段。
            </p>
          </section>

          <section>
            <h4 className="font-bold text-stone-900 dark:text-stone-100">2. 三大模式要点</h4>
            <ul className="mt-1 list-disc pl-5 space-y-1">
              <li>
                <strong>1v1（纯单挑）</strong>：2人各选1将，初始均 4 牌，无先手修正与主公技，击败对方即胜。
              </li>
              <li>
                <strong>2v2（欢乐成双）</strong>：1/4号蓝队 vs 2/3号红队；1号位首回合摸 1 张；队友阵亡存活队友摸 1 张；<strong>队友手牌互通可见</strong>；禁用主公技。
              </li>
              <li>
                <strong>五人身份场</strong>：1主1忠2反1内；主公明置且体力上限 +1、1号位先手；杀反摸 3 张，主公杀忠弃置全部手牌与装备。
              </li>
            </ul>
          </section>

          <section>
            <h4 className="font-bold text-stone-900 dark:text-stone-100">3. 军争与连环传导</h4>
            <p className="mt-1">
              处于连环状态的角色受到属性伤害（火/雷）扣血后解除连环，并从当前回合角色起逆时针依次传导同来源、同属性、同实际扣血量的传导伤害；即使首个受伤害者阵亡，只要对局未分胜负仍继续传导，一旦分出胜负立即中止。
            </p>
          </section>

          <section>
            <h4 className="font-bold text-stone-900 dark:text-stone-100">4. 快捷键说明</h4>
            <div className="mt-1 grid grid-cols-2 gap-2 text-xs font-mono bg-stone-50 dark:bg-stone-800/70 p-3 rounded-lg">
              <div>1 ~ 9：快速选中对应手牌</div>
              <div>双击手牌：直接使用无需目标的牌</div>
              <div>Enter：确认出牌 / 响应</div>
              <div>Esc：取消选中 / 放弃可选响应</div>
              <div>Space：结束出牌阶段</div>
              <div>点击牌右上角 i：查看完整牌面</div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
