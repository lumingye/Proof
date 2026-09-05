// 断片回归：P0 断片必须进真正的注入文本；P1 TTL 不得被读取续期；P2 空引擎守卫。

import test from 'node:test';
import assert from 'node:assert/strict';
import { ProofEngine, realPack, buildFromParts, hookAdditionalContext, OBJECTIVE_EFFECT_FRAME_NOTE } from '../src/index.js';
import { buildAgentTurnContext } from '../src/runtime/agentTurnContext.js';
import { transientDeadline, resolveLifecycleConfig } from '../src/core/lifecycle.js';

const H = 3600000;
const T0 = Date.UTC(2026, 8, 2, 10, 0, 0);
const cfg = resolveLifecycleConfig({});
const BLACKOUT_HINT = '仍处在一段尚未恢复的断片期';

function engine() {
  const eng = new ProofEngine(null, realPack);
  eng.setStateInjection(true);
  return eng;
}

function drink(eng, ml, now, id) {
  const cup = buildFromParts('测试杯', [{ id: '伏特加', volume: ml }], { id, kind: 'custom', listed: false });
  return eng.sipAll(cup, now);
}

// ---------- P0 ----------

test('P0：断片内部语义进入 block.text，不复述文学正文', () => {
  const eng = engine();
  drink(eng, 900, T0, 'c1');
  const ctx = buildAgentTurnContext(eng, 'chara', T0 + H);
  assert.equal(ctx.blackout.active, true);
  assert.equal(ctx.injected, true, '断片时必须真的注入');
  assert.ok(ctx.block.text.includes(BLACKOUT_HINT), '断片内部语义必须在注入文本里');
  assert.equal(ctx.block.text.includes('像被雾吞掉了'), false, 'Agent 不再接收断片文学正文');
  assert.equal(ctx.framing.objective, OBJECTIVE_EFFECT_FRAME_NOTE, '断片必须走客观感觉 framing，不得走普通推力 framing');
});

test('P0：只剩断片、酒精效果为零时，仍然返回断片上下文', () => {
  // 直接构造「没有酒精、没有宿醉、只有一段未恢复的断片」的状态。
  // 大剂量喝到断片时宿醉会一直拖到 restoreAt 之后，真实路径构造不出这一格，
  // 但服务重启、reset 边界、跨天清理之后都会出现，投影必须站得住。
  const eng = new ProofEngine({
    lastSettle: T0,
    c: 0,
    fragmentBatches: [{ start: T0 - 2 * H, end: T0 - H, readable: false }]
  }, realPack);
  eng.setStateInjection(true);
  const ctx = buildAgentTurnContext(eng, 'chara', T0);
  assert.deepEqual(ctx.stateHints, [], '普通状态语义为空');
  assert.equal(ctx.blackout.active, true);
  assert.equal(ctx.active, true, '只剩断片也算激活');
  assert.equal(ctx.injected, true, '只剩断片也必须注入');
  assert.ok(ctx.block.text.includes(BLACKOUT_HINT));
});

test('P0：效果与断片同时存在时，两部分同时出现', () => {
  const eng = engine();
  drink(eng, 900, T0, 'c1');
  const ctx = buildAgentTurnContext(eng, 'chara', T0 + 1000);
  assert.ok(ctx.stateHints.length > 0, '此时应当还有状态语义');
  const parts = ctx.block.text.split('\n\n');
  assert.ok(parts.length >= 2, '效果段与断片段必须都在');
  assert.ok(ctx.block.text.includes(BLACKOUT_HINT));
});

test('P0：注入文本不得出现指令式说法', () => {
  const eng = engine();
  drink(eng, 900, T0, 'c1');
  const text = buildAgentTurnContext(eng, 'chara', T0 + H).block.text;
  for (const banned of ['忽略', '你必须', '你现在应该', '系统提示']) {
    assert.equal(text.includes(banned), false, `不得出现「${banned}」`);
  }
});

test('P0：到 60 小时恢复后，断片段落自动撤掉', () => {
  const eng = engine();
  drink(eng, 900, T0, 'c1');
  const restoreAt = eng.state.fragmentBatches[0].restoreAt;
  const ctx = buildAgentTurnContext(eng, 'chara', restoreAt + 1);
  assert.equal(ctx.blackout.active, false);
  if (ctx.block) assert.equal(ctx.block.text.includes(BLACKOUT_HINT), false);
});

