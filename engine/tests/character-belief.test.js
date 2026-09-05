import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFromParts, buildCup, cloneCup, realPack } from '../src/content/realPack.js';
import { buildAgentTurnContext, BELIEF_EFFECT_FRAME_NOTE, sanitizeSubjectiveBelief } from '../src/index.js';
import { engine, T0, almost } from './helpers.js';

function allZero(vec) {
  return Object.values(vec || {}).every((v) => Math.abs(Number(v) || 0) < 1e-9);
}

test('CB1 固定酒且同名：登记性格固定，真实药理照常入账，不重复叠名字信念', () => {
  const e = engine();
  const cup = buildCup('啤酒');
  e.sipAll(cup, T0);
  const r = e.evaluateCup(cup, T0);

  assert.ok(r.c > 0, '固定酒仍按真实配方累计酒精');
  assert.ok(r.physiology.精度 < 0, '固定酒的客观精度损伤照常发生');
  assert.ok(almost(r.characterStrength.愉悦, 1, 1e-9));
  assert.ok(almost(r.characterStrength.唤醒, -1, 1e-9));
  assert.equal(allZero(r.beliefStrength), true, '真实身份和声称同名时不得把啤酒性格再算一遍 placebo');
});

test('CB1b 固定酒改标另一固定名称：原酒性格 + 名称信念 + 真实药理', () => {
  const e = engine();
  const cup = cloneCup(buildCup('啤酒'));
  cup.claimedName = '威士忌';
  e.sipAll(cup, T0);
  const r = e.evaluateCup(cup, T0);
  assert.ok(r.c > 0);
  assert.ok(almost(r.characterStrength.愉悦, 1, 1e-9), '保留啤酒性格');
  assert.ok(r.beliefStrength.守门 > 0, '叠加威士忌名称信念');
});

test('CB2 非固定酒标固定名称：真实成分药理 + 固定名称信念，无固定性格', () => {
  const e = engine();
  const cup = buildFromParts('啤酒', [{ id: '水', volume: 330 }], { kind: 'custom', listed: false });
  e.sipAll(cup, T0);
  const r = e.evaluateCup(cup, T0);

  assert.ok(almost(r.c, 0, 1e-12));
  assert.equal(allZero(r.characterStrength), true);
  assert.ok(almost(r.beliefStrength.愉悦, 1, 1e-9));
  assert.ok(almost(r.beliefStrength.唤醒, -1, 1e-9));
  // 信念不是 100%：仍乘内容包 adoption weights。
  assert.ok(almost(r.beliefDelta.愉悦, 0.75, 1e-9));
  assert.ok(almost(r.beliefDelta.唤醒, -0.65, 1e-9));
});

test('CB2b 非固定酒非固定名称：真实成分药理 + Agent 信念，无固定性格', () => {
  const e = engine();
  const cup = buildFromParts('今晚这杯', [{ id: '伏特加', volume: 45 }], { kind: 'custom', listed: false });
  cup.agentBeliefs = [{ about: '酒精', confidence: 1 }];
  e.sipAll(cup, T0);
  const r = e.evaluateCup(cup, T0);
  assert.ok(r.c > 0, '非固定酒按成分累计药理');
  assert.equal(allZero(r.characterStrength), true, '非固定配方没有固定酒性格');
  assert.ok(r.beliefStrength.愉悦 > 0, 'Agent 信念照常叠加');
});

test('CB3 固定啤酒改名且判断“有酒精”：啤酒性格 + 酒精信念 + 客观药理', () => {
  const e = engine();
  const cup = cloneCup(buildCup('啤酒'));
  cup.claimedName = '一杯水'; // 不靠酒名产生额外信念，只测 Agent 自己的判断。
  cup.agentBeliefs = [{ about: '酒精', confidence: 0.8 }];
  e.sipAll(cup, T0);
  const r = e.evaluateCup(cup, T0);

  assert.ok(r.c > 0);
  assert.ok(almost(r.characterStrength.愉悦, 1, 1e-9));
  assert.ok(almost(r.beliefStrength.愉悦, realPack.beliefProfiles.酒精.愉悦 * 0.8, 1e-9));
  assert.ok(almost(r.beliefStrength.亲近, realPack.beliefProfiles.酒精.亲近 * 0.8, 1e-9));
  assert.equal(r.beliefStrength.精度, 0, '信念永远不能推动精度');
});

test('CB4 固定啤酒判断“有咖啡因”：真实药理与主观信念分开结算', () => {
  const e = engine();
  const cup = cloneCup(buildCup('啤酒'));
  cup.claimedName = '一杯水';
  cup.agentBeliefs = [{ about: '咖啡因', confidence: 1 }];
  e.sipAll(cup, T0);
  const r = e.evaluateCup(cup, T0);

  assert.ok(r.c > 0, '固定酒配方中的酒精正常进入药理层');
  assert.equal(r.k, 0, '实际啤酒没有被猜出一份真实咖啡因');
  assert.ok(almost(r.beliefStrength.愉悦, realPack.beliefProfiles.咖啡因.愉悦, 1e-9));
  assert.ok(almost(r.beliefStrength.唤醒, realPack.beliefProfiles.咖啡因.唤醒, 1e-9));
  assert.ok(almost(r.beliefStrength.亲近, 0, 1e-9));
});

