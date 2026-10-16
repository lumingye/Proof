import test from 'node:test';
import assert from 'node:assert/strict';
import { projectAgentObjectiveStates } from '../src/runtime/agentObjectiveStates.js';

test('宕机投给 Agent 的是“一小会儿掉线”：可以接不上，之后恢复，不是持续迟钝', () => {
  const [crash] = projectAgentObjectiveStates([{ type: '宕机' }]);
  assert.equal(crash.type, '宕机');
  assert.match(crash.text, /一两句/);
  assert.match(crash.text, /反问|接不上|反应不过来/);
  assert.match(crash.text, /接回来/);
  assert.match(crash.text, /不是持续/);
  assert.match(crash.text, /安全边界/);
});

test('宕机文案只投一次，重复事件不叠加', () => {
  const out = projectAgentObjectiveStates([{ type: '宕机' }, { type: '宕机' }]);
  assert.equal(out.length, 1);
});
