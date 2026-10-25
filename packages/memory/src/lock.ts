// The vault has one writer (memory doc §6): the runner holds `_system/runner.lock`, which names its
// machine and process and how long it holds the vault, and renews it while it runs. Another runner,
// on this machine or on another one sharing the folder through Drive or OneDrive, refuses to start
// while the lock is held. A lock past its time, or held by a process of this machine that is gone,
// is taken over. Over a synchronised folder this is no true mutual exclusion (the copy arrives late):
// the time to live is what keeps two machines apart.
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { SYSTEM_DIR } from './journal';

export const LOCK = `${SYSTEM_DIR}/runner.lock`;
/** How long a lock holds without being renewed; a runner renews it every third of that. */
export const LOCK_TTL_MS = 5 * 60_000;

const LockFile = z.object({
  host: z.string(),
  pid: z.int(),
  /** Tells two holders apart when a process id comes back. */
  id: z.string(),
  until: z.iso.datetime(),
});
export type LockFile = z.infer<typeof LockFile>;

export class VaultLocked extends Error {
  constructor(readonly holder: LockFile) {
    super(`the vault is held by ${holder.host} (process ${holder.pid}) until ${holder.until}`);
    this.name = 'VaultLocked';
  }
}

export interface Holder {
  host: string;
  pid: number;
  now: Date;
  ttlMs?: number;
}

async function readLock(root: string): Promise<LockFile | null> {
  let text: string;
  try {
    text = await readFile(join(root, LOCK), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  const lock = LockFile.safeParse(JSON.parse(text || 'null'));
  // A lock that cannot be read holds nothing: it was cut by a crash, or a person broke it.
  return lock.success ? lock.data : null;
}

const fileOf = (holder: Holder, id: string): LockFile => ({
  host: holder.host,
  pid: holder.pid,
  id,
  until: new Date(holder.now.getTime() + (holder.ttlMs ?? LOCK_TTL_MS)).toISOString(),
});

/** Whether a process of this machine still runs. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Takes the vault, or throws `VaultLocked` naming who holds it. */
export async function acquireLock(root: string, holder: Holder): Promise<LockFile> {
  const path = join(root, LOCK);
  await mkdir(dirname(path), { recursive: true });
  const mine = fileOf(holder, randomBytes(6).toString('hex'));
  try {
    const handle = await open(path, 'wx');
    try {
      await handle.writeFile(JSON.stringify(mine));
      await handle.sync();
    } finally {
      await handle.close();
    }
    return mine;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  const held = await readLock(root);
  if (held) {
    const expired = Date.parse(held.until) <= holder.now.getTime();
    const gone = held.host === holder.host && held.pid !== holder.pid && !alive(held.pid);
    if (!expired && !gone) throw new VaultLocked(held);
  }
  await replace(root, mine);
  // Two runners taking over the same stale lock: the last rename wins, the other one sees it.
  const now = await readLock(root);
  if (now?.id !== mine.id) throw new VaultLocked(now ?? mine);
  return mine;
}

/** Holds the vault for another time to live; throws `VaultLocked` when it was taken over. */
export async function renewLock(root: string, lock: LockFile, holder: Holder): Promise<LockFile> {
  const held = await readLock(root);
  if (held?.id !== lock.id) throw new VaultLocked(held ?? lock);
  const renewed = fileOf(holder, lock.id);
  await replace(root, renewed);
  return renewed;
}

/** Lets the vault go, if it is still this holder's. */
export async function releaseLock(root: string, lock: LockFile): Promise<void> {
  const held = await readLock(root);
  if (held?.id === lock.id) await unlink(join(root, LOCK));
}

async function replace(root: string, lock: LockFile): Promise<void> {
  const path = join(root, LOCK);
  const tmp = `${path}.tmp-${randomBytes(6).toString('hex')}`;
  await writeFile(tmp, JSON.stringify(lock));
  await rename(tmp, path);
}
