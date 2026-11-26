import type { GeneralDefinition, SkillMeta } from '../../core/types.js';

/** Extra skills gained dynamically in Wind/Fire/Forest/Mountain packs */
export const EXPANSION_EXTRA_SKILLS: readonly SkillMeta[] = [
  {
    id: 'chanyuan',
    name: '缠怨',
    description: '锁定技，你不能质疑【蛊惑】；若你的体力值为1，你的其他技能失效。',
    type: 'compulsory'
  },
  {
    id: 'jixi_dengai',
    name: '急袭',
    description: '出牌阶段，你可以将一张“田”当【顺手牵羊】使用。',
    type: 'active'
  },
  {
    id: 'huangtian_give',
    name: '黄天(献牌)',
    description: '出牌阶段限一次，若场上有主公张角，其他群势力角色可以交给其一张【闪】或【闪电】。',
    type: 'active'
  },
  {
    id: 'zhiba_pindian',
    name: '制霸(拼点)',
    description: '出牌阶段限一次，若场上有主公孙策，其他吴势力角色可以与其拼点，若没赢孙策获得两张拼点牌。',
    type: 'active'
  }
];

/**
 * 风林火山 32 位 OL 官方武将（全部逐字核对自 sanguosha.com/hero）：
 * 风 8 + 火 8 + 林 8 + 山 8 = 32
 */
