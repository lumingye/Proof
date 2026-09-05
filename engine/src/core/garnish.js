// 装饰物（garnish）。
//
// **garnish 不是原料。** 它不进入 sources、不计入 totalVolume，
// 不参与味道、标准杯、ABV、离散度与 Heaven 资格判定。
//
// 之所以单独立一个词表而不是复用原料表：原料表里的每一项都是「入杯并被喝掉」的东西，
// 客户端如果能把原料标成装饰，就等于拿到了绕开资格判定的开关。
// **可作为装饰的对象由这里的允许列表约束，客户端说了不算。**

export const GARNISHES = Object.freeze([
  '柠檬皮',
  '青柠角',
  '橙皮卷',
  '樱桃',
  '橄榄',
  '薄荷叶',
  '盐口',
  '糖口',
  '杯签'
]);

const ALLOWED = new Set(GARNISHES);

export function isGarnish(name) {
  return ALLOWED.has(String(name ?? '').trim());
}

// 返回去重后的合法装饰列表；遇到不在允许列表里的直接抛错，不静默丢弃。
export function normalizeGarnishes(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error('invalid_garnish');
  const out = [];
  for (const raw of list) {
    const name = String(typeof raw === 'string' ? raw : raw?.id ?? '').trim();
    if (!isGarnish(name)) throw new Error('invalid_garnish');
    if (!out.includes(name)) out.push(name);
  }
  if (out.length > 4) throw new Error('too_many_garnishes');
  return out;
}
