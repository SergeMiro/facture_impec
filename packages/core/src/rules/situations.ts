// The situations de travaux a company issued, per chantier, for BTP-SIT-01 and BTP-SIT-02: the one
// that comes before a given situation. The chantier is the invoice's BT-11 as the sheet wrote it,
// case and accents aside (docs/research/BTP_RULES.md § Situations de travaux).
import type { Invoice } from '../model';

/** An issued situation and who it is, so that a situation never follows itself. */
export interface SituationEntry {
  id: string;
  /** The chantier, as the invoice names it (BT-11). */
  chantier: string;
  number: number;
  /** The cumulative works HT, in cents. */
  cumulative?: number | undefined;
}

export type SituationSubject = Pick<Invoice, 'projectReference' | 'btp'>;

/** « CH-12 », « ch 12 »: the same chantier. */
export const chantierKey = (name: string) =>
  name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export class SituationBook {
  readonly entries: readonly SituationEntry[];
  readonly #byChantier = new Map<string, SituationEntry[]>();

  constructor(entries: Iterable<SituationEntry>) {
    this.entries = [...entries];
    for (const e of this.entries) {
      const key = chantierKey(e.chantier);
      if (key === '') continue;
      const list = this.#byChantier.get(key);
      if (list) list.push(e);
      else this.#byChantier.set(key, [e]);
    }
  }

  /** A situation of an invoice, when it names its chantier and its number. */
  static entryOf(id: string, invoice: SituationSubject): SituationEntry | undefined {
    const situation = invoice.btp?.situation;
    const chantier = invoice.projectReference;
    if (!situation || !chantier) return undefined;
    return { id, chantier, number: situation.number, cumulative: situation.cumulative };
  }

  /**
   * The situation before this one: another of the same chantier with the same number (a repeat, which
   * BTP-SIT-01 names), else the one with the highest number below it. None for a first situation.
   */
  previous(
    invoice: SituationSubject,
    self?: string,
  ): { number: number; cumulative?: number | undefined } | undefined {
    const mine = SituationBook.entryOf(self ?? '', invoice);
    if (!mine) return undefined;
    const others = (this.#byChantier.get(chantierKey(mine.chantier)) ?? []).filter(
      (e) => self === undefined || e.id !== self,
    );
    const found =
      others.find((e) => e.number === mine.number) ??
      others
        .filter((e) => e.number < mine.number)
        .reduce<SituationEntry | undefined>(
          (a, e) => (!a || e.number > a.number ? e : a),
          undefined,
        );
    if (!found) return undefined;
    return {
      number: found.number,
      ...(found.cumulative !== undefined && { cumulative: found.cumulative }),
    };
  }
}
