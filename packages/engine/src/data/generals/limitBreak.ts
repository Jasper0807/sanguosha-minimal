import type { GeneralDefinition, SkillMeta } from '../../core/types.js';

/** Skills granted dynamically via Awakening (觉醒技) */
export const LIMIT_BREAK_EXTRA_SKILLS: readonly SkillMeta[] = [
  {
    id: 'lb_jianyan',
    name: '荐言',
    description:
      '出牌阶段限一次，你可以声明一种牌的类别或颜色，连续亮出牌堆顶的牌直到符合为止，令一名男性角色获得此牌，其余置入弃牌堆。',
    type: 'active'
  },
  {
    id: 'lb_gongxin',
    name: '攻心',
    description:
      '出牌阶段限一次，你可以观看一名其他角色的手牌，然后可展示其中一张红桃牌，选择弃置此牌或将其置于牌堆顶。',
    type: 'active'
  }
];

/**
 * 界限突破·标准包 30 位武将（全部核对自三国杀 OL 官网 sanguosha.com/hero）：
 * 魏 8 + 蜀 8 + 吴 8 + 群 6 = 30
 */
export const LIMIT_BREAK_GENERALS: readonly GeneralDefinition[] = [
  // ===== 魏势力（8位）=====
  {
    id: 'lb_caocao',
    name: '界曹操',
    title: '魏武帝',
    faction: 'wei',
    gender: 'male',
    maxHp: 4,
    pack: 'limit_break',
    baseGeneralId: 'caocao',
    isLordCandidate: true,
    skills: [
      {
        id: 'lb_jianxiong',
        name: '奸雄',
        description: '当你受到伤害后，你可以摸一张牌，并获得造成此伤害的牌。',
        type: 'trigger'
      },
      {
        id: 'lb_hujia',
        name: '护驾',
        description:
          '主公技，其他魏势力角色可在你需要时代替你使用或打出【闪】；每回合限一次，其他魏势力角色于回合外使用或打出【闪】时，可令你摸一张牌。',
        type: 'lord'
      }
    ]
  },
  {
    id: 'lb_simayi',
    name: '界司马懿',
    title: '狼顾之鬼',
    faction: 'wei',
    gender: 'male',
    maxHp: 3,
    pack: 'limit_break',
    baseGeneralId: 'simayi',
    skills: [
      {
        id: 'lb_fankui',
        name: '反馈',
        description: '当你受到1点伤害后，你可以获得伤害来源的一张牌。',
        type: 'trigger'
      },
      {
        id: 'lb_guicai',
        name: '鬼才',
        description: '当一张判定牌生效前，你可以用一张牌（手牌或装备区）代替之。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'lb_xiahoudun',
    name: '界夏侯惇',
    title: '独眼的罗刹',
    faction: 'wei',
    gender: 'male',
    maxHp: 4,
    pack: 'limit_break',
    baseGeneralId: 'xiahoudun',
    skills: [
      {
        id: 'lb_ganglie',
        name: '刚烈',
        description: '当一名角色对你造成1点伤害后，你可以判定：红色对其造成1点伤害；黑色弃置其一张牌。',
        type: 'trigger'
      },
      {
        id: 'lb_qingjian',
        name: '清俭',
        description:
          '每回合限一次，当你在摸牌阶段外获得牌后，可展示并交给一名其他角色任意张牌，每给出一种类别，当前回合角色手牌上限+1。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'lb_zhangliao',
    name: '界张辽',
    title: '前将军',
    faction: 'wei',
    gender: 'male',
    maxHp: 4,
    pack: 'limit_break',
    baseGeneralId: 'zhangliao',
    skills: [
      {
        id: 'lb_tuxi',
        name: '突袭',
        description: '摸牌阶段，你可以少摸任意张牌并获得等量其他角色的各一张手牌。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'lb_xuchu',
    name: '界许褚',
    title: '虎痴',
    faction: 'wei',
    gender: 'male',
    maxHp: 4,
    pack: 'limit_break',
    baseGeneralId: 'xuchu',
    skills: [
      {
        id: 'lb_luoyi',
        name: '裸衣',
        description:
          '摸牌阶段开始前，可亮出牌堆顶3张牌，然后跳过摸牌阶段并获得其中所有基本牌、武器牌和【决斗】，直到下回合开始你的【杀】与【决斗】伤害+1。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'lb_guojia',
    name: '界郭嘉',
    title: '早终的先知',
    faction: 'wei',
    gender: 'male',
    maxHp: 3,
    pack: 'limit_break',
    baseGeneralId: 'guojia',
    skills: [
      {
        id: 'tiandu',
        name: '天妒',
        description: '当你的判定牌生效后，你可以获得此牌。',
        type: 'trigger'
      },
      {
        id: 'lb_yiji',
        name: '遗计',
        description: '当你受到1点伤害后，你可以摸两张牌，然后交给至多两名其他角色共计至多两张手牌。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'lb_zhenji',
    name: '界甄姬',
    title: '薄幸的美人',
    faction: 'wei',
    gender: 'female',
    maxHp: 3,
    pack: 'limit_break',
    baseGeneralId: 'zhenji',
    skills: [
      {
        id: 'qingguo',
        name: '倾国',
        description: '你可以将一张黑色手牌当【闪】使用或打出。',
        type: 'active'
      },
      {
        id: 'lb_luoshen',
        name: '洛神',
        description: '准备阶段，你可以连续判定黑色牌并获得之；以此法获得的牌本回合不计入手牌上限。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'lb_lidian',
    name: '李典',
    title: '深明大义',
    faction: 'wei',
    gender: 'male',
    maxHp: 3,
    pack: 'limit_break',
    baseGeneralId: 'lidian',
    skills: [
      {
        id: 'lb_xunxun',
        name: '恂恂',
        description: '摸牌阶段开始时，你可以观看牌堆顶的四张牌，将其中两张置于牌堆顶，其余两张置于牌堆底。',
        type: 'trigger'
      },
      {
        id: 'lb_wangxi',
        name: '忘隙',
        description: '当你对其他角色造成1点伤害后，或受到其他角色的1点伤害后，你可以摸两张牌并交给该角色其中一张牌。',
        type: 'trigger'
      }
    ]
  },

  // ===== 蜀势力（8位）=====
  {
    id: 'lb_liubei',
    name: '界刘备',
    title: '乱世的枭雄',
    faction: 'shu',
    gender: 'male',
    maxHp: 4,
    pack: 'limit_break',
    baseGeneralId: 'liubei',
    isLordCandidate: true,
    skills: [
      {
        id: 'lb_rende',
        name: '仁德',
        description:
          '出牌阶段，每名角色限一次，交给一名其他角色任意张手牌；本阶段给出第2张时，你可以视为使用一张基本牌（【杀】有次数限制）。',
        type: 'active'
      },
      {
        id: 'lb_jijiang',
        name: '激将',
        description:
          '主公技，其他蜀势力角色可在你需要时代替你使用或打出【杀】；每回合限一次，其他蜀势力角色于回合外使用/打出或替你出【杀】时，可令你摸一张牌。',
        type: 'lord'
      }
    ]
  },
  {
    id: 'lb_guanyu',
    name: '界关羽',
    title: '美髯公',
    faction: 'shu',
    gender: 'male',
    maxHp: 4,
    pack: 'limit_break',
    baseGeneralId: 'guanyu',
    skills: [
      {
        id: 'lb_wusheng',
        name: '武圣',
        description: '你可以将一张红色牌当【杀】使用或打出；你使用的方块【杀】无距离限制。',
        type: 'active'
      },
      {
        id: 'lb_yijue',
        name: '义绝',
        description:
          '出牌阶段限一次，弃置一张牌令一名其他角色展示一张手牌：黑色则其本回合非锁定技失效且不能使用/打出手牌、对其红桃【杀】伤害+1；红色则你获得之并可令其回1血。',
        type: 'active'
      }
    ]
  },
  {
    id: 'lb_zhangfei',
    name: '界张飞',
    title: '万夫不当',
    faction: 'shu',
    gender: 'male',
    maxHp: 4,
    pack: 'limit_break',
    baseGeneralId: 'zhangfei',
    skills: [
      {
        id: 'lb_paoxiao',
        name: '咆哮',
        description: '锁定技，你使用【杀】无次数限制；当你使用的【杀】被抵消后，你本回合下一次【杀】造成的伤害+1。',
        type: 'compulsory'
      },
      {
        id: 'lb_tishen',
        name: '替身',
        description: '限定技，准备阶段，你可以回复所有体力，你每以此法回复1点体力便摸一张牌。',
        type: 'limited'
      }
    ]
  },
  {
    id: 'lb_zhugeliang',
    name: '界诸葛亮',
    title: '迟暮的丞相',
    faction: 'shu',
    gender: 'male',
    maxHp: 3,
    pack: 'limit_break',
    baseGeneralId: 'zhugeliang',
    skills: [
      {
        id: 'lb_guanxing',
        name: '观星',
        description:
          '准备阶段，观看牌堆顶5张牌（存活角色<4改为3张）任意置顶/置底；若全置于牌堆底，结束阶段可再次发动。',
        type: 'trigger'
      },
      {
        id: 'kongcheng',
        name: '空城',
        description: '锁定技，若你没有手牌，你不能成为【杀】或【决斗】的目标。',
        type: 'compulsory'
      }
    ]
  },
  {
    id: 'lb_zhaoyun',
    name: '界赵云',
    title: '少年将军',
    faction: 'shu',
    gender: 'male',
    maxHp: 4,
    pack: 'limit_break',
    baseGeneralId: 'zhaoyun',
    skills: [
      {
        id: 'lb_longdan',
        name: '龙胆',
        description: '你可以将【杀】当【闪】、【闪】当【杀】、【酒】当【桃】、【桃】当【酒】使用或打出。',
        type: 'active'
      },
      {
        id: 'lb_yajiao',
        name: '涯角',
        description:
          '当你于回合外使用或打出手牌时，可展示牌堆顶一张牌：类别相同令一名角色获得之；不同可弃置攻击范围内包含你的一名角色区域里一张牌。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'lb_machao',
    name: '界马超',
    title: '一骑当千',
    faction: 'shu',
    gender: 'male',
    maxHp: 4,
    pack: 'limit_break',
    baseGeneralId: 'machao',
    skills: [
      {
        id: 'mashu',
        name: '马术',
        description: '锁定技，你计算与其他角色的距离-1。',
        type: 'compulsory'
      },
      {
        id: 'lb_tieqi',
        name: '铁骑',
        description:
          '当你使用【杀】指定目标后，可令其本回合非锁定技失效，然后判定，除非其弃置一张与判定结果花色相同的牌，否则不可抵消此【杀】。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'lb_huangyueying',
    name: '界黄月英',
    title: '归隐的杰女',
    faction: 'shu',
    gender: 'female',
    maxHp: 3,
    pack: 'limit_break',
    baseGeneralId: 'huangyueying',
    skills: [
      {
        id: 'lb_jizhi',
        name: '集智',
        description: '当你使用非转化锦囊牌时，你可以摸一张牌；若为基本牌，可弃置之令你本回合手牌上限+1。',
        type: 'trigger'
      },
      {
        id: 'lb_qicai',
        name: '奇才',
        description: '锁定技，你使用锦囊牌无距离限制；其他角色弃置你装备区里的防具或宝物牌时，防止之。',
        type: 'compulsory'
      }
    ]
  },
  {
    id: 'lb_xushu',
    name: '界徐庶',
    title: '忠孝的侠士',
    faction: 'shu',
    gender: 'male',
    maxHp: 4,
    pack: 'limit_break',
    baseGeneralId: 'xushu',
    skills: [
      {
        id: 'lb_zhuhai',
        name: '诛害',
        description: '其他角色的结束阶段，若其本回合造成过伤害，你可以对其使用一张【杀】。',
        type: 'trigger'
      },
      {
        id: 'lb_qianxin',
        name: '潜心',
        description: '觉醒技，当你造成伤害后，若你已受伤，你减少1点体力上限并获得“荐言”。',
        type: 'awakening'
      }
    ]
  },

  // ===== 吴势力（8位）=====
  {
    id: 'lb_sunquan',
    name: '界孙权',
    title: '年轻的贤君',
    faction: 'wu',
    gender: 'male',
    maxHp: 4,
    pack: 'limit_break',
    baseGeneralId: 'sunquan',
    isLordCandidate: true,
    skills: [
      {
        id: 'lb_zhiheng',
        name: '制衡',
        description: '出牌阶段限一次，你可以弃置任意张牌并摸等量张牌；若弃置了所有手牌，额外摸一张牌。',
        type: 'active'
      },
      {
        id: 'lb_jiuyuan',
        name: '救援',
        description: '主公技，其他吴势力角色于其回合内回复体力时，若其体力值大于等于你，可改为令你回复1点体力然后其摸一张牌。',
        type: 'lord'
      }
    ]
  },
  {
    id: 'lb_ganning',
    name: '界甘宁',
    title: '锦帆游侠',
    faction: 'wu',
    gender: 'male',
    maxHp: 4,
    pack: 'limit_break',
    baseGeneralId: 'ganning',
    skills: [
      {
        id: 'qixi',
        name: '奇袭',
        description: '你可以将一张黑色牌当【过河拆桥】使用。',
        type: 'active'
      },
      {
        id: 'lb_fenwei',
        name: '奋威',
        description: '限定技，当一张锦囊牌指定多个目标后，你可以令此牌对任意个目标无效。',
        type: 'limited'
      }
    ]
  },
  {
    id: 'lb_lvmeng',
    name: '界吕蒙',
    title: '白衣渡江',
    faction: 'wu',
    gender: 'male',
    maxHp: 4,
    pack: 'limit_break',
    baseGeneralId: 'lvmeng',
    skills: [
      {
        id: 'keji',
        name: '克己',
        description: '若你未于本回合出牌阶段使用或打出过【杀】，你可以跳过弃牌阶段。',
        type: 'trigger'
      },
      {
        id: 'lb_qinxue',
        name: '勤学',
        description: '觉醒技，准备阶段或结束阶段，若手牌数比体力值多2或更多，减1点体力上限，回复1点体力或摸两张牌，并获得“攻心”。',
        type: 'awakening'
      },
      {
        id: 'lb_botu',
        name: '博图',
        description: '每轮限X次（X为存活角色数且至多为3），回合结束后，若本回合置入弃牌堆的牌包含四种花色，可执行一个额外回合。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'lb_huanggai',
    name: '界黄盖',
    title: '轻身为国',
    faction: 'wu',
    gender: 'male',
    maxHp: 4,
    pack: 'limit_break',
    baseGeneralId: 'huanggai',
    skills: [
      {
        id: 'lb_kurou',
        name: '苦肉',
        description: '出牌阶段限一次，你可以弃置一张牌，然后失去1点体力。',
        type: 'active'
      },
      {
        id: 'lb_zhaxiang',
        name: '诈降',
        description: '锁定技，当你失去1点体力后，摸三张牌；若在出牌阶段，本回合【杀】次数+1、红色【杀】无距离限制且不可抵消。',
        type: 'compulsory'
      }
    ]
  },
  {
    id: 'lb_zhouyu',
    name: '界周瑜',
    title: '大都督',
    faction: 'wu',
    gender: 'male',
    maxHp: 3,
    pack: 'limit_break',
    baseGeneralId: 'zhouyu',
    skills: [
      {
        id: 'lb_yingzi',
        name: '英姿',
        description: '锁定技，摸牌阶段你多摸一张牌；你的手牌上限等于你的体力上限。',
        type: 'compulsory'
      },
      {
        id: 'lb_fanjian',
        name: '反间',
        description: '出牌阶段限一次，展示并交给一名其他角色一张手牌，其选一项：1.弃置所有同花色牌；2.失去1点体力。',
        type: 'active'
      }
    ]
  },
  {
    id: 'lb_daqiao',
    name: '界大乔',
    title: '矜持之花',
    faction: 'wu',
    gender: 'female',
    maxHp: 3,
    pack: 'limit_break',
    baseGeneralId: 'daqiao',
    skills: [
      {
        id: 'lb_guose',
        name: '国色',
        description: '出牌阶段限一次，选一项后摸一张牌：1.方块牌当【乐不思蜀】使用；2.弃置一张方块牌与场上一张【乐不思蜀】。',
        type: 'active'
      },
      {
        id: 'liuli',
        name: '流离',
        description: '当你成为【杀】的目标时，你可以弃置一张牌并将此【杀】转移给你攻击范围内的一名其他角色。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'lb_luxun',
    name: '界陆逊',
    title: '儒生雄才',
    faction: 'wu',
    gender: 'male',
    maxHp: 3,
    pack: 'limit_break',
    baseGeneralId: 'luxun',
    skills: [
      {
        id: 'lb_qianxun',
        name: '谦逊',
        description: '当延时锦囊或其他角色使用的普通锦囊对你生效时，若你为唯一目标，可将所有手牌移出游戏直到回合结束。',
        type: 'trigger'
      },
      {
        id: 'lb_lianying',
        name: '连营',
        description: '当你失去所有手牌后，你可以令至多X名角色各摸一张牌（X为你此次失去的手牌数）。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'lb_sunshangxiang',
    name: '界孙尚香',
    title: '弓腰姬',
    faction: 'wu',
    gender: 'female',
    maxHp: 3,
    pack: 'limit_break',
    baseGeneralId: 'sunshangxiang',
    skills: [
      {
        id: 'lb_jieyin',
        name: '结姻',
        description: '出牌阶段限一次，选一名男性角色，弃置一张手牌或将一张装备牌置入其装备区，体力较大者摸1牌、较小者回1血。',
        type: 'active'
      },
      {
        id: 'xiaoji',
        name: '枭姬',
        description: '当你失去装备区里的一张牌后，你可以摸两张牌。',
        type: 'trigger'
      }
    ]
  },

  // ===== 群势力（6位）=====
  {
    id: 'lb_huatuo',
    name: '界华佗',
    title: '神医',
    faction: 'qun',
    gender: 'male',
    maxHp: 3,
    pack: 'limit_break',
    baseGeneralId: 'huatuo',
    skills: [
      {
        id: 'jijiu',
        name: '急救',
        description: '你的回合外，你可以将一张红色牌当【桃】使用。',
        type: 'active'
      },
      {
        id: 'lb_chuli',
        name: '除疠',
        description: '出牌阶段限一次，选择任意名势力各不相同的其他角色，弃置你与这些角色的各一张牌，被弃置黑桃牌者摸一张牌。',
        type: 'active'
      }
    ]
  },
  {
    id: 'lb_lvbu',
    name: '界吕布',
    title: '武的化身',
    faction: 'qun',
    gender: 'male',
    maxHp: 5,
    pack: 'limit_break',
    baseGeneralId: 'lvbu',
    skills: [
      {
        id: 'wushuang',
        name: '无双',
        description: '锁定技，你使用的【杀】需两张【闪】才能抵消；与你【决斗】的角色每次需打出两张【杀】。',
        type: 'compulsory'
      },
      {
        id: 'lb_liyu',
        name: '利驭',
        description: '当你使用【杀】对其他角色造成伤害后，可获得其区域里一张牌：非装备则其摸1牌；装备则你视为对由其指定的另一角色用【决斗】。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'lb_diaochan',
    name: '界貂蝉',
    title: '绝世的舞姬',
    faction: 'qun',
    gender: 'female',
    maxHp: 3,
    pack: 'limit_break',
    baseGeneralId: 'diaochan',
    skills: [
      {
        id: 'lijian',
        name: '离间',
        description: '出牌阶段限一次，弃置一张牌令一名男性角色视为对另一名男性角色使用不可【无懈可击】的【决斗】。',
        type: 'active'
      },
      {
        id: 'lb_biyue',
        name: '闭月',
        description: '结束阶段，若你没有手牌，你可以摸两张牌，否则你可以摸一张牌。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'lb_huaxiong',
    name: '界华雄',
    title: '魔将',
    faction: 'qun',
    gender: 'male',
    maxHp: 6,
    pack: 'limit_break',
    baseGeneralId: 'huaxiong',
    skills: [
      {
        id: 'lb_yaowu',
        name: '耀武',
        description: '锁定技，当你受到伤害时，若造成伤害的牌为红色，伤害来源摸一张牌；不为红色，你摸一张牌。',
        type: 'compulsory'
      },
      {
        id: 'lb_shizhan',
        name: '势斩',
        description: '出牌阶段限两次，你可以令一名其他角色视为对你使用一张【决斗】。',
        type: 'active'
      }
    ]
  },
  {
    id: 'lb_yuanshu',
    name: '界袁术',
    title: '仲家帝',
    faction: 'qun',
    gender: 'male',
    maxHp: 4,
    pack: 'limit_break',
    baseGeneralId: 'yuanshu',
    skills: [
      {
        id: 'lb_yongsi',
        name: '庸肆',
        description: '锁定技，摸牌阶段你改为摸X张牌（X为全场势力数）；弃牌阶段开始时，你弃置一张牌或失去1点体力。',
        type: 'compulsory'
      },
      {
        id: 'lb_jixi',
        name: '觊玺',
        description: '觉醒技，回合结束时若已连续3个自己回合未失去体力，加1血上限并回1血，选：1.获【妄尊】；2.摸2牌并获主公的主公技。',
        type: 'awakening'
      }
    ]
  },
  {
    id: 'lb_gongsunzan',
    name: '界公孙瓒',
    title: '白马将军',
    faction: 'qun',
    gender: 'male',
    maxHp: 4,
    pack: 'limit_break',
    baseGeneralId: 'gongsunzan',
    skills: [
      {
        id: 'lb_yicong',
        name: '义从',
        description: '锁定技，你计算与其他角色的距离-1；若你的体力值小于等于2，其他角色计算与你的距离+1。',
        type: 'compulsory'
      },
      {
        id: 'lb_qiaomeng',
        name: '趫猛',
        description: '当你使用【杀】对一名角色造成伤害后，你可以弃置其区域里的一张牌；若此牌为坐骑牌，你获得之。',
        type: 'trigger'
      }
    ]
  }
];
