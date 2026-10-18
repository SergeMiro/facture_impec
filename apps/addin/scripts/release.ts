// The store build of the manifest and the checks on the listing (docs/APPSOURCE.md). Pure functions:
// scripts/appsource.ts reads and writes the files.

/** The dev server every URL of manifest.xml points at. */
export const DEV_ORIGIN = 'https://localhost:3000';

export interface ReleaseUrls {
  /** Where taskpane.html and assets/ are served, https, e.g. https://app.example.fr or …/addin. */
  addin: string;
  /** A public page that needs no sign-in (§1: not GitHub, not a shared document). */
  support: string;
  /** « En savoir plus » under the ribbon's Get Started callout. */
  learnMore: string;
}

/** a.b.c.d, a in 1–9999 and b, c, d in 0–9999 (docs/APPSOURCE.md §1). */
export function isStoreVersion(version: string): boolean {
  const parts = version.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,4}$/.test(p))) return false;
  return Number(parts[0]) >= 1;
}

function publicHttps(url: string, what: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`${what}: not a URL (${url})`);
  }
  if (u.protocol !== 'https:') throw new Error(`${what}: must be https (${url})`);
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname) || u.hostname.endsWith('.local')) {
    throw new Error(`${what}: must be public, not ${u.hostname}`);
  }
  if (/(^|\.)example\.(com|org|net)$/.test(u.hostname)) {
    throw new Error(`${what}: still a placeholder (${u.hostname})`);
  }
  return u;
}

const attr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * manifest.xml for the store: every dev URL on the public host, the support and help pages, the
 * version, and no <AppDomains> (§1: the task pane's own domain needs none; Stripe opens in a browser
 * window or a dialog, which need none either).
 */
export function productionManifest(xml: string, urls: ReleaseUrls, version: string): string {
  if (!isStoreVersion(version)) throw new Error(`version: a.b.c.d expected, got ${version}`);
  const addin = publicHttps(urls.addin, 'add-in URL');
  if (addin.search || addin.hash) throw new Error('add-in URL: no query or fragment');
  const base = attr(addin.toString().replace(/\/$/, ''));
  publicHttps(urls.support, 'support URL');
  publicHttps(urls.learnMore, 'help URL');

  let out = xml
    .replace(/<!-- Development manifest[\s\S]*?-->\n/, '')
    .replace(/\n\s*<AppDomains>[\s\S]*?<\/AppDomains>/, '')
    .replace(/<Version>[^<]*<\/Version>/, `<Version>${version}</Version>`)
    .replace(/(<SupportUrl DefaultValue=")[^"]*(")/, `$1${attr(urls.support)}$2`)
    .replace(
      /(<bt:Url id="GetStarted\.LearnMoreUrl" DefaultValue=")[^"]*(")/,
      `$1${attr(urls.learnMore)}$2`,
    )
    .replaceAll(DEV_ORIGIN, base);
  out = out.replace(
    /(<\?xml[^>]*\?>\n)/,
    `$1<!-- Store manifest built by \`pnpm appsource:package\` from apps/addin/manifest.xml (docs/APPSOURCE.md). -->\n`,
  );
  const left = /localhost|example\.(com|org|net)/.exec(out);
  if (left) throw new Error(`manifest: a development URL is left (${left[0]})`);
  return out;
}

export interface Listing {
  name: string;
  summary: string;
  description: string;
  keywords: string[];
}

/** Partner Center limits (docs/APPSOURCE.md §2), in characters. */
export const LISTING_LIMITS = { name: 50, summary: 100, description: 4000 } as const;
/** Required in a listing written in French only (policy 100.1.4). */
export const ENGLISH_NOTICE = 'This application is available in French.';
/** Marks what the owner still has to write (prices, legal pages). */
export const TO_FILL = /⟨[^⟩]*⟩/g;

/** The listing's sections: `## Nom`, `## Résumé`, `## Description`, `## Mots-clés` (one per line). */
export function parseListing(markdown: string): Listing {
  const sections = new Map<string, string>();
  for (const part of markdown.split(/^## /m).slice(1)) {
    const [title = '', ...rest] = part.split('\n');
    sections.set(title.trim(), rest.join('\n').trim());
  }
  const get = (title: string) => {
    const value = sections.get(title);
    if (value === undefined) throw new Error(`listing: section « ${title} » is missing`);
    return value;
  };
  return {
    name: get('Nom'),
    summary: get('Résumé'),
    description: get('Description'),
    keywords: get('Mots-clés')
      .split('\n')
      .map((k) => k.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean),
  };
}

/** What stops the submission; an empty list means the listing can go to Partner Center. */
export function listingProblems(listing: Listing): string[] {
  const problems: string[] = [];
  for (const field of ['name', 'summary', 'description'] as const) {
    const length = [...listing[field]].length;
    if (length > LISTING_LIMITS[field]) {
      problems.push(`${field}: ${length} characters, at most ${LISTING_LIMITS[field]}`);
    }
  }
  const description = listing.description.trim();
  if (!description.startsWith(ENGLISH_NOTICE) && !description.endsWith(ENGLISH_NOTICE)) {
    problems.push(`description: must begin or end with « ${ENGLISH_NOTICE} »`);
  }
  if (/\b(free|gratuit)\b|!/i.test(listing.name)) {
    problems.push('name: no « free », « gratuit » or « ! »');
  }
  const blanks = Object.values(listing).flat().join('\n').match(TO_FILL) ?? [];
  for (const blank of new Set(blanks)) problems.push(`to fill in: ${blank}`);
  return problems;
}

/** A cell as the harness holds it (src/excel/fake.ts). */
type SampleCell = string | number | { value: unknown; text: string; format?: string };

/**
 * The demo sheet as tab-separated text the reviewers paste into Excel, whatever its language: ISO dates
 * and plain numbers, which every locale reads the same (a reviewer's 12/10/2026 could be 10 December).
 */
export function reviewerSample(table: SampleCell[][]): string {
  const cell = (c: SampleCell): string => {
    if (typeof c !== 'object') return String(c);
    if (c.format === 'dd/mm/yyyy' && typeof c.value === 'number') {
      return new Date((c.value - 25_569) * 86_400_000).toISOString().slice(0, 10);
    }
    if (c.format?.endsWith('%')) return c.text;
    return typeof c.value === 'number' ? String(c.value) : c.text;
  };
  return table.map((row) => row.map(cell).join('\t')).join('\n');
}
