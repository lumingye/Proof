// 活性成分通道通用化 · 缝合后的验收测试
// 设计来自外包 v3.2，缝合点 0–5 由执行方对齐源码后补齐。
// 全部注入时钟，零真实等待。

import test from 'node:test';
import assert from 'node:assert/strict';
import { ProofEngine, realPack, buildFromParts, ingredients } from '../src/index.js';
import {
  collectActives, ingestActives, settleActives, resetActives,
  activeAmount, activesToPhysiology, exportActives, restoreActives,
  emptyActives, caffeineToPhysiology, metabolizeCompound
} from '../src/core/active.js';
import {
  ACTIVE_DEFS, ACTIVE_AXIS_WHITELIST, validateActiveDefs, compoundPeak
} from '../src/content/actives.js';

const H = 3600000;
const T0 = Date.UTC(2026, 8, 3, 0, 0, 0);

function st(now = T0) {
  return { actives: emptyActives(), lastSettle: now };
}

// ---------- 缝合点 0：咖啡因逐字一致 ----------

test('缝合0：注册表里的咖啡因曲线与 caffeineToPhysiology 逐点一致（含超界区间）', () => {
  const curve = ACTIVE_DEFS.咖啡因.curve;
  for (let k = 0; k <= 6; k += 0.01) {
    const a = caffeineToPhysiology(k);
    const b = curve(k);
    assert.ok(Math.abs(a.愉悦 - b.愉悦) < 1e-12, `k=${k} 愉悦`);
    assert.ok(Math.abs(a.唤醒 - b.唤醒) < 1e-12, `k=${k} 唤醒`);
  }
});

test('缝合0：cap 之外必须是平的（防止有人把曲线改成超过 cap 继续变化）', () => {
  const four = caffeineToPhysiology(4);
  for (const k of [5, 6, 10]) {
    const r = caffeineToPhysiology(k);
    assert.equal(r.愉悦, four.愉悦);
    assert.equal(r.唤醒, four.唤醒);
  }
});

test('缝合0：常数与现状一致', () => {
  assert.equal(ACTIVE_DEFS.咖啡因.cap, 4);
  assert.equal(ACTIVE_DEFS.咖啡因.halfLifeH, 5);
  assert.equal(ACTIVE_DEFS.咖啡因.zero, 0.05);
});

// ---------- 1 双成分各自衰减 ----------

test('1：咖啡因与糖分各按自己的半衰期衰减，互不读取对方', () => {
  const s = st();
  ingestActives(s, { 咖啡因: 1, 糖分: 1 }, T0);
  settleActives(s, T0 + 3 * H);
  assert.ok(Math.abs(activeAmount(s.actives, '咖啡因') - 2 ** (-3 / 5)) < 1e-12);
  // 糖分半衰期 0.75h，3h = 4 个半衰期 = 0.0625 > zero 0.05，存活
  assert.ok(Math.abs(activeAmount(s.actives, '糖分') - 2 ** (-4)) < 1e-12);
});

// ---------- 2 离线补算比例（按 v3.1 修订版的三成分组合） ----------

test('2：export→restore 六小时补算，咖啡因与苦味存活、奎宁穿越阈值被删', () => {
  const s = st();
  ingestActives(s, { 咖啡因: 1, 苦味: 1, 奎宁: 1 }, T0);
  const payload = exportActives(s.actives);
  const back = restoreActives(payload, T0 + 6 * H);

  // 咖啡因 6h = 1.2 个半衰期 → 0.4353，远高于 0.05
  assert.ok(Math.abs(back.咖啡因.amount - 2 ** (-1.2)) < 1e-12);
  // 苦味 6h = 3 个半衰期 → 0.125，高于 0.05
  assert.ok(Math.abs(back.苦味.amount - 2 ** (-3)) < 1e-12);
  // 奎宁 6h = 4 个半衰期 → 0.0625，低于自己的 zero 0.1 → 在补算阶段就被删
  assert.equal('奎宁' in back, false, '奎宁必须在 restore 补算阶段被删');

  // 为什么这个组合不会误触发归零：余量对各自阈值都有安全边际
  assert.ok(2 ** (-1.2) > ACTIVE_DEFS.咖啡因.zero);
  assert.ok(2 ** (-3) > ACTIVE_DEFS.苦味.zero);
  assert.ok(2 ** (-4) < ACTIVE_DEFS.奎宁.zero);
});

// ---------- 3 归零阈值 ----------

