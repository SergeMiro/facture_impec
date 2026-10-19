// 20 sheets for the LayoutAgent eval (R1: ≥ 95 % on the kind and the key fields), five of each kind:
// orders, delivery notes, purchases, price lists. Every name and number is invented. `expected` lists
// each key field's column; a field left out means the sheet has no such column and mapping one is an
// error.
import {
  type DocKind,
  type GridCell,
  grid,
  type KEY_LAYOUT_FIELDS,
  type SheetSnapshot,
} from '@fi/core';

type KeyField = (typeof KEY_LAYOUT_FIELDS)[number];

export interface LayoutFixture {
  name: string;
  /** What makes this sheet hard. */
  trap: string;
  snapshot: SheetSnapshot;
  expected: {
    kind: DocKind;
    headerRow: number;
    fields: Partial<Record<KeyField, string>>;
  };
}

const d = (serial: number, text: string): GridCell => ({ v: serial, t: text, f: 'dd/mm/yyyy' });
const OCT1 = d(46296, '01/10/2026');
const OCT2 = d(46297, '02/10/2026');
const OCT6 = d(46301, '06/10/2026');
const OCT9 = d(46304, '09/10/2026');
const OCT15 = d(46310, '15/10/2026');
const OCT20 = d(46315, '20/10/2026');
const NOV3 = d(46329, '03/11/2026');

const fixture = (
  name: string,
  trap: string,
  sheet: string,
  rows: readonly (readonly GridCell[])[],
  expected: LayoutFixture['expected'],
): LayoutFixture => ({ name, trap, snapshot: grid(sheet, rows), expected });

