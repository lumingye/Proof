// 每轮模型提交前的状态注入入口。默认关。不缓存饮酒完成时的旧文本。

import { STATE_INJECTION_LABEL } from '../core/constants.js';
import { buildAgentTurnContext } from './agentTurnContext.js';

export function createTurnBridge({ getEngine, agentId }) {
  if (!agentId) throw new Error('agent_id_required');
  return {
    agentId,
    // 唯一权威：一律走 buildAgentTurnContext，本处不再自行拼装。
    beforeModelTurn(now) {
      return buildAgentTurnContext(getEngine(agentId), agentId, now);
    }
  };
}

export function formatContextBlock(block) {
  if (!block?.text) return '';
  return block.text.startsWith(STATE_INJECTION_LABEL) ? block.text : `${STATE_INJECTION_LABEL}\n${block.text}`;
}

export function hookAdditionalContext(turnResult) {
  if (!turnResult?.injected) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: formatContextBlock(turnResult.block)
    }
  };
}
