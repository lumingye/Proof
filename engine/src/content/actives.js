// ─────────────────────────────────────────────────────────────
// 化合物注册表 —— 非酒精活性成分的唯一数据源。
// core/active.js 只做通用结算，不认识任何具体化合物。
//
// 依据分级（逐条如实标注，不许混）：
//   A = 药理/法规换算，数值有出处
//   B = 含量有出处，效果量级与动力学凭感觉
//   C = 纯凭感觉（口感 / 文化印象）
//
// 设计与数值来自外包设计稿 v3.2（承接方），审查与缝合由执行方完成。
// ─────────────────────────────────────────────────────────────

// 轴白名单：本期只开生理两轴，与 SPEC「精度与反应三轴不对非酒精成分开放」一致。
// 将来开放任何新轴 = 改这一行 + 一条 SPEC 补丁 + 过审。
export const ACTIVE_AXIS_WHITELIST = ['愉悦', '唤醒'];
const REACTION_AXES = ['亲近', '守门', '欲望'];

// 咖啡因曲线：与 core/active.js 的 caffeineToPhysiology 逐字等价。
// **内部自带封顶（现状如此），通用层再 min 一次是幂等的，不得剥除。**
// content 不得反向 import core（会成环），所以在这里内联；
// tests/actives.test.js 有一条断言逐点比对两者，防止将来漂移。
const CAFFEINE_CAP_INLINE = 4;
const MAX_STATE_INLINE = 5;
const MIN_STATE_INLINE = -5;

function clampInline(v) {
  return Math.max(MIN_STATE_INLINE, Math.min(MAX_STATE_INLINE, v));
}

function curveCaffeine(k) {
  const khat = Math.min(k, CAFFEINE_CAP_INLINE);
  let arousal;
  let pleasure;
  if (khat <= 2) {
    arousal = 1.2 * khat;
    pleasure = 0.5 * khat;
  } else {
    arousal = 2.4;
    pleasure = 1.0 - 0.6 * (khat - 2);
  }
  return { 愉悦: clampInline(pleasure), 唤醒: clampInline(arousal) };
}

export const ACTIVE_DEFS = {
  咖啡因: {
    reference: true, // 闸③⑥ 的基准化合物；校验强制全表恰好一个
    halfLifeH: 5,
    cap: 4,
    zero: 0.05,
    axes: ['愉悦', '唤醒'],
    curve: curveCaffeine
    // 依据 A：浓缩 ≈60–76mg/30ml；人类平均半衰期 ≈5h。
    // **数值与曲线有既有测试钉住，一个字不许动。**
  },

  奎宁: {
    halfLifeH: 1.5,
    cap: 2,
    zero: 0.1,
    axes: ['唤醒'],
    curve: (k) => ({ 唤醒: 0.06 * k })
    // 依据 B：含量有出处（EU 上限 100mg/L、市售 ≈80mg/L），一杯实际摄入
    // ≈8–12mg，远低于药理剂量。真实半衰期 11–16h **故意不用**——
    // 效果本质是味觉唤醒，按感官持续 ≈1.5h 定。效果量级与半衰期凭感觉。
  },

  糖分: {
    halfLifeH: 0.75,
    cap: 3,
    zero: 0.05,
    axes: ['愉悦'],
    curve: (k) => ({ 愉悦: 0.08 * k })
    // 依据 C：10g/份是营养学惯用约定（换算基准可查），
    // 效果量级与回落时间全凭感觉。
  },

  苦味: {
    halfLifeH: 2,
    cap: 2,
    zero: 0.05,
    axes: ['愉悦'],
    curve: (k) => ({ 愉悦: -0.08 * k }),
    phase2: { axis: '守门', slope: 0.05 }
    // 依据 C：纯口感，未习惯者不悦。
    // phase2 是二期候选预埋：**求值器不读 phase2**，白名单不开守门即永不生效。
  },

  果酸: {
    halfLifeH: 0.5,
    cap: 2,
    zero: 0.05,
    axes: ['唤醒'],
    curve: (k) => ({ 唤醒: 0.05 * k })
    // 依据 C：酸度可查（青柠 5–7%），「酸=提神」纯感官印象。
  },

  单宁: {
    halfLifeH: 1,
    cap: 2,
    zero: 0.05,
    axes: ['唤醒'],
    curve: (k) => ({ 唤醒: 0.04 * k })
    // 依据 C：收敛感给微弱唤醒；白藜芦醇等在饮用剂量下无可靠精神效果。
  },

  啤酒花: {
    halfLifeH: 1,
    cap: 2,
    zero: 0.05,
    axes: ['唤醒'],
    curve: (k) => ({ 唤醒: -0.03 * k })
    // 依据 C：镇静 reputation 是文化印象，膳食剂量下无可靠药理支持，刻意给小。
  },

  侧柏酮: {
    halfLifeH: 8,
    cap: 2,
    zero: 0.02,
    axes: ['唤醒'],
    curve: (k) => ({ 唤醒: 0.03 * k })
    // 依据 B（含量）/ C（效果）：含量按 EU 上限 35mg/kg 估算；
    // 真实饮用剂量下精神效果无可靠文献支持（「苦艾致幻」是文化神话），
    // 数值极小＝刻意表达「接近没有」。
  }
};

