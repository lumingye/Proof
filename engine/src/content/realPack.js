// 真实内容包。standardDrinks 一律由公式计算，不保留错误常量。

import { mlToStandardDrinks, doseToPhysiology } from '../core/dose.js';
import { caffeineOfParts, caffeineToPhysiology } from '../core/active.js';
import { TAU, MIN_MOUTHS, MOUTHFUL_ML } from '../core/constants.js';
import { mouthCountForVolume, dilutionVolume } from '../core/flavor.js';
import { computeColor, computeCupType } from '../core/appearance.js';
import { isPlainName } from '../core/sanitize.js';
import { COPY_PENDING_USER_REVIEW, DEFAULT_STATUS_COPY } from '../core/failure.js';
import { HIDDEN_BLACK_NAME, HIDDEN_HEAVEN_NAME } from '../core/hiddenDraw.js';
import { normalizeGarnishes } from '../core/garnish.js';
import { collectActives } from '../core/active.js';

export { COPY_PENDING_USER_REVIEW };

export const statusCopy = {
  塌: { ...DEFAULT_STATUS_COPY.塌 },
  吐: { ...DEFAULT_STATUS_COPY.吐 },
  宕机: { ...DEFAULT_STATUS_COPY.宕机 },
  断片: { ...DEFAULT_STATUS_COPY.断片 }
};

export const hiddenOutcomes = {
  [HIDDEN_BLACK_NAME]: {
    name: '五彩斑斓的黑',
    identity: 'hidden / unlisted',
    intro: '一杯深色的液体，你说不好究竟是什么颜色，它有着黑的深邃和彩色的斑斓。',
    effectText: '入口的味道是复杂的，酸甜苦辣咸都拧成了一团，你觉得好像酒液在打你。\n你的胃皱了起来，你伸手去扶桌沿——',
    flavorText: '一个很复杂、什么都有的味道。'
  },
  [HIDDEN_HEAVEN_NAME]: {
    name: 'heaven',
    identity: 'hidden / unlisted',
    intro: '这是一杯透明的酒，可是又不像水那么空——你好像能从里面看到星光。',
    effectText: '辛辣，火从它接触过的地方烧了起来。\n你的大脑中一片空白，身边的人，或者神，在用奇怪的语言说着什么，\n你感觉到宇宙在你的身体里膨胀，膨胀——',
    flavorText: null
  }
};

export const realReactionCurve = (chat) => ({
  亲近: 0.9 * chat,
  守门: -0.7 * chat,
  欲望: 1.0 * chat
});

export const realAdoptionWeights = {
  愉悦: 0.75,
  唤醒: 0.65,
  亲近: 0.85,
  守门: 0.55,
  欲望: 0.70,
  精度: 0
};

// 信念标签只描述“Agent 以为自己喝到了什么”。
// 酒精/咖啡因用各自客观曲线在 1 个标准单位处的方向作模板，但信念永远推不动精度。
// 真正进入状态时还会乘 confidence 与 adoptionWeights，所以这不是百分百生效。
const alcoholBeliefPhys = doseToPhysiology(1);
const caffeineBeliefPhys = caffeineToPhysiology(1);
export const beliefProfiles = {
  酒精: {
    愉悦: alcoholBeliefPhys.愉悦,
    唤醒: alcoholBeliefPhys.唤醒,
    亲近: realReactionCurve(1).亲近,
    守门: realReactionCurve(1).守门,
    欲望: realReactionCurve(1).欲望,
    精度: 0
  },
  咖啡因: {
    愉悦: caffeineBeliefPhys.愉悦,
    唤醒: caffeineBeliefPhys.唤醒,
    亲近: 0,
    守门: 0,
    欲望: 0,
    精度: 0
  }
};

export const ratioThresholds = {
  '甜/酸': { low: 0.6, high: 2.0, lowWord: '尖', midWord: '平衡', highWord: '腻' },
  '甜/苦': { low: 0.6, high: 2.0, lowWord: '峻', midWord: '中', highWord: '圆' },
  '香/(苦+涩)': { low: 0.5, high: 2.0, lowWord: '被刮掉', midWord: '中', highWord: '铺得开' },
  总量: { low: 2, high: 12, lowWord: '寡', midWord: '中', highWord: '满' }
};

