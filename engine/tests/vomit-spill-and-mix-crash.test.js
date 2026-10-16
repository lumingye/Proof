import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, T0 } from './helpers.js';
import { realPack } from '../src/content/realPack.js';
import { buildFromParts } from '../src/content/realPack.js';
import { projectAgentObjectiveStates } from '../src/runtime/agentObjectiveStates.js';
import { ProofEngine } from '../src/engine/ProofEngine.js';
import { resolveLifecycleConfig } from '../src/core/lifecycle.js';

const MIXER = 'mixer';
const DRINKER = 'drinker';
const MIN = 60 * 1000;

function vomitOnce(e, at, tag) {
  e.state.c = 9.8;
  e.state.lastSettle = at;
  e.state.vomitArmed = true;
  const cup = buildFromParts(`过线-${tag}`, [{ id: '伏特加', volume: 20 }], { kind: 'custom', listed: false, totalMouths: 1 });
  const id = e.createOffer(cup, MIXER, MIXER, DRINKER, at);
  return e.drinkOffer(id, DRINKER, `vomit-${tag}`, at);
}

test('VS1 默认开倾泻：第一次吐要求先标注，第二次不再要求', () => {
  const e = engine();
  const first = vomitOnce(e, T0, 'a').events.find((ev) => ev.type === '吐');
  assert.ok(first, '应当吐');
  assert.equal(first.spill, true);
  assert.equal(first.firstSpill, true);
  const [firstText] = projectAgentObjectiveStates([first]);
  assert.match(firstText.text, /（Proof：吐了）/);
  assert.match(firstText.text, /三五行/);
  assert.match(firstText.text, /安全边界/);

  const second = vomitOnce(e, T0 + 5 * MIN, 'b').events.find((ev) => ev.type === '吐');
  assert.ok(second, '降回线下再上穿，应当再吐');
  assert.equal(second.spill, true);
  assert.equal(second.firstSpill, false);
  const [secondText] = projectAgentObjectiveStates([second]);
  assert.doesNotMatch(secondText.text, /（Proof：吐了）/);
  assert.match(secondText.text, /倾泻/);
});

test('VS2 关掉倾泻：只剩一句事实，不倾泻也不标注', () => {
  const e = engine({ vomitSpillEnabled: false });
  const ev = vomitOnce(e, T0, 'off').events.find((x) => x.type === '吐');
  assert.equal(ev.spill, false);
  assert.equal(ev.firstSpill, false);
  const [projected] = projectAgentObjectiveStates([ev]);
  assert.equal(projected.text, '你刚才确实吐了。这件事已经发生，不是性格推动或可能性。');
  assert.equal(e.state.vomitSpillShown, false, '没倾泻过，就不算用掉「第一次」');
});

test('VS3 「已经标注过」跨导出/导入保留，reset 不清', () => {
  const e = engine();
  vomitOnce(e, T0, 'p');
  const restored = new ProofEngine(e.exportState(), realPack);
  assert.equal(restored.state.vomitSpillShown, true);
  restored.reset('连宿醉一起清', T0 + 10 * MIN);
  assert.equal(restored.state.vomitSpillShown, true);
});

test('VS4 环境变量 PROOF_VOMIT_SPILL_ENABLED 控制开关，默认开', () => {
  assert.equal(resolveLifecycleConfig({}).vomitSpillEnabled, true);
  assert.equal(resolveLifecycleConfig({ PROOF_VOMIT_SPILL_ENABLED: 'false' }).vomitSpillEnabled, false);
  assert.throws(() => resolveLifecycleConfig({ PROOF_VOMIT_SPILL_ENABLED: 'maybe' }));
});

const cupA = () => buildFromParts('两样', [
  { id: '伏特加', volume: 20 },
  { id: '金酒', volume: 20 }
], { kind: 'custom', listed: false, totalMouths: 1 });
const cupB = () => buildFromParts('三样', [
  { id: '白朗姆', volume: 20 },
  { id: '龙舌兰', volume: 20 },
  { id: '威士忌', volume: 20 }
], { kind: 'custom', listed: false, totalMouths: 1 });

function drink(e, cup, at, tag) {
  const id = e.createOffer(cup, MIXER, MIXER, DRINKER, at);
  return e.drinkOffer(id, DRINKER, tag, at);
}

test('MC1 单杯都不够杂，各自不宕机', () => {
  const a = engine({ random: () => 0 });
  assert.equal(drink(a, cupA(), T0, 'a').events.some((ev) => ev.type === '宕机'), false);
  const b = engine({ random: () => 0 });
  assert.equal(drink(b, cupB(), T0, 'b').events.some((ev) => ev.type === '宕机'), false);
});

test('MC2 一小时内混着喝，两杯并起来够杂，第二杯第一口可能宕机', () => {
  const e = engine({ random: () => 0 });
  drink(e, cupA(), T0, 'a');
  const second = drink(e, cupB(), T0 + 10 * MIN, 'b');
  assert.ok(second.events.some((ev) => ev.type === '宕机'), '混喝的那一锅应当可能宕机');
});

test('MC3 隔了超过一小时，前一杯不算混喝', () => {
  const e = engine({ random: () => 0 });
  drink(e, cupA(), T0, 'a');
  const later = drink(e, cupB(), T0 + 61 * MIN, 'b');
  assert.equal(later.events.some((ev) => ev.type === '宕机'), false);
});

test('MC4 reset 清掉混喝记录', () => {
  const e = engine({ random: () => 0 });
  drink(e, cupA(), T0, 'a');
  e.reset('醒酒', T0 + 5 * MIN);
  const after = drink(e, cupB(), T0 + 10 * MIN, 'b');
  assert.equal(after.events.some((ev) => ev.type === '宕机'), false);
});

test('MC5 掷骰没中（random 高）时混喝也不宕', () => {
  const e = engine({ random: () => 0.99 });
  drink(e, cupA(), T0, 'a');
  const second = drink(e, cupB(), T0 + 10 * MIN, 'b');
  assert.equal(second.events.some((ev) => ev.type === '宕机'), false);
});
