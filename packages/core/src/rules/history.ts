// The part of a company's numbering history that decides one invoice's history rules. A sync checks
// thousands of invoices against thousands of numbers, and giving each one the whole list made
// validation quadratic (8.7 s for 5 000 invoices of one series, 0.9 s without history). The four
// rules that read `history` only ask whether some other invoice exists (the same number this year; a
// higher number dated earlier or a lower one dated later; the invoice a credit note cites) and which
// number of the series comes next or is the highest, so a few witnesses give the verdict the whole
// list gives: history.test.ts checks it on random histories. A rule that reads `history` in another
// way must add its witnesses here.
import type { Invoice } from '../model';
import type { IssuedInvoice } from './types';
import { present, series, sirenOf, year } from './util';

/** An issued invoice and who it is, so that an invoice is never its own history. */
export interface HistoryEntry extends IssuedInvoice {
  id: string;
}

interface Numbered {
  entry: HistoryEntry;
  n: number;
}

/** The two best entries of a stretch, so that one may be the invoice itself. */
type Best = readonly [HistoryEntry, HistoryEntry?];

/** One series, by number; for each position the latest-dated entries up to it and the earliest from it. */
interface Series {
  list: Numbered[];
  latestUpTo: Best[];
  earliestFrom: Best[];
}

function best(
  better: (a: HistoryEntry, b: HistoryEntry) => boolean,
  previous: Best | undefined,
  e: HistoryEntry,
): Best {
  if (!previous) return [e];
  const [first, second] = previous;
  if (better(e, first)) return [e, first];
  return !second || better(e, second) ? [first, e] : previous;
}

/** First index whose number is at least `n` (`strict`: greater than `n`). */
function bound(list: readonly Numbered[], n: number, strict: boolean) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const m = list[mid]?.n ?? 0;
    if (m < n || (strict && m === n)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The order the rules see the history in: by number, date, then id. */
const byNumber = (a: HistoryEntry, b: HistoryEntry) =>
  compare(a.number, b.number) || compare(a.issueDate, b.issueDate) || compare(a.id, b.id);

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export type HistorySubject = Pick<Invoice, 'number' | 'issueDate' | 'precedingInvoices' | 'seller'>;

export class NumberingHistory {
  /** Every entry, in the order the rules see them. */
  readonly entries: readonly HistoryEntry[];
  readonly #rank = new Map<HistoryEntry, number>();
  readonly #byNumber = new Map<string, HistoryEntry[]>();
  /** Per series prefix. */
  readonly #series = new Map<string, Series>();

  constructor(entries: Iterable<HistoryEntry>) {
    this.entries = [...entries].sort(byNumber);
    const numbered = new Map<string, Numbered[]>();
    this.entries.forEach((entry, rank) => {
      this.#rank.set(entry, rank);
      push(this.#byNumber, entry.number, entry);
      const s = series(entry.number);
      if (s) push(numbered, s.prefix, { entry, n: s.n });
    });
    const rank = (e: HistoryEntry) => this.#rank.get(e) ?? 0;
    const later = (a: HistoryEntry, b: HistoryEntry) =>
      a.issueDate > b.issueDate || (a.issueDate === b.issueDate && rank(a) < rank(b));
    const earlier = (a: HistoryEntry, b: HistoryEntry) =>
      a.issueDate < b.issueDate || (a.issueDate === b.issueDate && rank(a) < rank(b));
    for (const [prefix, list] of numbered) {
      list.sort((a, b) => a.n - b.n || rank(a.entry) - rank(b.entry));
      const latestUpTo: Best[] = [];
      const earliestFrom: Best[] = [];
      list.forEach((x, i) => {
        latestUpTo[i] = best(later, latestUpTo[i - 1], x.entry);
      });
      for (let i = list.length - 1; i >= 0; i--) {
        const x = list[i];
        if (x) earliestFrom[i] = best(earlier, earliestFrom[i + 1], x.entry);
      }
      this.#series.set(prefix, { list, latestUpTo, earliestFrom });
    }
  }

  /** The history to validate `invoice` with: the verdict of every entry but `self`, from a few. */
  for(invoice: HistorySubject, self?: string): IssuedInvoice[] {
    const picked = new Set<HistoryEntry>();
    const other = (e: HistoryEntry) => e.id !== self;
    const { number, issueDate } = invoice;

    // BR-FR-CO-02: the same number this year, by the same seller.
    if (present(number)) {
      const siren = sirenOf(invoice.seller);
      const twin = this.#byNumber
        .get(number)
        ?.find(
          (e) =>
            other(e) &&
            year(e.issueDate) === year(issueDate) &&
            (e.sellerSiren === undefined || siren === undefined || e.sellerSiren === siren),
        );
      if (twin) picked.add(twin);
    }

    // FF-NUM-01: the same number of the series, else the next one, else the highest.
    // FF-NUM-02: a lower number dated later, a higher one dated earlier.
    const current = present(number) ? series(number) : null;
    const group = current ? this.#series.get(current.prefix) : undefined;
    if (current && group) {
      const { list } = group;
      const first = (from: number, to: number, step: number) => {
        for (let i = from; i !== to; i += step) {
          const x = list[i];
          if (x && other(x.entry)) return x.entry;
        }
        return undefined;
      };
      const lo = bound(list, current.n, false);
      const hi = bound(list, current.n, true);
      const witness =
        first(lo, hi, 1) ?? first(hi, list.length, 1) ?? first(list.length - 1, -1, -1);
      if (witness) picked.add(witness);
      if (present(issueDate)) {
        const pick = (b: Best | undefined) => b?.find((e) => e !== undefined && other(e));
        const later = pick(group.latestUpTo[lo - 1]);
        const earlier = pick(group.earliestFrom[hi]);
        if (later && later.issueDate > issueDate) picked.add(later);
        if (earlier && earlier.issueDate < issueDate) picked.add(earlier);
      }
    }

    // FF-CN-01: the first invoice that matches each one cited.
    const cited = invoice.precedingInvoices.filter((p) => present(p.number));
    for (const p of cited) {
      const found = this.#byNumber
        .get(p.number ?? '')
        ?.find((e) => other(e) && (p.issueDate === undefined || e.issueDate === p.issueDate));
      if (found) picked.add(found);
    }
    // FF-CN-01 stays silent on an empty history: when nothing above was found, one entry keeps it
    // from being empty. It cannot change another rule's verdict, or it would have been found.
    if (picked.size === 0 && cited.length > 0) {
      const any = this.entries.find(other);
      if (any) picked.add(any);
    }

    return [...picked]
      .sort((a, b) => (this.#rank.get(a) ?? 0) - (this.#rank.get(b) ?? 0))
      .map((e) => ({
        number: e.number,
        issueDate: e.issueDate,
        ...(e.sellerSiren !== undefined && { sellerSiren: e.sellerSiren }),
      }));
  }
}
