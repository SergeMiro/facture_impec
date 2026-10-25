// The memory's index in the database (docs/DECISIONS.md D12): one row per page with its keys, its
// facts and its folded text for full-text, one row per link, one per text read from `raw/`. The
// vault is the truth: compile, a person's edits and rebuild write here what they wrote there, and
// rebuild writes it all again. Recall reads only this.
import {
  and,
  type Db,
  eq,
  inArray,
  type MemoryPageRow,
  memoryLinks,
  memoryPages,
  memoryRaw,
  memoryRecalls,
  or,
  sql,
} from '@fi/db';
import { t } from '@fi/shared';
import { fold, keyOf } from './fold';
import { encodeFrontmatter, type Page } from './page';
import { sectionOf } from './types';

export const KEY_KINDS = [
  'path',
  'name',
  'siren',
  'siret',
  'vat_id',
  'email',
  'erp_ref',
  'number',
] as const;
export type KeyKind = (typeof KEY_KINDS)[number];

export const keyString = (by: KeyKind, value: string) =>
  `${by}:${by === 'path' ? value : by === 'name' ? fold(value) : keyOf(value)}`;

/** What finds a page at level 1: its path, its name, its identifiers. */
export function keysOf(page: Page): string[] {
  const fm = page.frontmatter;
  const keys = [keyString('path', page.path), keyString('name', fm.title)];
  const add = (by: KeyKind, value: string | undefined) => {
    if (value) keys.push(keyString(by, value));
  };
  if (fm.type === 'tiers') {
    add('siren', fm.siren);
    add('siret', fm.siret);
    add('vat_id', fm.vat_id);
    add('email', fm.email);
  }
  if (fm.type === 'tiers' || fm.type === 'chantier') add('erp_ref', fm.erp_ref);
  if ('number' in fm && typeof fm.number === 'string') add('number', fm.number);
  if (fm.type === 'situation') add('number', `${leaf(fm.chantier)} ${fm.number}`);
  return [...new Set(keys)];
}

const leaf = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/[-_]/g, ' ');
const SKIP = new Set(['sources', 'links', 'backlinks', 'updated', 'type', 'extracted']);

/** What full-text reads of a page: its type, title, facts (a page's path as its name) and text. */
export function foldedOf(page: Page): string {
  const facts = encodeFrontmatter(page.frontmatter) as Record<string, unknown>;
  const words: string[] = [t(`memory.type.${page.frontmatter.type}`), page.frontmatter.title];
  const visit = (value: unknown) => {
    if (typeof value === 'string')
      words.push(/^[a-z]+\/[a-z0-9/_-]+$/.test(value) ? leaf(value) : value);
    else if (typeof value === 'number') words.push(String(value));
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  for (const [k, v] of Object.entries(facts)) if (!SKIP.has(k)) visit(v);
  words.push(page.text);
  return fold(words.join(' '));
}

export interface RawText {
  /** The original's reference: `raw/2026/10/facture-f-114.pdf`. */
  ref: string;
  text: string;
}

/** A full-text query for any of `words` (folded: letters and digits only, nothing to escape). */
function anyOf(words: readonly string[]) {
  const clean = words.map(fold).filter((w) => /^[a-z0-9]+$/.test(w));
  return clean.length ? sql`to_tsquery('french', ${clean.join(' | ')})` : null;
}

const CHUNK = 200;
const chunks = <T>(list: readonly T[]) =>
  Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) =>
    list.slice(i * CHUNK, (i + 1) * CHUNK),
  );

export class MemoryStore {
  constructor(
    readonly db: Db,
    readonly tenantId: string,
  ) {}