export const FENG_GENERALS: readonly GeneralDefinition[] = [
  {
    id: 'exp_xiahouyuan',
    name: '夏侯渊',
    title: '疾行的猎豹',
    faction: 'wei',
    gender: 'male',
    maxHp: 4,
    pack: 'feng',
    skills: [
      {
        id: 'shensu',
        name: '神速',
        description:
          '你可以选择至多三项：1.跳过判定和摸牌阶段；2.跳过出牌阶段并弃置一张装备牌；3.跳过弃牌阶段并翻面。每选一项视为使用一张无距离限制的【杀】。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'exp_caoren',
    name: '曹仁',
    title: '大将军',
    faction: 'wei',
    gender: 'male',
    maxHp: 4,
    pack: 'feng',
    skills: [
      {
        id: 'jushou',
        name: '据守',
        description: '结束阶段，你可以翻面并摸四张牌，然后弃置一张手牌，若为装备牌，你改为使用之。',
        type: 'trigger'
      },
      {
        id: 'jiewei',
        name: '解围',
        description: '你可以将装备区里的牌当【无懈可击】使用；当你从背面翻至正面时，可弃置一张牌并移动场上一张牌。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'exp_huangzhong',
    name: '黄忠',
    title: '老当益壮',
    faction: 'shu',
    gender: 'male',
    maxHp: 4,
    pack: 'feng',
    skills: [
      {
        id: 'liegong',
        name: '烈弓',
        description:
          '当你于出牌阶段使用【杀】指定目标后，若其手牌数大于等于你的体力值或小于等于你的攻击范围，可令其不能抵消此【杀】。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'exp_weiyan',
    name: '魏延',
    title: '嗜血的独狼',
    faction: 'shu',
    gender: 'male',
    maxHp: 4,
    pack: 'feng',
    skills: [
      {
        id: 'kuanggu',
        name: '狂骨',
        description: '当你对距离1以内的一名角色造成1点伤害后，你可以回复1点体力或摸一张牌。',
        type: 'trigger'
      },
      {
        id: 'qimou',
        name: '奇谋',
        description: '限定技，出牌阶段，你可以失去任意点体力，本回合你计算与其他角色的距离-X且使用【杀】次数+X。',
        type: 'limited'
      }
    ]
  },
  {
    id: 'exp_xiaoqiao',
    name: '小乔',
    title: '矫情之花',
    faction: 'wu',
    gender: 'female',
    maxHp: 3,
    pack: 'feng',
    skills: [
      {
        id: 'hongyan',
        name: '红颜',
        description: '锁定技，你的黑桃牌视为红桃牌。',
        type: 'compulsory'
      },
      {
        id: 'tianxiang',
        name: '天香',
        description:
          '当你受到伤害时，可弃置一张红桃手牌防止此伤害并选一名其他角色，令其：1.受来源1点伤并摸已损体力张牌（至多5）；2.失1血并获弃置牌。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'exp_zhoutai',
    name: '周泰',
    title: '历战之躯',
    faction: 'wu',
    gender: 'male',
    maxHp: 4,
    pack: 'feng',
    skills: [
      {
        id: 'buqu',
        name: '不屈',
        description:
          '锁定技，濒死时将牌堆顶1牌置于武将牌上称为“创”，点数与其他“创”不同则回至1血，否则移去；有“创”时手牌上限=“创”数。',
        type: 'compulsory'
      },
      {
        id: 'fenji',
        name: '奋激',
        description: '当一名角色的手牌被弃置或获得后，你可以失去1点体力令其摸两张牌。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'exp_zhangjiao',
    name: '张角',
    title: '天公将军',
    faction: 'qun',
    gender: 'male',
    maxHp: 3,
    pack: 'feng',
    isLordCandidate: true,
    skills: [
      {
        id: 'leiji',
        name: '雷击',
        description: '当你使用或打出【闪】时，可令一名其他角色判定：黑桃对其造成2点雷伤；梅花你回1血并对其造成1点雷伤。',
        type: 'trigger'
      },
      {
        id: 'guidao',
        name: '鬼道',
        description: '当一张判定牌生效前，你可以用一张黑色牌替换之（获得原判定牌）。',
        type: 'trigger'
      },
      {
        id: 'huangtian',
        name: '黄天',
        description: '主公技，其他群势力角色出牌阶段限一次，可以交给你一张【闪】或【闪电】。',
        type: 'lord'
      }
    ]
  },
  {
    id: 'exp_yuji',
    name: '于吉',
    title: '太平道人',
    faction: 'qun',
    gender: 'male',
    maxHp: 3,
    pack: 'feng',
    skills: [
      {
        id: 'guhuo',
        name: '蛊惑',
        description:
          '每回合限一次，扣置一张手牌当任意基本牌或普通锦囊牌使用，其他角色可质疑：若假作废并质疑者摸牌；若真质疑者获【缠怨】。',
        type: 'active'
      }
    ]
  }
];

export const HUO_GENERALS: readonly GeneralDefinition[] = [
  {
    id: 'exp_dianwei',
    name: '典韦',
    title: '古之恶来',
    faction: 'wei',
    gender: 'male',
    maxHp: 4,
    pack: 'huo',
    skills: [
      {
        id: 'qiangxi',
        name: '强袭',
        description: '出牌阶段限两次，你可以失去1点体力或弃置一张武器牌，对一名本回合未以此法指定过的其他角色造成1点伤害。',
        type: 'active'
      }
    ]
  },
  {
    id: 'exp_xunyu',
    name: '荀彧',
    title: '王佐之才',
    faction: 'wei',
    gender: 'male',
    maxHp: 3,
    pack: 'huo',
    skills: [
      {
        id: 'quhu',
        name: '驱虎',
        description: '出牌阶段限一次，与体力值大于你的一名角色拼点：赢则其对其攻击范围内你选的角色造成1伤；没赢其对你造成1伤。',
        type: 'active'
      },
      {
        id: 'jieming',
        name: '节命',
        description: '当你受到1点伤害后，你可以令一名角色将手牌摸至X张（X为其体力上限且至多为5）。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'exp_wolong',
    name: '卧龙诸葛亮',
    title: '卧龙',
    faction: 'shu',
    gender: 'male',
    maxHp: 3,
    pack: 'huo',
    skills: [
      {
        id: 'bazhen',
        name: '八阵',
        description: '锁定技，若你的装备区里没有防具牌，你视为装备着【八卦阵】。',
        type: 'compulsory'
      },
      {
        id: 'huoji',
        name: '火计',
        description: '出牌阶段，你可以将一张红色手牌当【火攻】使用。',
        type: 'active'
      },
      {
        id: 'kanpo',
        name: '看破',
        description: '你可以将一张黑色手牌当【无懈可击】使用。',
        type: 'active'
      }
    ]
  },
  {
    id: 'exp_pangtong',
    name: '庞统',
    title: '凤雏',
    faction: 'shu',
    gender: 'male',
    maxHp: 3,
    pack: 'huo',
    skills: [
      {
        id: 'lianhuan',
        name: '连环',
        description: '出牌阶段，你可以将一张梅花手牌当【铁索连环】使用或重铸。',
        type: 'active'
      },
      {
        id: 'niepan',
        name: '涅槃',
        description: '限定技，当你处于濒死状态时，你可以弃置区域里的所有牌，复原武将牌，摸三张牌，回复至3点体力。',
        type: 'limited'
      }
    ]
  },
  {
    id: 'exp_taishici',
    name: '太史慈',
    title: '笃烈之士',
    faction: 'wu',
    gender: 'male',
    maxHp: 4,
    pack: 'huo',
    skills: [
      {
        id: 'tianyi',
        name: '天义',
        description: '出牌阶段限一次，与一名其他角色拼点：赢则本回合【杀】次数+1、无距离限制且可多指定1个目标；没赢本回合不能用【杀】。',
        type: 'active'
      }
    ]
  },
  {
    id: 'exp_yuanshao',
    name: '袁绍',
    title: '高贵的名门',
    faction: 'qun',
    gender: 'male',
    maxHp: 4,
    pack: 'huo',
    isLordCandidate: true,
    skills: [
      {
        id: 'luanji',
        name: '乱击',
        description: '出牌阶段，你可以将两张花色相同的手牌当【万箭齐发】使用。',
        type: 'active'
      },
      {
        id: 'xueyi',
        name: '血裔',
        description: '主公技，锁定技，全场每有一名其他群势力角色，你的手牌上限便+2。',
        type: 'lord'
      }
    ]
  },
  {
    id: 'exp_yanliangwenchou',
    name: '颜良&文丑',
    title: '虎狼兄弟',
    faction: 'qun',
    gender: 'male',
    maxHp: 4,
    pack: 'huo',
    skills: [
      {
        id: 'shuangxiong',
        name: '双雄',
        description: '摸牌阶段，你可以改为判定并获得判定牌，本回合你可以将一张与之颜色不同的手牌当【决斗】使用。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'exp_pangde',
    name: '庞德',
    title: '人马一体',
    faction: 'qun',
    gender: 'male',
    maxHp: 4,
    pack: 'huo',
    skills: [
      {
        id: 'mashu',
        name: '马术',
        description: '锁定技，你计算与其他角色的距离-1。',
        type: 'compulsory'
      },
      {
        id: 'jianchu',
        name: '鞬出',
        description: '当你使用【杀】指定目标后，可弃置其一张牌：若为装备牌其不能抵消此【杀】；若为非装备牌其获得此【杀】。',
        type: 'trigger'
      }
    ]
  }
];

export const LIN_GENERALS: readonly GeneralDefinition[] = [
  {
    id: 'exp_xuhuang',
    name: '徐晃',
    title: '周亚夫之风',
    faction: 'wei',
    gender: 'male',
    maxHp: 4,
    pack: 'lin',
    skills: [
      {
        id: 'duanliang',
        name: '断粮',
        description: '你可以将一张黑色基本牌或黑色装备牌当【兵粮寸断】使用；对手牌数大于等于你的角色使用【兵粮寸断】无距离限制。',
        type: 'active'
      },
      {
        id: 'jiezi',
        name: '截辎',
        description: '锁定技，当其他角色跳过摸牌阶段后，你摸一张牌。',
        type: 'compulsory'
      }
    ]
  },
  {
    id: 'exp_caopi',
    name: '曹丕',
    title: '霸业的继承者',
    faction: 'wei',
    gender: 'male',
    maxHp: 3,
    pack: 'lin',
    isLordCandidate: true,
    skills: [
      {
        id: 'xingshang',
        name: '行殇',
        description: '当其他角色死亡时，你可以获得其所有牌。',
        type: 'trigger'
      },
      {
        id: 'fangzhu',
        name: '放逐',
        description: '当你受到伤害后，你可以令一名其他角色翻面，并令其摸X张牌（X为你已损失体力值）。',
        type: 'trigger'
      },
      {
        id: 'songwei',
        name: '颂威',
        description: '主公技，当其他魏势力角色的黑色判定牌生效后，其可以令你摸一张牌。',
        type: 'lord'
      }
    ]
  },
  {
    id: 'exp_menghuo',
    name: '孟获',
    title: '南蛮王',
    faction: 'shu',
    gender: 'male',
    maxHp: 4,
    pack: 'lin',
    skills: [
      {
        id: 'huoshou',
        name: '祸首',
        description: '锁定技，【南蛮入侵】对你无效；当其他角色使用【南蛮入侵】指定目标后，你代替其成为此牌的伤害来源。',
        type: 'compulsory'
      },
      {
        id: 'zaiqi',
        name: '再起',
        description: '摸牌阶段，若你已受伤，你可以改为亮出牌堆顶 1+已损体力 张牌，回复其中红桃牌数等量体力并获得其余牌。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'exp_zhurong',
    name: '祝融',
    title: '野性的女王',
    faction: 'shu',
    gender: 'female',
    maxHp: 4,
    pack: 'lin',
    skills: [
      {
        id: 'juxiang',
        name: '巨象',
        description: '锁定技，【南蛮入侵】对你无效；当其他角色使用的【南蛮入侵】结算结束后，你获得之。',
        type: 'compulsory'
      },
      {
        id: 'lieren',
        name: '烈刃',
        description: '当你使用【杀】对目标角色造成伤害后，你可以与其拼点：若你赢，你获得其一张牌。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'exp_sunjian',
    name: '孙坚',
    title: '武烈帝',
    faction: 'wu',
    gender: 'male',
    maxHp: 4,
    pack: 'lin',
    skills: [
      {
        id: 'yinghun',
        name: '英魂',
        description: '准备阶段，若你已受伤，可选择一名其他角色选一项（X为已损体力）：1.摸X弃1；2.摸1弃X。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'exp_lusu',
    name: '鲁肃',
    title: '独断的外交家',
    faction: 'wu',
    gender: 'male',
    maxHp: 3,
    pack: 'lin',
    skills: [
      {
        id: 'haoshi',
        name: '好施',
        description: '摸牌阶段，你可以多摸两张牌，然后若手牌数大于5，你将一半手牌（向下取整）交给手牌最少的一名其他角色。',
        type: 'trigger'
      },
      {
        id: 'dimeng',
        name: '缔盟',
        description: '出牌阶段限一次，选择两名其他角色并弃置等于两者手牌数之差的牌，然后交换两者手牌。',
        type: 'active'
      }
    ]
  },
  {
    id: 'exp_dongzhuo',
    name: '董卓',
    title: '魔王',
    faction: 'qun',
    gender: 'male',
    maxHp: 8,
    pack: 'lin',
    isLordCandidate: true,
    skills: [
      {
        id: 'jiuchi',
        name: '酒池',
        description: '你可以将一张黑桃手牌当【酒】使用。',
        type: 'active'
      },
      {
        id: 'roulin',
        name: '肉林',
        description: '锁定技，你对女性角色使用的【杀】和女性角色对你使用的【杀】均需使用两张【闪】才能抵消。',
        type: 'compulsory'
      },
      {
        id: 'benghuai',
        name: '崩坏',
        description: '锁定技，结束阶段，若你不是体力值最小的角色，你失去1点体力或减少1点体力上限。',
        type: 'compulsory'
      },
      {
        id: 'baonue',
        name: '暴虐',
        description: '主公技，当其他群势力角色造成伤害后，其可以令你判定，若结果为黑桃，你回复1点体力。',
        type: 'lord'
      }
    ]
  },
  {
    id: 'exp_jiaxu',
    name: '贾诩',
    title: '冷酷的毒士',
    faction: 'qun',
    gender: 'male',
    maxHp: 3,
    pack: 'lin',
    skills: [
      {
        id: 'wansha',
        name: '完杀',
        description: '锁定技，在你的回合内，不处于濒死状态的其他角色不能使用【桃】。',
        type: 'compulsory'
      },
      {
        id: 'luanwu',
        name: '乱武',
        description: '限定技，出牌阶段，令所有其他角色依次选择：对其距离最近的另一名角色使用一张【杀】，或失去1点体力。',
        type: 'limited'
      },
      {
        id: 'weimu',
        name: '帷幕',
        description: '锁定技，你不能成为黑色锦囊牌的目标。',
        type: 'compulsory'
      }
    ]
  }
];

export const SHAN_GENERALS: readonly GeneralDefinition[] = [
  {
    id: 'exp_zhanghe',
    name: '张郃',
    title: '料敌机先',
    faction: 'wei',
    gender: 'male',
    maxHp: 4,
    pack: 'shan',
    skills: [
      {
        id: 'qiaobian',
        name: '巧变',
        description:
          '你可以弃置一张手牌并跳过一个阶段（准备/结束除外）：跳过摸牌可获至多2名角色各1手牌；跳过出牌可移动场上一张牌。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'exp_dengai',
    name: '邓艾',
    title: '矫然的壮士',
    faction: 'wei',
    gender: 'male',
    maxHp: 4,
    pack: 'shan',
    skills: [
      {
        id: 'tuntian',
        name: '屯田',
        description: '当你于回合外失去牌后，你可以判定，非红桃判定牌置于武将牌上称为“田”，每有1张“田”你计算与其他角色距离-1。',
        type: 'trigger'
      },
      {
        id: 'zaoxian',
        name: '凿险',
        description: '觉醒技，准备阶段，若“田”的数量>=3，你减少1点体力上限并获得【急袭】。',
        type: 'awakening'
      }
    ]
  },
  {
    id: 'exp_jiangwei',
    name: '姜维',
    title: '龙的衣钵',
    faction: 'shu',
    gender: 'male',
    maxHp: 4,
    pack: 'shan',
    skills: [
      {
        id: 'tiaoxin',
        name: '挑衅',
        description: '出牌阶段限一次，令一名攻击范围内包含你的角色对你使用一张【杀】，否则你弃置其一张牌。',
        type: 'active'
      },
      {
        id: 'zhiji',
        name: '志继',
        description: '觉醒技，准备阶段，若你没有手牌，回复1点体力或摸两张牌，然后减1点体力上限并获得【观星】。',
        type: 'awakening'
      }
    ]
  },
  {
    id: 'exp_liushan',
    name: '刘禅',
    title: '无为的真命主',
    faction: 'shu',
    gender: 'male',
    maxHp: 3,
    pack: 'shan',
    isLordCandidate: true,
    skills: [
      {
        id: 'xiangle',
        name: '享乐',
        description: '锁定技，当你成为【杀】的目标后，除非使用者弃置一张基本牌，否则此【杀】对你无效。',
        type: 'compulsory'
      },
      {
        id: 'fangquan',
        name: '放权',
        description: '你可以跳过出牌阶段，然后本回合结束时，弃置一张手牌并令一名其他角色执行一个额外的回合。',
        type: 'trigger'
      },
      {
        id: 'ruoyu',
        name: '若愚',
        description: '主公技，觉醒技，准备阶段，若你是体力值最小的角色，加1点体力上限、回1点体力，然后获得【激将】。',
        type: 'lord'
      }
    ]
  },
  {
    id: 'exp_sunce',
    name: '孙策',
    title: '江东的小霸王',
    faction: 'wu',
    gender: 'male',
    maxHp: 4,
    pack: 'shan',
    isLordCandidate: true,
    skills: [
      {
        id: 'jiang',
        name: '激昂',
        description: '当你使用【决斗】或红色【杀】指定目标后，或成为【决斗】或红色【杀】的目标后，你可以摸一张牌。',
        type: 'trigger'
      },
      {
        id: 'hunzi',
        name: '魂姿',
        description: '觉醒技，准备阶段，若你的体力值为1，你减少1点体力上限，然后获得【英姿】和【英魂】。',
        type: 'awakening'
      },
      {
        id: 'zhiba',
        name: '制霸',
        description: '主公技，其他吴势力角色出牌阶段限一次可与你拼点：若其没赢，你获得两张拼点牌；发动魂姿后可拒绝。',
        type: 'lord'
      }
    ]
  },
  {
    id: 'exp_erzhang',
    name: '张昭&张纮',
    title: '经天纬地',
    faction: 'wu',
    gender: 'male',
    maxHp: 3,
    pack: 'shan',
    skills: [
      {
        id: 'zhijian',
        name: '直谏',
        description: '出牌阶段，你可以将手牌中一张装备牌置入一名其他角色的装备区，然后摸一张牌。',
        type: 'active'
      },
      {
        id: 'guzheng',
        name: '固政',
        description: '其他角色弃牌阶段结束时，你可以令其获得一张此阶段因弃置进入弃牌堆的牌，然后你可以获得剩余牌。',
        type: 'trigger'
      }
    ]
  },
  {
    id: 'exp_caiwenji',
    name: '蔡文姬',
    title: '异乡的孤女',
    faction: 'qun',
    gender: 'female',
    maxHp: 3,
    pack: 'shan',
    skills: [
      {
        id: 'beige',
        name: '悲歌',
        description: '当一名角色受到【杀】的伤害后，可弃置一张牌令其判定：红桃回1血；方片摸2牌；梅花来源弃2牌；黑桃来源翻面。',
        type: 'trigger'
      },
      {
        id: 'duanchang',
        name: '断肠',
        description: '锁定技，当你死亡时，杀死你的角色失去所有技能。',
        type: 'compulsory'
      }
    ]
  },
  {
    id: 'exp_zuoci',
    name: '左慈',
    title: '迷之仙人',
    faction: 'qun',
    gender: 'male',
    maxHp: 3,
    pack: 'shan',
    skills: [
      {
        id: 'huashen',
        name: '化身',
        description: '游戏开始时随机获得两张武将牌作为“化身”牌，展示一张并获得其上一个非主公/觉醒/限定技能；回合开始/结束可替换。',
        type: 'trigger'
      },
      {
        id: 'xinsheng',
        name: '新生',
        description: '当你受到1点伤害后，你可以获得一张新的“化身”牌。',
        type: 'trigger'
      }
    ]
  }
];

export const EXPANSION_GENERALS: readonly GeneralDefinition[] = [
  ...FENG_GENERALS,
  ...HUO_GENERALS,
  ...LIN_GENERALS,
  ...SHAN_GENERALS
];