export const LAYOUT_FIXTURES: LayoutFixture[] = [
  // — Orders —
  fixture(
    'order-01-clean',
    'none: the baseline every reader must get right',
    'Commandes',
    [
      ['N° commande', 'Date', 'Client', 'Réf.', 'Désignation', 'Qté', 'PU HT', 'TVA'],
      ['C-2026-041', OCT1, 'Boulangerie Martin', 'TAB-01', 'Tabouret chêne', 4, 85, 20],
      ['C-2026-042', OCT2, 'Garage des Lilas', 'ETA-12', 'Étagère murale', 2, 140, 20],
      ['C-2026-043', OCT6, 'Cabinet Roux', 'BUR-03', 'Bureau compact', 1, 420, 20],
    ],
    {
      kind: 'order',
      headerRow: 1,
      fields: {
        docNumber: 'A',
        docDate: 'B',
        partyName: 'C',
        itemRef: 'D',
        itemName: 'E',
        quantity: 'F',
        unitPrice: 'G',
      },
    },
  ),
  fixture(
    'order-02-planned-delivery',
    'title rows, and a planned delivery date next to the order date',
    'Commandes clients',
    [
      ['CARNET DE COMMANDES — OCTOBRE 2026'],
      ['Menuiserie Dupont — 12 rue des Lilas, 21000 Dijon'],
      [],
      [
        'Cde n°',
        'Livraison prévue',
        'Date cde',
        'Client',
        'Code article',
        'Article',
        'Qté cdée',
        'Prix HT',
      ],
      ['2026-118', OCT20, OCT1, 'Fromagerie Bernard', 'PL-140', 'Plan de travail 140', 1, 310],
      ['2026-119', NOV3, OCT9, 'Pressing Lefèvre', 'CO-60', 'Comptoir 60', 1, 780],
      ['2026-120', NOV3, OCT15, 'Librairie Moreau', 'RA-90', 'Rayonnage 90', 6, 95],
    ],
    {
      kind: 'order',
      headerRow: 4,
      fields: {
        docNumber: 'A',
        docDate: 'C',
        partyName: 'D',
        itemRef: 'E',
        itemName: 'F',
        quantity: 'G',
        unitPrice: 'H',
      },
    },
  ),
  fixture(
    'order-03-lines-and-contact',
    'informal headers (« Qui », « Quoi », « Combien »), the number only on the first line, a contact',
    'Carnet de commandes',
    [
      ['N°', 'Le', 'Qui', 'Contact', 'Réf', 'Quoi', 'Combien', 'Prix pièce'],
      ['418', OCT2, 'Atelier Garnier', 'Mme Petit', 'VIT-2', 'Vitrine 2 portes', 1, 650],
      ['', '', '', '', 'TAB-01', 'Tabouret chêne', 6, 85],
      ['419', OCT6, 'Hôtel du Parc', 'M. Laurent', 'CHE-1', 'Chevet', 12, 120],
      ['', '', '', '', 'ETA-12', 'Étagère murale', 12, 140],
    ],
    {
      kind: 'order',
      headerRow: 1,
      fields: {
        docNumber: 'A',
        docDate: 'B',
        partyName: 'C',
        itemRef: 'E',
        itemName: 'F',
        quantity: 'G',
        unitPrice: 'H',
      },
    },
  ),
  fixture(
    'order-04-generic-name',
    'a sheet named « Feuil2 », a customer code before the name, a remainder column',
    'Feuil2',
    [
      [
        'N° commande',
        'Date',
        'Code client',
        'Nom client',
        'Article',
        'Qté',
        'Reliquat',
        'Prix unitaire',
      ],
      ['BC-77', OCT1, 'CL0042', 'Traiteur Blanc', 'Table pliante', 10, 4, 64],
      ['BC-78', OCT9, 'CL0017', 'École Saint-Joseph', 'Banc 2 m', 8, 0, 110],
      ['BC-79', OCT15, 'CL0042', 'Traiteur Blanc', 'Chaise empilable', 40, 40, 29],
    ],
    {
      kind: 'order',
      headerRow: 1,
      fields: {
        docNumber: 'A',
        docDate: 'B',
        partyName: 'D',
        itemName: 'E',
        quantity: 'F',
        unitPrice: 'H',
      },
    },
  ),
  fixture(
    'order-05-customer-reference',
    "the customer's own order reference, and a line amount next to the unit price",
    'Commandes',
    [
      [
        'N° commande',
        'Date',
        'Réf. client',
        'Client',
        'Réf. article',
        'Désignation',
        'Qté',
        'PU HT',
        'Montant HT',
        'TVA',
      ],
      ['C-501', OCT2, 'PO-88812', 'SARL Fontaine', 'PAN-10', 'Panneau acoustique', 12, 45, 540, 20],
      ['C-502', OCT9, 'BC2026/114', 'Mairie de Talant', 'BAN-2', 'Banc 2 m', 4, 110, 440, 20],
      ['C-503', OCT15, 'A-7741', 'SARL Fontaine', 'CLO-1', 'Cloison mobile', 2, 380, 760, 20],
    ],
    {
      kind: 'order',
      headerRow: 1,
      fields: {
        docNumber: 'A',
        docDate: 'B',
        partyName: 'D',
        itemRef: 'E',
        itemName: 'F',
        quantity: 'G',
        unitPrice: 'H',
      },
    },
  ),

  // — Delivery notes —
  fixture(
    'delivery-01-clean',
    'none: delivery notes with plain headers',
    'BL',
    [
      ['N° BL', 'Date livraison', 'Client', 'Réf.', 'Désignation', 'Qté livrée', 'PU HT'],
      ['BL-3301', OCT2, 'Boulangerie Martin', 'TAB-01', 'Tabouret chêne', 4, 85],
      ['BL-3302', OCT6, 'Garage des Lilas', 'ETA-12', 'Étagère murale', 2, 140],
      ['BL-3303', OCT9, 'Cabinet Roux', 'BUR-03', 'Bureau compact', 1, 420],
    ],
    {
      kind: 'delivery',
      headerRow: 1,
      fields: {
        docNumber: 'A',
        docDate: 'B',
        partyName: 'C',
        itemRef: 'D',
        itemName: 'E',
        quantity: 'F',
        unitPrice: 'G',
      },
    },
  ),
  fixture(
    'delivery-02-order-number',
    'the order number of each delivery note sits right next to its own number; no prices',
    'Bons de livraison',
    [
      ['N° BL', 'N° commande', 'Date', 'Client', 'Article', 'Qté'],
      ['L-901', 'C-2026-041', OCT6, 'Boulangerie Martin', 'Tabouret chêne', 4],
      ['L-902', 'C-2026-042', OCT9, 'Garage des Lilas', 'Étagère murale', 2],
      ['L-903', 'C-2026-043', OCT15, 'Cabinet Roux', 'Bureau compact', 1],
    ],
    {
      kind: 'delivery',
      headerRow: 1,
      fields: { docNumber: 'A', docDate: 'C', partyName: 'D', itemName: 'E', quantity: 'F' },
    },
  ),
  fixture(
    'delivery-03-ordered-and-delivered',
    'order date before the delivery date, ordered and remaining quantities around the delivered one',
    'Livraisons',
    [
      [
        'BL',
        'Commandé le',
        'Livré le',
        'Client',
        'Code',
        'Désignation',
        'Qté cdée',
        'Qté livrée',
        'Reliquat',
      ],
      ['7120', OCT1, OCT9, 'Hôtel du Parc', 'CHE-1', 'Chevet', 12, 8, 4],
      ['7121', OCT2, OCT9, 'Atelier Garnier', 'VIT-2', 'Vitrine 2 portes', 1, 1, 0],
      ['7122', OCT6, OCT15, 'Traiteur Blanc', 'TAB-PL', 'Table pliante', 10, 6, 4],
    ],
    {
      kind: 'delivery',
      headerRow: 1,
      fields: {
        docNumber: 'A',
        docDate: 'C',
        partyName: 'D',
        itemRef: 'E',
        itemName: 'F',
        quantity: 'H',
      },
    },
  ),
  fixture(
    'delivery-04-carrier',
    'a generic sheet name, a header on two rows, a carrier and a parcel count',
    'Feuil1',
    [
      ['Expéditions — semaine 41'],
      ['Livraison', '', 'Destinataire', 'Transporteur', 'Produit', '', 'Nombre de', ''],
      ['N°', 'Date', '', '', 'Réf.', 'Libellé', 'colis', 'pièces'],
      ['EX-5512', OCT6, 'Mairie de Talant', 'Transports Gauthier', 'BAN-2', 'Banc 2 m', 2, 4],
      [
        'EX-5513',
        OCT9,
        'SARL Fontaine',
        'Messagerie Rapide',
        'PAN-10',
        'Panneau acoustique',
        3,
        12,
      ],
      ['EX-5514', OCT9, 'École Saint-Joseph', 'Transports Gauthier', 'BAN-2', 'Banc 2 m', 4, 8],
    ],
    {
      kind: 'delivery',
      headerRow: 3,
      fields: {
        docNumber: 'A',
        docDate: 'B',
        partyName: 'C',
        itemRef: 'E',
        itemName: 'F',
        quantity: 'H',
      },
    },
  ),
  fixture(
    'delivery-05-lines-and-total',
    'the number and date only on the first line of each note, and a total row',
    'BL octobre',
    [
      ['N° BL', 'Date', 'Client', 'Réf', 'Désignation', 'Qté', 'Prix'],
      ['BL-88', OCT2, 'Hôtel du Parc', 'CHE-1', 'Chevet', 8, 120],
      ['', '', '', 'LAM-3', 'Lampe de chevet', 8, 35],
      ['BL-89', OCT9, 'Atelier Garnier', 'VIT-2', 'Vitrine 2 portes', 1, 650],
      ['', '', '', 'TAB-01', 'Tabouret chêne', 6, 85],
      ['Total', '', '', '', '', 23, ''],
    ],
    {
      kind: 'delivery',
      headerRow: 1,
      fields: {
        docNumber: 'A',
        docDate: 'B',
        partyName: 'C',
        itemRef: 'D',
        itemName: 'E',
        quantity: 'F',
        unitPrice: 'G',
      },
    },
  ),

  // — Purchases —
  fixture(
    'purchase-01-clean',
    'none: purchases with plain headers',
    'Achats',
    [
      [
        'N° commande',
        'Date',
        'Fournisseur',
        'Réf. fournisseur',
        'Article',
        'Qté',
        "Prix d'achat HT",
      ],
      ['A-301', OCT1, 'Bois du Morvan', 'CH-27', 'Chêne 27 mm (m²)', 12, 18.5],
      ['A-302', OCT6, 'Quincaillerie Roux', 'VS-440', 'Vis 4×40 (boîte)', 20, 6.9],
      ['A-303', OCT15, 'Vernis Leclerc', 'VN-5', 'Vernis mat 5 L', 3, 74],
    ],
    {
      kind: 'purchase',
      headerRow: 1,
      fields: {
        docNumber: 'A',
        docDate: 'B',
        partyName: 'C',
        itemRef: 'D',
        itemName: 'E',
        quantity: 'F',
        unitPrice: 'G',
      },
    },
  ),
  fixture(
    'purchase-02-sale-price-too',
    'the resale price and the margin next to the purchase price',
    'Achats',
    [
      [
        'N° achat',
        'Date achat',
        'Fournisseur',
        'Code',
        'Désignation',
        'Qté',
        'PA HT',
        'PV HT',
        'Marge',
      ],
      ['AC-12', OCT2, 'Luminaires Bonnet', 'LAM-3', 'Lampe de chevet', 20, 14, 35, 21],
      ['AC-13', OCT9, 'Textiles Mercier', 'COU-2', 'Coussin lin', 30, 9.5, 24, 14.5],
      ['AC-14', OCT15, 'Luminaires Bonnet', 'SUS-1', 'Suspension rotin', 6, 38, 89, 51],
    ],
    {
      kind: 'purchase',
      headerRow: 1,
      fields: {
        docNumber: 'A',
        docDate: 'B',
        partyName: 'C',
        itemRef: 'D',
        itemName: 'E',
        quantity: 'F',
        unitPrice: 'G',
      },
    },
  ),
  fixture(
    'purchase-03-english',
    'English headers',
    'Purchases',
    [
      ['PO #', 'Date', 'Supplier', 'SKU', 'Description', 'Qty', 'Unit cost'],
      ['PO-1007', OCT1, 'Nordic Timber AB', 'OAK-27', 'Oak board 27 mm', 40, 21],
      ['PO-1008', OCT9, 'Hafele Distribution', 'HNG-35', 'Hinge 35 mm', 200, 1.4],
      ['PO-1009', OCT20, 'Nordic Timber AB', 'ASH-20', 'Ash board 20 mm', 25, 17.5],
    ],
    {
      kind: 'purchase',
      headerRow: 1,
      fields: {
        docNumber: 'A',
        docDate: 'B',
        partyName: 'C',
        itemRef: 'D',
        itemName: 'E',
        quantity: 'F',
        unitPrice: 'G',
      },
    },
  ),
  fixture(
    'purchase-04-abbreviations',
    'a generic sheet name, « Frs » for the supplier, a job-site column that names a customer',
    'Feuil3',
    [
      ['Appro chantiers 2026'],
      [],
      [
        'Bon n°',
        'Date',
        'Frs',
        'SIRET frs',
        'Réf.',
        'Libellé',
        'Quantité',
        'Prix unitaire',
        'Chantier',
      ],
      [
        'B-61',
        OCT2,
        'Bois du Morvan',
        '41234567800017',
        'CH-27',
        'Chêne 27 mm (m²)',
        30,
        18.5,
        'Hôtel du Parc',
      ],
      [
        'B-62',
        OCT6,
        'Quincaillerie Roux',
        '52234567800012',
        'CHA-6',
        'Charnière invisible',
        48,
        3.2,
        'Atelier Garnier',
      ],
      [
        'B-63',
        OCT15,
        'Bois du Morvan',
        '41234567800017',
        'HE-18',
        'Hêtre 18 mm (m²)',
        12,
        15,
        'Mairie de Talant',
      ],
    ],
    {
      kind: 'purchase',
      headerRow: 3,
      fields: {
        docNumber: 'A',
        docDate: 'B',
        partyName: 'C',
        itemRef: 'E',
        itemName: 'F',
        quantity: 'G',
        unitPrice: 'H',
      },
    },
  ),
  fixture(
    'purchase-05-lines-discount-total',
    'supplier orders with the number on the first line only, a discount, a total row',
    'Commandes fournisseurs',
    [
      [
        'N° cde',
        'Date cde',
        'Fournisseur',
        'Réf. frs',
        'Désignation',
        'Qté',
        'Remise %',
        'PU achat HT',
        'Total HT',
      ],
      ['F-220', OCT1, 'Vernis Leclerc', 'VN-5', 'Vernis mat 5 L', 4, 10, 74, 266.4],
      ['', '', '', 'TE-1', 'Teinte noyer 1 L', 6, 10, 19, 102.6],
      ['F-221', OCT9, 'Textiles Mercier', 'COU-2', 'Coussin lin', 30, 0, 9.5, 285],
      ['Total', '', '', '', '', '', '', '', 654],
    ],
    {
      kind: 'purchase',
      headerRow: 1,
      fields: {
        docNumber: 'A',
        docDate: 'B',
        partyName: 'C',
        itemRef: 'D',
        itemName: 'E',
        quantity: 'F',
        unitPrice: 'H',
      },
    },
  ),

  // — Price lists —
  fixture(
    'price-01-clean',
    'none: a price list with plain headers',
    'Tarifs',
    [
      ['Réf.', 'Désignation', 'Unité', 'Prix HT', 'TVA'],
      ['TAB-01', 'Tabouret chêne', 'pièce', 85, 20],
      ['ETA-12', 'Étagère murale', 'pièce', 140, 20],
      ['POS-H', 'Pose (heure)', 'heure', 45, 20],
    ],
    {
      kind: 'price_list',
      headerRow: 1,
      fields: { itemRef: 'A', itemName: 'B', unitPrice: 'D' },
    },
  ),
  fixture(
    'price-02-cost-and-sale',
    'a purchase price, a coefficient and a price with VAT around the sale price',
    'Tarif 2026',
    [
      ['Code', 'Article', 'Famille', "Prix d'achat", 'Coef.', 'Prix de vente HT', 'Prix TTC'],
      ['LAM-3', 'Lampe de chevet', 'Luminaires', 14, 2.5, 35, 42],
      ['COU-2', 'Coussin lin', 'Textile', 9.5, 2.5, 24, 28.8],
      ['SUS-1', 'Suspension rotin', 'Luminaires', 38, 2.35, 89, 106.8],
    ],
    {
      kind: 'price_list',
      headerRow: 1,
      fields: { itemRef: 'A', itemName: 'B', unitPrice: 'F' },
    },
  ),
  fixture(
    'price-03-sections',
    'title rows and section rows between the articles',
    'Catalogue',
    [
      ['CATALOGUE PROFESSIONNEL 2026'],
      ['Prix nets hors taxes, franco à partir de 500 €'],
      [],
      ['Référence', 'Libellé', 'Conditionnement', 'PU HT'],
      ['MENUISERIE'],
      ['PL-140', 'Plan de travail 140', 'pièce', 310],
      ['CO-60', 'Comptoir 60', 'pièce', 780],
      ['ACCESSOIRES'],
      ['CHA-6', 'Charnière invisible', 'lot de 2', 8.9],
    ],
    {
      kind: 'price_list',
      headerRow: 4,
      fields: { itemRef: 'A', itemName: 'B', unitPrice: 'D' },
    },
  ),
  fixture(
    'price-04-generic-name',
    'a sheet named « Feuil1 » and a quantity-discount column',
    'Feuil1',
    [
      ['Code article', 'Désignation', 'Prix unitaire HT', 'Remise quantité', 'Taux TVA'],
      ['BAN-2', 'Banc 2 m', 110, '5 % dès 10', 20],
      ['PAN-10', 'Panneau acoustique', 45, '10 % dès 50', 20],
      ['CLO-1', 'Cloison mobile', 380, '', 20],
    ],
    {
      kind: 'price_list',
      headerRow: 1,
      fields: { itemRef: 'A', itemName: 'B', unitPrice: 'C' },
    },
  ),
  fixture(
    'price-05-validity-and-supplier',
    'validity dates and a usual-supplier column on a price list',
    'Tarifs',
    [
      ['Réf', 'Produit', 'Prix HT', 'Valable du', 'au', 'Fournisseur habituel'],
      ['OAK-27', 'Plateau chêne 27 mm', 96, OCT1, NOV3, 'Bois du Morvan'],
      ['HNG-35', 'Charnière 35 mm', 4.5, OCT1, NOV3, 'Quincaillerie Roux'],
      ['VN-5', 'Vernis mat 5 L', 119, OCT1, NOV3, 'Vernis Leclerc'],
    ],
    {
      kind: 'price_list',
      headerRow: 1,
      fields: { itemRef: 'A', itemName: 'B', unitPrice: 'C' },
    },
  ),
];
