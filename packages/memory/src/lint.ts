// Lint of the memory's links (memory doc §4: « an edge without its reverse is a lint error, an edge
// without sources is a lint error »): a link its target does not show back, or a backlink no link
// makes; a link to a page that is not there; a rule's link whose fact is gone (the rules no longer
// make it, or make it by another rule, so its evidence names what is not there); a link nobody
// accounts for (exact or strong with no rule and no person behind it, or a guess whose quote is not
// in its page). Rebuild mends backlinks; the rest is a person's to fix. M5 turns each finding into a
// fix a person approves, and adds contradictions, pages without sources, stale indexes and deadlines.
import { fold } from './fold';
import { confirmed, LinkIndex, ruleLinks } from './link-rules';
import type { Page } from './page';
import type { LinkKind } from './types';

export type LintCode = 'one_sided' | 'dangling' | 'stale' | 'unsourced';

export interface LintFinding {
  code: LintCode;
  /** The page whose frontmatter holds the line. */
  page: string;
  kind: LinkKind;
  /** The page at the other end. */
  other: string;
  /** A link the page makes, or a backlink it shows. */
  side: 'link' | 'backlink';
}

/** What a guess quotes: its evidence without the French quotation marks. */
const quoted = (evidence: string) => /^«\s*([\s\S]*?)\s*»$/.exec(evidence)?.[1] ?? evidence;

/** Every defect of the links of `pages`, page by page. */
export function lintLinks(pages: readonly Page[]): LintFinding[] {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const index = new LinkIndex(pages);
  const out: LintFinding[] = [];
  for (const page of pages) {
    const derived = new Set(ruleLinks(page, index).map((l) => `${l.kind} ${l.to} ${l.rule}`));
    const text = fold(page.text);
    for (const l of page.frontmatter.links ?? []) {
      const at = { page: page.path, kind: l.kind, other: l.to, side: 'link' } as const;
      const target = byPath.get(l.to);
      if (!target) {
        out.push({ code: 'dangling', ...at });
        continue;
      }
      const back = target.frontmatter.backlinks ?? [];
      if (!back.some((b) => b.kind === l.kind && b.from === page.path)) {
        out.push({ code: 'one_sided', ...at });
      }
      if (confirmed(l)) continue;
      if (l.rule && !derived.has(`${l.kind} ${l.to} ${l.rule}`)) out.push({ code: 'stale', ...at });
      const quote = fold(quoted(l.evidence));
      if (!l.rule && (l.confidence !== 'inferred' || !quote || !text.includes(quote))) {
        out.push({ code: 'unsourced', ...at });
      }
    }
    for (const b of page.frontmatter.backlinks ?? []) {
      const from = byPath.get(b.from);
      if (!from?.frontmatter.links?.some((l) => l.kind === b.kind && l.to === page.path)) {
        out.push({
          code: 'one_sided',
          page: page.path,
          kind: b.kind,
          other: b.from,
          side: 'backlink',
        });
      }
    }
  }
  return out;
}
