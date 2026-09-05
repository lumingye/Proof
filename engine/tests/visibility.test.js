import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, whiskey, customPotion, T0 } from './helpers.js';
import { hiddenHeaven, menuItem, cloneCup } from '../src/content/realPack.js';

const MIXER = 'mixer';
const DRINKER = 'drinker';
const GIVER = 'giver';
const OTHER = 'other';

test('V1 特调饮用前，调制者只见配方、不见效果描述', () => {
  const e = engine();
  const cup = customPotion(1, 2);
  cup.mixerId = MIXER;
  cup.drinkerId = DRINKER;
  const id = e.createOffer(cup, MIXER, MIXER, DRINKER, T0);
  const view = e.viewOffer(id, MIXER, T0);
  assert.equal(view.ok, true);
  assert.ok('recipe' in view.projection);
  assert.ok(!('effects' in view.projection));
  assert.ok('claimedEffects' in view.projection);
  assert.ok(!('description' in view.projection));
  assert.ok(!('flavor' in view.projection));
  assert.ok(!('actualEffectDescription' in view.projection));
});

test('V2 特调饮用前，饮用者不见配方', () => {
  const e = engine();
  const cup = customPotion(1, 2);
  const id = e.createOffer(cup, MIXER, MIXER, DRINKER, T0);
  const view = e.viewOffer(id, DRINKER, T0);
  assert.ok(!('recipe' in view.projection));
  assert.ok(!('effects' in view.projection));
  // 饮用方喝前不给声称效果；调制者仍看得到
  assert.ok(!('claimedEffects' in view.projection));
  assert.ok('claimedEffects' in e.viewOffer(id, MIXER, T0).projection);
  assert.ok(!('physiology' in view.projection));
  assert.equal(view.projection.claimedName, '迷情剂');
  assert.ok('cupType' in view.projection);
  assert.ok('color' in view.projection);
});

test('V3 喝完后双方都见描述，但饮用者仍不见配方', () => {
  const e = engine();
  const cup = customPotion(1, 2);
  const id = e.createOffer(cup, MIXER, MIXER, DRINKER, T0);
  e.drinkOffer(id, DRINKER, 'req-1', T0);
  const drinker = e.viewOffer(id, DRINKER, T0).projection;
  const mixer = e.viewOffer(id, MIXER, T0).projection;
  assert.ok('description' in drinker || 'finish' in drinker);
  assert.ok('description' in mixer || 'finish' in mixer);
  assert.ok(!('recipe' in drinker));
  assert.ok('recipe' in mixer);
});

test('V4 亮底只向被指定对象开放配方', () => {
  const e = engine();
  const cup = customPotion(1, 2);
  const id = e.createOffer(cup, MIXER, MIXER, DRINKER, T0);
  e.revealRecipe(id, OTHER, MIXER);
  const other = e.viewOffer(id, OTHER, T0).projection;
  const drinker = e.viewOffer(id, DRINKER, T0).projection;
  assert.ok('recipe' in other);
  assert.ok(!('recipe' in drinker));
});

test('V5 非调制递酒者无配方权限', () => {
  const e = engine();
  const cup = customPotion(1, 2);
  const id = e.createOffer(cup, MIXER, GIVER, DRINKER, T0);
  const giver = e.viewOffer(id, GIVER, T0).projection;
  assert.ok(!('recipe' in giver));
  const mixer = e.viewOffer(id, MIXER, T0).projection;
  assert.ok('recipe' in mixer);
});

test('V6 固定菜单与未公开项分别走正确例外', () => {
  const e = engine();
  const listed = cloneCup(menuItem('威士忌'));
  listed.kind = 'menu';
  const idMenu = e.createOffer(listed, MIXER, MIXER, DRINKER, T0);
  const drinkerMenu = e.viewOffer(idMenu, DRINKER, T0).projection;
  assert.equal(drinkerMenu.claimedName, '威士忌');
  // 菜单酒也一样：饮用方喝前四字段
  assert.ok(!('claimedEffects' in drinkerMenu));
  assert.ok('claimedEffects' in e.viewOffer(idMenu, MIXER, T0).projection);
  assert.ok(!('effects' in drinkerMenu));
  assert.ok(!('recipe' in drinkerMenu));

  const publicNames = e.publicMenu().map((m) => m.claimedName);
  assert.ok(publicNames.includes('威士忌'));
  assert.ok(!publicNames.includes('heaven'));

  const hidden = cloneCup(hiddenHeaven);
  const idH = e.createOffer(hidden, MIXER, MIXER, DRINKER, T0);
  const mixerH = e.viewOffer(idH, MIXER, T0).projection;
  const drinkerH = e.viewOffer(idH, DRINKER, T0).projection;
  assert.ok('description' in mixerH);
  assert.ok(!('description' in drinkerH));
  assert.ok(!publicNames.includes('heaven'));
});
