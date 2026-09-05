// 网关 V1 总装（里程碑 4）。服务端只做最小接线：
//   数据目录 / 引擎访问器 / 环境变量 → identity + ledger + proxy/router

import { createIdentity } from './identity.mjs';
import { createLedger } from './ledger.mjs';
import { buildGateway, createStreamAccumulator } from './router.mjs';

export function createGateway(options = {}) {
  const {
    getEngine,
    dataDir,
    env = process.env,
    now,
    maxBodyBytes,
    timeoutMs
  } = options;
  const identity = createIdentity({ dataDir, now });
  const ledger = createLedger({ dataDir, now });
  const core = buildGateway({ getEngine, dataDir, env, now, maxBodyBytes, timeoutMs });
  return { ...core, identity, ledger };
}

export { createIdentity, createLedger, buildGateway, createStreamAccumulator };
export default { createGateway };
