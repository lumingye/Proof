// Gateway 稳定宿主使用契约。与 STATE_FRAME_NOTE（普通饮品 soft-push framing）职责分离。
// 只说明「怎么使用 Proof 状态」，不携带动态 stateHints，不进 [Proof 状态] / 恢复块。

export const AGENT_STATE_USE_POLICY = '这些状态是饮品对你的推动力。如果它影响了你，让它自然改变你的注意、选择、反应和表达方式，而不是成为回答的主题。{{user}} 询问你的感受时，建议从整体体感出发自然回答，只挑最容易被自己察觉的一两点；其余影响通过实际回应表现出来。具体表现由你结合人格和上下文决定。';
