// Several files written as one (memory doc §5): each new content goes to a temporary file beside its
// target, then a journal naming them all is put in place by one rename, then each temporary file is
// renamed over its target. A crash before the journal leaves the old files and some litter; after
// it, `recover` finishes the renames. Either way no file is ever half written, and a write is all
// there or not at all.
import { randomBytes } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, unlink } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

export const SYSTEM_DIR = '_system';
const JOURNAL = `${SYSTEM_DIR}/compile.journal.json`;
const TMP = /\.tmp-[0-9a-f]{12}$/;

interface Journal {
  id: string;
  files: string[];
  /** Files the write removes. */
  removed?: string[];
}

const tmpOf = (file: string, id: string) => `${file}.tmp-${id}`;

/** A file's new content; null removes it. */
export type FileContent = string | Uint8Array | null;

/** Writes `content` to `path` and flushes it to the disk before returning. */
async function writeDurably(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, 'w');
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** `files`: vault-relative paths (with `/`) and their new contents. */
export async function commitFiles(
  root: string,
  files: ReadonlyMap<string, FileContent>,
): Promise<void> {
  await recover(root);
  const id = randomBytes(6).toString('hex');
  const kept: string[] = [];
  const removed: string[] = [];
  for (const [file, content] of files) {
    if (content === null) {
      removed.push(file);
      continue;
    }
    await writeDurably(join(root, tmpOf(file, id)), content);
    kept.push(file);
  }
  const journal: Journal = { id, files: kept, removed };
  const path = join(root, JOURNAL);
  await writeDurably(tmpOf(path, id), JSON.stringify(journal));
  await rename(tmpOf(path, id), path);
  await finish(root, journal);
}

async function finish(root: string, journal: Journal): Promise<void> {
  for (const file of journal.files) {
    try {
      await rename(join(root, tmpOf(file, journal.id)), join(root, file));
    } catch (e) {
      // Already renamed by a run that stopped after it.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  for (const file of journal.removed ?? []) await rm(join(root, file), { force: true });
  await unlink(join(root, JOURNAL));
}

/**
 * Finishes a write a crash interrupted after its journal; with `sweep`, also removes the temporary
 * files of writes interrupted before it (a walk of the whole vault: at start-up only).
 */
export async function recover(root: string, sweep = false): Promise<'none' | 'finished'> {
  let found: 'none' | 'finished' = 'none';
  let text: string | null = null;
  try {
    text = await readFile(join(root, JOURNAL), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (text !== null) {
    await finish(root, JSON.parse(text) as Journal);
    found = 'finished';
  }
  if (sweep) {
    for (const file of await walk(root)) if (TMP.test(file)) await rm(join(root, file));
  }
  return found;
}

/** Every file under `root`, vault-relative with `/`. */
export async function walk(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return out;
    throw e;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(root, path)));
    else out.push(relative(root, path).split(sep).join('/'));
  }
  return out;
}