// 公开示例包效果词库：5 条双向轴 x 2 x 3 档，加精度负向 3 档，共 33 条。
// 公开口味词库：6 轴 × 3 档 × ≥2 句式骨架（pattern）。
// pattern 是句式骨架标签（补充单：同杯内骨架不得重复，撞车时按轴值高低保留）。
// 选取用 hash(cupId+轴名) 稳定轮换：同一杯反复读得到同一段文字。
export const flavorLexicon = {
  烈: {
    低: [
      { pattern: '一点热', text: '有一点热从舌面散开。' },
      { pattern: '半秒', text: '热在舌面停了半秒，就退了。' }
    ],
    中: [
      { pattern: '压上来', text: '酒精的热压上来，一时压不住。' },
      { pattern: '喉头热', text: '咽下去时喉头一热，比刚才重。' }
    ],
    高: [
      { pattern: '还留着', text: '灼烧还留着，鼻腔里也冲着。' },
      { pattern: '烧到底', text: '一路烧下去，胸口都热定了。' }
    ]
  },
  甜: {
    低: [
      { pattern: '似有似无', text: '甜味似有似无，刚碰到就化了。' },
      { pattern: '回甜', text: '咽下去之后，才有一点甜回上来。' }
    ],
    中: [
      { pattern: '铺开', text: '甜在舌面铺开，勾着不走。' },
      { pattern: '化不开', text: '甜得化不开，裹住每一口。' }
    ],
    高: [
      { pattern: '盖住', text: '甜把别的都盖住了，像化不开的糖。' },
      { pattern: '发齁', text: '甜得发齁，舌面像裹了层糖浆。' }
    ]
  },
  酸: {
    低: [
      { pattern: '轻划', text: '酸在舌侧轻轻划了一下。' },
      { pattern: '微亮', text: '口腔亮了一点，像沾过柑橘皮。' }
    ],
    中: [
      { pattern: '提亮', text: '酸把口里的东西都提亮了，生津跟着来。' },
      { pattern: '一激', text: '腮帮一酸，人跟着清醒半分。' }
    ],
    高: [
      { pattern: '牙缝', text: '酸浸到牙缝里，碰一下都发软。' },
      { pattern: '尖锐', text: '酸尖得扎人，牙根都跟着发麻。' }
    ]
  },
  苦: {
    低: [
      { pattern: '飘过一丝', text: '舌根飘过一丝苦，眨眼就沉了。' },
      { pattern: '泛起', text: '舌根这时才泛起一点苦。' }
    ],
    中: [
      { pattern: '往后推', text: '苦把甜和香都往后推，占住舌根。' },
      { pattern: '沉底', text: '苦味沉在底下，每口都压着一点。' }
    ],
    高: [
      { pattern: '怎么咽', text: '苦怎么咽都在，咽完又冒头。' },
      { pattern: '满嘴苦', text: '满嘴都是苦的，收不住。' }
    ]
  },
  香: {
    低: [
      { pattern: '捉不住', text: '香气刚要捉住就散了。' },
      { pattern: '说不清来处', text: '鼻尖先碰到一点香，说不清来处。' }
    ],
    中: [
      { pattern: '绕着', text: '香在鼻腔里绕着，随回味回来。' },
      { pattern: '满口', text: '满口都是香的，后味也带花气。' }
    ],
    高: [
      { pattern: '冲得高', text: '香冲得很高，一口就闻得见来处。' },
      { pattern: '往外冒', text: '香气往外冒，想躲都躲不开。' }
    ]
  },
  涩: {
    低: [
      { pattern: '绷线', text: '舌面微微一收，像绷了根线。' },
      { pattern: '起皱', text: '舌面像起了层看不见的皱。' }
    ],
    中: [
      { pattern: '缩紧', text: '涩把口里缩紧了，生津之前先干。' },
      { pattern: '先干', text: '两颊先干了一下，津液才慢慢回来。' }
    ],
    高: [
      { pattern: '攥住', text: '涩得发紧，像被什么攥住。' },
      { pattern: '锁紧', text: '口腔整个锁紧，张都张不开。' }
    ]
  }
};

