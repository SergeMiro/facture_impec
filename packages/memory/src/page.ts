// One page of the vault as a file (memory doc §4): the YAML frontmatter between two « --- » lines,
// the text, then a `## Liens` section that code rewrites from the links at every write. Reading
// leaves that section out; writing puts it back, so a person's edit of it never survives.
import { t } from '@fi/shared';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { type Backlink, Frontmatter, type Link, type PagePath } from './types';

export interface Page {
  path: PagePath;
  /** As code holds it: amounts in cents. */
  frontmatter: Frontmatter;
  /** The text under the frontmatter, without the `## Liens` section. */
  text: string;
}

export type PageRead = { ok: true; page: Page } | { ok: false; reason: string };

const FENCE = '---';
const linksHeading = () => `## ${t('memory.links.title')}`;

/** The file's text cut in three: its YAML, its text, and what follows `## Liens` (dropped). */
function split(file: string): { yaml: string; text: string } | null {
  const lines = file.replace(/\r\n/g, '\n').split('\n');
  if (lines[0]?.trim() !== FENCE) return null;
  const end = lines.indexOf(FENCE, 1);
  if (end < 0) return null;
  const body = lines.slice(end + 1);
  const links = body.findIndex((l) => l.trim() === linksHeading());
  return {
    yaml: lines.slice(1, end).join('\n'),
    text: (links < 0 ? body : body.slice(0, links)).join('\n').trim(),
  };
}

/** A page's file read and checked; why not, in a person's words, when it cannot be. */
export function readPage(path: PagePath, file: string): PageRead {
  const parts = split(file);
  if (!parts) return { ok: false, reason: 'no frontmatter' };
  let data: unknown;
  try {
    data = parse(parts.yaml);
  } catch (e) {
    return { ok: false, reason: `YAML: ${e instanceof Error ? e.message.split('\n')[0] : e}` };
  }
  const fm = Frontmatter.safeParse(data);
  if (!fm.success) return { ok: false, reason: describe(fm.error) };
  return { ok: true, page: { path, frontmatter: fm.data, text: parts.text } };
}

/** « ttc: Invalid input », the first problems only. */
function describe(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || 'type'}: ${i.message}`)
    .join('; ');
}

/** The frontmatter as the file writes it: amounts as « 12400.00 »; throws when it breaks its schema. */
export function encodeFrontmatter(frontmatter: Frontmatter): z.input<typeof Frontmatter> {
  return z.encode(Frontmatter, frontmatter);
}

/** The file of a page: same input, same bytes. */
export function writePage(page: Page): string {
  const yaml = stringify(encodeFrontmatter(page.frontmatter), { lineWidth: 0 }).trimEnd();
  const links = linkLines(page.frontmatter.links ?? [], page.frontmatter.backlinks ?? []);
  return [
    FENCE,
    yaml,
    FENCE,
    '',
    ...(page.text ? [page.text, ''] : []),
    linksHeading(),
    '',
    t('memory.links.note', { app: t('app.title') }),
    ...(links.length ? ['', ...links] : []),
    '',
  ].join('\n');
}

function linkLines(links: readonly Link[], backlinks: readonly Backlink[]): string[] {
  return [
    ...links.map((l) =>
      t(l.confidence === 'inferred' ? 'memory.link.inferred' : 'memory.link.line', {
        label: t(`memory.link.${l.kind}`),
        path: l.to,
      }),
    ),
    ...backlinks.map((b) =>
      t('memory.link.line', { label: t(`memory.backlink.${b.kind}`), path: b.from }),
    ),
  ].map((l) => `- ${l}`);
}