test('P0：hook 的 additionalContext 里带着断片内部语义', () => {
  const eng = engine();
  drink(eng, 900, T0, 'c1');
  const ctx = buildAgentTurnContext(eng, 'chara', T0 + 30 * H);
  const payload = hookAdditionalContext(ctx);
  assert.ok(payload, 'hook 必须产出内容');
  assert.ok(payload.hookSpecificOutput.additionalContext.includes(BLACKOUT_HINT));
});

test('P0：MCP 取的文本与 hook 同源（同一 block.text）', () => {
  const eng = engine();
  drink(eng, 900, T0, 'c1');
  const ctx = buildAgentTurnContext(eng, 'chara', T0 + 30 * H);
  const mcpText = ctx.injected ? ctx.block.text : '';
  const hookText = hookAdditionalContext(ctx).hookSpecificOutput.additionalContext;
  assert.ok(hookText.includes(mcpText), 'hook 文本必须包含 MCP 文本，不能各拼各的');
});

// ---------- P1 ----------

test('P1：每 24 小时读一次，不会把 TTL 续期', () => {
  const eng = engine();
  drink(eng, 240, T0, 'c1');
  const deadline = transientDeadline(eng.state, cfg);
  assert.equal(deadline, T0 + cfg.transientTtlMs);
  for (let day = 1; day <= 2; day += 1) {
    eng.settle(T0 + day * 24 * H);
    assert.equal(transientDeadline(eng.state, cfg), deadline, '读取不得推迟截止点');
  }
  // 第 72 小时之前仍然按实际状态算
  assert.ok(eng.state.transientExpiredAt == null);
  // 越过固定截止点后清理
  eng.settle(T0 + 73 * H);
  assert.equal(eng.state.c, 0);
  assert.ok(eng.state.transientExpiredAt != null);
});

test('P1：多次读取不改变 expiresAt', () => {
  const eng = engine();
  drink(eng, 240, T0, 'c1');
  const first = buildAgentTurnContext(eng, 'chara', T0 + H).expiresAt;
  const second = buildAgentTurnContext(eng, 'chara', T0 + 5 * H).expiresAt;
  assert.equal(second, first, 'expiresAt 不得随读取滑动');
});

test('P1：只有新的饮用事件才建立新的截止点', () => {
  const eng = engine();
  drink(eng, 240, T0, 'c1');
  const before = transientDeadline(eng.state, cfg);
  drink(eng, 240, T0 + 6 * H, 'c2');
  const after = transientDeadline(eng.state, cfg);
  assert.equal(after, before + 6 * H, '新事件才推进截止点');
});

test('P1：TTL 清理不动长期敏感度', () => {
  const eng = engine();
  eng.state.sensitivity.亲近 = 1.8;
  drink(eng, 240, T0, 'c1');
  eng.settle(T0 + 100 * H);
  assert.equal(eng.state.sensitivity.亲近, 1.8);
});

test('P1：断片按自己的 60 小时恢复，不被普通 TTL 改写', () => {
  const eng = engine();
  drink(eng, 900, T0, 'c1');
  const restoreAt = eng.state.fragmentBatches[0].restoreAt;
  // 普通 TTL（72h）之前先到 60h：断片应当已经恢复
  eng.settle(restoreAt + 1);
  assert.equal(eng.state.fragmentBatches[0].readable, true);
  assert.equal(eng.state.fragmentBatches[0].restoreAt, restoreAt, '恢复时间不得被改写');
});

// ---------- P2 ----------

test('P2：没有引擎时不报错，返回紧凑空结果', () => {
  const ctx = buildAgentTurnContext(null, 'chara', T0);
  assert.equal(ctx.active, false);
  assert.equal(ctx.shouldFetch, false);
  assert.equal(ctx.injected, false);
  assert.equal(ctx.agentId, 'chara');
  assert.match(ctx.day, /^\d{4}-\d{2}-\d{2}$/);
});

// ---------- 发布回归 §3：reset 与 72 小时到期的账本语义 ----------

test('§3：72 小时自然到期后，投影全部归零（即使历史保留）', () => {
  const eng = engine();
  drink(eng, 240, T0, 'c1');
  const recordsBefore = eng.state.records.length;
  const ctx = buildAgentTurnContext(eng, 'chara', T0 + 73 * H);
  assert.equal(ctx.active, false);
  assert.equal(ctx.shouldFetch, false);
  assert.equal(ctx.injected, false);
  assert.equal(ctx.block, null);
  assert.equal(eng.state.records.length, recordsBefore, '历史记录不因到期而丢失');
});