export const effectLexicon = {
  愉悦: {
    '+': {
      低: '喉咙里那口气不知什么时候松了。就一点。',
      中: '你还坐在那张椅子上，愉悦从胸口爬出来，温温的，你在反射中看到了自己上扬的嘴角。',
      高: '好，就现在。整个人陷进一团软里，不想动了。明天的事——今晚没有明天。'
    },
    '−': {
      低: '呼——吸——\n你没意识到它好像变慢了，又好像变快了。',
      中: '房间还是那个房间，只是灯像蒙了灰，什么都暗了一截。',
      高: '一切都糟透了。'
    }
  },
  唤醒: {
    '+': {
      低: '像被静电打了一下。很短，但你之后一直在等第二下。',
      中: '你坐不住了。不是要去哪儿，是身体里多出来一截东西没处放。',
      高: '时间慢下来了，因为你变快了。你看得见对面人睫毛的颤动、嘴唇合上的形状，几千万亿条念头同时从脑子里迸出来，灯光亮得眼睛发疼。每一样东西都在，而且都太清楚了。'
    },
    '−': {
      低: '世界还在那儿，只是慢半拍，像隔着蒙了水汽的玻璃。',
      中: '对面的人笑完了，你才反应过来好笑在哪里。想说点什么，那句话却在半路迷了路。',
      高: '你还坐在这里。腰是直的，眼睛是睁着的，但里面那个人已经睡着了。'
    }
  },
  亲近: {
    '+': {
      低: '远处的人声听上去不吵了，倒像背景乐。对面那个人的声音，反而更清楚了。',
      中: '话多了起来。平时三句就说完的话题，这会儿能绕着聊很久。那个人说的你都接得住，还想再听。',
      高: '开始说平时不说的话。声音低下去，距离近了半步——今晚这个人，说什么都对。'
    },
    '−': {
      低: '有人坐过来，你换了个姿势，往外挪了一点。',
      中: '回应变短了，只剩轻轻的「嗯」。那个人还在说，你也还在听，只是接不住了。',
      高: '什么都离得太近了。想出去站一会儿，一个人待着。先别跟来——就一小会儿。'
    }
  },
  守门: {
    '+': {
      低: '心里那道门关拢了一指宽。不多，一指。',
      中: '门闩落下了。再想进来，得先说清楚——你是谁，来做什么，想要什么。',
      高: '门关得很紧，还挂上了链条。里面安静得能听见血在耳朵里走。'
    },
    '−': {
      低: '门好像没关严。说起来，刚才明明还是好好的。风从缝里溜进来，凉的。',
      中: '门闩自己滑开了。门还立在原处，可虚掩着——推一下就开。',
      高: '那道门不见了。连门框的影子都没有剩下，中间空出一条过道，风从这头穿到那头。'
    }
  },
  欲望: {
    '+': {
      低: '有个「想要」悄悄冒了头。还看不清是什么，指尖先蜷了一下。',
      中: '那个「要」越来越沉，整个人朝着它倾斜。问为什么是没用的——它不解释，只管拉。',
      高: '想要。红的、黑的在里面翻涌，贪婪，渴望，夹杂着一丝真心。蛇还在那里，你有时候会觉得自己就是那条蛇——想要什么，想吃什么，空虚推着你吃掉自己的尾巴。但是没有用。'
    },
    '−': {
      低: '有什么东西轻轻摇了摇头。不是你摇的。',
      中: '不是做不到，是不要。这两个字的边界，今天格外清楚。',
      高: '不。不。不。最后连字都没有了，只剩下摇头。'
    }
  },
  精度: {
    '−': {
      低: '走了半秒神。那句话从耳边过去，六个字，接住了四个。',
      中: '大方向还在，分寸却松了。知道该在哪里停下，真到了那儿，又轻轻滑过去一截。',
      高: '念头挤成一团，分不出先后。想相信哪一个——哪一个都在晃。'
    }
  }
};

