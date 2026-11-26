import type { CardName, CardSpec } from '../../core/types.js';

export const CARD_SPECS: Record<CardName, CardSpec> = {
  // ===== 基本牌 =====
  slash: {
    name: 'slash',
    displayName: '杀',
    category: 'basic',
    subtype: 'basic',
    element: 'normal',
    shortTag: '基本·普通',
    description: '出牌阶段限1次，对你攻击范围内的一名其他角色使用，对其造成1点伤害（目标可打出一张【闪】抵消）。'
  },
  fire_slash: {
    name: 'fire_slash',
    displayName: '火杀',
    category: 'basic',
    subtype: 'basic',
    element: 'fire',
    shortTag: '基本·火属性',
    description: '出牌阶段限1次（与普通杀共用次数），对你攻击范围内的一名其他角色使用，对其造成1点火焰伤害。'
  },
  thunder_slash: {
    name: 'thunder_slash',
    displayName: '雷杀',
    category: 'basic',
    subtype: 'basic',
    element: 'thunder',
    shortTag: '基本·雷属性',
    description: '出牌阶段限1次（与普通杀共用次数），对你攻击范围内的一名其他角色使用，对其造成1点雷电伤害。'
  },
  dodge: {
    name: 'dodge',
    displayName: '闪',
    category: 'basic',
    subtype: 'basic',
    shortTag: '基本·响应',
    description: '当你成为【杀】或【万箭齐发】的目标时，打出一张【闪】抵消之。'
  },
  peach: {
    name: 'peach',
    displayName: '桃',
    category: 'basic',
    subtype: 'basic',
    shortTag: '基本·回复',
    description: '出牌阶段对自己使用，回复1点体力；任意角色处于濒死状态时可对其使用，使其回复1点体力。'
  },
  alcohol: {
    name: 'alcohol',
    displayName: '酒',
    category: 'basic',
    subtype: 'basic',
    shortTag: '基本·增益/自救',
    description: '出牌阶段限1次，令你本回合下一张【杀】造成的伤害+1；当你处于濒死状态时对自己使用，回复1点体力。'
  },

  // ===== 普通锦囊 =====
  dismantle: {
    name: 'dismantle',
    displayName: '过河拆桥',
    category: 'trick',
    subtype: 'normal_trick',
    shortTag: '锦囊·拆牌',
    description: '出牌阶段对区域内有牌的一名其他角色使用，弃置其区域内的一张牌（无距离限制）。'
  },
  snatch: {
    name: 'snatch',
    displayName: '顺手牵羊',
    category: 'trick',
    subtype: 'normal_trick',
    shortTag: '锦囊·距离1',
    description: '出牌阶段对距离为1且区域内有牌的一名其他角色使用，获得其区域内的一张牌。'
  },
  ex_nihilo: {
    name: 'ex_nihilo',
    displayName: '无中生有',
    category: 'trick',
    subtype: 'normal_trick',
    shortTag: '锦囊·摸2',
    description: '出牌阶段对自己使用，摸两张牌。'
  },
  duel: {
    name: 'duel',
    displayName: '决斗',
    category: 'trick',
    subtype: 'normal_trick',
    shortTag: '锦囊·对决',
    description: '出牌阶段对一名其他角色使用。由目标开始，双方轮流打出一张【杀】，首先不出【杀】的角色受到另一方造成的1点伤害。'
  },
  savage_assault: {
    name: 'savage_assault',
    displayName: '南蛮入侵',
    category: 'trick',
    subtype: 'normal_trick',
    shortTag: '群体·需出杀',
    description: '出牌阶段对所有其他角色使用。目标角色须打出一张【杀】，否则受到你造成的1点伤害。'
  },
  archery_attack: {
    name: 'archery_attack',
    displayName: '万箭齐发',
    category: 'trick',
    subtype: 'normal_trick',
    shortTag: '群体·需出闪',
    description: '出牌阶段对所有其他角色使用。目标角色须打出一张【闪】，否则受到你造成的1点伤害。'
  },
  peach_garden: {
    name: 'peach_garden',
    displayName: '桃园结义',
    category: 'trick',
    subtype: 'normal_trick',
    shortTag: '群体·全体回1',
    description: '出牌阶段对所有角色使用，从你开始按行动顺序令每名已受伤的角色回复1点体力。'
  },
  harvest: {
    name: 'harvest',
    displayName: '五谷丰登',
    category: 'trick',
    subtype: 'normal_trick',
    shortTag: '群体·亮牌选1',
    description: '出牌阶段对所有角色使用。亮出牌堆顶等同于存活角色数量的牌，从你开始每名角色依次选择并获得其中一张。'
  },
  collateral: {
    name: 'collateral',
    displayName: '借刀杀人',
    category: 'trick',
    subtype: 'normal_trick',
    shortTag: '锦囊·夺武',
    description: '出牌阶段对装备区有武器牌的一名其他角色使用，指定其攻击范围内另一名角色：其须对后者使用一张【杀】，否则将武器交给你。'
  },
  nullification: {
    name: 'nullification',
    displayName: '无懈可击',
    category: 'trick',
    subtype: 'normal_trick',
    shortTag: '锦囊·反制',
    description: '在任意锦囊牌（含延时锦囊判定前或其他【无懈可击】）生效前使用，抵消该锦囊牌对一名目标角色的效果。'
  },
  iron_chain: {
    name: 'iron_chain',
    displayName: '铁索连环',
    category: 'trick',
    subtype: 'normal_trick',
    shortTag: '锦囊·连环/重铸',
    description: '出牌阶段对1至2名角色使用，横置或重置其武将牌；或重铸此牌（弃置之并摸一张牌）。处于连环状态的角色受到属性伤害后会顺次传导。'
  },
  fire_attack: {
    name: 'fire_attack',
    displayName: '火攻',
    category: 'trick',
    subtype: 'normal_trick',
    shortTag: '锦囊·火伤',
    description: '出牌阶段对一名有手牌的角色使用。目标展示一张手牌，你可弃置一张与之同花色的手牌，对其造成1点火焰伤害。'
  },

  // ===== 延时锦囊 =====
  indulgence: {
    name: 'indulgence',
    displayName: '乐不思蜀',
    category: 'trick',
    subtype: 'delayed_trick',
    shortTag: '延时·跳出牌',
    description: '出牌阶段置于一名其他角色判定区。其判定阶段进行判定，若结果不为红桃，跳过其本回合出牌阶段。'
  },
  lightning: {
    name: 'lightning',
    displayName: '闪电',
    category: 'trick',
    subtype: 'delayed_trick',
    shortTag: '延时·3雷伤',
    description: '出牌阶段置于自己判定区。判定阶段判定若为黑桃2~9，受到3点无来源雷电伤害；否则移动至下家判定区。'
  },
  supply_shortage: {
    name: 'supply_shortage',
    displayName: '兵粮寸断',
    category: 'trick',
    subtype: 'delayed_trick',
    shortTag: '延时·距离1',
    description: '出牌阶段置于距离为1的一名其他角色判定区。其判定阶段进行判定，若结果不为梅花，跳过其本回合摸牌阶段。'
  },

  // ===== 武器 =====
  zhuge_crossbow: {
    name: 'zhuge_crossbow',
    displayName: '诸葛连弩',
    category: 'equip',
    subtype: 'weapon',
    attackRange: 1,
    shortTag: '武器·范围1',
    description: '锁定技，你于出牌阶段内使用【杀】无次数限制。'
  },
  double_swords: {
    name: 'double_swords',
    displayName: '雌雄双股剑',
    category: 'equip',
    subtype: 'weapon',
    attackRange: 2,
    shortTag: '武器·范围2',
    description: '当你使用【杀】指定一名异性角色为目标后，你可令其选择：弃置一张手牌，或令你摸一张牌。'
  },
  qinggang_sword: {
    name: 'qinggang_sword',
    displayName: '青釭剑',
    category: 'equip',
    subtype: 'weapon',
    attackRange: 2,
    shortTag: '武器·范围2',
    description: '锁定技，当你使用【杀】指定一名角色为目标后，你无视其防具。'
  },
  ice_sword: {
    name: 'ice_sword',
    displayName: '寒冰剑',
    category: 'equip',
    subtype: 'weapon',
    attackRange: 2,
    shortTag: '武器·范围2',
    description: '当你使用【杀】对目标角色造成伤害时，若其有手牌或装备牌，你可防止此伤害，改为依次弃置其至多两张牌。'
  },
  guding_blade: {
    name: 'guding_blade',
    displayName: '古锭刀',
    category: 'equip',
    subtype: 'weapon',
    attackRange: 2,
    shortTag: '武器·范围2',
    description: '锁定技，当你使用【杀】对目标角色造成伤害时，若其没有手牌，此伤害+1。'
  },
  blade: {
    name: 'blade',
    displayName: '青龙偃月刀',
    category: 'equip',
    subtype: 'weapon',
    attackRange: 3,
    shortTag: '武器·范围3',
    description: '当你使用的【杀】被目标角色的【闪】抵消时，你可以对其再使用一张【杀】（无距离限制）。'
  },
  serpent_spear: {
    name: 'serpent_spear',
    displayName: '丈八蛇矛',
    category: 'equip',
    subtype: 'weapon',
    attackRange: 3,
    shortTag: '武器·范围3',
    description: '你可以将两张手牌当普通【杀】使用或打出（两红为红杀，两黑为黑杀，一红一黑为无色杀）。'
  },
  axe: {
    name: 'axe',
    displayName: '贯石斧',
    category: 'equip',
    subtype: 'weapon',
    attackRange: 3,
    shortTag: '武器·范围3',
    description: '当你使用的【杀】被目标角色的【闪】抵消时，你可以弃置两张牌（不含贯石斧自身），令此【杀】依然造成伤害。'
  },
  halberd: {
    name: 'halberd',
    displayName: '方天画戟',
    category: 'equip',
    subtype: 'weapon',
    attackRange: 4,
    shortTag: '武器·范围4',
    description: '你使用的【杀】若是你最后的手牌，你可以额外选择至多两个目标。'
  },
  fan: {
    name: 'fan',
    displayName: '朱雀羽扇',
    category: 'equip',
    subtype: 'weapon',
    attackRange: 4,
    shortTag: '武器·范围4',
    description: '你可以将你使用的一张普通【杀】当火【杀】使用。'
  },
  kylin_bow: {
    name: 'kylin_bow',
    displayName: '麒麟弓',
    category: 'equip',
    subtype: 'weapon',
    attackRange: 5,
    shortTag: '武器·范围5',
    description: '当你使用【杀】对目标角色造成伤害时，你可以弃置其装备区里的一张坐骑牌。'
  },

  // ===== 防具 =====
  eight_trigrams: {
    name: 'eight_trigrams',
    displayName: '八卦阵',
    category: 'equip',
    subtype: 'armor',
    shortTag: '防具·判定闪',
    description: '每当你需要使用或打出一张【闪】时，你可进行判定，若结果为红色，视为你使用或打出了一张【闪】。'
  },
  renwang_shield: {
    name: 'renwang_shield',
    displayName: '仁王盾',
    category: 'equip',
    subtype: 'armor',
    shortTag: '防具·免疫黑杀',
    description: '锁定技，黑色的【杀】对你无效。'
  },
  vine_armor: {
    name: 'vine_armor',
    displayName: '藤甲',
    category: 'equip',
    subtype: 'armor',
    shortTag: '防具·免普杀/火+1',
    description: '锁定技，【南蛮入侵】、【万箭齐发】和普通【杀】对你无效；你受到火焰伤害时，此伤害+1。'
  },
  silver_lion: {
    name: 'silver_lion',
    displayName: '白银狮子',
    category: 'equip',
    subtype: 'armor',
    shortTag: '防具·锁1伤/失回1',
    description: '锁定技，当你受到大于1点的伤害时，防止多余伤害；当你失去装备区里的【白银狮子】后，回复1点体力。'
  },

  // ===== 坐骑 =====
  jueying: {
    name: 'jueying',
    displayName: '绝影',
    category: 'equip',
    subtype: 'horse_plus',
    shortTag: '防御马 +1',
    description: '锁定技，其他角色计算与你的距离+1。'
  },
  dilu: {
    name: 'dilu',
    displayName: '的卢',
    category: 'equip',
    subtype: 'horse_plus',
    shortTag: '防御马 +1',
    description: '锁定技，其他角色计算与你的距离+1。'
  },
  zhuahuang: {
    name: 'zhuahuang',
    displayName: '爪黄飞电',
    category: 'equip',
    subtype: 'horse_plus',
    shortTag: '防御马 +1',
    description: '锁定技，其他角色计算与你的距离+1。'
  },
  hualiu: {
    name: 'hualiu',
    displayName: '骅骝',
    category: 'equip',
    subtype: 'horse_plus',
    shortTag: '防御马 +1',
    description: '锁定技，其他角色计算与你的距离+1。'
  },
  chitu: {
    name: 'chitu',
    displayName: '赤兔',
    category: 'equip',
    subtype: 'horse_minus',
    shortTag: '进攻马 -1',
    description: '锁定技，你计算与其他角色的距离-1。'
  },
  dayuan: {
    name: 'dayuan',
    displayName: '大宛',
    category: 'equip',
    subtype: 'horse_minus',
    shortTag: '进攻马 -1',
    description: '锁定技，你计算与其他角色的距离-1。'
  },
  zixing: {
    name: 'zixing',
    displayName: '紫骍',
    category: 'equip',
    subtype: 'horse_minus',
    shortTag: '进攻马 -1',
    description: '锁定技，你计算与其他角色的距离-1。'
  },

  // ===== 宝物 =====
  wooden_ox: {
    name: 'wooden_ox',
    displayName: '木牛流马',
    category: 'equip',
    subtype: 'treasure',
    shortTag: '宝物·藏牌转移',
    description: '出牌阶段限1次，可将1张手牌扣置于【木牛流马】下（至多5张），然后可将【木牛流马】移至另一名角色的装备区；你可以如手牌般使用或打出其下的牌。'
  }
};
