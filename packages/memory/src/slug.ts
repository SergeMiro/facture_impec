// A page's path, made once from its facts and then kept (memory doc §4): readable in the Explorer,
// the same on Windows, macOS and Linux (lowercase ASCII, no space), short enough for Windows' path
// limit. A path never changes when a name does: the page is found again by its keys (SIREN, ERP
// reference, number), not by its path.
import type { PageFacts } from './compile';
import type { PagePath } from './types';

const MAX_SEGMENT = 60;

/** « Électricité Marc & Fils » → `electricite-marc-fils`. */
export function slugify(text: string, max = MAX_SEGMENT): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
  return slug || 'sans-nom';
}

/** The last segment of a page's path: `tiers/marc-elec` → `marc-elec`. */
const leaf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

const DOCUMENT_NAMES = {
  facture_vente: 'facture',
  facture_achat: 'achat',
  avoir: 'avoir',
  devis: 'devis',
  commande: 'commande',
} as const;

/** Where a new page goes; `taken` says whether a path is already another page's. */
export function pagePath(
  facts: PageFacts,
  taken: (path: string) => boolean = () => false,
): PagePath {
  return unique(firstPath(facts), taken);
}

function firstPath(f: PageFacts): string {
  switch (f.type) {
    case 'tiers':
      return `tiers/${slugify(f.title)}`;
    case 'chantier':
      return `chantiers/${f.start ? `${f.start.slice(0, 4)}-` : ''}${slugify(f.title, 50)}`;
    case 'facture_vente':
    case 'facture_achat':
    case 'avoir':
    case 'devis':
    case 'commande': {
      const date = 'issue_date' in f ? f.issue_date : f.date;
      return `finances/${date.slice(0, 4)}/${date}_${DOCUMENT_NAMES[f.type]}_${slugify(leaf(f.party), 24)}_${slugify(f.number, 24)}`;
    }
    case 'situation':
      return `finances/situations/${slugify(leaf(f.chantier), 40)}_sit-${f.number}`;
    case 'article':
      return `catalogue/${slugify(f.title)}`;
    case 'attestation_vigilance':
    case 'kbis':
    case 'attestation_assurance_decennale':
    case 'attestation_assurance_rc':
      return `juridique/${slugify(leaf(f.party), 40)}/${f.type.replace(/_/g, '-')}_${f.valid_from}`;
    case 'salarie':
      return `rh/${slugify(f.title)}`;
    case 'document':
      return `juridique/${f.party ? slugify(leaf(f.party), 40) : 'divers'}/${f.date ?? 'sans-date'}_${slugify(f.kind, 30)}_${slugify(f.title, 30)}`;
  }
}

/** `path`, or `path-2`, `path-3`… when it is taken. */
function unique(path: string, taken: (path: string) => boolean): PagePath {
  if (!taken(path)) return path;
  for (let n = 2; ; n++) if (!taken(`${path}-${n}`)) return `${path}-${n}`;
}
