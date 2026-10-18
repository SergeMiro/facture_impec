// Personal data never reaches a model (plan §0, §6). Names, identifiers, IBANs, e-mails, phones and
// street lines become stable tokens such as {{PARTY_1}}; amounts, dates and descriptions stay. The
// answer is re-hydrated, and a token the model invented is reported instead of passed on.
//
// One pass over the text: every detector proposes spans, the first one to claim a character wins,
// and text that already looks like a token is itself masked (LITERAL) so it round-trips untouched.

export const TOKEN_KINDS = [
  'LITERAL',
  'PARTY',
  'PERSON',
  'SIREN',
  'SIRET',
  'VAT',
  'IBAN',
  'BIC',
  'EMAIL',
  'PHONE',
  'ADDRESS',
] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

const TOKEN = /\{\{([A-Z]+)_(\d+)\}\}/g;

const LEGAL_FORMS = 'SARL|SASU|SAS|SA|EURL|SCI|SNC|SCOP|SELARL|SELAS|EIRL|EI|SCM|SCP|GIE';
const CAPITALISED = "[A-ZÀ-Ý][\\p{L}0-9'’&.-]*";
const STREET_TYPES =
  'rue|avenue|av\\.|boulevard|bd|place|pl\\.|chemin|ch\\.|allée|impasse|route|rte|quai|cours|square|passage|faubourg|fg|lieu-dit|résidence|zone|za|zi|parc';

/** Detectors in priority order. Each one runs on the original text. */
const DETECTORS: ReadonlyArray<{ kind: TokenKind; re: RegExp }> = [
  { kind: 'EMAIL', re: /[\p{L}0-9._%+-]+@[\p{L}0-9-]+(?:\.[\p{L}0-9-]+)*\.[\p{L}]{2,}/gu },
  // A French VAT number also has the shape of a short IBAN: test it first.
  { kind: 'VAT', re: /\bFR ?[0-9A-HJ-NP-Z]{2} ?\d{3} ?\d{3} ?\d{3}\b/g },
  { kind: 'IBAN', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g },
  { kind: 'SIRET', re: /\b\d{3}[ .]?\d{3}[ .]?\d{3}[ .]?\d{5}\b/g },
  { kind: 'PHONE', re: /(?:\+33 ?(?:\(0\) ?)?|\b0)[1-9](?:[ .-]?\d{2}){4}\b/g },
  { kind: 'SIREN', re: /\b\d{3}[ .]?\d{3}[ .]?\d{3}\b/g },
  {
    kind: 'BIC',
    re: /\b(?:BIC|SWIFT)\s*:?\s*[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g,
  },
  {
    kind: 'PERSON',
    re: new RegExp(
      `\\b(?:M\\.|MM\\.|Mme|Mmes|Mlle|Monsieur|Madame|Mademoiselle|Maître|Me|Dr|Docteur)\\s+${CAPITALISED}(?:[ -]${CAPITALISED}){0,2}`,
      'gu',
    ),
  },
  {
    kind: 'PARTY',
    re: new RegExp(
      `\\b(?:${LEGAL_FORMS})\\b\\.?(?:\\s+${CAPITALISED}){1,4}|(?:${CAPITALISED}\\s+){1,4}(?:${LEGAL_FORMS})\\b`,
      'gu',
    ),
  },
  {
    kind: 'ADDRESS',
    re: new RegExp(
      `\\b\\d{1,4}(?:\\s?(?:bis|ter|quater|[A-D]))?,?\\s+(?:${STREET_TYPES})\\s+[^,;\\n\\d]{2,60}`,
      'giu',
    ),
  },
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Span {
  start: number;
  end: number;
  kind: TokenKind;
}

export class Pseudonymizer {
  readonly #tokenOf = new Map<string, string>();
  readonly #valueOf = new Map<string, string>();
  readonly #counters = new Map<TokenKind, number>();
  /** Values the caller declared personal (party names, addresses…), matched before the patterns. */
  readonly #known = new Map<string, TokenKind>();
  #knownRe: RegExp | null = null;

  /** Declares a value personal: every exact occurrence is masked, wherever it appears. */
  protect(kind: TokenKind, value: string | undefined): this {
    const v = value?.trim();
    if (v && v.length >= 2 && !this.#known.has(v)) {
      this.#known.set(v, kind);
      this.#knownRe = null;
    }
    return this;
  }

  /** The token for a value, created on first use. */
  token(kind: TokenKind, value: string): string {
    const existing = this.#tokenOf.get(value);
    if (existing) return existing;
    const n = (this.#counters.get(kind) ?? 0) + 1;
    this.#counters.set(kind, n);
    const token = `{{${kind}_${n}}}`;
    this.#tokenOf.set(value, token);
    this.#valueOf.set(token, value);
    return token;
  }

  #spans(text: string): Span[] {
    const taken: Span[] = [];
    const free = (start: number, end: number) =>
      taken.every((s) => end <= s.start || start >= s.end);
    const claim = (re: RegExp, kind: (match: string) => TokenKind) => {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const start = m.index;
        const end = start + m[0].length;
        if (m[0].length > 0 && free(start, end)) taken.push({ start, end, kind: kind(m[0]) });
      }
    };
    // Literal tokens first: a model must never confuse the user's own text with our tokens.
    claim(/\{\{[A-Z]+_\d+\}\}/g, () => 'LITERAL');
    if (this.#known.size > 0) {
      this.#knownRe ??= new RegExp(
        [...this.#known.keys()]
          .sort((a, b) => b.length - a.length)
          .map(escapeRe)
          .join('|'),
        'g',
      );
      claim(this.#knownRe, (m) => this.#known.get(m) ?? 'PARTY');
    }
    for (const d of DETECTORS) claim(d.re, () => d.kind);
    return taken.sort((a, b) => a.start - b.start);
  }

  /** Masks a free text. */
  mask(text: string): string {
    let out = '';
    let at = 0;
    for (const s of this.#spans(text)) {
      out += text.slice(at, s.start) + this.token(s.kind, text.slice(s.start, s.end));
      at = s.end;
    }
    return out + text.slice(at);
  }

  /** Re-hydrates a text; tokens this instance never issued are left as they are and listed. */
  unmask(text: string): { text: string; unknown: string[] } {
    const unknown: string[] = [];
    const out = text.replace(TOKEN, (token) => {
      const value = this.#valueOf.get(token);
      if (value === undefined) unknown.push(token);
      return value ?? token;
    });
    return { text: out, unknown };
  }

  /** unmask() over every string of a JSON-like value. */
  unmaskDeep<T>(value: T): { value: T; unknown: string[] } {
    const unknown: string[] = [];
    const walk = (v: unknown): unknown => {
      if (typeof v === 'string') {
        const r = this.unmask(v);
        unknown.push(...r.unknown);
        return r.text;
      }
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object')
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
      return v;
    };
    return { value: walk(value) as T, unknown };
  }
}
