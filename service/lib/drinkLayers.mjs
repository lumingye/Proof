// 给 Agent 的「看起来什么样」：跟调酒台前端同一套渲染规则（ui/drink-visuals.js）。
// 摇过 / 搅过 → 一层混合色；直接倒 → 按密度从下到上分层。
// 颜色给一个大概的中文色名，附色号；浑浊度给三档。
import { visualFor } from '../../ui/drink-visuals.js';

const CLEAR_BASE = [0xe8, 0xdf, 0xc8];

function hexToRgb(hex) {
  const n = parseInt(String(hex || '').replace('#', ''), 16);
  if (!Number.isFinite(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]) {
  const R = r / 255; const G = g / 255; const B = b / 255;
  const max = Math.max(R, G, B); const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0));
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [h * 60, s, l];
}

export function colorName(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '说不清的颜色';
  const dist = Math.hypot(rgb[0] - CLEAR_BASE[0], rgb[1] - CLEAR_BASE[1], rgb[2] - CLEAR_BASE[2]);
  if (dist < 14) return '近乎无色';
  const [h, s, l] = rgbToHsl(rgb);
  if (l < 0.12) return '近黑';
  const hueName = (deg) => {
    if (deg < 10 || deg >= 345) return '红';
    if (deg < 22) return '橙红';
    if (deg < 40) return '橙';
    if (deg < 62) return '黄';
    if (deg < 95) return '黄绿';
    if (deg < 160) return '绿';
    if (deg < 195) return '青';
    if (deg < 250) return '蓝';
    if (deg < 290) return '紫';
    return '紫红';
  };
  if (s < 0.15) {
    if (l > 0.75) return '乳白';
    const tint = s >= 0.06 ? hueName(h) : '';
    return l < 0.35 ? `深灰${tint || '褐'}` : `灰${tint || '白'}`;
  }
  if (l > 0.88) return '乳白';
  let base = hueName(h);
  // 酒吧里常见的那几种，换成更像人会说的词
  if ((base === '橙' || base === '橙红') && l < 0.3) base = '棕';
  else if (base === '橙' && l < 0.5) base = '琥珀';
  else if ((base === '橙' || base === '黄') && l > 0.75) base = '米黄';
  else if (base === '橙红' && l < 0.48 && h >= 18) base = '琥珀';
  else if (base === '黄' && l < 0.6 && s > 0.5) base = '金黄';
  const prefix = l < 0.32 && base !== '棕' ? '深' : l > 0.8 && base !== '米黄' ? '浅' : '';
  return `${prefix}${base}`;
}

function clarity(turbidity) {
  const t = Number(turbidity) || 0;
  if (t >= 0.45) return '浑';
  if (t >= 0.15) return '微浑';
  return '清';
}

// 返回 { mixed, layers: [{ color, hex, ml, clarity }] }，layers 从下到上。无配方时返回 null。
export function drinkLayersFor(cup) {
  const parts = (cup?.recipe || []).map((p) => ({ id: p.id, volume: Number(p.volume) || 0 }));
  if (!parts.length) return null;
  const method = cup.method === 'shake' || cup.method === 'stir' ? cup.method : '';
  const visual = visualFor(parts, method);
  if (!visual?.layers?.length) return null;
  const layers = visual.layers.map((layer) => ({
    color: colorName(layer.color),
    hex: layer.color,
    ml: Math.round(Number(layer.ml) || 0),
    clarity: clarity(layer.turbidity)
  }));
  const describe = (layer) => `${layer.color}（${layer.hex}）约 ${layer.ml}ml，${layer.clarity}`;
  const text = layers.length === 1
    ? `一整杯${visual.mixed ? '混匀的' : ''}${describe(layers[0])}`
    : `从下到上：${layers.map(describe).join(' / ')}`;
  return { mixed: !!visual.mixed, layers, text };
}
