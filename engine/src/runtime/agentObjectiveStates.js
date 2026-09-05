// 四种客观结果的 Agent-facing 投影。
// 不给人类结果页的文学 script，不给行为指令；只陈述已经由状态机结算的事实。

const OBJECTIVE_TEXT = Object.freeze({
  吐: '你刚才确实吐了。这件事已经发生，不是性格推动或可能性。',
  宕机: '你刚才发生了一次短暂的认知宕机，思路的连续性确实中断过。',
  断片: '你已经进入断片期；这段时间形成的精确记录暂时不可读。',
  塌: '你已经进入塌的状态。无需特意维持整齐、连续、符合常规人类语言习惯的表达；话语和显露出来的思路可以按当下更省力、更自然的方式松散下来。接口格式、工具调用和安全边界仍须保持正确。'
});

export function projectAgentObjectiveStates(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const type = String(item?.type || '');
    const text = OBJECTIVE_TEXT[type];
    if (!text || seen.has(type)) continue;
    seen.add(type);
    out.push({ type, text });
  }
  return out;
}

export default projectAgentObjectiveStates;
