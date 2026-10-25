// A person's edits (memory doc §5 « user_edit »): a page changed in Obsidian or the Explorer is read,
// checked and indexed, its backlinks follow on the other pages, and a line goes to the log. The
// person's file is not rewritten: what they typed stays as they typed it. A page that cannot be read
// leaves the index with an open question; a deleted page leaves it too, its links kept on the pages
// that point to it. Files the vault wrote itself come back through the watcher and are skipped by
// their hash.
import { watch } from 'node:fs';
import { parisToday } from '@fi/core';
import { t } from '@fi/shared';
import { isGenerated, type Question } from './indexes';
import { commitFiles, type FileContent, recover } from './journal';
import type { Page } from './page';
import { classify, pageFiles, relink, setAside } from './rebuild';
import { finish, isPageFile, sha, VaultFiles } from './vault';

export interface EditsResult {
  accepted: string[];
  invalid: string[];
  removed: string[];
  copies: string[];
  relinked: number;
}

/** Reads the page files `files` (vault-relative) a person changed, created or deleted. */
export async function applyUserEdits(
  root: string,
  files: Iterable<string>,
  options: { now: Date; actor?: string },
): Promise<EditsResult> {
  await recover(root);
  const vault = new VaultFiles(root, options.now);
  const written = await vault.written();
  const date = parisToday(options.now);
  const out = new Map<string, FileContent>();
  const people = new Map<string, { content?: string; edited?: string }>();
  const result: EditsResult = { accepted: [], invalid: [], removed: [], copies: [], relinked: 0 };
  const indexed: Page[] = [];
  const unindexed: string[] = [];
  const questions: Question[] = [];

  for (const file of new Set(files)) {
    if (!isPageFile(file) || isGenerated(file) || /\.tmp-[0-9a-f]{12}$/.test(file)) continue;
    const content = await vault.text(file);
    const path = file.replace(/\.md$/, '');
    if (content === null) {
      if (!written[file]) continue;
      unindexed.push(path);
      result.removed.push(path);
      questions.push({ date, entity: path, text: t('memory.question.deleted') });
      continue;
    }
    if (written[file]?.sha === sha(content)) continue;
    const found = await classify(vault, file);
    if (found.kind === 'copy') {
      questions.push(await setAside(vault, out, file, found.of));
      result.copies.push(file);
    } else if (found.kind === 'invalid') {
      if (found.path) unindexed.push(found.path);
      questions.push(found.question);
      result.invalid.push(file);
    } else {
      indexed.push(found.page);
      people.set(file, { content, edited: new Date(await vault.mtime(file)).toISOString() });
      result.accepted.push(path);
    }
  }
  if (!indexed.length && !unindexed.length && !out.size && !questions.length) return result;

  if (indexed.length || result.removed.length) {
    const pages = new Map<string, Page>();
    for (const file of await pageFiles(root)) {
      const found = await classify(vault, file);
      if (found.kind === 'page') pages.set(found.page.path, found.page);
    }
    const linked = await relink(vault, pages, out, people);
    result.relinked = linked.relinked;
    const touched = new Set([...indexed.map((p) => p.path), ...result.removed]);
    // Only what this edit broke: older dangling links were asked about when they appeared.
    questions.push(...linked.questions.filter((q) => q.entity && touched.has(q.entity)));
  }

  await finish(vault, out, {
    indexed,
    unindexed,
    log: {
      reason: 'user_edit',
      actor: options.actor ?? 'user',
      pages: [...result.accepted, ...result.removed],
    },
    questions,
    people,
  });
  await commitFiles(root, out);
  return result;
}

/**
 * Calls `onFiles` with the vault-relative files changed under `root`, gathered for `debounceMs`
 * after the last change. Returns what stops it. Recursive watching needs Node 20 or later on Linux.
 */
export function watchVault(
  root: string,
  onFiles: (files: string[]) => void,
  debounceMs = 500,
): () => void {
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(root, { recursive: true }, (_event, name) => {
    if (!name) return;
    const file = name.toString().split('\\').join('/');
    if (!file.endsWith('.md') || file.startsWith('_')) return;
    pending.add(file);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const files = [...pending];
      pending = new Set();
      onFiles(files);
    }, debounceMs);
  });
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