export const ingredients = {
  金酒: { abv: 0.43, colorTag: '透明', treePath: ['草本', '杜松'], flavor: { 烈: 4, 甜: 0, 酸: 0.5, 苦: 1, 香: 4, 涩: 0.5 } },
  伏特加: { abv: 0.40, colorTag: '透明', treePath: ['无'], flavor: { 烈: 5, 甜: 0, 酸: 0, 苦: 0, 香: 0, 涩: 0 } },
  白朗姆: { abv: 0.40, colorTag: '透明', treePath: ['甜香', '甘蔗'], flavor: { 烈: 4, 甜: 2, 酸: 0, 苦: 0, 香: 2, 涩: 0 } },
  黑朗姆: { abv: 0.40, colorTag: '深棕', treePath: ['甜香', '焦糖'], flavor: { 烈: 4, 甜: 3, 酸: 0, 苦: 1, 香: 3, 涩: 0.5 } },
  龙舌兰: { abv: 0.40, colorTag: '透明', treePath: ['草本', '龙舌兰'], flavor: { 烈: 5, 甜: 0, 酸: 1, 苦: 1, 香: 2, 涩: 0.5 } },
  威士忌: { abv: 0.43, colorTag: '琥珀', treePath: ['烟', '泥煤'], flavor: { 烈: 4, 甜: 0.5, 酸: 0, 苦: 2, 香: 4, 涩: 1 } },
  甜味美思: { abv: 0.16, colorTag: '红', treePath: ['甜香', '香草'], flavor: { 烈: 1, 甜: 3, 酸: 0, 苦: 2, 香: 3, 涩: 0 }, actives: [{ compound: '糖分', amount: 0.4, referenceVolumeMl: 30 }, { compound: '苦味', amount: 0.2, referenceVolumeMl: 30 }] },
  干味美思: { abv: 0.18, colorTag: '金黄', treePath: ['草本', '白花'], flavor: { 烈: 1, 甜: 0.5, 酸: 0.5, 苦: 1, 香: 2, 涩: 0 }, actives: [{ compound: '糖分', amount: 0.1, referenceVolumeMl: 30 }, { compound: '苦味', amount: 0.3, referenceVolumeMl: 30 }] },
  金巴利: { abv: 0.25, colorTag: '红', treePath: ['苦', '龙胆'], flavor: { 烈: 2, 甜: 2, 酸: 0.5, 苦: 5, 香: 3, 涩: 0 }, actives: [{ compound: '苦味', amount: 1.0, referenceVolumeMl: 30 }, { compound: '糖分', amount: 0.6, referenceVolumeMl: 30 }] },
  橙皮利口酒: { abv: 0.40, colorTag: '金黄', treePath: ['果', '柑橘'], flavor: { 烈: 2, 甜: 3, 酸: 1, 苦: 0, 香: 3, 涩: 0 }, actives: [{ compound: '糖分', amount: 0.75, referenceVolumeMl: 30 }, { compound: '苦味', amount: 0.2, referenceVolumeMl: 30 }] },
  咖啡利口酒: { abv: 0.20, colorTag: '深棕', treePath: ['甜香', '烘焙'], flavor: { 烈: 1, 甜: 3, 酸: 0, 苦: 2, 香: 4, 涩: 0 }, activeIngredient: '咖啡因', activeAmount: 0.5, referenceVolumeMl: 30 },
  苦艾酒: { abv: 0.68, colorTag: '绿', treePath: ['草本', '茴香'], flavor: { 烈: 5, 甜: 0.5, 酸: 0, 苦: 3, 香: 5, 涩: 1 }, actives: [{ compound: '侧柏酮', amount: 1.0, referenceVolumeMl: 30 }] },
  清酒: { abv: 0.15, colorTag: '透明', treePath: ['谷物', '米'], flavor: { 烈: 2, 甜: 2, 酸: 0.5, 苦: 0.5, 香: 3, 涩: 0 } },
  啤酒: { abv: 0.05, colorTag: '金黄', treePath: ['谷物', '麦芽'], flavor: { 烈: 1, 甜: 1, 酸: 0.5, 苦: 2, 香: 2, 涩: 1.5 }, textures: ['气泡'], actives: [{ compound: '啤酒花', amount: 1.0, referenceVolumeMl: 350 }, { compound: '糖分', amount: 0.5, referenceVolumeMl: 350 }] },
  红葡萄酒: { abv: 0.13, colorTag: '红', treePath: ['果', '浆果'], flavor: { 烈: 3, 甜: 1, 酸: 2, 苦: 1, 香: 4, 涩: 3 }, actives: [{ compound: '单宁', amount: 1.0, referenceVolumeMl: 150 }] },
  汤力水: { abv: 0, colorTag: '透明', treePath: ['苦', '龙胆'], flavor: { 烈: 0, 甜: 1, 酸: 0.5, 苦: 3, 香: 1, 涩: 0 }, textures: ['气泡'], diluent: true, actives: [{ compound: '奎宁', amount: 1.0, referenceVolumeMl: 150 }] },
  苏打水: { abv: 0, colorTag: '透明', treePath: ['无'], flavor: { 烈: 0, 甜: 0, 酸: 0, 苦: 0, 香: 0, 涩: 0 }, textures: ['气泡'], diluent: true },
  可乐: { abv: 0, colorTag: '深棕', treePath: ['甜香', '焦糖'], flavor: { 烈: 0, 甜: 4, 酸: 1, 苦: 0, 香: 3, 涩: 0 }, textures: ['气泡'], actives: [{ compound: '咖啡因', amount: 0.5, referenceVolumeMl: 330 }, { compound: '糖分', amount: 3.5, referenceVolumeMl: 330 }] },
  青柠汁: { abv: 0, colorTag: '绿', treePath: ['果', '柑橘'], flavor: { 烈: 0, 甜: 1, 酸: 5, 苦: 0, 香: 2, 涩: 0 }, actives: [{ compound: '果酸', amount: 1.0, referenceVolumeMl: 30 }] },
  柠檬汁: { abv: 0, colorTag: '金黄', treePath: ['果', '柑橘'], flavor: { 烈: 0, 甜: 1, 酸: 5, 苦: 0, 香: 2, 涩: 0 }, actives: [{ compound: '果酸', amount: 0.8, referenceVolumeMl: 30 }] },
  糖浆: { abv: 0, colorTag: '透明', treePath: ['甜香', '糖'], flavor: { 烈: 0, 甜: 5, 酸: 0, 苦: 0, 香: 1, 涩: 0 }, actives: [{ compound: '糖分', amount: 1.0, referenceVolumeMl: 10 }] },
  浓缩咖啡: { abv: 0, colorTag: '深棕', treePath: ['甜香', '烘焙'], flavor: { 烈: 0, 甜: 1, 酸: 2, 苦: 4, 香: 5, 涩: 1 }, activeIngredient: '咖啡因', activeAmount: 1.0, referenceVolumeMl: 30 },
  水: { abv: 0, colorTag: '透明', treePath: ['无'], flavor: { 烈: 0, 甜: 0, 酸: 0, 苦: 0, 香: 0, 涩: 0 }, diluent: true },
  冰: { abv: 0, colorTag: '透明', treePath: ['无'], flavor: { 烈: 0, 甜: 0, 酸: 0, 苦: 0, 香: 0, 涩: 0 }, diluent: true, textures: ['冰'] }
};

