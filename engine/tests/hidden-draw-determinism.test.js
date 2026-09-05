// 发布回归追加 §2：消除隐藏抽卡带来的随机红灯。
// **生产玩法不变**：每只新杯仍生成随机 cupId，按 hash(cupId) 掷 5%，结果冻结。
// 这里只把「测试用的杯 id」固定下来。

import test from 'node:test';
import assert from 'node:assert/strict';
import { ProofEngine, realPack, buildFromParts } from '../src/index.js';
import { hashUnit, HIDDEN_DRAW_P, isHiddenIdentity } from '../src/core/hiddenDraw.js';

const T0 = Date.UTC(2026, 8, 2, 10, 0, 0);
// hashUnit('fixed-0') ≈ 0.4207 —— 稳定不命中
const MISS_ID = 'fixed-0';
// hashUnit('fixed-48') ≈ 0.0326 —— 稳定命中
const HIT_ID = 'fixed-48';

// 纯烈酒单一来源：满足 heaven 资格，同时离散度为 0，不会先命中「五彩斑斓的黑」。
function heavenCup() {
  return buildFromParts('测试烈酒', [{ id: '伏特加', volume: 90 }], { kind: 'custom', listed: false });
}

test('固定 id 选得对：一个稳定不命中，一个稳定命中', () => {
  assert.ok(hashUnit(MISS_ID) >= HIDDEN_DRAW_P, 'MISS_ID 必须落在 5% 之外');
  assert.ok(hashUnit(HIT_ID) < HIDDEN_DRAW_P, 'HIT_ID 必须落在 5% 之内');
});

test('注入固定 id 后，连续 100 次结果完全一致（不再随机红灯）', () => {
  for (let i = 0; i < 100; i += 1) {
    const e = new ProofEngine(null, realPack, { idFactory: () => MISS_ID });
    const id = e.createOffer(heavenCup(), 'mixer', 'mixer', 'drinker', T0);
    const name = e.offers.get(id).cup.claimedName;
    assert.equal(isHiddenIdentity(name), false, `第 ${i} 次不该命中隐藏酒`);
    assert.equal(name, '测试烈酒');
  }
});

test('注入命中 id 后，稳定抽中 heaven', () => {
  for (let i = 0; i < 20; i += 1) {
    const e = new ProofEngine(null, realPack, { idFactory: () => HIT_ID });
    const id = e.createOffer(heavenCup(), 'mixer', 'mixer', 'drinker', T0);
    assert.equal(e.offers.get(id).cup.claimedName, 'heaven');
  }
});

test('不具备资格的配方，即使 id 命中也不会变成隐藏酒', () => {
  const e = new ProofEngine(null, realPack, { idFactory: () => HIT_ID });
  const water = buildFromParts('白水', [{ id: '水', volume: 200 }], { kind: 'custom', listed: false });
  const id = e.createOffer(water, 'mixer', 'mixer', 'drinker', T0);
  assert.equal(e.offers.get(id).cup.claimedName, '白水');
});

test('10000 杯分布仍约为 5%', () => {
  const N = 10000;
  let hits = 0;
  for (let i = 0; i < N; i += 1) {
    if (hashUnit(`dist-${i}`) < HIDDEN_DRAW_P) hits += 1;
  }
  const rate = hits / N;
  assert.ok(rate > 0.04 && rate < 0.06, `命中率应在 4%~6%，实际 ${(rate * 100).toFixed(2)}%`);
});

test('生产默认仍是随机 cupId：不传 idFactory 时两次调制得到不同的杯', () => {
  const e = new ProofEngine(null, realPack);
  const a = e.createOffer(heavenCup(), 'mixer', 'mixer', 'drinker', T0);
  const b = e.createOffer(heavenCup(), 'mixer', 'mixer', 'drinker', T0);
  assert.notEqual(e.offers.get(a).cup.id, e.offers.get(b).cup.id, '同一配方重新调制必须是不同的杯');
});
