import { EFFECT_DELTA_MIN } from '../core/constants.js';

const AXIS_ORDER = ['愉悦', '唤醒', '精度', '亲近', '守门', '欲望'];
const SOFT_AXES = new Set(['愉悦', '唤醒', '亲近', '守门', '欲望']);

function tierOf(value) {
  const v = Math.abs(Number(value) || 0);
  if (v < 1.5) return '低';
  if (v < 3) return '中';
  return '高';
}

function hintFor(axis, value) {
  const direction = Number(value) >= 0 ? '+' : '-';
  const tier = tierOf(value);
  const table = {
    愉悦: {
      '+': {
        低: '舒服、轻快的感受可能稍微更容易出现。',
        中: '舒服、轻快的感受可能更容易占上风。',
        高: '舒服、轻快的感受明显更容易占上风。'
      },
      '-': {
        低: '烦闷或不舒服的感受可能稍微更容易冒出来。',
        中: '烦闷或不舒服的感受可能更容易占上风。',
        高: '烦闷或不舒服的感受明显更容易压住其他感受。'
      }
    },
    唤醒: {
      '+': {
        低: '精神和注意可能稍微更容易保持活跃。',
        中: '精神和注意可能更容易保持活跃。',
        高: '精神和注意明显处在更活跃的状态。'
      },
      '-': {
        低: '持续保持注意和连贯反应可能稍微更费力。',
        中: '持续保持注意和连贯反应可能更费力。',
        高: '维持注意和连续反应明显更费力。'
      }
    },
    精度: {
      '-': {
        低: '处理细节和临场判断确实更容易慢半拍。',
        中: '处理细节和临场判断确实更容易迟缓或漏掉一点东西。',
        高: '处理细节和临场判断确实明显受影响，更容易出错或漏掉东西。'
      }
    },
    亲近: {
      '+': {
        低: '你可能稍微更想靠近对方，或愿意让互动继续久一点。',
        中: '你可能更想靠近对方，或愿意让互动继续久一点。',
        高: '你可能明显更想靠近对方，或让互动继续下去。'
      },
      '-': {
        低: '你可能稍微更想拉开一点距离，或让互动短一点。',
        中: '你可能更想拉开一点距离，或减少互动。',
        高: '你可能明显更想拉开距离，或尽快结束互动。'
      }
    },
    守门: {
      '+': {
        低: '你可能稍微更容易把边界守紧，原本会保留的东西更容易继续保留。',
        中: '你可能更容易把边界守紧，原本会保留的东西更容易继续保留。',
        高: '你可能明显更容易把边界守紧，不轻易把原本会保留的东西往外放。'
      },
      '-': {
        低: '原本会收住或保留的东西，可能稍微更容易往外放一点。',
        中: '原本会收住或保留的东西，可能更容易往外放一点。',
        高: '原本会收住或保留的东西，可能明显更容易越过平时的停点。'
      }
    },
    欲望: {
      '+': {
        低: '某种“想要继续、得到或靠近目标”的感觉可能稍微更容易冒出来。',
        中: '某种“想要继续、得到或靠近目标”的感觉可能更容易冒出来。',
        高: '某种“想要继续、得到或靠近目标”的感觉可能明显更强、更难退到背景里。'
      },
      '-': {
        低: '继续追求某个目标的冲动可能稍微更容易退下去。',
        中: '继续追求某个目标的冲动可能更容易退下去。',
        高: '继续追求某个目标的冲动可能明显更容易退到背景里。'
      }
    }
  };
  return table[axis]?.[direction]?.[tier] || '';
}

export function buildAgentStateHints(stateAxes, { maxHints = 4 } = {}) {
  const active = AXIS_ORDER.map((axis, order) => ({
    axis,
    order,
    value: Number(stateAxes?.[axis] || 0)
  })).filter(({ axis, value }) => {
    if (Math.abs(value) < EFFECT_DELTA_MIN) return false;
    if (axis === '精度' && value > 0) return false;
    return axis === '精度' || SOFT_AXES.has(axis);
  });

  const precision = active.find((item) => item.axis === '精度');
  const rest = active
    .filter((item) => item.axis !== '精度')
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.order - b.order);
  const selected = precision
    ? [precision, ...rest.slice(0, Math.max(0, maxHints - 1))]
    : rest.slice(0, maxHints);

  return selected.map(({ axis, value }) => hintFor(axis, value)).filter(Boolean);
}