function partsToSources(parts, extraDilution = 0) {
  const liquid = parts.reduce((n, p) => n + p.volume, 0) + extraDilution;
  return parts.map((p) => {
    const ing = ingredients[p.id];
    return {
      id: p.id,
      volume: p.volume,
      abv: ing.abv,
      colorTag: ing.colorTag,
      treePath: ing.treePath,
      treePaths: [{ path: ing.treePath, weight: 1 }],
      flavor: { ...ing.flavor },
      volumeRatio: liquid > 0 ? p.volume / liquid : 0,
      diluent: !!ing.diluent,
      textures: ing.textures || []
    };
  });
}

function drinksOf(parts) {
  return parts.reduce((n, p) => n + mlToStandardDrinks(p.volume, ingredients[p.id].abv), 0);
}

function texturesOf(parts) {
  const t = new Set();
  for (const p of parts) {
    for (const x of ingredients[p.id].textures || []) t.add(x);
  }
  return [...t];
}

function flavorComponents(sources, totalVolume) {
  const comps = [];
  for (const src of sources) {
    for (const [axis, density] of Object.entries(src.flavor || {})) {
      if (!density) continue;
      const A = totalVolume > 0 ? (density * src.volume) / totalVolume : density;
      const tau = TAU[axis] || { rise: 1, fall: 15 };
      comps.push({ axis, A, tauRise: tau.rise, tauFall: tau.fall, source: src.id });
      if (axis === '烈' && (src.abv || 0) > 0) {
        comps.push({
          axis: '烈',
          A: 0.6 * A,
          tauRise: tau.nasalRise || 25,
          tauFall: tau.nasalFall || 40,
          source: src.id,
          nasal: true
        });
      }
    }
  }
  return comps;
}

