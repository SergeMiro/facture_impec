// The columns of a list exported from an ERP, recognised by their French labels (docs/DECISIONS.md
// D9). A list export holds the columns the person shows in that list (EBP calls it « export
// paramétrable »), so no layout is fixed: a column is known by its label, whatever its place. The
// labels are common French usage, not a pilot's real file: TODO(verify) with the first pilot's
// exports from Batigest and EBP (docs/TODO.md).
import { normalizeHeader } from '@fi/core';

/** What a file lists: one entity, and for companies, which side. */
export const EXPORT_LISTS = [
  'customers',
  'suppliers',
  'chantiers',
  'invoices',
  'payments',
] as const;
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

/** A sale or a situation the company invoiced (stage 4B). */
export const INVOICE_FIELDS = [
  'number',
  'type',
  'issuedOn',
  'dueOn',
  'customerCode',
  'customerName',
  'customerSiren',
  'customerSiret',
  'chantierCode',
  'chantierName',
  'total',
  'left',
  'situation',
] as const;
export type InvoiceField = (typeof INVOICE_FIELDS)[number];

/** A payment a customer made, by its invoice's number (stage 4B). */
export const PAYMENT_FIELDS = [
  'invoiceNumber',
  'paidOn',
  'amount',
  'mode',
  'reference',
  'customerName',
] as const;
export type PaymentField = (typeof PAYMENT_FIELDS)[number];

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

const INVOICE_NUMBER = [
  'n facture',
  'no facture',
  'numero facture',
  'numero de facture',
  'num facture',
  'ref facture',
  'reference facture',
  'facture',
];

const INVOICE: Labels<InvoiceField> = {
  number: [
    ...INVOICE_NUMBER,
    'n piece',
    'no piece',
    'numero piece',
    'numero de piece',
    'piece',
    'n document',
    'numero document',
    'numero',
    'n',
  ],
  type: ['type', 'type de piece', 'type piece', 'type de document', 'nature', 'nature de piece'],
  issuedOn: [
    'date',
    'date facture',
    'date de facture',
    'date de la facture',
    'date piece',
    'date de piece',
    'date d emission',
    'date emission',
  ],
  dueOn: [
    'echeance',
    'date echeance',
    'date d echeance',
    'date de l echeance',
    'date limite de paiement',
    'date limite de reglement',
    'a payer le',
  ],
  customerCode: CHANTIER.customerCode,
  customerName: CHANTIER.customerName,
  customerSiren: CHANTIER.customerSiren,
  customerSiret: CHANTIER.customerSiret,
  chantierCode: [
    'code chantier',
    'n chantier',
    'no chantier',
    'numero chantier',
    'numero de chantier',
    'ref chantier',
    'code affaire',
    'n affaire',
    'no affaire',
    'numero affaire',
    'numero d affaire',
  ],
  chantierName: [
    'chantier',
    'affaire',
    'libelle chantier',
    'libelle du chantier',
    'nom du chantier',
    'nom chantier',
    'libelle affaire',
  ],
  total: [
    'montant ttc',
    'total ttc',
    'ttc',
    'net a payer',
    'net a payer ttc',
    'montant',
    'total',
    'montant total',
  ],
  left: [
    'reste a payer',
    'reste du',
    'restant du',
    'reste a regler',
    'reste a encaisser',
    'montant restant',
    'restant',
    'solde',
    'solde du',
  ],
  situation: [
    'n situation',
    'no situation',
    'numero situation',
    'numero de situation',
    'situation n',
  ],
};

const PAYMENT: Labels<PaymentField> = {
  invoiceNumber: [
    ...INVOICE_NUMBER,
    'facture reglee',
    'n piece',
    'no piece',
    'numero piece',
    'piece',
    'n document',
  ],
  paidOn: [
    'date',
    'date reglement',
    'date de reglement',
    'date du reglement',
    'date paiement',
    'date de paiement',
    'date encaissement',
    'date d encaissement',
    'regle le',
    'paye le',
    'encaisse le',
  ],
  amount: [
    'montant',
    'montant regle',
    'montant reglement',
    'montant du reglement',
    'montant encaisse',
    'montant paye',
    'montant ttc',
    'somme',
    'regle',
    'encaissement',
  ],
  mode: [
    'mode',
    'mode de reglement',
    'mode reglement',
    'mode de paiement',
    'moyen de paiement',
    'type de reglement',
  ],
  reference: [
    'n reglement',
    'no reglement',
    'numero reglement',
    'numero de reglement',
    'ref reglement',
    'reference reglement',
    'reference',
    'ref',
    'n cheque',
    'numero de cheque',
    'n remise',
  ],
  customerName: ['client', 'nom client', 'nom du client', 'raison sociale'],
};

export const LABELS = {
  customers: TIERS,
  suppliers: TIERS,
  chantiers: CHANTIER,
  invoices: INVOICE,
  payments: PAYMENT,
} as const;

export type FieldOf<L extends ExportList> = L extends 'chantiers'
  ? ChantierField
  : L extends 'invoices'
    ? InvoiceField
    : L extends 'payments'
      ? PaymentField
      : TiersField;

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

/** What only an invoice list says: when it falls due, what is left to pay, the situation. */
const DUE =
  /\b(echeance|reste a payer|reste du|restant du|reste a regler|(n|no|numero|numero de) situation)\b/;
/** A payment's own labels; a list of customers may have a « Mode de règlement », so not that one. */
const PAID =
  /\b(date (de |du |d )?(reglement|paiement|encaissement)|montant (du )?(regle|reglement|encaisse|paye)|(n|no|numero|numero de|ref|reference) reglement|facture reglee|reglements|encaissements)\b/;
const INVOICE_NAMED = /\b(n|no|num|numero|numero de|date|date de) facture\b/;
/** An amount: a list of customers may show its payment terms as « Échéance », not an amount due. */
const AMOUNT = /\b(ttc|net a payer|montant|reste a payer|reste du|restant du|reste a regler)\b/;

/**
 * The list a row of labels looks like: invoices by their due date or what is left to pay (an invoice
 * list may also show what was paid), payments by their date or amount paid (they name their invoice
 * too), then a chantier or an affaire named, else the side its labels say (« Code fournisseur »);
 * undefined when nothing tells, and the person says.
 */
export function guessList(headers: readonly string[]): ExportList | undefined {
  const words = headers.map(normalizeHeader).join(' | ');
  if (DUE.test(words) && (AMOUNT.test(words) || INVOICE_NAMED.test(words))) return 'invoices';
  if (PAID.test(words)) return 'payments';
  if (INVOICE_NAMED.test(words)) return 'invoices';
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
  invoices: [['number'], ['dueOn'], ['total', 'left']],
  payments: [['invoiceNumber'], ['amount']],
};
