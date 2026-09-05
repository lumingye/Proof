// 唯一权威的每轮状态投影。
//
// MCP、hook、CLI、HTTP `/agent/turn-context` 都必须经由这里，
// **四个入口不得各自维护状态副本、不得各自累计。**

import {
  dayKey,
  blackoutVisibility,
  activeDrinkEvents,
  transientDeadline,
  resolveLifecycleConfig,
  blackoutDigest
} from '../core/lifecycle.js';
import { STATE_INJECTION_LABEL, EFFECT_DELTA_MIN } from '../core/constants.js';
import { STATE_FRAME_NOTE, OBJECTIVE_EFFECT_FRAME_NOTE, BELIEF_EFFECT_FRAME_NOTE } from '../core/injection.js';
import { activeSubjectiveBeliefs } from '../core/belief.js';
import { buildAgentStateHints } from './agentStateHints.js';
import { projectAgentObjectiveStates } from './agentObjectiveStates.js';

// Agent 内部只拿可执行的简短状态语义，不吃人类结果页那套文学文案。
// 文学文案仍保留在 actualEffectDescription / 公开结果层；这里不重复它。
function blackoutSection(blackout) {
  if (!blackout?.active) return '';
  return '仍处在一段尚未恢复的断片期；这段精确记录暂时不可读，恢复时间到了会自动归还。';
}

const AXES = ['愉悦', '唤醒', '精度', '亲近', '守门', '欲望'];

function sensitivitySummary(sensitivity) {
  const out = {};
  for (const axis of AXES) {
    const value = Number(sensitivity?.[axis]);
    if (!Number.isFinite(value) || value === 1) continue;
    out[axis] = value > 1 ? '偏敏感' : '偏迟钝';
  }
  return out;
}