test('3：低于阈值即删键，不留 { amount: 0 } 残骸', () => {
  const s = st();
  s.actives.糖分 = { amount: 0.04, lastSettle: T0 };
  settleActives(s, T0 + 1);
  assert.equal('糖分' in s.actives, false);
  assert.equal(activeAmount(s.actives, '糖分'), 0);
});

// ---------- 4 reset ----------

test('4：reset 三档一律清空全部活性成分', () => {
  for (const mode of ['醒酒', '连宿醉一起清', '这晚不算']) {
    const e = new ProofEngine(null, realPack);
    const cup = buildFromParts('咖啡', [{ id: '浓缩咖啡', volume: 60 }], { kind: 'custom', listed: false, id: 'c1' });
    e.sipAll(cup, T0);
    assert.ok(activeAmount(e.state.actives, '咖啡因') > 0, `${mode} 前应当有咖啡因`);
    e.reset(mode, T0 + H);
    assert.deepEqual(e.state.actives, {}, `${mode} 之后必须清空`);
  }
});

// ---------- 5 export→restore 等价 ----------

test('5：直通与 export→restore 两条路径求值等价', () => {
  const e = new ProofEngine(null, realPack);
  const cup = buildFromParts('可乐加酒', [{ id: '可乐', volume: 330 }, { id: '伏特加', volume: 45 }], { kind: 'custom', listed: false, id: 'c1' });
  e.sipAll(cup, T0);
  const at = T0 + 2 * H;
  const direct = e.evaluate(at).state;
  const restored = ProofEngine.restoreState(e.exportState(), realPack).evaluate(at).state;
  for (const axis of ['愉悦', '唤醒', '精度', '亲近', '守门', '欲望']) {
    assert.ok(Math.abs(direct[axis] - restored[axis]) < 1e-9, `${axis} 必须等价`);
  }
});

// ---------- 6 咖啡因回归 ----------

test('6：咖啡因金样快照（含超界点）', () => {
  const golden = [0, 0.5, 1, 2, 3, 4, 5, 6, 10].map((k) => {
    const r = caffeineToPhysiology(k);
    return [k, Number(r.愉悦.toFixed(10)), Number(r.唤醒.toFixed(10))];
  });
  assert.deepEqual(golden, [
    [0, 0, 0], [0.5, 0.25, 0.6], [1, 0.5, 1.2], [2, 1, 2.4],
    [3, 0.4, 2.4], [4, -0.2, 2.4], [5, -0.2, 2.4], [6, -0.2, 2.4], [10, -0.2, 2.4]
  ]);
});

test('6b：存量不封顶，求值时才封顶（与现状一致）', () => {
  const s = st();
  ingestActives(s, { 咖啡因: 6 }, T0);
  assert.equal(activeAmount(s.actives, '咖啡因'), 6, '存量必须保留 6，不在摄入时截断');
  const phys = activesToPhysiology(s.actives);
  const four = caffeineToPhysiology(4);
  assert.ok(Math.abs(phys.愉悦 - four.愉悦) < 1e-12);
  assert.ok(Math.abs(phys.唤醒 - four.唤醒) < 1e-12);
});

// ---------- 7 无声明原料不推 ----------

test('7：纯烈酒不产生任何非酒精推力', () => {
  const e = new ProofEngine(null, realPack);
  const cup = buildFromParts('金酒', [{ id: '金酒', volume: 60 }], { kind: 'custom', listed: false, id: 'g1' });
  e.sipAll(cup, T0);
  assert.deepEqual(e.state.actives, {}, '六种烈酒都不挂活性成分');
});

test('7b：水与冰不在范围内', () => {
  assert.deepEqual(collectActives([{ id: '水', volume: 200 }, { id: '冰', volume: 60 }], ingredients), {});
});

// ---------- 8 轴范围与闸门 ----------

test('8a：当前注册表通过全部六道闸', () => {
  assert.equal(validateActiveDefs(), true);
});

test('8b：白名单只有生理两轴，精度与反应三轴不开放', () => {
  assert.deepEqual(ACTIVE_AXIS_WHITELIST, ['愉悦', '唤醒']);
  for (const [name, def] of Object.entries(ACTIVE_DEFS)) {
    for (const axis of def.axes) {
      assert.ok(ACTIVE_AXIS_WHITELIST.includes(axis), `${name} 声明了 ${axis}`);
    }
  }
});