  #rowOf(page: Page) {
    return {
      tenantId: this.tenantId,
      path: page.path,
      type: page.frontmatter.type,
      section: sectionOf(page.path),
      title: page.frontmatter.title,
      keys: keysOf(page),
      facts: encodeFrontmatter(page.frontmatter) as Record<string, unknown>,
      sources: page.frontmatter.sources,
      body: page.text,
      folded: foldedOf(page),
    };
  }

  #linksOf(pages: readonly Page[]) {
    return pages.flatMap((p) =>
      (p.frontmatter.links ?? []).map((l) => ({
        tenantId: this.tenantId,
        fromPath: p.path,
        kind: l.kind,
        toPath: l.to,
        confidence: l.confidence,
      })),
    );
  }

  /** The whole index again, from every page and text of the vault (rebuild). */
  async replace(pages: readonly Page[], raws: readonly RawText[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(memoryLinks).where(eq(memoryLinks.tenantId, this.tenantId));
      await tx.delete(memoryPages).where(eq(memoryPages.tenantId, this.tenantId));
      await tx.delete(memoryRaw).where(eq(memoryRaw.tenantId, this.tenantId));
      for (const part of chunks(pages)) {
        await tx.insert(memoryPages).values(part.map((p) => this.#rowOf(p)));
      }
      for (const part of chunks(this.#linksOf(pages))) {
        await tx.insert(memoryLinks).values(part).onConflictDoNothing();
      }
      for (const part of chunks(raws)) {
        await tx.insert(memoryRaw).values(part.map((r) => this.#rawOf(r)));
      }
    });
  }

  /** Pages written or read again (compile, a person's edit): their rows and their links. */
  async upsert(pages: readonly Page[]): Promise<void> {
    if (!pages.length) return;
    const paths = pages.map((p) => p.path);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(memoryLinks)
        .where(and(eq(memoryLinks.tenantId, this.tenantId), inArray(memoryLinks.fromPath, paths)));
      await tx
        .delete(memoryPages)
        .where(and(eq(memoryPages.tenantId, this.tenantId), inArray(memoryPages.path, paths)));
      for (const part of chunks(pages)) {
        await tx.insert(memoryPages).values(part.map((p) => this.#rowOf(p)));
      }
      for (const part of chunks(this.#linksOf(pages))) {
        await tx.insert(memoryLinks).values(part).onConflictDoNothing();
      }
    });
  }

  /** Pages gone from the index (deleted, or unreadable): their rows and the links they made. */
  async remove(paths: readonly string[]): Promise<void> {
    if (!paths.length) return;
    await this.db.transaction(async (tx) => {
      await tx
        .delete(memoryLinks)
        .where(
          and(eq(memoryLinks.tenantId, this.tenantId), inArray(memoryLinks.fromPath, [...paths])),
        );
      await tx
        .delete(memoryPages)
        .where(and(eq(memoryPages.tenantId, this.tenantId), inArray(memoryPages.path, [...paths])));
    });
  }

  #rawOf(raw: RawText) {
    return { tenantId: this.tenantId, ref: raw.ref, body: raw.text, folded: fold(raw.text) };
  }

  async addRaw(raw: RawText): Promise<void> {
    await this.db.insert(memoryRaw).values(this.#rawOf(raw)).onConflictDoNothing();
  }

  /** Level 1: the pages one of `keys` names. */
  byKeys(keys: readonly string[]): Promise<MemoryPageRow[]> {
    return this.db
      .select()
      .from(memoryPages)
      .where(
        and(
          eq(memoryPages.tenantId, this.tenantId),
          sql`${memoryPages.keys} && ${sql`array[${sql.join(
            keys.map((k) => sql`${k}`),
            sql`, `,
          )}]::text[]`}`,
        ),
      )
      .orderBy(memoryPages.path);
  }

  async pages(paths: readonly string[]): Promise<MemoryPageRow[]> {
    if (!paths.length) return [];
    return this.db
      .select()
      .from(memoryPages)
      .where(and(eq(memoryPages.tenantId, this.tenantId), inArray(memoryPages.path, [...paths])))
      .orderBy(memoryPages.path);
  }

  /** The pages one link away from `paths`, either way, by the given kinds (all when none). */
  async neighbours(paths: readonly string[], kinds?: readonly string[]): Promise<string[]> {
    if (!paths.length) return [];
    const list = [...paths];
    const found = await this.db
      .select({ from: memoryLinks.fromPath, to: memoryLinks.toPath })
      .from(memoryLinks)
      .where(
        and(
          eq(memoryLinks.tenantId, this.tenantId),
          or(inArray(memoryLinks.fromPath, list), inArray(memoryLinks.toPath, list)),
          kinds?.length ? inArray(memoryLinks.kind, [...kinds]) : undefined,
        ),
      );
    const near = new Set<string>();
    for (const l of found) near.add(paths.includes(l.from) ? l.to : l.from);
    for (const p of paths) near.delete(p);
    return [...near].sort();
  }

  /** Full-text over the pages, best first (any of `words`, the most of them first); in one section when given. */
  async search(words: readonly string[], section?: string, limit = 10): Promise<MemoryPageRow[]> {
    const query = anyOf(words);
    if (!query) return [];
    return this.db
      .select()
      .from(memoryPages)
      .where(
        and(
          eq(memoryPages.tenantId, this.tenantId),
          section ? eq(memoryPages.section, section) : undefined,
          sql`${memoryPages.search} @@ ${query}`,
        ),
      )
      .orderBy(sql`ts_rank(${memoryPages.search}, ${query}) desc`, memoryPages.path)
      .limit(limit);
  }

  /** Full-text over the texts of `raw/`, best first. */
  async searchRaw(words: readonly string[], limit = 5): Promise<{ ref: string; body: string }[]> {
    const query = anyOf(words);
    if (!query) return [];
    return this.db
      .select({ ref: memoryRaw.ref, body: memoryRaw.body })
      .from(memoryRaw)
      .where(and(eq(memoryRaw.tenantId, this.tenantId), sql`${memoryRaw.search} @@ ${query}`))
      .orderBy(sql`ts_rank(${memoryRaw.search}, ${query}) desc`, memoryRaw.ref)
      .limit(limit);
  }

  /** The pages that name `ref` among their sources. */
  citing(ref: string): Promise<MemoryPageRow[]> {
    return this.db
      .select()
      .from(memoryPages)
      .where(
        and(eq(memoryPages.tenantId, this.tenantId), sql`${ref} = any(${memoryPages.sources})`),
      )
      .orderBy(memoryPages.path);
  }

  async logRecall(entry: {
    intent: string;
    status: string;
    level: number;
    ms: number;
    searched: unknown[];
  }): Promise<void> {
    await this.db.insert(memoryRecalls).values({ tenantId: this.tenantId, ...entry });
  }
}
