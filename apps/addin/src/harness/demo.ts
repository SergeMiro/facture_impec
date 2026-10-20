// The harness's sample sheet: invented companies, three invoices. F2026-101 is clean; F2026-102 has
// a mistyped SIREN (E3) and F2026-103 no date (B4), the two errors a new user fixes from the fiche.
import type { FakeCell } from '../excel/fake';

const date = (text: string, serial: number): FakeCell => ({
  value: serial,
  text,
  format: 'dd/mm/yyyy',
});
const VAT: FakeCell = { value: 0.2, text: '20%', format: '0%' };
const money = (n: number): FakeCell => ({
  value: n,
  text: `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`,
  format: '#,##0.00 €',
});

const HEADERS = [
  'N° Facture',
  'Date',
  'Date de prestation',
  'Client',
  'SIREN',
  'Adresse',
  'Code postal',
  'Ville',
  'Désignation',
  'Qté',
  'P.U. HT',
  'TVA',
];

const ROWS: (string | number | FakeCell)[][] = [
  [
    'F2026-101',
    date('12/10/2026', 46307),
    date('09/10/2026', 46304),
    'Boulangerie Martin SAS',
    '200 000 008',
    '8 place du Marché',
    '21000',
    'Dijon',
    'Journée de conseil',
    2,
    money(450),
    VAT,
  ],
  [
    'F2026-102',
    date('13/10/2026', 46308),
    date('10/10/2026', 46305),
    'Garage Dupont',
    '200 000 009',
    '3 rue de la Gare',
    '21000',
    'Dijon',
    'Audit atelier',
    1,
    money(900),
    VAT,
  ],
  [
    'F2026-103',
    '',
    date('11/10/2026', 46306),
    'Fleurs & Co',
    '300 000 007',
    '1 quai Nord',
    '69001',
    'Lyon',
    'Formation Excel',
    3,
    money(300),
    VAT,
  ],
];

const COLS = 'ABCDEFGHIJKL';

export function demoSheet(): Record<string, FakeCell | string | number> {
  const cells: Record<string, FakeCell | string | number> = {};
  HEADERS.forEach((h, i) => {
    cells[`${COLS[i]}1`] = h;
  });
  ROWS.forEach((row, r) => {
    row.forEach((value, c) => {
      if (value !== '') cells[`${COLS[c]}${r + 2}`] = value;
    });
  });
  return cells;
}

export const DEMO_SHEET = 'Factures';

/** Customer orders (R1), for the « Registre »: C-41 spans two rows, C-42 one. */
export const DEMO_ORDERS = 'Commandes';
const ORDER_HEADERS = ['N° commande', 'Date', 'Client', 'Réf.', 'Désignation', 'Qté', 'PU HT'];
const ORDER_ROWS: (string | number | FakeCell)[][] = [
  [
    'C-41',
    date('01/10/2026', 46296),
    'Boulangerie Martin',
    'TAB-01',
    'Tabouret chêne',
    4,
    money(85),
  ],
  ['', '', '', 'ETA-12', 'Étagère murale', 1, money(140)],
  [
    'C-42',
    date('06/10/2026', 46301),
    'Garage des Lilas',
    'ETA-12',
    'Étagère murale',
    2,
    money(140),
  ],
];

function table(rows: (string | number | FakeCell)[][]): Record<string, FakeCell | string | number> {
  const cells: Record<string, FakeCell | string | number> = {};
  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      if (value !== '') cells[`${COLS[c]}${r + 1}`] = value;
    });
  });
  return cells;
}

export const demoOrders = () => table([ORDER_HEADERS, ...ORDER_ROWS]);

/** What the company bought (R3): the « Audit atelier » it resells, at 800 €, then at 1 000 €. */
export const DEMO_PURCHASES = 'Achats';
const PURCHASE_HEADERS = [
  'N° achat',
  'Date',
  'Fournisseur',
  'Désignation',
  'Qté',
  'Prix d’achat HT',
];
const PURCHASE_ROWS: (string | number | FakeCell)[][] = [
  ['A-6', date('01/09/2026', 46266), 'Audits Associés', 'Audit atelier', 1, money(800)],
  ['A-7', date('01/10/2026', 46296), 'Audits Associés', 'Audit atelier', 1, money(1000)],
];

export const demoPurchases = () => table([PURCHASE_HEADERS, ...PURCHASE_ROWS]);

/** The header row and the three invoices, cells as the harness holds them. */
export const demoTable = (): (string | number | FakeCell)[][] => [HEADERS, ...ROWS];

/** The company the demo sheet invoices from: invented, the SIREN of the API's scenarios. */
export const DEMO_SELLER = {
  name: 'Atelier Dupont SARL',
  siren: '100000009',
  vatId: 'FR88100000009',
  address: { line1: '12 rue des Lilas', city: 'Dijon', postCode: '21000', country: 'FR' },
};
/** Its invoice defaults (Réglages): with them, F2026-101 passes every rule. */
export const DEMO_DEFAULTS = {
  siret: '10000000900017',
  iban: 'FR7630006000011234567890189',
  paymentDays: 30,
  operationCategory: 'services' as const,
};
export const DEMO_OWNER = 'gerante@atelier-dupont.test';