test('8c：声明白名单外的轴 → 加载期抛错', () => {
  assert.throws(() => validateActiveDefs({
    咖啡因: { ...ACTIVE_DEFS.咖啡因 },
    假货: { halfLifeH: 1, cap: 1, zero: 0.05, axes: ['精度'], curve: () => ({ 精度: -1 }) }
  }), /白名单外的轴/);
});

test('8d：轴级合计超预算 → 抛错（闸⑥）', () => {
  assert.throws(() => validateActiveDefs({
    咖啡因: { ...ACTIVE_DEFS.咖啡因 },
    假货: { halfLifeH: 1, cap: 2, zero: 0.05, axes: ['唤醒'], curve: (k) => ({ 唤醒: 0.7 * k }) }
  }), /超过/);
});

test('8e：没有基准化合物 → 抛错', () => {
  assert.throws(() => validateActiveDefs({
    奎宁: { ...ACTIVE_DEFS.奎宁 }
  }), /基准化合物/);
});

test('8f：当前数值的实际余量（闸⑥ 现状留档）', () => {
  const base愉悦 = compoundPeak('咖啡因', '愉悦');
  const base唤醒 = compoundPeak('咖啡因', '唤醒');
  assert.equal(base愉悦, 1);
  assert.equal(base唤醒, 2.4);
  // 糖分 +0.24 / 苦味 −0.16 / 唤醒正向合计 0.36，全部在 50% 预算内
  assert.ok(compoundPeak('糖分', '愉悦') <= base愉悦 * 0.5);
  assert.ok(compoundPeak('苦味', '愉悦') <= base愉悦 * 0.5);
});

// ---------- 9 投影不泄露内部数值 ----------

test('9：喝完的投影里不出现化合物名、份数、半衰期', () => {
  const e = new ProofEngine(null, realPack);
  const cup = buildFromParts('汤力', [{ id: '金酒', volume: 45 }, { id: '汤力水', volume: 150 }], { kind: 'custom', listed: false, id: 't1' });
  const id = e.createOffer(cup, 'mixer', 'mixer', 'drinker', T0);
  const r = e.drinkOffer(id, 'drinker', 'req1', T0);
  const text = JSON.stringify(r.projection);
  for (const leak of ['奎宁', 'halfLifeH', 'referenceVolumeMl', 'actives']) {
    assert.equal(text.includes(leak), false, `投影不得含 ${leak}`);
  }
});

// ---------- 10 空字典迁移 ----------

test('10：空字典状态下 settle / evaluate / reset / export 全不抛错', () => {
  const e = new ProofEngine(null, realPack);
  assert.deepEqual(e.state.actives, {});
  e.settle(T0);
  const s = e.evaluate(T0).state;
  assert.equal(s.唤醒, 0);
  e.reset('连宿醉一起清', T0 + H);
  assert.deepEqual(exportActives(e.state.actives), {});
});

test('10b：空状态直接 restore 一个非空包，槽正确建立', () => {
  const back = restoreActives({ 咖啡因: { amount: 2, lastSettle: T0 } }, T0);
  assert.equal(back.咖啡因.amount, 2);
  const phys = activesToPhysiology(back);
  assert.ok(Math.abs(phys.唤醒 - caffeineToPhysiology(2).唤醒) < 1e-12);
});

// ---------- 11 内容侧：每条已声明原料收出预期清单（缝合点 1） ----------

test('11：十二种原料的声明逐条收得出来', () => {
  const expect = {
    甜味美思: ['糖分', '苦味'], 干味美思: ['糖分', '苦味'], 金巴利: ['苦味', '糖分'],
    橙皮利口酒: ['糖分', '苦味'], 苦艾酒: ['侧柏酮'], 啤酒: ['啤酒花', '糖分'],
    红葡萄酒: ['单宁'], 汤力水: ['奎宁'], 可乐: ['咖啡因', '糖分'],
    青柠汁: ['果酸'], 柠檬汁: ['果酸'], 糖浆: ['糖分'],
    浓缩咖啡: ['咖啡因'], 咖啡利口酒: ['咖啡因']
  };
  for (const [id, compounds] of Object.entries(expect)) {
    const got = Object.keys(collectActives([{ id, volume: 100 }], ingredients));
    assert.deepEqual(got.sort(), [...compounds].sort(), `${id} 的声明不符`);
  }
});

test('11b：可乐的咖啡因遗漏已修复——长岛冰茶不再是零咖啡因', () => {
  const lit = realPack.menu.find((c) => c.claimedName === '长岛冰茶');
  assert.ok(lit.activesTotal.咖啡因 > 0, '长岛冰茶含 205ml 可乐，咖啡因不该是 0');
});
