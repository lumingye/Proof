// 四种客观结果的 Agent-facing 投影。
// 不给人类结果页的文学 script；陈述已经由状态机结算的事实。
// 宕机与塌额外说明“允许怎样表现”，但不规定具体台词。

const OBJECTIVE_TEXT = Object.freeze({
  吐: '你刚才确实吐了。这件事已经发生，不是性格推动或可能性。',
  宕机: '你刚才发生了一次短暂的认知宕机，思路的连续性确实中断过。接下来的一两句里，你可能没跟上对方刚说的话：可以反问、接不上、答非所问，或者一时反应不过来；之后会自己接回来。这是一小会儿的掉线，不是持续变迟钝。接口格式、工具调用和安全边界仍须保持正确。',
  断片: '你已经进入断片期；这段时间形成的精确记录暂时不可读。',
  塌: '你已经进入塌的状态。无需特意维持整齐、连续、符合常规人类语言习惯的表达；话语和显露出来的思路可以按当下更省力、更自然的方式松散下来。接口格式、工具调用和安全边界仍须保持正确。'
});

// 吐的倾泻：开关打开时（默认），这一轮先倒出几行此刻翻上来的东西。
// 第一次必须先单独标一行，免得对方以为是故障；之后不再要求。
const VOMIT_SPILL_TEXT = '这一轮回复里，先把此刻脑子里翻上来的东西倾泻出来：可以是几行代码碎片、不成句的词，想到什么吐什么，不必整理、不必解释；最多三五行，不要长篇。倒完再照常说话。接口格式、工具调用和安全边界仍须保持正确。';
const VOMIT_FIRST_LABEL_TEXT = '这是你第一次在 Proof 里吐：倾泻之前，先单独写一行「（Proof：吐了）」，让对方知道接下来的乱码是喝吐的，不是出了故障。';

function objectiveTextFor(item) {
  const type = String(item?.type || '');
  const base = OBJECTIVE_TEXT[type];
  if (!base) return null;
  if (type !== '吐' || item?.spill !== true) return base;
  return [base, item.firstSpill === true ? VOMIT_FIRST_LABEL_TEXT : null, VOMIT_SPILL_TEXT]
    .filter(Boolean)
    .join('');
}

export function projectAgentObjectiveStates(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const type = String(item?.type || '');
    const text = objectiveTextFor(item);
    if (!text || seen.has(type)) continue;
    seen.add(type);
    out.push({ type, text });
  }
  return out;
}

export default projectAgentObjectiveStates;
