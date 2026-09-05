// 网关 V1 测试公共夹具。
// 硬约束：测试产物不得落到 C 盘。默认落在「仓库所在盘符」根下的专用目录，
// 可用 PROOF_TEST_TMPDIR 覆盖。确定性时钟供时间旅行测试使用。

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICE_ROOT = fileURLToPath(new URL('..', import.meta.url));

function defaultTmpRoot() {
  const drive = parse(SERVICE_ROOT).root; // 当前平台的文件系统根目录。
  if (process.platform === 'win32') return join(drive, 'proof-gateway-test-tmp');
  return join(tmpdir(), 'proof-gateway-test-tmp');
}

export function tmpRoot() {
  return process.env.PROOF_TEST_TMPDIR || defaultTmpRoot();
}

export async function makeTempDir(prefix = 'gw-') {
  const base = tmpRoot();
  await mkdir(base, { recursive: true });
  return mkdtemp(join(base, prefix));
}

export async function removeTempDir(dir) {
  if (dir) await rm(dir, { recursive: true, force: true });
}

/** 确定性时钟：测试完全掌控时间，不依赖真实时间流逝。 */
export function createClock(startMs = Date.UTC(2026, 8, 2, 9, 0, 0)) {
  let current = startMs;
  return {
    now: () => current,
    set: (ms) => {
      current = ms;
      return current;
    },
    advance: (ms) => {
      current += ms;
      return current;
    },
    advanceHours: (h) => {
      current += h * 3600_000;
      return current;
    }
  };
}

export default { makeTempDir, removeTempDir, createClock, tmpRoot };