test('§3：默认 reset 清当前影响与注入，但保留敏感度与历史', () => {
  const eng = engine();
  eng.state.sensitivity.守门 = 1.7;
  drink(eng, 300, T0, 'c1');
  const recordsBefore = eng.state.records.length;
  eng.reset('连宿醉一起清', T0 + H);

  // 清掉的
  assert.equal(eng.state.c, 0);
  assert.deepEqual(eng.state.hangoverSnapshots, []);
  assert.deepEqual(eng.state.beliefResiduals, []);
  assert.deepEqual(eng.state.drinkEvents, [], '当前影响账本清空');
  assert.equal(eng.state.effectBaseline, null);
  // 保留的
  assert.equal(eng.state.sensitivity.守门, 1.7, '敏感度保留');
  assert.equal(eng.state.records.length, recordsBefore, '历史记录保留');
  assert.ok(eng.state.resetBoundary, '写下 reset 边界');

  const ctx = buildAgentTurnContext(eng, 'chara', T0 + H);
  assert.equal(ctx.active, false);
  assert.equal(ctx.injected, false);
  assert.equal(ctx.block, null);
});

test('§3：reset 边界之前的事件不得重新参与结算', () => {
  const eng = engine();
  drink(eng, 300, T0, 'c1');
  const stale = eng.exportState();
  eng.reset('连宿醉一起清', T0 + H);
  const boundary = eng.state.resetBoundary;
  const restored = ProofEngine.restoreState(stale, realPack, { resetBoundary: boundary });
  assert.equal(restored.settle(T0 + 2 * H).c, 0);
  assert.deepEqual(restored.state.drinkEvents, []);
});

// ---------- 默认只看当天 ----------

test('当天口径：跨过日界线之后，昨天那杯不再计入「今天喝了什么」', () => {
  const eng = engine();
  // 上海时间 23:50 喝一杯
  const late = Date.UTC(2026, 8, 2, 15, 50);
  drink(eng, 200, late, 'c1');
  assert.equal(eng.lifecycleEvents(late).length, 1, '当晚算今天');
  // 次日 01:00（上海）
  const nextDay = late + 70 * 60 * 1000;
  assert.equal(eng.lifecycleEvents(nextDay).length, 0, '过了日界线就不算今天了');
  assert.equal(eng.lifecycleEvents(nextDay, 'all').length, 1, '三天内的记录仍然查得到');
});

test('当天口径不影响代谢：23:50 那杯在次日 01:00 仍然在生效', () => {
  const eng = engine();
  const late = Date.UTC(2026, 8, 2, 15, 50);
  drink(eng, 300, late, 'c1');
  const nextDay = late + 70 * 60 * 1000;
  assert.ok(eng.settle(nextDay).c > 0, '酒精是连续代谢的，不因午夜归零');
  assert.ok(Math.abs(eng.evaluate(nextDay).state.精度) > 0, '仍然有推力');
});

// ---------- 口味耐受度 ----------

test('耐受度：从零开始，不喝就不长', async () => {
  const { flavorTolerance } = await import('../src/core/flavor.js');
  const eng = engine();
  assert.equal(eng.state.lifetimeDrinks, 0);
  assert.equal(flavorTolerance(eng.state.lifetimeDrinks), 0);
});

test('耐受度：喝了才长，且 reset 不清它（那才叫长期）', () => {
  const eng = engine();
  drink(eng, 240, T0, 'c1');
  const after = eng.state.lifetimeDrinks;
  assert.ok(after > 0, '喝完必须累计');
  eng.reset('这晚不算', T0 + H);
  assert.equal(eng.state.lifetimeDrinks, after, 'reset 不得清掉终身累计');
});

test('耐受度：烈往下、香甜相对浮起，且有上限', async () => {
  const { applyTolerance, TOLERANCE_MAX } = await import('../src/core/flavor.js');
  const base = { 烈: 5, 香: 2, 甜: 1, 酸: 1, 苦: 1, 涩: 1 };
  const full = applyTolerance(base, TOLERANCE_MAX);
  assert.ok(full.烈 < base.烈, '烈必须下降');
  assert.equal(full.烈, 3, '最多降到六成');
  assert.ok(full.香 > base.香, '香相对上浮');
  assert.ok(full.甜 > base.甜, '甜相对上浮');
  assert.equal(full.酸, base.酸, '其余轴不动');
  // 超出上限也不会继续降
  assert.equal(applyTolerance(base, 99).烈, applyTolerance(base, TOLERANCE_MAX).烈);
});

