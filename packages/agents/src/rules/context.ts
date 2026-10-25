// What a memory rule reads (memory doc §8): the pages as code holds them (amounts in cents), the
// links between them with how sure each is, the day in Paris and the company's preferences. A rule
// only reads: what it found is a `Found`, which the API records, cools down and shows.
import type { Frontmatter, LinkConfidence, LinkKind, PageType } from '@fi/memory';
import type { RuleEntry } from './catalogue';

export interface RulePage {
  path: string;
  frontmatter: Frontmatter;
}

export type PageOf<T extends PageType> = RulePage & {
  frontmatter: Extract<Frontmatter, { type: T }>;
};

export interface RuleOptions {
  /** margin-below-threshold: the company's lowest acceptable margin, in percent. */
  marginPct: number;
  /** tva-declaration-due: the company opted to pay VAT on its invoices (débits), not on payments. */
  vatOnDebits: boolean;
}

export const DEFAULT_RULE_OPTIONS: RuleOptions = { marginPct: 15, vatOnDebits: false };

/** One situation a rule found: on what, with which facts, resting on which pages. */
export interface Found {
  /** What it is about, stable from one run to the next: a page's path, or a key of the rule's own. */
  entity: string;
  /** Amounts in cents, dates as ISO days, names as the pages write them. */
  facts: Record<string, string | number | boolean | null | readonly string[]>;
  /** The pages it rests on: a firing that names none is not shown (memory doc §8). */
  cites: string[];
}

export interface MemoryRule {
  entry: RuleEntry & { runs: 'memory' };
  /** The page types it looks at, one entity each: the « checked » count of its runs. */
  on: readonly PageType[];
  detect(ctx: RuleContext): Found[];
}

const SURE: Record<LinkConfidence, number> = { inferred: 0, strong: 1, exact: 2 };

export class RuleContext {
  readonly #byPath: Map<string, RulePage>;
  /** Who links to a page, from the links themselves: a backlink missing is the lint's, not ours. */
  readonly #to = new Map<
    string,
    { from: RulePage; kind: LinkKind; confidence: LinkConfidence }[]
  >();

  constructor(
    readonly pages: readonly RulePage[],
    /** Today in Paris, ISO. */
    readonly today: string,
    readonly options: RuleOptions = DEFAULT_RULE_OPTIONS,
  ) {
    this.#byPath = new Map(pages.map((p) => [p.path, p]));
    for (const from of pages) {
      for (const l of from.frontmatter.links ?? []) {
        const list = this.#to.get(l.to) ?? [];
        list.push({ from, kind: l.kind, confidence: l.confidence });
        this.#to.set(l.to, list);
      }
    }
  }

  get(path: string | undefined): RulePage | undefined {
    return path === undefined ? undefined : this.#byPath.get(path);
  }

  ofType<T extends PageType>(type: T): PageOf<T>[] {
    return this.pages.filter((p): p is PageOf<T> => p.frontmatter.type === type);
  }

  /** The pages `from` links to by `kind`, at least as sure as `min`. */
  linked(from: RulePage, kind: LinkKind, min: LinkConfidence): string[] {
    return (from.frontmatter.links ?? [])
      .filter((l) => l.kind === kind && SURE[l.confidence] >= SURE[min])
      .map((l) => l.to);
  }

  /** The pages that link to `to` by `kind`, at least as sure as `min`. */
  linking(to: RulePage, kind: LinkKind, min: LinkConfidence): RulePage[] {
    return (this.#to.get(to.path) ?? [])
      .filter((l) => l.kind === kind && SURE[l.confidence] >= SURE[min])
      .map((l) => l.from);
  }

  /** The chantier a document belongs to: its own field, else a link as sure as `min`. */
  siteOf(page: RulePage, min: LinkConfidence): string | undefined {
    const field = 'chantier' in page.frontmatter ? page.frontmatter.chantier : undefined;
    return field ?? this.linked(page, 'belongs_to', min)[0];
  }

  title(path: string | undefined): string {
    return this.get(path)?.frontmatter.title ?? path ?? '';
  }
}