export function buildAgentTurnContext(engine, agentId, now, config = null) {
  if (!agentId) throw new Error('agent_id_required');
  // 先判空再取配置：没有引擎时不得先去读 engine.lifecycle。
  const cfg = config || engine?.lifecycle || resolveLifecycleConfig({});
  const base = {
    agentId,
    active: false,
    shouldFetch: false,
    revision: 0,
    generatedAt: now,
    day: dayKey(now, cfg.timezone),
    stateHints: [],
    objectiveStates: [],
    blackout: { active: false, soft: true },
    sensitivitySummary: {},
    expiresAt: null,
    // 「有没有状态」与「宿主会不会自动把它送进模型」是两件事。
    // hasState / active / context 描述前者，由 Proof 决定；
    // autoDeliver / injected / block 描述后者，由连接方式决定。
    hasState: false,
    context: null,
    framing: { push: null, belief: null, objective: null },
    autoDeliver: false,
    // 兼容既有 MCP / hook 契约
    injected: false,
    block: null
  };
  if (!engine) return base;

  engine.settle(now);
  base.revision = engine.state.revision || 0;
  base.blackout = blackoutVisibility(engine.state, now);
  if (base.blackout.active) base.blackout.digest = blackoutDigest(engine.state, now);
  base.sensitivitySummary = sensitivitySummary(engine.state.sensitivity);

  // **不再因为自动投递关着就早退。**
  // 旧写法在 stateInjectionEnabled=false 时直接返回空 base，
  // 调用方读到 injected:false / block:null，会误以为「这个 Agent 没有状态」。
  // 现在开关只决定 autoDeliver，不决定状态存不存在。
  base.autoDeliver = typeof engine.isInjectionEnabled === 'function'
    ? engine.isInjectionEnabled()
    : false;

  const evaluated = engine.evaluate(now);
  base.objectiveStates = projectAgentObjectiveStates(evaluated?.presentation?.states || []);
  // Agent 不再接收“守门- / 精度- / tier”或文学效果正文。
  // 六轴只在引擎内部计算；出 Agent 边界时翻成简短的状态语义，具体怎么表现由 Agent 自己决定。
  const stateHints = buildAgentStateHints(evaluated?.state, { maxHints: 4 });
  // 默认只看当天：跨过日界线之后，昨天那杯不再计入「今天喝了什么」。
  const events = activeDrinkEvents(engine.state, now, cfg);
  const hasEffect = stateHints.length > 0;
  // 「有没有状态」看的是体内还有没有东西在跑，不是文案够不够门槛。
  // 一杯威士忌可能所有轴都不到 EFFECT_DELTA_MIN，但人确实喝了。
  const st = engine.state;
  const hasLoad = Number(st.c || 0) > 0
    || (st.hangoverSnapshots || []).length > 0
    || Object.values(st.actives || {}).some((a) => Number(a?.amount || 0) > 0);

  const subjectiveBeliefs = activeSubjectiveBeliefs(st.directBeliefResiduals || [], now)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3);
  const hasSubjectiveBelief = subjectiveBeliefs.length > 0;
  const activeBeliefVector = Object.entries(evaluated?.beliefStrength || {})
    .some(([axis, value]) => axis !== '精度' && Math.abs(Number(value) || 0) >= 0.2);
  const hasActiveBelief = activeBeliefVector || hasSubjectiveBelief;

  // 注入的边界：**喝过东西就一直给到账本过期；reset 清空账本，注入随之停止。**
  // 既保住「喝完两小时、酒已代谢完仍在注入」的既有契约，
  // 又满足「reset 之后不再返回空注入」。
  const hasLedger = events.length > 0;
  const anything = hasEffect || hasLoad || hasActiveBelief || base.blackout.active === true || hasLedger;
  const sections = [];
  // 状态层只给简洁语义，不给轴名、方向符号、数值、文学原文，也不规定具体说话动作。
  if (stateHints.length) {
    sections.push([STATE_INJECTION_LABEL, ...stateHints].join('\n'));
    // 精度只来自客观通道；如果它正在下降，同时标出 objective framing。
    const precision = Number(evaluated?.state?.精度 || 0);
    if (precision <= -EFFECT_DELTA_MIN) base.framing.objective = OBJECTIVE_EFFECT_FRAME_NOTE;
    if (stateHints.length > (precision <= -EFFECT_DELTA_MIN ? 1 : 0)) base.framing.push = STATE_FRAME_NOTE;
  }

  // 信念不伪装成客观状态，也不复述用户原句。宿主只收到 Agent 在饮用前
  // 提交并经过清洗的短主观描述。向量与主观描述都衰减到无意义后，这一段自动沉默。
  if (hasActiveBelief) {
    const beliefLines = ['[Proof 信念体感]', BELIEF_EFFECT_FRAME_NOTE, ...subjectiveBeliefs.map((item) => item.text)];
    sections.push(beliefLines.join('\n'));
    base.framing.belief = BELIEF_EFFECT_FRAME_NOTE;
  }

  // 客观状态同样不用人类结果页的文学 script，避免模型拿它当回答素材。
  for (const state of base.objectiveStates) {
    if (state.type !== '塌') continue;
    sections.push(state.text);
    base.framing.objective = OBJECTIVE_EFFECT_FRAME_NOTE;
  }
  const blackoutText = blackoutSection(base.blackout);
  if (blackoutText) {
    sections.push(blackoutText);
    base.framing.objective = OBJECTIVE_EFFECT_FRAME_NOTE;
  }
  base.hasState = anything;
  if (sections.length && anything) {
    base.context = {
      kind: 'proof-state',
      label: STATE_INJECTION_LABEL,
      text: sections.join('\n\n'),
      role: 'context'
    };
    // 兼容字段：只有在宿主被允许自动投递时才置位，语义与旧契约一致。
    if (base.autoDeliver) {
      base.injected = true;
      base.block = base.context;
    }
  }

  if (!(hasEffect || hasLoad || hasActiveBelief || base.blackout.active === true)) return base;

  base.active = true;
  base.shouldFetch = true;
  base.stateHints = stateHints;
  // 截止时间必须固定：读取不得把它往后推。
  base.expiresAt = events.length
    ? Math.max(...events.map((event) => event.expiresAt))
    : transientDeadline(engine.state, cfg);
  return base;
}