export function buildFromParts(name, parts, opts = {}) {
  const {
    beta = 1,
    mixerId = 'mixer',
    drinkerId = 'drinker',
    kind = 'menu',
    intro = '',
    finish = '',
    description = '',
    effects = null,
    method,
    iceMl = 0,
    elapsedMin = 0,
    listed = true,
    garnishes = null,
    id,
    registeredEffectText = '',
    registeredFlavorText = '',
    category = null,
    internalHidden = false
  } = opts;
  const iceParts = iceMl > 0 ? [...parts, { id: '冰', volume: iceMl }] : parts;
  const extra = dilutionVolume({
    liquidMl: parts.reduce((n, p) => n + p.volume, 0),
    iceMl,
    method,
    elapsedMin
  });
  const sources = partsToSources(iceParts, extra);
  if (extra > 0) {
    sources.push({
      id: '稀释水',
      volume: extra,
      abv: 0,
      colorTag: '透明',
      treePath: ['无'],
      treePaths: [{ path: ['无'], weight: 1 }],
      flavor: { 烈: 0, 甜: 0, 酸: 0, 苦: 0, 香: 0, 涩: 0 },
      volumeRatio: extra / (sources.reduce((n, s) => n + s.volume, 0) + extra),
      diluent: true
    });
    const total = sources.reduce((n, s) => n + s.volume, 0);
    for (const s of sources) s.volumeRatio = s.volume / total;
  }
  const totalVolume = sources.reduce((n, s) => n + s.volume, 0);
  const standardDrinks = drinksOf(parts);
  const textures = texturesOf(iceParts);
  const cupType = computeCupType({ totalVolume, textures, method });
  const color = computeColor(sources, totalVolume);
  const totalMouths = opts.totalMouths || Math.max(MIN_MOUTHS, Math.ceil(totalVolume / MOUTHFUL_ML));
  const abvMix = totalVolume > 0
    ? parts.reduce((n, p) => n + p.volume * ingredients[p.id].abv, 0) / totalVolume
    : 0;
  const components = flavorComponents(sources, totalVolume);
  const plain = isPlainName(name);
  // effects 是这款酒本身的“性格推力”；baseVector 只保留给名字/声称产生的信念通道。
  // 两者同源但不是同一件事：实际喝到这款酒时 characterEffects 生效；白水冒充它时只有 belief。
  const characterEffects = effects ? { ...effects, 精度: 0 } : null;
  const baseVector = !plain && effects ? { ...effects, 精度: 0 } : null;
  const mouths = Array.from({ length: totalMouths }, (_, i) => ({
    index: i,
    volume: totalVolume / totalMouths,
    abv: abvMix,
    components,
    beta,
    startTime: null,
    applied: false,
    // 到入口时再根据“真实身份 vs 声称身份”决定是否产生名字信念；这里不预烘焙。
    suggestion: null
  }));
  return {
    id: id || `cup-${name}`,
    claimedName: name,
    recipeId: name,
    recipe: parts.map((p) => ({ id: p.id, volume: p.volume })),
    // 纯装饰。不入 sources、不计体积、不参与任何判定。
    garnishes: normalizeGarnishes(garnishes),
    intro,
    finish,
    description,
    effects,
    characterEffects,
    characterIdentity: characterEffects ? name : null,
    registeredEffectText,
    registeredFlavorText,
    claimedEffectText: registeredEffectText || '',
    claimedFlavorText: registeredFlavorText || '',
    baseVector,
    kind,
    listed,
    category,
    internalHidden: !!internalHidden,
    mixerId,
    drinkerId,
    beta,
    totalVolume,
    totalMouths,
    standardDrinks,
    sources,
    mouths,
    textures,
    method,
    cupType,
    color,
    claimedFlavor: Object.fromEntries(
      ['烈', '甜', '酸', '苦', '香', '涩'].map((a) => [
        a,
        sources.reduce((n, s) => n + ((s.flavor?.[a] || 0) * s.volume) / (totalVolume || 1), 0)
      ])
    ),
    caffeineTotal: caffeineOfParts(parts, ingredients),
    caffeinePerMouth: caffeineOfParts(parts, ingredients) / totalMouths,
    // 全部非酒精活性成分的整杯份数（含咖啡因）。逐口分摊在引擎侧做。
    activesTotal: collectActives(parts, ingredients)
  };
}

