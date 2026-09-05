// 原子写：先写同目录临时文件再 rename，避免进程中断留下半截状态文件。
// 原型 service/lib/atomicWrite.mjs 的可复用部分；V1 继续用于网关账本与身份映射落盘。

import { randomBytes } from 'node:crypto';
import { mkdir, rename, writeFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function atomicWriteFile(path, contents, { mode = 0o600 } = {}) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, contents, { mode });
  try {
    await chmod(tmp, mode);
  } catch {
    // 部分文件系统不支持 chmod，忽略
  }
  await rename(tmp, path);
  return path;
}

export default { atomicWriteFile };