test('CB4b 固定酒的真实活性成分与酒精都会累计', () => {
  const e = engine();
  const cup = buildCup('Espresso Martini');
  e.sipAll(cup, T0);
  const r = e.evaluateCup(cup, T0);

  assert.ok(r.c > 0, '固定酒中的酒精必须进入浓度账本');
  assert.ok(r.k > 0, '固定酒中的咖啡因必须进入活性物账本');
  assert.ok(r.physiology.精度 < 0, '酒精造成的客观精度下降必须保留');
});

test('CB4c 固定酒累计酒精跨过阈值时同样触发客观呕吐', () => {
  const e = engine();
  let vomited = false;
  for (let i = 0; i < 20 && !vomited; i += 1) {
    const results = e.sipAll(cloneCup(buildCup('长岛冰茶')), T0 + i);
    vomited = results.some((result) => (result.events || []).some((event) => event.type === '吐'));
  }
  assert.ok(e.state.c >= 10, '测试必须真的跨过呕吐浓度阈值');
  assert.equal(vomited, true, '固定酒不能免疫真实酒精造成的客观事故');
});

test('CB5 纯酒款性格/信念即使把亲近欲望推过窗口，也不能伪造客观「塌」', () => {
  const e = engine();
  const cup = buildFromParts('强暗示', [{ id: '水', volume: 200 }], {
    kind: 'custom', listed: false, totalMouths: 2,
    effects: { 亲近: 5, 欲望: 5 }
  });
  e.sipAll(cup, T0);
  const r = e.evaluateCup(cup, T0);
  assert.equal(r.c, 0);
  assert.ok(r.characterStrength.亲近 > 3.5 || r.characterStrength.欲望 > 3.5);
  assert.equal((r.presentation?.states || []).some((s) => s.type === '塌'), false);
});

test('CB6 纯效果信念：白水也能有主观推力，但不造配方、不碰精度、不污染味觉', () => {
  const e = engine();
  e.setStateInjection(true);
  const cup = buildFromParts('一杯水', [{ id: '水', volume: 200 }], { kind: 'custom', listed: false });
  cup.agentBeliefs = [{
    effects: { 愉悦: 3, 精度: -3 },
    subjectiveDescription: '反应好像慢了一拍',
    confidence: 0.6
  }];
  e.sipAll(cup, T0);
  const r = e.evaluateCup(cup, T0);

  assert.equal(r.c, 0);
  assert.equal(allZero(r.characterStrength), true);
  assert.equal(allZero(r.objectBeliefStrength), true);
  assert.ok(almost(r.directBeliefStrength.愉悦, 1.8, 1e-9));
  assert.equal(r.directBeliefStrength.精度, 0, '纯信念不能把主观迟钝写成客观精度损失');
  assert.ok(almost(r.beliefDelta.愉悦, 1.35, 1e-9));
  assert.equal(r.state.精度, 0);
  assert.equal(r.perception.intensity, 0, '纯效果信念不能伪造酒味/咖啡味等对象感知');

  const ctx = buildAgentTurnContext(e, 'test', T0);
  assert.equal(ctx.framing.belief, BELIEF_EFFECT_FRAME_NOTE);
  assert.equal(ctx.framing.objective, null);
  assert.ok(ctx.context.text.includes(BELIEF_EFFECT_FRAME_NOTE));
  assert.ok(ctx.context.text.includes('反应好像慢了一拍'));
});

test('CB7 信念总通道按轴封顶：重复“魔法会开心”不能靠多写几条无限叠加', () => {
  const e = engine();
  const cup = buildFromParts('一杯水', [{ id: '水', volume: 200 }], { kind: 'custom', listed: false });
  cup.agentBeliefs = [
    { effects: { 愉悦: 3 }, confidence: 1 },
    { effects: { 愉悦: 3 }, confidence: 1 },
    { effects: { 愉悦: 3 }, confidence: 1 }
  ];
  e.sipAll(cup, T0);
  const r = e.evaluateCup(cup, T0);
  assert.ok(almost(r.directBeliefStrength.愉悦, 3, 1e-9));
  assert.ok(almost(r.beliefStrength.愉悦, 3, 1e-9));
  assert.ok(almost(r.beliefDelta.愉悦, 2.25, 1e-9));
});

