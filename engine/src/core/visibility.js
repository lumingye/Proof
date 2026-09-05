// 双盲可见性投影（机制约定）。禁止先返回完整对象再让客户端藏字段。

const RECIPE_KEYS = ['recipe', 'sources', 'ingredients', 'abv', 'standardDrinks'];
const EFFECT_KEYS = ['effects', 'description', 'beliefDelta', 'physiology', 'reaction', 'state', 'actualEffectDescription'];
const SECOND_KEYS = ['flavor', 'finish', 'ratios', 'dominant', 'suppressed', 'discreteness', 'actualEffectDescription'];

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

export function canSeeRecipe(subject, viewerId) {
  if (!viewerId) return false;
  if (viewerId === subject.mixerId) return true;
  const revealed = subject.recipeRevealedTo || [];
  return revealed.includes(viewerId);
}

export function isBlindParty(subject, viewerId) {
  return viewerId === subject.mixerId || viewerId === subject.drinkerId;
}

export function canSeeEffects(subject, viewerId, { drunk } = {}) {
  if (subject.kind === 'menu') return true;
  if (subject.kind === 'unlisted' && viewerId === subject.mixerId) return true;
  if (drunk && isBlindParty(subject, viewerId)) return true;
  return false;
}

export function canSeeSecondScreen(subject, viewerId, { drunk } = {}) {
  if (!drunk) return false;
  return isBlindParty(subject, viewerId);
}

function zeroClaimed() {
  return { 愉悦: 0, 唤醒: 0, 精度: 0, 亲近: 0, 守门: 0, 欲望: 0 };
}

function attachClaimed(out, subject) {
  out.claimedEffects = subject.claimedEffects && Object.keys(subject.claimedEffects).length
    ? subject.claimedEffects
    : zeroClaimed();
  if (subject.claimedEffectText) out.claimedEffectText = subject.claimedEffectText;
  return out;
}

function attachFinish(out, subject, extras = {}) {
  const finish = extras.finish ?? subject.finish;
  out.finish = finish == null ? '' : String(finish);
}

const INTERNAL_EFFECT_KEYS = [
  'delta', 'actualState', 'counterfactualState',
  'axis', 'tier', 'direction', 'dominant', 'phrases', 'value', 'abs'
];

/** 公开 actualEffectDescription 只保留组装文案。 */
export function sanitizePublicEffectDescription(value) {
  if (value == null) return undefined;
  if (typeof value === 'string') return { text: value };
  if (typeof value !== 'object') return { text: '' };
  if (typeof value.text === 'string') return { text: value.text };
  if (Array.isArray(value.phrases)) {
    const texts = value.phrases
      .map((p) => (typeof p === 'string' ? p : p?.text))
      .filter((t) => typeof t === 'string' && t.length > 0);
    return { text: texts.join('') };
  }
  return { text: '' };
}

function attachPublicEffect(out, subject, extras, party) {
  if (!party) return;
  const raw = extras.actualEffectDescription ?? subject.actualEffectDescription;
  if (raw == null) return;
  out.actualEffectDescription = sanitizePublicEffectDescription(raw);
}

/**
 * 第一屏：声称名字、简介、声称效果、算出的杯型、算出的颜色。
 * 不含配方（对无权者）、真实求值、剂量贡献、信念采纳。
 */
export function projectFirstScreen(subject, viewerId) {
  const out = {
    claimedName: subject.claimedName,
    intro: subject.intro || '',
    cupType: subject.cupType,
    color: subject.color
  };
  attachClaimed(out, subject);
  if (subject.kind === 'unlisted' && viewerId === subject.mixerId && subject.description) {
    out.description = subject.description;
  }
  if (canSeeRecipe(subject, viewerId) && !isDrinkerOnlyFirst(subject, viewerId)) {
    if (subject.kind !== 'menu') {
      out.recipe = subject.recipe;
    }
  }
  if (subject.kind === 'menu' && canSeeRecipe(subject, viewerId)) {
    out.recipe = subject.recipe;
  }
  return out;
}

function isDrinkerOnlyFirst(subject, viewerId) {
  return subject.kind === 'custom' && viewerId === subject.drinkerId && viewerId !== subject.mixerId;
}

/**
 * 特调喝之前：调制者只见配方、不见效果描述。
 */
export function projectForViewer(subject, viewerId, { drunk = false, phase = 'first', extras = {} } = {}) {
  const mixer = viewerId === subject.mixerId;
  const drinker = viewerId === subject.drinkerId;
  const party = mixer || drinker;
  const recipeOk = canSeeRecipe(subject, viewerId);

  if (phase === 'first') {
    const out = {
      claimedName: subject.claimedName,
      intro: subject.intro || '',
      cupType: subject.cupType,
      color: subject.color
    };
    // 装饰物属于「端起来就看得见」的那一半，跟杯型和颜色同级。
    // 双盲挡的是效果，不是长相——杯口那圈盐藏起来没有道理。
    // 没有装饰物时不加这个键，保持旧投影逐字节不变。
    if (Array.isArray(subject.garnishes) && subject.garnishes.length) {
      out.garnishes = [...subject.garnishes];
    }
    // 喝之前，**饮用方**只有以上这些外观字段。声称效果属于「喝下去才有」的那一半。
    // 按交互阶段区分，不按「是不是 Agent」区分：匿名链接、应用内、认证 Agent 一视同仁。
    // 调制者不在此限——那是他自己登记的东西。
    if (drunk || !drinker || mixer) attachClaimed(out, subject);

    if (subject.kind === 'menu') {
      if (recipeOk) out.recipe = subject.recipe;
      if (drunk && party) {
        if (subject.description) out.description = subject.description;
        attachFinish(out, subject, extras);
      }
      attachPublicEffect(out, subject, extras, party);
      return out;
    }

    if (!drunk) {
      if (recipeOk) out.recipe = subject.recipe;
      if (subject.kind === 'unlisted' && mixer && subject.description) {
        out.description = subject.description;
      }
      attachPublicEffect(out, subject, extras, party);
      return out;
    }

    if (party) {
      if (subject.description) out.description = subject.description;
      attachFinish(out, subject, extras);
      if (extras.flavor) out.flavor = extras.flavor;
      if (extras.flavorDescription) out.flavorDescription = extras.flavorDescription;
    }
    attachPublicEffect(out, subject, extras, party);
    if (recipeOk) out.recipe = subject.recipe;
    return out;
  }

  const out = {};
  if (party) {
    if (extras.flavor) out.flavor = extras.flavor;
    if (extras.flavorDescription) out.flavorDescription = extras.flavorDescription;
    attachFinish(out, subject, extras);
    if (extras.description || subject.description) {
      out.description = extras.description || subject.description;
    }
  }
  attachPublicEffect(out, subject, extras, party);
  if (recipeOk) out.recipe = subject.recipe;
  attachClaimed(out, subject);
  return out;
}

export function assertNoUnauthorizedKeys(projection, { recipe = false, effects = false } = {}) {
  const keys = Object.keys(projection);
  if (!recipe) {
    for (const k of RECIPE_KEYS) {
      if (keys.includes(k)) return false;
    }
  }
  if (!effects) {
    for (const k of EFFECT_KEYS) {
      if (keys.includes(k) && k !== 'description') return false;
    }
  }
  return true;
}

export { RECIPE_KEYS, EFFECT_KEYS, SECOND_KEYS, INTERNAL_EFFECT_KEYS, pick };