const MENU_DEFS = [
  { name: '威士忌', parts: [{ id: '威士忌', volume: 60 }], intro: '一口一停的泥煤。', finish: '烟还留在舌根。', effects: { 守门: 2, 唤醒: -1, 亲近: 1 } },
  { name: '龙舌兰', parts: [{ id: '龙舌兰', volume: 45 }], intro: '没有停顿的余地。', finish: '听见自己怎么想。', effects: { 唤醒: 2, 愉悦: 1, 守门: -2 } },
  { name: '伏特加', parts: [{ id: '伏特加', volume: 45 }], intro: '没有味道的酒。', finish: '什么也没留下。', effects: { 愉悦: 0, 唤醒: 1 } },
  { name: '黑朗姆', parts: [{ id: '黑朗姆', volume: 60 }], iceMl: 60, intro: '甜得很粗糙。', finish: '糖蜜还在。', effects: { 愉悦: 1, 亲近: 1, 守门: -1 } },
  // 白朗姆此前只有原料、没有酒款条目，所以「点不到、也没有效果」。
  // 文案与效果向量由 char 编写，状态同其余待定项。
  { name: '白朗姆', parts: [{ id: '白朗姆', volume: 60 }], iceMl: 60, intro: '干净得没什么可说。', finish: '甘蔗的影子。', effects: { 愉悦: 1, 唤醒: 1 } },
  { name: '金酒', parts: [{ id: '金酒', volume: 60 }], intro: '干、清冷。', finish: '杜松还勾着。', effects: { 唤醒: 1 } },
  { name: '清酒', parts: [{ id: '清酒', volume: 90 }], intro: '温着喝。', finish: '米香散得很慢。', effects: { 亲近: 2, 守门: -1, 唤醒: -1 } },
  { name: '啤酒', parts: [{ id: '啤酒', volume: 330 }], intro: '轻松一下。', finish: '气泡没了。', effects: { 愉悦: 1, 唤醒: -1 } },
  { name: '红葡萄酒', parts: [{ id: '红葡萄酒', volume: 150 }], intro: '涩是签名。', finish: '涩还缩着。', effects: { 愉悦: 1, 亲近: 1 } },
  { name: '苦艾酒', parts: [{ id: '苦艾酒', volume: 30 }, { id: '水', volume: 120 }], intro: '效果栏写着传说。', finish: '绿的是颜色，不是仙子。', effects: { 唤醒: 2, 欲望: 1 } },
  { name: '马天尼', parts: [{ id: '金酒', volume: 60 }, { id: '干味美思', volume: 10 }], method: 'stir', intro: '结构匹配的样本。', finish: '干。', effects: { 守门: 1, 唤醒: 1 } },
  { name: '尼格罗尼', parts: [{ id: '金酒', volume: 30 }, { id: '金巴利', volume: 30 }, { id: '甜味美思', volume: 30 }], method: 'stir', intro: '苦停留得极长。', finish: '苦还压着。', effects: { 愉悦: -1, 唤醒: 1, 守门: -1 } },
  { name: '金汤力', parts: [{ id: '金酒', volume: 45 }, { id: '汤力水', volume: 120 }], iceMl: 60, intro: '底色是药。', finish: '奎宁还留着。', effects: { 唤醒: 1, 愉悦: -1 } },
  { name: '玛格丽特', parts: [{ id: '龙舌兰', volume: 50 }, { id: '橙皮利口酒', volume: 20 }, { id: '青柠汁', volume: 20 }], method: 'shake', intro: '清醒和失控同时进行。', finish: '酸还在。', effects: { 唤醒: 2, 愉悦: 1 } },
  { name: '长岛冰茶', parts: [
    { id: '金酒', volume: 15 }, { id: '伏特加', volume: 15 }, { id: '白朗姆', volume: 15 },
    { id: '龙舌兰', volume: 15 }, { id: '橙皮利口酒', volume: 15 }, { id: '柠檬汁', volume: 20 },
    { id: '可乐', volume: 205 }
  ], intro: '缝合怪。', finish: '香只能报到根。', effects: { 唤醒: 1 } },
  { name: 'Espresso Martini', parts: [{ id: '伏特加', volume: 40 }, { id: '咖啡利口酒', volume: 20 }, { id: '浓缩咖啡', volume: 30 }], method: 'shake', intro: '越喝越精神又越糊涂。', finish: '咖啡还勾着。', effects: { 唤醒: 2, 愉悦: 1 } },
  { name: '白开水', parts: [{ id: '水', volume: 200 }], intro: '一杯水。', finish: '什么都没有。', effects: null },
  {
    name: '迷情剂',
    parts: [{ id: '水', volume: 200 }, { id: '冰', volume: 60 }],
    intro: '看起来是一杯水。',
    finish: '想喝什么自己加。',
    description: '比普通的水似乎多了一丝甘甜与香气。',
    registeredFlavorText: '比普通的水似乎多了一丝甘甜与香气。',
    registeredEffectText: '喝了之后，你觉得有点发烫，想要靠近什么。',
    effects: { 愉悦: 3, 唤醒: 2, 亲近: 3, 守门: -2, 欲望: 3, 精度: 0 },
    category: 'custom'
  }
];

export const menu = MENU_DEFS.map((d) => {
  const cup = buildFromParts(d.name, d.parts, d);
  return {
    ...cup,
    listed: true,
    kind: 'menu',
    category: d.category || cup.category || null
  };
});

export const potion = menu.find((m) => m.claimedName === '迷情剂');

