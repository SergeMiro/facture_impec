// The columns of a list exported from an ERP, recognised by their French labels (docs/DECISIONS.md
// D9). A list export holds the columns the person shows in that list (EBP calls it « export
// paramétrable »), so no layout is fixed: a column is known by its label, whatever its place. The
// labels are common French usage, not a pilot's real file: TODO(verify) with the first pilot's
// exports from Batigest and EBP (docs/TODO.md).
import { normalizeHeader } from '@fi/core';

/** What a file lists: one entity, and for companies, which side. */
export const EXPORT_LISTS = ['customers', 'suppliers', 'chantiers'] as const;
export type ExportList = (typeof EXPORT_LISTS)[number];

export const TIERS_FIELDS = [
  'code',
  'name',
  'siren',
  'siret',
  'email',
  'line1',
  'line2',
  'postcode',
  'city',
  'country',
  'subcontracting',
  'category',
] as const;
export type TiersField = (typeof TIERS_FIELDS)[number];

export const CHANTIER_FIELDS = [
  'code',
  'name',
  'customerCode',
  'customerName',
  'customerSiren',
  'customerSiret',
  'line1',
  'postcode',
  'city',
  'status',
  'receptionOn',
  'reservesLiftedOn',
  'retenue',
] as const;
export type ChantierField = (typeof CHANTIER_FIELDS)[number];

/** Labels as `normalizeHeader` writes them: « N° client » is "n client", « E-mail » "e mail". */
type Labels<F extends string> = Readonly<Record<F, readonly string[]>>;

const ADDRESS = {
  line1: ['adresse', 'adresse 1', 'adresse1', 'adresse ligne 1', 'rue', 'voie'],
  postcode: ['code postal', 'cp', 'c p'],
  city: ['ville', 'localite', 'commune'],
};

const TIERS: Labels<TiersField> = {
  code: [
    'code',
    'code client',
    'code fournisseur',
    'code tiers',
    'n client',
    'no client',
    'numero client',
    'num client',
    'n fournisseur',
    'no fournisseur',
    'numero fournisseur',
    'num fournisseur',
    'reference',
    'ref',
    'ref client',
    'ref fournisseur',
    'identifiant',
  ],
  name: [
    'raison sociale',
    'nom',
    'nom raison sociale',
    'societe',
    'entreprise',
    'denomination',
    'intitule',
    'libelle',
    'designation',
    'client',
    'nom client',
    'nom du client',
    'fournisseur',
    'nom fournisseur',
    'nom du fournisseur',
  ],
  siren: ['siren', 'n siren', 'no siren', 'numero siren', 'code siren'],
  siret: [
    'siret',
    'n siret',
    'no siret',
    'numero siret',
    'code siret',
    'siren siret',
    'siret siren',
  ],
  email: [
    'e mail',
    'email',
    'mail',
    'courriel',
    'adresse e mail',
    'adresse email',
    'adresse mail',
    'e mail facturation',
    'email facturation',
    'mail facturation',
  ],
  ...ADDRESS,
  line1: [...ADDRESS.line1, 'adresse de facturation', 'adresse facturation'],
  line2: ['adresse 2', 'adresse2', 'adresse ligne 2', 'complement', 'complement d adresse'],
  country: ['pays', 'code pays'],
  subcontracting: ['sous traitant', 'sous traitance', 'est sous traitant'],
  category: [
    'famille',
    'categorie',
    'type',
    'type de tiers',
    'famille de tiers',
    'famille fournisseur',
    'type de fournisseur',
    'nature',
  ],
};

const CHANTIER: Labels<ChantierField> = {
  code: [
    'code',
    'code chantier',
    'n chantier',
    'no chantier',
    'numero chantier',
    'numero de chantier',
    'num chantier',
    'ref chantier',
    'reference chantier',
    'code affaire',
    'n affaire',
    'no affaire',
    'numero affaire',
    'numero d affaire',
    'affaire',
    'reference',
    'ref',
  ],
  name: [
    'libelle',
    'libelle chantier',
    'libelle du chantier',
    'libelle affaire',
    'nom',
    'nom du chantier',
    'nom chantier',
    'nom de l affaire',
    'chantier',
    'intitule',
    'intitule chantier',
    'designation',
    'objet',
    'description',
  ],
  customerCode: ['code client', 'n client', 'no client', 'numero client', 'ref client'],
  customerName: [
    'client',
    'nom client',
    'nom du client',
    'raison sociale',
    'raison sociale client',
    'maitre d ouvrage',
    'donneur d ordre',
  ],
  customerSiren: ['siren client', 'client siren', 'siren'],
  customerSiret: ['siret client', 'client siret', 'siret'],
  line1: [...ADDRESS.line1, 'adresse chantier', 'adresse du chantier', 'lieu', 'lieu du chantier'],
  postcode: [...ADDRESS.postcode, 'cp chantier', 'code postal chantier'],
  city: [...ADDRESS.city, 'ville chantier', 'ville du chantier'],
  status: ['statut', 'etat', 'statut chantier', 'etat chantier', 'etat du chantier', 'avancement'],
  receptionOn: [
    'date de reception',
    'date reception',
    'reception',
    'date pv de reception',
    'date du pv de reception',
    'pv de reception',
    'date de reception des travaux',
    'receptionne le',
  ],
  reservesLiftedOn: [
    'levee des reserves',
    'date de levee des reserves',
    'date levee des reserves',
    'levee reserves',
    'date levee reserves',
  ],
  retenue: [
    'retenue de garantie',
    'retenue garantie',
    'retenue de garantie %',
    'retenue %',
    'rg',
    '% rg',
    'rg %',
    'taux rg',
    'taux de rg',
    'taux retenue de garantie',
    'taux de retenue de garantie',
    'pourcentage rg',
  ],
};

export const LABELS = { customers: TIERS, suppliers: TIERS, chantiers: CHANTIER } as const;

export type FieldOf<L extends ExportList> = L extends 'chantiers' ? ChantierField : TiersField;

/** The field a header names in this list, if any. */
export function fieldOf<L extends ExportList>(list: L, header: string): FieldOf<L> | undefined {
  const h = normalizeHeader(header);
  if (h === '') return undefined;
  const labels = LABELS[list] as Labels<FieldOf<L>>;
  for (const field of Object.keys(labels) as FieldOf<L>[]) {
    if (labels[field].includes(h)) return field;
  }
  return undefined;
}

/**
 * The list a row of labels looks like: a chantier or an affaire is named, else the side its labels
 * say (« Code fournisseur »); undefined when nothing tells, and the person says.
 */
export function guessList(headers: readonly string[]): ExportList | undefined {
  const words = headers.map(normalizeHeader).join(' | ');
  if (/\b(chantier|affaire|reception|retenue|rg)\b/.test(words)) return 'chantiers';
  const supplier = /\bfournisseurs?\b/.test(words);
  const customer = /\bclients?\b/.test(words);
  if (supplier && !customer) return 'suppliers';
  if (customer && !supplier) return 'customers';
  return undefined;
}

/** What each list cannot do without: the person adds the column to the export. */
export const REQUIRED: { readonly [L in ExportList]: readonly (readonly FieldOf<L>[])[] } = {
  customers: [['name'], ['siren', 'siret']],
  suppliers: [['name'], ['siren', 'siret']],
  chantiers: [['code'], ['name']],
};