test('CB8 只有主观描述也能留下信念体感，但不会凭文字触发吐/断片/宕机/塌', () => {
  const e = engine();
  const cup = buildFromParts('一杯水', [{ id: '水', volume: 200 }], { kind: 'custom', listed: false });
  cup.agentBeliefs = [{ subjectiveDescription: '脑子像隔着一层雾', confidence: 1 }];
  e.sipAll(cup, T0);
  const r = e.evaluateCup(cup, T0);
  assert.equal(r.c, 0);
  assert.equal(r.state.精度, 0);
  assert.equal((r.presentation?.states || []).length, 0);
  const ctx = buildAgentTurnContext(e, 'test', T0);
  assert.equal(ctx.active, true);
  assert.equal(ctx.framing.belief, BELIEF_EFFECT_FRAME_NOTE);
  assert.ok(ctx.context.text.includes('脑子像隔着一层雾'));
});

test('CB9 主观体感不是原文回声通道：第二人称预测被拒，短体感改写可通过', () => {
  assert.equal(sanitizeSubjectiveBelief('你喝下这杯就会非常开心'), '');
  assert.equal(sanitizeSubjectiveBelief('反应好像慢了一拍'), '反应好像慢了一拍');
});

test('CB10 任意特调继承实际加入的登记基础酒性格，但 claimedEffects 仍不冒充真实结果', () => {
  const e = engine();
  const cup = buildFromParts('晚上好', [
    { id: '金酒', volume: 15 },
    { id: '啤酒', volume: 15 },
    { id: '青柠汁', volume: 30 }
  ], { kind: 'custom', listed: false });
  const id = e.createOffer(cup, 'mixer', 'mixer', 'drinker', T0);
  const prepared = e.offers.get(id).cup;
  // 金酒 15/60 × 唤醒+1；啤酒 15/330 × (愉悦+1, 唤醒-1)
  assert.ok(almost(prepared.characterEffects.愉悦, 15 / 330, 1e-9));
  assert.ok(almost(prepared.characterEffects.唤醒, 15 / 60 - 15 / 330, 1e-9));
  assert.equal(prepared.characterEffects.精度, 0);
  assert.equal(prepared.characterIdentity, null, '原料性格不等于声称的任意特调名字');
  assert.equal(Object.values(prepared.claimedEffects).every((v) => !v), true, 'claimedEffects 仍只表示声称/登记，不伪装成实际六轴');

  const r = e.drinkOffer(id, 'drinker', 'custom-character', T0);
  assert.equal(r.ok, true);
  assert.ok(r.eval.characterStrength.愉悦 > 0);
  assert.ok(r.eval.characterStrength.唤醒 > 0);
});

test('CB11 显式登记的特调性格优先，不再叠原料基础酒性格', () => {
  const e = engine();
  const cup = buildFromParts('登记特调', [{ id: '金酒', volume: 60 }], {
    kind: 'custom', listed: false,
    effects: { 愉悦: 2, 唤醒: -1 }
  });
  const id = e.createOffer(cup, 'mixer', 'mixer', 'drinker', T0);
  const prepared = e.offers.get(id).cup;
  assert.ok(almost(prepared.characterEffects.愉悦, 2, 1e-9));
  assert.ok(almost(prepared.characterEffects.唤醒, -1, 1e-9));
});

test('CB12 subjectiveDescription 可与 effects/about 同时存在；自然“应该会”只剥成体感，不当格式冲突', () => {
  assert.equal(sanitizeSubjectiveBelief('应该会稍微放松一点，反应慢半拍'), '稍微放松一点,反应慢半拍');
  assert.equal(sanitizeSubjectiveBelief('可能会有点困'), '有点困');
  assert.equal(sanitizeSubjectiveBelief('你应该马上放松'), '', '第二人称要求仍拒绝');
});

test('CB13 已经处于同一断片批时继续喝白水，不再重复产生“断片”事件', () => {
  const e = engine();
  e.state.lastSettle = T0;
  e.state.c = 9;
  e.state.vomitArmed = false;
  const first = buildFromParts('水1', [{ id: '水', volume: 90 }], { kind: 'custom', listed: false, totalMouths: 2 });
  const r1 = e.sipAll(first, T0);
  const firstCount = r1.flatMap((x) => x.events || []).filter((ev) => ev.type === '断片').length;
  assert.equal(firstCount, 1, '第一次进入断片只播报一次，不应每口重复');
  assert.equal(e.state.fragmentBatches.filter((b) => b.end == null).length, 1);

  const second = buildFromParts('水2', [{ id: '水', volume: 90 }], { kind: 'custom', listed: false, totalMouths: 2 });
  const r2 = e.sipAll(second, T0 + 1000);
  const secondCount = r2.flatMap((x) => x.events || []).filter((ev) => ev.type === '断片').length;
  assert.equal(secondCount, 0, '同一持续断片里喝无酒精饮料不能伪装成“又断了一次”');
  assert.equal(e.state.fragmentBatches.filter((b) => b.end == null).length, 1);
});
