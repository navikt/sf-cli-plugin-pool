import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Global, lockInit } from '@salesforce/core';

export async function withPoolAuthLock<T>(username: string, operation: () => Promise<T>): Promise<T> {
  const lockName = createHash('sha256').update(username.toLowerCase()).digest('hex');
  const { unlock } = await lockInit(join(Global.SF_DIR, 'pool-auth-locks', lockName));
  try {
    return await operation();
  } finally {
    await unlock();
  }
}
