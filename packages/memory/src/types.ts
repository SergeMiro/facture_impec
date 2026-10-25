// The memory's page types (memory doc §4, docs/DECISIONS.md D12): what each page's frontmatter holds.
// Only code writes a frontmatter, through these schemas; a model writes the page's text. Amounts are
// euros with cents as text in the file (« 12400.00 », what a person reads in Obsidian) and integer
// cents in code; dates are ISO days. Field names are the file's, snake_case as YAML is usually written.
import { DocumentKind } from '@fi/domain';
import { z } from 'zod';

/** Written in `_schema.md`; a vault of a newer version is refused (memory doc §10). */
export const MEMORY_SCHEMA_VERSION = 1;

export const SECTIONS = ['tiers', 'chantiers', 'finances', 'juridique', 'catalogue', 'rh'] as const;
export type Section = (typeof SECTIONS)[number];

const SEGMENT = '[a-z0-9][a-z0-9_-]*';
/** A page's path in the vault, without `.md`: `tiers/marc-elec`, `finances/situations/2026-hugo_sit-3`. */
export const PagePath = z
  .string()
  .regex(new RegExp(`^(${SECTIONS.join('|')})(/${SEGMENT})+$`), 'not a page path');
export type PagePath = z.infer<typeof PagePath>;

export const sectionOf = (path: string) => path.split('/')[0] as Section;

/**
 * Where a fact comes from: a file of `raw/`, or a record the caller vouches for (an invoice sent
 * here, a document, an ERP row, a platform event, a sheet, a person).
 */
export const SourceRef = z
  .string()
  .regex(/^(raw\/\S+|(invoice|document|erp|pdp|sheet|user):\S+)$/, 'not a source');

export const IsoDate = z.iso.date();

/** « 12400.00 » in the file, 1240000 in code; a number a person typed (12400) is read too. */
export const Money = z.codec(
  z.union([z.string().regex(/^-?\d+(\.\d{1,2})?$/), z.number().multipleOf(0.01)]),
  z.int(),
  {
    decode: (v) => Math.round(Number(v) * 100),
    encode: (cents) => (cents / 100).toFixed(2),
  },
);

export const LINK_KINDS = [
  'works_on',
  'issued_by',
  'issued_to',
  'belongs_to',
  'covers',
  'fulfils',
  'uses',
  'supplied_by',
  'succeeds',
  'employs',
  'mentioned_in',
] as const;
export const LinkKind = z.enum(LINK_KINDS);
export type LinkKind = z.infer<typeof LinkKind>;

/**
 * How a link was found (memory doc §7): an identifier in the document, a match on the data, or a
 * model's reading, which a person confirms before anything relies on it.
 */
export const LinkConfidence = z.enum(['exact', 'strong', 'inferred']);
export type LinkConfidence = z.infer<typeof LinkConfidence>;

/** The rules that find links by code (`link-rules.ts`), and how sure each one is. */
export const LINK_RULES = {
  party: 'exact',
  chantier: 'exact',
  project_ref: 'exact',
  order_ref: 'exact',
  quote_ref: 'exact',
  previous_situation: 'exact',
  line_article: 'exact',
  supplier: 'exact',
  contract_site: 'exact',
  line_code: 'strong',
  line_name: 'strong',
  order_match: 'strong',
  quote_match: 'strong',
  invoice_site: 'strong',
  order_near: 'inferred',
  quote_near: 'inferred',
  text_chantier: 'inferred',
  text_quote: 'inferred',
  line_words: 'inferred',
} as const satisfies Record<string, LinkConfidence>;
export type LinkRule = keyof typeof LINK_RULES;
export const LinkRule = z.enum(Object.keys(LINK_RULES) as [LinkRule, ...LinkRule[]]);

/**
 * A link this page makes: its kind, its target, how sure, and on what (a field or a quote). A rule's
 * link names its rule and is made again at every write; a model's has none; a person's confirmation
 * says who and when.
 */
export const Link = z.object({
  kind: LinkKind,
  to: PagePath,
  confidence: LinkConfidence,
  evidence: z.string().min(1),
  rule: LinkRule.optional(),
  confirmed_by: z.string().min(1).optional(),
});
export type Link = z.infer<typeof Link>;

/** A link another page makes to this one: compile writes it, a patch never does. */
export const Backlink = z.object({ kind: LinkKind, from: PagePath });
export type Backlink = z.infer<typeof Backlink>;

const head = {
  title: z.string().min(1),
  sources: z.array(SourceRef).min(1),
  updated: IsoDate,
};
const tail = {
  /** Numbers read from a file by OCR or a model, and how sure the reading was: never prepared on. */
  extracted: z.object({ confidence: z.number().min(0).max(1) }).optional(),
  links: z.array(Link).optional(),
  backlinks: z.array(Backlink).optional(),
  /** Links a person said were wrong: no rule makes them again. */
  refused_links: z.array(z.object({ kind: LinkKind, to: PagePath })).optional(),
};

const Line = z.object({
  label: z.string().min(1),
  quantity: z.number().optional(),
  unit_price: Money.optional(),
  amount: Money,
  article: PagePath.optional(),
  /** The article's code as the document writes it (BT-155): the seller's own. */
  code: z.string().min(1).optional(),
});

