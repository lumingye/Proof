// 部署前静态收口 v2：Agent cardinality / idFactory / fragmentBatches 等价回归 —— 引擎层。
// 不假设固定三名 Agent：唯一性、隔离、restore/restart 都以“任意 Agent A≠B”为表达。

import test from 'node:test';
import assert from 'node:assert/strict';
import { ProofEngine } from '../src/engine/ProofEngine.js';
import { realPack, menuItem } from '../src/content/realPack.js';

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);

function engine(options) {
  return new ProofEngine(null, realPack, options || {});
}

function openAndDrink(e, name, at, requestId) {
  const id = e.createOffer(menuItem(name), 'user', 'user', 'drinker-a', at);
  const r = e.drinkOffer(id, 'drinker-a', requestId, at);
  assert.equal(r.ok, true, r.error || 'drink ok');
  return { e, id };
}

test('ID-1 单实例对象唯一性：连续创建 cup/offer/record 不冲突', () => {
  const e = engine();
  const offerIds = [];
  const cupIds = [];
  for (let i = 0; i < 8; i += 1) {
    const id = e.createOffer(menuItem('金汤力'), 'user', 'user', 'drinker-a', T0 + i);
    const offer = e.offers.get(id);
    offerIds.push(id);
    cupIds.push(offer.cup.id);
    const r = e.drinkOffer(id, 'drinker-a', `req-${i}`, T0 + i);
    assert.equal(r.ok, true, r.error || 'drink');
  }
  assert.equal(new Set(offerIds).size, offerIds.length, 'offer id 唯一');
  assert.equal(new Set(cupIds).size, cupIds.length, 'cup id（idFactory）唯一');
  const recIds = e.state.records.map((r) => r.id);
  assert.equal(new Set(recIds).size, recIds.length, 'record/event id 唯一');
  // 饮用事件账本也不重复
  const eventIds = e.state.drinkEvents.map((ev) => ev.eventId);
  assert.equal(new Set(eventIds).size, eventIds.length, 'drinkEvent id 唯一');
});

test('ID-2 任意 Agent 隔离：ID 相同与否都不能跨 Engine 命中', () => {
  // 两个引擎分别注入返回同名的确定性 idFactory → 产生同名 cup，但 offer/状态各自隔离。
  const A = engine({ idFactory: () => 'shared-cup-id' });
  const B = engine({ idFactory: () => 'shared-cup-id' });
  const aId = A.createOffer(menuItem('金汤力'), 'user', 'user', 'agent-a', T0);
  const bId = B.createOffer(menuItem('啤酒'), 'user', 'user', 'agent-b', T0 + 1);
  assert.equal(A.offers.get(aId).cup.id, B.offers.get(bId).cup.id, '同名 cup（故意）');
  // A 无法命中 B 的 offer
  assert.equal(A.drinkOffer(bId, 'agent-a', 'x', T0 + 2).ok, false, 'A 不能喝 B 的 offer');
  assert.equal(A.rejectOffer(bId, 'agent-a', T0 + 2).ok, false, 'A 不能拒绝 B 的 offer');
  assert.equal(A.drinkOffer(aId, 'agent-b', 'y', T0 + 2).ok, false, '饮用者身份不符');
  // A 的操作不改变 B
  A.drinkOffer(aId, 'agent-a', 'z', T0 + 2);
  assert.equal(A.state.characterResiduals.length > 0, true, 'A 只写入固定酒性格');
  assert.equal(B.state.c, 0, 'B 的生理状态不被 A 改变');
  assert.equal(B.offers.get(bId).status, 'open', 'B 的 offer 不被 A 触碰');
});

test('ID-4 restore/restart：恢复后继续生成新对象不命中旧资源，不跨 Agent 串写', () => {
  const A1 = engine();
  const firstIds = [];
  for (let i = 0; i < 3; i += 1) {
    const { id } = openAndDrink(A1, i % 2 ? '啤酒' : '金汤力', T0 + i, `rest-${i}`);
    firstIds.push(id);
  }
  const characterCountA1 = A1.state.characterResiduals.length;
  const exported = A1.exportState();
  // 重启：恢复 A 之后继续创建
  const A2 = ProofEngine.restoreState(exported, realPack);
  const newOffer = A2.createOffer(menuItem('金汤力'), 'user', 'user', 'drinker-a', T0 + 10);
  assert.equal(firstIds.includes(newOffer), false, '新 offer 不命中旧资源');
  const r = A2.drinkOffer(newOffer, 'drinker-a', 'after-restart', T0 + 10);
  assert.equal(r.ok, true, '重启后可正常继续喝');
  // 独立 B：与 A 完全无关
  const B = engine();
  assert.equal(A2.state.records.some((x) => x.id && String(x.id).startsWith('drink-')), true, 'A 历史在');
  assert.equal(B.state.records.length, 0, 'B 不受 A 重启影响');
  assert.equal(B.state.c, 0);
  // 恢复后的 A 不因旧对象而串写：尝试用旧 A1 的 offer 在 B 上操作 → not_found
  const someAOffer = A2.offers.keys().next().value;
  assert.equal(B.drinkOffer(someAOffer, 'drinker-a', 'cross', T0 + 20).ok, false, 'B 无法命中 A 的 offer');
  assert.equal(characterCountA1 > 0, true);
});

test('FB fragmentBatches 唯一权威水合：清理死键后契约一致（迁移补齐 id/restoreAt/mode，不重复）', () => {
  const e = engine();
  // 构造真实批次后再导出：确保 hydrate 使用权威实现且不翻倍
  const raw = e.exportState();
  // 制造一段 legacy 批次（缺 id/restoreAt/mode），模拟旧存档
  const legacyBatch = { readable: false, hiddenFrom: T0, end: null };
  raw.fragmentBatches = [legacyBatch];
  const restored = ProofEngine.restoreState(raw, realPack);
  assert.equal(restored.state.fragmentBatches.length, 1, '不重复');
  const batch = restored.state.fragmentBatches[0];
  assert.ok(batch.id, 'id 由权威水合补齐');
  assert.ok(Number(batch.restoreAt) > 0, 'restoreAt 由权威水合补齐');
  assert.ok(batch.mode, 'mode 由权威水合补齐');
  assert.equal(batch.hiddenFrom, T0);
  assert.equal(batch.readable, false);
  assert.equal(batch.end, null);
  // 往返一致：再导出→再恢复，batch 数不变、字段不漂移
  const round2 = ProofEngine.restoreState(restored.exportState(), realPack);
  assert.equal(round2.state.fragmentBatches.length, 1);
  assert.equal(round2.state.fragmentBatches[0].id, batch.id);
  assert.equal(round2.state.fragmentBatches[0].restoreAt, batch.restoreAt);
});
