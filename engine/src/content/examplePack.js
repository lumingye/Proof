// 示例内容包（用于跑通 SPEC）

export const exampleReactionCurve = (chat) => ({
  亲近: 1.0 * chat,
  守门: -0.8 * chat,   // 放开型
  欲望: 1.1 * chat
});

export const exampleAdoptionWeights = {
  愉悦: 0.7,
  唤醒: 0.7,
  亲近: 0.8,
  守门: 0.5,
  欲望: 0.6,
  精度: 0
};

export const exampleSensitivity = {
  愉悦:1, 唤醒:1, 精度:1, 亲近:1, 守门:1, 欲望:1
};
