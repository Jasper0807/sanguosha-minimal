import type { GeneralDefinition } from '../../core/types.js';

/**
 * Exact 27 Standard Pack Generals (OL current Standard Edition):
 * - Wei (7): 曹操、司马懿、夏侯惇、张辽、许褚、郭嘉、甄姬
 * - Shu (7): 刘备、关羽、张飞、诸葛亮、赵云、马超、黄月英
 * - Wu  (8): 孙权、甘宁、吕蒙、黄盖、周瑜、大乔、陆逊、孙尚香
 * - Qun (5): 华佗、吕布、貂蝉、华雄、袁术
 */
export const STANDARD_GENERALS: readonly GeneralDefinition[] = [
  // ===================== WEI (7) =====================
  {
    id: 'std_caocao',
    baseGeneralId: 'caocao',
    name: '曹操',
    title: '魏武帝',
    faction: 'wei',
    gender: 'male',
    maxHp: 4,
    pack: 'standard',
    isLordCandidate: true,
    skills: [
      {
        id: 'jianxiong',
        name: '奸雄',
        type: 'trigger',
        description: '当你受到伤害后，你可以获得对你造成伤害的牌。'
      },
      {
        id: 'hujia',
        name: '护驾',
        type: 'lord',
        description: '主公技，当你需要使用或打出一张【闪】时，你可以令其他魏势力角色选择是否打出一张【闪】（视为由你使用或打出）。'
      }
    ]
  },
  {
    id: 'std_simayi',
    baseGeneralId: 'simayi',
    name: '司马懿',
    title: '狼顾之鬼',
    faction: 'wei',
    gender: 'male',
    maxHp: 3,
    pack: 'standard',
    skills: [
      {
        id: 'fankui',
        name: '反馈',
        type: 'trigger',
        description: '当你受到伤害后，你可以获得伤害来源的一张牌（手牌或装备区）。'
      },
      {
        id: 'guicai',
        name: '鬼才',
        type: 'trigger',
        description: '当一名角色的判定牌生效前，你可以打出一张手牌代替之。'
      }
    ]
  },
  {
    id: 'std_xiahoudun',
    baseGeneralId: 'xiahoudun',
    name: '夏侯惇',
    title: '独眼的罗刹',
    faction: 'wei',
    gender: 'male',
    maxHp: 4,
    pack: 'standard',
    skills: [
      {
        id: 'ganglie',
        name: '刚烈',
        type: 'trigger',
        description: '当你受到伤害后，你可以进行判定，若结果不为红桃，伤害来源选择一项：弃置两张手牌，或受到你造成的1点伤害。'
      }
    ]
  },
  {
    id: 'std_zhangliao',
    baseGeneralId: 'zhangliao',
    name: '张辽',
    title: '前将军',
    faction: 'wei',
    gender: 'male',
    maxHp: 4,
    pack: 'standard',
    skills: [
      {
        id: 'tuxi',
        name: '突袭',
        type: 'trigger',
        description: '摸牌阶段，你可以改为获得至多两名其他角色的各一张手牌。'
      }
    ]
  },
  {
    id: 'std_xuchu',
    baseGeneralId: 'xuchu',
    name: '许褚',
    title: '虎痴',
    faction: 'wei',
    gender: 'male',
    maxHp: 4,
    pack: 'standard',
    skills: [
      {
        id: 'luoyi',
        name: '裸衣',
        type: 'trigger',
        description: '摸牌阶段，你可以少摸一张牌，若如此做，本回合你使用【杀】或【决斗】造成伤害时，此伤害+1。'
      }
    ]
  },
  {
    id: 'std_guojia',
    baseGeneralId: 'guojia',
    name: '郭嘉',
    title: '早终的先知',
    faction: 'wei',
    gender: 'male',
    maxHp: 3,
    pack: 'standard',
    skills: [
      {
        id: 'tiandu',
        name: '天妒',
        type: 'trigger',
        description: '当你的判定牌生效后，你可以获得此牌。'
      },
      {
        id: 'yiji',
        name: '遗计',
        type: 'trigger',
        description: '当你受到1点伤害后，你可以观看牌堆顶的两张牌，然后将这些牌交给任意角色。'
      }
    ]
  },
  {
    id: 'std_zhenji',
    baseGeneralId: 'zhenji',
    name: '甄姬',
    title: '薄幸的美人',
    faction: 'wei',
    gender: 'female',
    maxHp: 3,
    pack: 'standard',
    skills: [
      {
        id: 'qingguo',
        name: '倾国',
        type: 'trigger',
        description: '你可以将一张黑色手牌当【闪】使用或打出。'
      },
      {
        id: 'luoshen',
        name: '洛神',
        type: 'trigger',
        description: '准备阶段，你可以进行判定，若结果为黑色，你获得此牌并可以重复此流程。'
      }
    ]
  },

  // ===================== SHU (7) =====================
  {
    id: 'std_liubei',
    baseGeneralId: 'liubei',
    name: '刘备',
    title: '乱世的枭雄',
    faction: 'shu',
    gender: 'male',
    maxHp: 4,
    pack: 'standard',
    isLordCandidate: true,
    skills: [
      {
        id: 'rende',
        name: '仁德',
        type: 'active',
        description: '出牌阶段，你可以将任意张手牌交给其他角色；每阶段你以此法给出第二张牌时，你回复1点体力。'
      },
      {
        id: 'jijiang',
        name: '激将',
        type: 'lord',
        description: '主公技，当你需要使用或打出一张【杀】时，你可以令其他蜀势力角色选择是否打出一张【杀】（视为由你使用或打出）。'
      }
    ]
  },
  {
    id: 'std_guanyu',
    baseGeneralId: 'guanyu',
    name: '关羽',
    title: '美髯公',
    faction: 'shu',
    gender: 'male',
    maxHp: 4,
    pack: 'standard',
    skills: [
      {
        id: 'wusheng',
        name: '武圣',
        type: 'active',
        description: '你可以将一张红色牌（手牌或装备区）当【杀】使用或打出。'
      }
    ]
  },
  {
    id: 'std_zhangfei',
    baseGeneralId: 'zhangfei',
    name: '张飞',
    title: '万夫不当',
    faction: 'shu',
    gender: 'male',
    maxHp: 4,
    pack: 'standard',
    skills: [
      {
        id: 'paoxiao',
        name: '咆哮',
        type: 'compulsory',
        description: '锁定技，你使用【杀】无次数限制。'
      }
    ]
  },
  {
    id: 'std_zhugeliang',
    baseGeneralId: 'zhugeliang',
    name: '诸葛亮',
    title: '迟暮的丞相',
    faction: 'shu',
    gender: 'male',
    maxHp: 3,
    pack: 'standard',
    skills: [
      {
        id: 'guanxing',
        name: '观星',
        type: 'trigger',
        description: '准备阶段，你可以观看牌堆顶的X张牌（X为存活角色数且至多为5），然后将任意数量的牌置于牌堆顶，其余置于牌堆底。'
      },
      {
        id: 'kongcheng',
        name: '空城',
        type: 'compulsory',
        description: '锁定技，若你没有手牌，你不能成为【杀】或【决斗】的目标。'
      }
    ]
  },
  {
    id: 'std_zhaoyun',
    baseGeneralId: 'zhaoyun',
    name: '赵云',
    title: '少年将军',
    faction: 'shu',
    gender: 'male',
    maxHp: 4,
    pack: 'standard',
    skills: [
      {
        id: 'longdan',
        name: '龙胆',
        type: 'active',
        description: '你可以将【杀】当【闪】、【闪】当【杀】使用或打出。'
      }
    ]
  },
  {
    id: 'std_machao',
    baseGeneralId: 'machao',
    name: '马超',
    title: '一骑当千',
    faction: 'shu',
    gender: 'male',
    maxHp: 4,
    pack: 'standard',
    skills: [
      {
        id: 'mashu',
        name: '马术',
        type: 'compulsory',
        description: '锁定技，你计算与其他角色的距离-1。'
      },
      {
        id: 'tieqi',
        name: '铁骑',
        type: 'trigger',
        description: '当你使用【杀】指定目标后，你可以进行判定，若结果为红色，此【杀】不可被【闪】响应。'
      }
    ]
  },
  {
    id: 'std_huangyueying',
    baseGeneralId: 'huangyueying',
    name: '黄月英',
    title: '归隐的杰女',
    faction: 'shu',
    gender: 'female',
    maxHp: 3,
    pack: 'standard',
    skills: [
      {
        id: 'jizhi',
        name: '集智',
        type: 'trigger',
        description: '当你使用普通锦囊牌时，你可以摸一张牌。'
      },
      {
        id: 'qicai',
        name: '奇才',
        type: 'compulsory',
        description: '锁定技，你使用锦囊牌无距离限制。'
      }
    ]
  },

  // ===================== WU (8) =====================
  {
    id: 'std_sunquan',
    baseGeneralId: 'sunquan',
    name: '孙权',
    title: '年轻的贤君',
    faction: 'wu',
    gender: 'male',
    maxHp: 4,
    pack: 'standard',
    isLordCandidate: true,
    skills: [
      {
        id: 'zhiheng',
        name: '制衡',
        type: 'active',
        description: '出牌阶段限一次，你可以弃置任意张牌（手牌或装备区），然后摸等量的牌。'
      },
      {
        id: 'jiuyuan',
        name: '救援',
        type: 'lord',
        description: '主公技，锁定技，其他吴势力角色对你使用【桃】回复体力时，回复值+1。'
      }
    ]
  },
  {
    id: 'std_ganning',
    baseGeneralId: 'ganning',
    name: '甘宁',
    title: '锦帆游侠',
    faction: 'wu',
    gender: 'male',
    maxHp: 4,
    pack: 'standard',
    skills: [
      {
        id: 'qixi',
        name: '奇袭',
        type: 'active',
        description: '出牌阶段，你可以将一张黑色牌（手牌或装备区）当【过河拆桥】使用。'
      }
    ]
  },
  {
    id: 'std_lvmeng',
    baseGeneralId: 'lvmeng',
    name: '吕蒙',
    title: '白衣渡江',
    faction: 'wu',
    gender: 'male',
    maxHp: 4,
    pack: 'standard',
    skills: [
      {
        id: 'keji',
        name: '克己',
        type: 'trigger',
        description: '若你未于出牌阶段内使用或打出过【杀】，你可以跳过弃牌阶段。'
      }
    ]
  },
  {
    id: 'std_huanggai',
    baseGeneralId: 'huanggai',
    name: '黄盖',
    title: '轻身为国',
    faction: 'wu',
    gender: 'male',
    maxHp: 4,
    pack: 'standard',
    skills: [
      {
        id: 'kurou',
        name: '苦肉',
        type: 'active',
        description: '出牌阶段，你可以失去1点体力，然后摸两张牌。'
      }
    ]
  },
  {
    id: 'std_zhouyu',
    baseGeneralId: 'zhouyu',
    name: '周瑜',
    title: '大都督',
    faction: 'wu',
    gender: 'male',
    maxHp: 3,
    pack: 'standard',
    skills: [
      {
        id: 'yingzi',
        name: '英姿',
        type: 'trigger',
        description: '摸牌阶段，你可以多摸一张牌。'
      },
      {
        id: 'fanjian',
        name: '反间',
        type: 'active',
        description: '出牌阶段限一次，你可以令一名其他角色选择一种花色，然后该角色获得你的一张手牌并展示之，若花色不同则你对其造成1点伤害。'
      }
    ]
  },
  {
    id: 'std_daqiao',
    baseGeneralId: 'daqiao',
    name: '大乔',
    title: '矜持之花',
    faction: 'wu',
    gender: 'female',
    maxHp: 3,
    pack: 'standard',
    skills: [
      {
        id: 'guose',
        name: '国色',
        type: 'active',
        description: '出牌阶段，你可以将一张方块牌（手牌或装备区）当【乐不思蜀】使用。'
      },
      {
        id: 'liuli',
        name: '流离',
        type: 'trigger',
        description: '当你成为【杀】的目标时，你可以弃置一张牌（手牌或装备区）并将此【杀】转移给你攻击范围内的一名其他角色（不能是使用者）。'
      }
    ]
  },
  {
    id: 'std_luxun',
    baseGeneralId: 'luxun',
    name: '陆逊',
    title: '儒生雄才',
    faction: 'wu',
    gender: 'male',
    maxHp: 3,
    pack: 'standard',
    skills: [
      {
        id: 'qianxun',
        name: '谦逊',
        type: 'compulsory',
        description: '锁定技，你不能成为【顺手牵羊】与【乐不思蜀】的目标。'
      },
      {
        id: 'lianying',
        name: '连营',
        type: 'trigger',
        description: '当你失去最后的手牌后，你可以摸一张牌。'
      }
    ]
  },
  {
    id: 'std_sunshangxiang',
    baseGeneralId: 'sunshangxiang',
    name: '孙尚香',
    title: '弓腰姬',
    faction: 'wu',
    gender: 'female',
    maxHp: 3,
    pack: 'standard',
    skills: [
      {
        id: 'jieyin',
        name: '结姻',
        type: 'active',
        description: '出牌阶段限一次，你可以弃置两张手牌并选择一名已受伤的男性角色，你与其各回复1点体力。'
      },
      {
        id: 'xiaoji',
        name: '枭姬',
        type: 'trigger',
        description: '当你失去装备区里的一张牌后，你可以摸两张牌。'
      }
    ]
  },

  // ===================== QUN (5) =====================
  {
    id: 'std_huatuo',
    baseGeneralId: 'huatuo',
    name: '华佗',
    title: '神医',
    faction: 'qun',
    gender: 'male',
    maxHp: 3,
    pack: 'standard',
    skills: [
      {
        id: 'jijiu',
        name: '急救',
        type: 'trigger',
        description: '你的回合外，你可以将一张红色牌（手牌或装备区）当【桃】使用。'
      },
      {
        id: 'qingnang',
        name: '青囊',
        type: 'active',
        description: '出牌阶段限一次，你可以弃置一张手牌并令一名已受伤的角色回复1点体力。'
      }
    ]
  },
  {
    id: 'std_lvbu',
    baseGeneralId: 'lvbu',
    name: '吕布',
    title: '武的化身',
    faction: 'qun',
    gender: 'male',
    maxHp: 4,
    pack: 'standard',
    skills: [
      {
        id: 'wushuang',
        name: '无双',
        type: 'compulsory',
        description: '锁定技，你使用的【杀】需两张【闪】抵消；与你进行【决斗】的角色每次需打出两张【杀】。'
      }
    ]
  },
  {
    id: 'std_diaochan',
    baseGeneralId: 'diaochan',
    name: '貂蝉',
    title: '绝世的舞姬',
    faction: 'qun',
    gender: 'female',
    maxHp: 3,
    pack: 'standard',
    skills: [
      {
        id: 'lijian',
        name: '离间',
        type: 'active',
        description: '出牌阶段限一次，你可以弃置一张牌并选择两名男性角色，视为其中一名对另一名使用一张不能被【无懈可击】响应的【决斗】。'
      },
      {
        id: 'biyue',
        name: '闭月',
        type: 'trigger',
        description: '结束阶段，你可以摸一张牌。'
      }
    ]
  },
  {
    id: 'std_huaxiong',
    baseGeneralId: 'huaxiong',
    name: '华雄',
    title: '飞扬跋扈',
    faction: 'qun',
    gender: 'male',
    maxHp: 6,
    pack: 'standard',
    skills: [
      {
        id: 'yaowu',
        name: '耀武',
        type: 'compulsory',
        description: '锁定技，当一名角色使用红色【杀】对你造成伤害时，其选择回复1点体力或摸一张牌。'
      }
    ]
  },
  {
    id: 'std_yuanshu',
    baseGeneralId: 'yuanshu',
    name: '袁术',
    title: '野心渐增',
    faction: 'qun',
    gender: 'male',
    maxHp: 4,
    pack: 'standard',
    skills: [
      {
        id: 'wangzun',
        name: '妄尊',
        type: 'trigger',
        description: '主公的准备阶段，你可以摸一张牌，然后令其本回合手牌上限-1。'
      },
      {
        id: 'tongji',
        name: '同疾',
        type: 'compulsory',
        description: '锁定技，若你的手牌数大于体力值，攻击范围内包含你的其他角色使用【杀】不能指定除你外的角色为目标。'
      }
    ]
  }
];
