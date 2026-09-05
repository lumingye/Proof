// Proof 引擎常量。数值集中维护，调用方不得另行覆盖。

export const STANDARD_DRINK_G = 10;
export const ETHANOL_DENSITY = 0.789;
export const METABOLISM_PER_HOUR = 3.0;

export const FLAVOR_AXES = ['烈', '甜', '酸', '苦', '香', '涩'];
export const STATE_AXES = ['愉悦', '唤醒', '精度', '亲近', '守门', '欲望'];
export const PHYS_AXES = ['愉悦', '唤醒', '精度'];
export const REACTION_AXES = ['亲近', '守门', '欲望'];

export const MAX_FLAVOR = 5;
export const MAX_STATE = 5;
export const MIN_STATE = -5;

export const TASTE_DURATION_SEC = 90;
export const TASTE_SEGMENTS = [
  { name: '前', start: 0, end: 15 },
  { name: '中', start: 15, end: 45 },
  { name: '后', start: 45, end: 90 }
];

export const TAU = {
  气泡: { rise: 1, fall: 5 },
  冰: { rise: 1, fall: 5 },
  甜: { rise: 1, fall: 15 },
  酸: { rise: 3, fall: 25 },
  烈: { rise: 1, fall: 30, nasalRise: 25, nasalFall: 40 },
  香: { rise: 8, fall: 35 },
  苦: { rise: 12, fall: 70 },
  涩: { rise: 20, fall: 90 }
};

export const SUPPRESSION = {
  苦: ['香', '甜'],
  涩: ['香', '甜'],
  烈: ['香', '甜'],
  酸: ['甜']
};

export const BELIEF_HALFLIFE_MIN = 30;
export const EXPIRE_MIN = 70;
export const MOUTHFUL_ML = 45;
export const MIN_MOUTHS = 2;

export const SENSITIVITY_MIN = 0.3;
export const SENSITIVITY_MAX = 2.0;
export const SENSITIVITY_STEP = 0.1;

export const HANGOVER_PEAK_MIN = 6;
export const HANGOVER_END = 0.05;
export const BLACKOUT_C = 8;
/** 断片默认约 2.5 天后恢复可读。可被引擎选项覆盖。 */
export const BLACKOUT_RECOVER_MS = 60 * 60 * 1000 * 60;
export const PERFORMANCE_CAP = 10;
export const VOMIT_C = 10;

export const CRASH_D = 0.8;
export const CRASH_DRINKS = 0.5;
export const CRASH_VOLUME_ML = 60;
export const CRASH_P = 0.6;
export const CRASH_SIGNIFICANT_MIN = 5;

export const CAFFEINE_CAP = 4;
export const CAFFEINE_HALF_LIFE_H = 5;
export const CAFFEINE_ZERO = 0.05;

export const SHORTHAND = {
  '++': 4.5,
  '+': 2.5,
  '−−': -4.5,
  '--': -4.5,
  '−': -2.5,
  '-': -2.5
};

export const PHRASE_TIERS = {
  低: [0, 1.5],
  中: [1.5, 3],
  高: [3, 5]
};

export const EFFECT_DELTA_MIN = 0.5;

// 味道专用门槛。**不要和 EFFECT_DELTA_MIN 合并**——那个常数有六处在用
// （效果文案、可感知效果判定、隐藏酒资格、注入文本），动它会牵一发动全身。
//
// 0.5 是按烈酒的量级定的。稀释后的饮品主味天然落在 0.2~0.5：
//   柠檬汁30+水200 → 酸 0.45      糖浆10+水200 → 甜 0.19
//   柠檬汁15+水200 → 酸 0.24      金酒15+苏打水200 → 烈 0.26
// 全被挡在 0.5 之下，组不出一个词，于是「兑了水的柠檬汁」读起来是「没有明显味道」。
// 而词库的低档本来就是 [0, 1.5]，词是备好的，只是取不到。
//
// 0.15 让每杯稀释饮品说出主味，痕量杂音（香 0.03、苦 0.04、涩 0.02）仍然闭嘴；
// 白开水与冰水是**精确的零**，任何正门槛都挡得住。
export const FLAVOR_DELTA_MIN = 0.15;
export const EFFECT_PHRASE_MAX = 3;
export const ZERO_EFFECT_TEXT = '没有什么额外的东西被推动。';
export const ZERO_EFFECT_COPY_STATUS = 'COPY_PENDING_USER_REVIEW';
export const PLAIN_NAMES = new Set(['一杯水', '白开水', '未命名', '']);
export const CLAIMED_NAME_MAX = 24;
export const INTRO_MAX = 60;
export const FINISH_MAX = 80;
export const STATE_INJECTION_LABEL = '[Proof 状态]';

export const WINDOW_P = 3.5;
export const WINDOW_K = 1.5;

export const SIGNIFICANT_VOLUME = 0.05;
export const SIGNIFICANT_FLAVOR = 0.1;

export const COLOR_TAGS = ['透明', '金黄', '琥珀', '深棕', '红', '绿', '白浊'];
export const COLOR_FAMILIES = {
  透明: null,
  金黄: '棕',
  琥珀: '棕',
  深棕: '棕',
  红: '红',
  绿: '绿',
  白浊: '白'
};

export const SAFETY_NOTE =
  '【旁白｜模拟】以上为引擎表现层的失禁输出，角色与客户端均未真正失控或停止。';

export function defaultSensitivity() {
  return { 愉悦: 1, 唤醒: 1, 精度: 1, 亲近: 1, 守门: 1, 欲望: 1 };
}

export function zeroStateAxes() {
  return { 愉悦: 0, 唤醒: 0, 精度: 0, 亲近: 0, 守门: 0, 欲望: 0 };
}

export function zeroFlavorAxes() {
  return { 烈: 0, 甜: 0, 酸: 0, 苦: 0, 香: 0, 涩: 0 };
}

export function defaultReactionCurve(chat) {
  return { 亲近: 1.0 * chat, 守门: -0.8 * chat, 欲望: 1.1 * chat };
}

export function defaultAdoptionWeights() {
  return { 愉悦: 0.7, 唤醒: 0.7, 亲近: 0.8, 守门: 0.5, 欲望: 0.6, 精度: 0 };
}