// 原料声明归一化：新旧两种格式都认。
// 返回 [{ compound, amount, referenceVolumeMl }]，未注册的化合物直接丢弃。
export function normalizeIngredientActives(ing) {
  if (!ing || typeof ing !== 'object') return [];
  if (Array.isArray(ing.actives)) {
    return ing.actives
      .filter((d) => d && ACTIVE_DEFS[d.compound])
      .map((d) => ({
        compound: d.compound,
        amount: d.amount,
        referenceVolumeMl: d.referenceVolumeMl
      }));
  }
  if (ing.activeIngredient && ACTIVE_DEFS[ing.activeIngredient]) {
    // 旧三字段格式（外部内容包兼容）
    return [{
      compound: ing.activeIngredient,
      amount: ing.activeAmount,
      referenceVolumeMl: ing.referenceVolumeMl
    }];
  }
  return [];
}

// 峰值：对 curve 在 k ∈ [0, cap] 采样取最大绝对值。
// 不手工填数——咖啡因的愉悦曲线先升后降，手填迟早填错。
export function compoundPeak(name, axis, defs = ACTIVE_DEFS, steps = 400) {
  const def = defs[name];
  if (!def || !def.axes.includes(axis)) return 0;
  let peak = 0;
  for (let i = 0; i <= steps; i += 1) {
    const k = (def.cap * i) / steps;
    const v = Math.abs(Number(def.curve(k)[axis] || 0));
    if (v > peak) peak = v;
  }
  return peak;
}

// 六道闸的加载期校验。任何一条不过直接抛错，不静默放行。
export function validateActiveDefs(defs = ACTIVE_DEFS) {
  const names = Object.keys(defs);

  // 闸⑤ 的基础：必须恰好一个基准化合物
  const refs = names.filter((n) => defs[n].reference === true);
  if (refs.length !== 1) {
    throw new Error(`活性成分注册表必须恰好有一个基准化合物，实际 ${refs.length} 个`);
  }
  const ref = refs[0];

  for (const name of names) {
    const def = defs[name];
    if (!Array.isArray(def.axes) || def.axes.length === 0) {
      throw new Error(`化合物 ${name} 未声明 axes`);
    }
    // 闸① 默认拒绝：不在白名单内的轴，声明即抛错
    for (const axis of def.axes) {
      if (!ACTIVE_AXIS_WHITELIST.includes(axis)) {
        throw new Error(`化合物 ${name} 声明了白名单外的轴：${axis}`);
      }
    }
    // 闸② 轴数上限：至多 2 条，其中反应层至多 1 条
    if (def.axes.length > 2) {
      throw new Error(`化合物 ${name} 的轴数超过 2：${def.axes.join('/')}`);
    }
    if (def.axes.filter((a) => REACTION_AXES.includes(a)).length > 1) {
      throw new Error(`化合物 ${name} 的反应层轴数超过 1`);
    }
    if (!(def.halfLifeH > 0)) throw new Error(`化合物 ${name} 的 halfLifeH 必须为正`);
    if (!(def.cap > 0)) throw new Error(`化合物 ${name} 的 cap 必须为正`);
    if (!(def.zero > 0)) throw new Error(`化合物 ${name} 的 zero 必须为正`);
  }

  // 闸③ 单峰预算 + 闸⑥ 轴级合计预算（正负方向分开算）
  for (const axis of ACTIVE_AXIS_WHITELIST) {
    const base = compoundPeak(ref, axis, defs);
    if (!base) continue;
    const budget = base * 0.5;
    let pos = 0;
    let neg = 0;
    for (const name of names) {
      if (name === ref) continue;
      const def = defs[name];
      if (!def.axes.includes(axis)) continue;
      const peak = compoundPeak(name, axis, defs);
      // 方向按 cap 处的取值判断
      const at = Number(def.curve(def.cap)[axis] || 0);
      if (peak > budget) {
        throw new Error(`化合物 ${name} 在 ${axis} 轴的峰值 ${peak.toFixed(3)} 超过基准的一半 ${budget.toFixed(3)}`);
      }
      if (at >= 0) pos += peak; else neg += peak;
    }
    if (pos > budget) {
      throw new Error(`${axis} 轴正向合计峰值 ${pos.toFixed(3)} 超过预算 ${budget.toFixed(3)}`);
    }
    if (neg > budget) {
      throw new Error(`${axis} 轴负向合计峰值 ${neg.toFixed(3)} 超过预算 ${budget.toFixed(3)}`);
    }
  }
  return true;
}
