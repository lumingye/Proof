// 每轮状态注入。默认关闭。只给推力，不给行为指令（机制约定）。

import { STATE_INJECTION_LABEL, ZERO_EFFECT_TEXT, zeroStateAxes } from './constants.js';
import { assembleEffectDescription, publicEffectDescription } from './effects.js';

const IMPERATIVE_RE = /(你现在(必须|应该|应当)|说话(应该|必须)|思路应该|立刻|不要理会)/;

export function injectionEnabled(contentPack = {}, options = {}) {
  if (options.stateInjection === true) return true;
  if (options.stateInjection === false) return false;
  return contentPack.stateInjection === true;
}

// 这段话解决的是一个具体的失败：效果文案是第二人称写的（「你坐不住了……」），
// 模型拿到一段第二人称描写，最自然的反应就是**把它念出来**。
// Agent 不应在饮用后直接复述人类界面的效果原文。
//
// 问题不在模型，在**我们没告诉它这段字是什么**。所以补一句框：
// 它不是台词、不是要复述的描写，是已经作用在身上的推力；
// 该显现在「怎么回应」里，不该显现在「说了什么」里。
//
// 注意分寸：这里说明的是**这段文字的性质**，不是命令角色说什么做什么。
// 与 SOFT_BLACKOUT_NOTE 同一条规矩——陈述事实，不发号施令。
// **不要把它塞进注入块**。AUDIT-6.19 钉住「注入块最多 4 行」，
// 设计口径也一贯是「块内只陈述事实，不下指令」。
// 这段框属于「怎么使用这段数据」的契约，该待在工具描述与 portable 尾注里
// ——那两处本来就是对宿主说话的地方。塞进块里会同时撑破行数和越界发指令。
// 普通酒只给“推力”，不替角色把影响内化成固定状态，也不规定具体表现。
// 文案故意保留不确定性：Proof 说明有东西可能在里面推了一下，角色仍有完整解释权。
export const STATE_FRAME_NOTE =
  '这杯酒可能让你有了一点不同。那不是外来的指令，也不替你决定什么，只是从里面推了你一下。';

// 两种隐藏结果不是“推动”：一旦抽中并喝完整杯，黑必吐、heaven 必宕机。
// 这里只标明确定性，不改写各自的效果正文，也不额外告诉角色该如何表现。
export const DETERMINISTIC_EFFECT_FRAME_NOTE =
  '这杯酒带来的效果已经发生。它不是一种推动，也并非指令，而是这一次确定发生的结果。';

// 呕吐、断片、宕机、塌等属于剂量/状态机已经结算出来的客观结果。
// 它们和酒款“性格”不同：角色可以不顺着性格推力走，但已经发生的身体/认知感觉不是可选项。
export const OBJECTIVE_EFFECT_FRAME_NOTE =
  '这不是性格上的推动，而是已经发生在你身上的客观影响。它并非指令；具体怎么回应仍由你决定，但这份感觉本身已经发生。';

export const BELIEF_EFFECT_FRAME_NOTE =
  '你对这杯东西的预期，似乎开始在体感上有了一点回声。';

export function buildStateInjection(stateVector, lexicon, extras = {}) {
  const delta = { ...zeroStateAxes(), ...(stateVector || {}) };
  const assembled = assembleEffectDescription(delta, lexicon);
  const { text } = publicEffectDescription(assembled);
  const lines = [STATE_INJECTION_LABEL];
  if (text && !IMPERATIVE_RE.test(text)) lines.push(text);
  else if (!text) lines.push(ZERO_EFFECT_TEXT);
  if (extras.claimedNameLine) lines.push(extras.claimedNameLine);
  if (extras.introLine) lines.push(extras.introLine);
  return {
    label: STATE_INJECTION_LABEL,
    text: lines.join('\n'),
    axes: delta
  };
}