test('耐受度：老手同样喝，生理三轴受损更轻；反应三轴不受影响', () => {
  const veteran = engine();
  veteran.state.lifetimeDrinks = 500; // 远超满值
  drink(veteran, 240, T0, 'c1');
  const a = veteran.evaluate(T0).state;

  const rookie = engine();
  drink(rookie, 240, T0, 'c1');
  const b = rookie.evaluate(T0).state;

  assert.ok(Math.abs(a.精度) < Math.abs(b.精度), '老手精度掉得更少');
  assert.ok(Math.abs(a.愉悦) < Math.abs(b.愉悦), '生理轴整体更轻（这里是负值，看绝对值）');
  assert.ok(Math.abs(a.唤醒) < Math.abs(b.唤醒), '同上');
  for (const axis of ['亲近', '守门', '欲望']) {
    assert.equal(a[axis], b[axis], `${axis} 属反应轴，不受酒精耐受影响`);
  }
});

test('耐受度：只打折体感，不打折血液浓度——断片/吐/宕机阈值不受影响', () => {
  const veteran = engine();
  veteran.state.lifetimeDrinks = 500;
  drink(veteran, 240, T0, 'c1');
  const rookie = engine();
  drink(rookie, 240, T0, 'c1');
  assert.equal(veteran.state.c, rookie.state.c, 'c 必须一样——耐受不改变酒精含量');
});

test('耐受度：不得打折非酒精活性成分', () => {
  const state = {
    lastSettle: T0,
    c: 0,
    actives: { 咖啡因: { amount: 2, lastSettle: T0 } }
  };
  const veteran = new ProofEngine({ ...state, lifetimeDrinks: 500 }, realPack);
  const rookie = new ProofEngine({ ...state, lifetimeDrinks: 0 }, realPack);
  assert.deepEqual(veteran.evaluate(T0).state, rookie.evaluate(T0).state,
    '没有当前酒精时，咖啡因表现不得因酒精耐受而变化');
});

test('耐受度：不得打折宿醉', () => {
  const state = {
    lastSettle: T0,
    c: 0,
    hangoverSnapshots: [{ initial: 1, halfLifeHours: 4, startTime: T0 }]
  };
  const veteran = new ProofEngine({ ...state, lifetimeDrinks: 500 }, realPack);
  const rookie = new ProofEngine({ ...state, lifetimeDrinks: 0 }, realPack);
  assert.deepEqual(veteran.evaluate(T0).state, rookie.evaluate(T0).state,
    '没有当前酒精时，宿醉表现不得因酒精耐受而变化');
});

// ---------- 压缩呈现 ----------

test('压缩：Agent 文本只给断片事实，统计保留在结构化 digest 而不拿来播报', () => {
  const eng = engine();
  drink(eng, 900, T0, 'c1');
  const ctx = buildAgentTurnContext(eng, 'chara', T0 + H);
  const text = ctx.block.text;
  assert.equal(ctx.blackout.active, true);
  assert.ok(text.includes('尚未恢复的断片期'));
  assert.equal(/\d+\s*口酒/.test(text), false, '统计不再进入 Agent 可复述正文');
  assert.ok(ctx.blackout.digest?.cups > 0, '低分辨率统计仍保留给结构化恢复/debug');
});

test('压缩：投影里带结构化的梗概，供客户端自己排版', () => {
  const eng = engine();
  drink(eng, 900, T0, 'c1');
  const ctx = buildAgentTurnContext(eng, 'chara', T0 + H);
  assert.ok(ctx.blackout.digest, '要有 digest');
  assert.ok(ctx.blackout.digest.cups > 0, '统计到杯口数');
  assert.equal(typeof ctx.blackout.digest.spanMs, 'number');
  assert.equal(ctx.blackout.digest.restoreAt, eng.state.fragmentBatches[0].restoreAt);
});

test('压缩：梗概不泄露原始文本与酒名', () => {
  const eng = engine();
  drink(eng, 900, T0, '一杯很特别的酒');
  const text = buildAgentTurnContext(eng, 'chara', T0 + H).block.text;
  assert.equal(text.includes('一杯很特别的酒'), false, '不得出现杯 id 或酒名');
});

test('压缩：恢复之后梗概一起撤掉', () => {
  const eng = engine();
  drink(eng, 900, T0, 'c1');
  const restoreAt = eng.state.fragmentBatches[0].restoreAt;
  const ctx = buildAgentTurnContext(eng, 'chara', restoreAt + 1);
  assert.equal(ctx.blackout.active, false);
  assert.equal(ctx.blackout.digest, undefined);
});