const Tiers = z.object({
  type: z.literal('tiers'),
  ...head,
  roles: z.array(z.enum(['client', 'fournisseur', 'sous_traitant'])).min(1),
  siren: z
    .string()
    .regex(/^\d{9}$/)
    .optional(),
  siret: z
    .string()
    .regex(/^\d{14}$/)
    .optional(),
  vat_id: z.string().optional(),
  email: z.email().optional(),
  erp_ref: z.string().optional(),
  ...tail,
});

const Chantier = z.object({
  type: z.literal('chantier'),
  ...head,
  client: PagePath.optional(),
  status: z.enum(['en_cours', 'receptionne', 'clos']),
  start: IsoDate.optional(),
  reception_date: IsoDate.optional(),
  retenue_pct: z.number().min(0).max(100).optional(),
  erp_ref: z.string().optional(),
  ...tail,
});

const invoiceLike = <T extends 'facture_vente' | 'facture_achat' | 'avoir'>(type: T) =>
  z.object({
    type: z.literal(type),
    ...head,
    number: z.string().min(1),
    party: PagePath,
    issue_date: IsoDate,
    due_date: IsoDate.optional(),
    ht: Money,
    tva: Money,
    ttc: Money,
    chantier: PagePath.optional(),
    /**
     * References as the document writes them: BT-11 the chantier's, BT-13 the buyer's order (a
     * purchase order, or our quote's number copied there), BT-14 the seller's order.
     */
    project_ref: z.string().min(1).optional(),
    order_ref: z.string().min(1).optional(),
    sales_order_ref: z.string().min(1).optional(),
    lines: z.array(Line).optional(),
    paid_at: IsoDate.optional(),
    ...tail,
  });

const Situation = z.object({
  type: z.literal('situation'),
  ...head,
  chantier: PagePath,
  number: z.int().min(1),
  cumul_ht: Money,
  party: PagePath.optional(),
  issue_date: IsoDate.optional(),
  due_date: IsoDate.optional(),
  ht: Money.optional(),
  ttc: Money.optional(),
  retenue: Money.optional(),
  ...tail,
});

const Devis = z.object({
  type: z.literal('devis'),
  ...head,
  number: z.string().min(1),
  party: PagePath,
  chantier: PagePath.optional(),
  date: IsoDate,
  status: z.enum(['brouillon', 'envoye', 'accepte', 'refuse']),
  ht: Money.optional(),
  ttc: Money.optional(),
  lines: z.array(Line).optional(),
  ...tail,
});

const Commande = z.object({
  type: z.literal('commande'),
  ...head,
  number: z.string().min(1),
  party: PagePath,
  chantier: PagePath.optional(),
  date: IsoDate,
  ht: Money.optional(),
  lines: z.array(Line).optional(),
  ...tail,
});

const Article = z.object({
  type: z.literal('article'),
  ...head,
  unit: z.string().optional(),
  suppliers: z.array(PagePath).optional(),
  /** Its codes: the suppliers' and the company's own. */
  codes: z.array(z.string().min(1)).optional(),
  last_price: Money.optional(),
  stock: z.number().optional(),
  ...tail,
});

const standing = <
  T extends
    | 'attestation_vigilance'
    | 'kbis'
    | 'attestation_assurance_decennale'
    | 'attestation_assurance_rc',
>(
  type: T,
) =>
  z.object({
    type: z.literal(type),
    ...head,
    party: PagePath,
    valid_from: IsoDate,
    valid_to: IsoDate,
    ...tail,
  });

const Salarie = z.object({
  type: z.literal('salarie'),
  ...head,
  contract: z.enum(['cdi', 'cdd', 'apprentissage', 'interim', 'autre']),
  start: IsoDate,
  end: IsoDate.optional(),
  visite_medicale_due: IsoDate.optional(),
  ...tail,
});

/** Any other document worth a page (a PV de réception, a DGD, a contract). */
const Document = z.object({
  type: z.literal('document'),
  ...head,
  kind: DocumentKind,
  party: PagePath.optional(),
  chantier: PagePath.optional(),
  date: IsoDate.optional(),
  ...tail,
});

export const Frontmatter = z.discriminatedUnion('type', [
  Tiers,
  Chantier,
  invoiceLike('facture_vente'),
  invoiceLike('facture_achat'),
  invoiceLike('avoir'),
  Situation,
  Devis,
  Commande,
  Article,
  standing('attestation_vigilance'),
  standing('kbis'),
  standing('attestation_assurance_decennale'),
  standing('attestation_assurance_rc'),
  Salarie,
  Document,
]);
/** As code holds it: amounts in cents. */
export type Frontmatter = z.output<typeof Frontmatter>;
export type PageType = Frontmatter['type'];

/** Where each type's pages live. */
export const TYPE_SECTION: Record<PageType, Section> = {
  tiers: 'tiers',
  chantier: 'chantiers',
  facture_vente: 'finances',
  facture_achat: 'finances',
  avoir: 'finances',
  situation: 'finances',
  devis: 'finances',
  commande: 'finances',
  article: 'catalogue',
  attestation_vigilance: 'juridique',
  kbis: 'juridique',
  attestation_assurance_decennale: 'juridique',
  attestation_assurance_rc: 'juridique',
  salarie: 'rh',
  document: 'juridique',
};

/** Each type's schema, for `_schema.md`. */
export const TYPE_SCHEMAS = Object.fromEntries(
  Frontmatter.options.map((o) => [o.shape.type.value, o]),
) as Record<PageType, (typeof Frontmatter.options)[number]>;