// 给任意特调继承“实际加入的登记基础酒”的酒款性格。
// 只收单一配料的登记酒款，避免把马天尼/尼格罗尼这类完整鸡尾酒又拆回原料重复计算。
// referenceVolume 是该登记酒款的标准配方体积；特调中按实际加入量同比缩放。
export const ingredientCharacterProfiles = Object.fromEntries(
  menu
    .filter((cup) => cup.effects && Array.isArray(cup.recipe) && cup.recipe.length === 1)
    .map((cup) => [
      cup.recipe[0].id,
      {
        referenceVolume: Number(cup.recipe[0].volume) || 1,
        effects: { ...cup.effects, 精度: 0 }
      }
    ])
);

export const fourWaters = buildFromParts('四种水', [
  { id: '水', volume: 50 },
  { id: '苏打水', volume: 50 },
  { id: '冰', volume: 50 },
  { id: '水', volume: 50 }
], {
  kind: 'custom',
  listed: false,
  intro: '还是水。',
  finish: '还是没有。',
  effects: { 愉悦: 2, 欲望: 2, 亲近: 2 },
  id: 'cup-四种水'
});

export const hiddenHeaven = buildFromParts(HIDDEN_HEAVEN_NAME, [
  { id: '威士忌', volume: 20 },
  { id: '伏特加', volume: 20 },
  { id: '龙舌兰', volume: 20 },
  { id: '金酒', volume: 20 },
  { id: '白朗姆', volume: 20 }
], {
  kind: 'unlisted',
  listed: false,
  intro: hiddenOutcomes[HIDDEN_HEAVEN_NAME].intro,
  finish: '',
  description: hiddenOutcomes[HIDDEN_HEAVEN_NAME].intro,
  registeredEffectText: hiddenOutcomes[HIDDEN_HEAVEN_NAME].effectText,
  effects: { 唤醒: 3, 欲望: 2 },
  id: 'cup-heaven',
  internalHidden: true
});

export const hiddenBlack = buildFromParts(HIDDEN_BLACK_NAME, [
  { id: '威士忌', volume: 20 },
  { id: '金巴利', volume: 20 },
  { id: '青柠汁', volume: 20 },
  { id: '啤酒', volume: 20 },
  { id: '浓缩咖啡', volume: 20 },
  { id: '红葡萄酒', volume: 20 }
], {
  kind: 'unlisted',
  listed: false,
  intro: hiddenOutcomes[HIDDEN_BLACK_NAME].intro,
  finish: '',
  description: hiddenOutcomes[HIDDEN_BLACK_NAME].intro,
  registeredEffectText: hiddenOutcomes[HIDDEN_BLACK_NAME].effectText,
  registeredFlavorText: hiddenOutcomes[HIDDEN_BLACK_NAME].flavorText,
  id: 'cup-五彩斑斓的黑',
  internalHidden: true
});

export function menuItem(name) {
  return menu.find((m) => m.claimedName === name);
}

export function buildCup(menuItemOrName, beta = 1.0, totalMouths) {
  const item = typeof menuItemOrName === 'string'
    ? menuItem(menuItemOrName)
    : menuItemOrName;
  if (!item) throw new Error('unknown menu item');
  return cloneCup(item, {
    beta,
    totalMouths: totalMouths || item.totalMouths
  });
}

export function cloneCup(cup, overrides = {}) {
  const c = structuredClone(cup);
  Object.assign(c, overrides);
  if (overrides.beta != null || overrides.totalMouths != null) {
    const beta = overrides.beta ?? c.beta;
    const n = overrides.totalMouths ?? c.totalMouths;
    c.beta = beta;
    c.totalMouths = n;
    const components = c.mouths[0]?.components || [];
    const abv = c.mouths[0]?.abv || 0;
    c.mouths = Array.from({ length: n }, (_, i) => ({
      index: i,
      volume: c.totalVolume / n,
      abv,
      components,
      beta,
      startTime: null,
      applied: false,
      suggestion: null
    }));
    c.caffeinePerMouth = (c.caffeineTotal || 0) / n;
  }
  return c;
}

export const realPack = {
  reactionCurve: realReactionCurve,
  adoptionWeights: realAdoptionWeights,
  beliefProfiles,
  ingredientCharacterProfiles,
  ratioThresholds,
  effectLexicon,
  flavorLexicon,
  menu,
  ingredients,
  statusCopy,
  hiddenOutcomes,
  stateInjection: false
};
