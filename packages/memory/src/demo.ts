// The demo vault (docs/plans/memory.md M1): a small BTP company's memory made by a seeded generator,
// 30 companies, 5 chantiers, 200 documents, 20 articles and the mails they came with, and 100
// questions whose answers the generator knows. Every name, number and IBAN is made up (the IBANs
// use bank code 99999, which no French bank has). Recall is measured on it; lint (M2) will be too.
// `pnpm vault:demo` writes it to `fixtures/vault-demo/`; a test makes it again and compares.
import { compile, type PageFacts, type PageWrite } from './compile';
import { addRaw } from './raw';
import type { RecallQuery } from './recall';
import { pagePath, slugify } from './slug';
import type { Link } from './types';

export const DEMO_NOW = new Date('2026-10-25T10:00:00Z');
const TODAY = '2026-10-25';

/** One golden question: the query, and what a right answer is. */
export interface Golden {
  id: string;
  query: RecallQuery;
  expect: {
    status: 'found' | 'ambiguous' | 'not_found';
    /** The deepest level a right answer may come from. */
    level: 1 | 2 | 3 | 4 | 5 | 6;
    /** The pages (or `raw/` file) that answer; all of them for a list. */
    paths?: string[];
    value?: unknown;
  };
}

interface Original {
  name: string;
  at: Date;
  text: string;
  ref: string;
}

/** mulberry32: the same numbers for the same seed, on every machine. */
function random(seed: number) {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(list: readonly T[]): T => list[int(0, list.length - 1)] as T;
  return { next, int, pick };
}

const day = (iso: string, plus: number) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + plus * 86_400_000).toISOString().slice(0, 10);
const euros = (cents: number) => (cents / 100).toFixed(2);

/** A SIREN whose Luhn key is right. */
function siren(rng: ReturnType<typeof random>): string {
  const digits = Array.from({ length: 8 }, () => rng.int(0, 9));
  digits[0] = rng.int(3, 9);
  for (let last = 0; last <= 9; last++) {
    const all = [...digits, last];
    const sum = all.reduce((s, d, i) => {
      const v = i % 2 === 1 ? d * 2 : d;
      return s + (v > 9 ? v - 9 : v);
    }, 0);
    if (sum % 10 === 0) return all.join('');
  }
  return `${digits.join('')}0`;
}

const vatOf = (s: string) => `FR${String((12 + 3 * (Number(s) % 97)) % 97).padStart(2, '0')}${s}`;

/** A French IBAN at bank 99999, with its check digits right. */
function iban(rng: ReturnType<typeof random>): string {
  const bban = `99999${String(rng.int(10000, 99999))}${String(rng.int(10000000, 99999999))}${String(rng.int(100, 999))}${String(rng.int(10, 97))}`;
  const numeric = `${bban}152700`; // F=15 R=27 then 00
  let rest = 0;
  for (const ch of numeric) rest = (rest * 10 + Number(ch)) % 97;
  const check = String(98 - rest).padStart(2, '0');
  return `FR${check}${bban}`.replace(/(.{4})/g, '$1 ').trim();
}

const CLIENTS = [
  'SCI Les Tilleuls',
  'SCI Clos des Vignes',
  'Résidence Le Parc SAS',
  'Habitat Bourgogne Est',
  'Cabinet Médical des Lilas',
  'Boulangerie Petit Frères',
  'Hôtel du Lac Kir',
];
const SUPPLIERS = [
  'Matériaux Rousseau',
  'Bois et Panneaux Girard',
  'Carrelages Fontaine',
  'Quincaillerie Bonnet',
  'Béton Prêt Vincent',
  'Plâtres Lambert',
  'Sanitaires Faure',
  'Électro-Distribution Muller',
  'Peintures Roux',
  'Isolants Fournier',
  'Location Engins Michel',
  'Tuiles Simon',
];
const SUBCONTRACTORS = [
  'Électricité Moreau',
  'Plomberie Martin',
  'Menuiserie Dubois',
  'Peinture Laurent',
  'Charpente Leroy',
  'Maçonnerie Bernard',
  'Couverture Lefèvre',
  'Chauffage Dupont',
  'Isolation Garnier',
  'Carrelage Chevalier',
];
/** [article, its supplier's index in SUPPLIERS, unit, price in cents] */
const ARTICLES: [string, number, string, number][] = [
  ['Ciment CEM II 35 kg', 0, 'sac', 945],
  ['Sable 0/4 big bag', 0, 'big bag', 6_800],
  ['Parpaing creux 20x20x50', 0, 'unité', 162],
  ['Enduit de façade 25 kg', 0, 'sac', 2_390],
  ['Panneau OSB 18 mm', 1, 'm²', 1_480],
  ['Chevron sapin 63x75', 1, 'ml', 590],
  ['Carrelage grès cérame 60x60', 2, 'm²', 3_290],
  ['Colle carrelage C2', 2, 'sac', 2_150],
  ['Vis à bois 5x60', 3, 'boîte', 1_290],
  ['Béton C25/30', 4, 'm³', 13_900],
  ['Plaque de plâtre BA13', 5, 'm²', 520],
  ['Rail métallique R48', 5, 'ml', 310],
  ['WC suspendu complet', 6, 'unité', 31_900],
  ['Tube PER 16', 6, 'ml', 120],
  ['Câble R2V 3G2,5', 7, 'ml', 145],
  ['Tableau électrique 3 rangées', 7, 'unité', 18_900],
  ['Peinture acrylique blanche 15 L', 8, 'pot', 8_990],
  ['Laine de verre 100 mm', 9, 'm²', 690],
  ['Mini-pelle à la journée', 10, 'jour', 21_000],
  ['Tuile terre cuite romane', 11, 'm²', 3_450],
];
const SITES: [string, number][] = [
  ['Résidence Les Tilleuls 12 logements', 0],
  ['Extension Clos des Vignes', 1],
  ['Rénovation Le Parc bâtiment B', 2],
  ['Cabinet médical des Lilas', 4],
  ['Hôtel du Lac Kir façade', 6],
];
const WORKS = [
  'reprise des fissures en façade nord',
  'pose des menuiseries du rez-de-chaussée',
  'réfection de la toiture côté cour',
  'création des cloisons du premier étage',
  'raccordement du tableau électrique',
  'pose du carrelage des sanitaires',
  'isolation des combles perdus',
  'peinture des parties communes',
  'remplacement de la chaudière',
  'terrassement et fondations',
];

const exact = (kind: Link['kind'], to: string, evidence: string): Link => ({
  kind,
  to,
  confidence: 'exact',
  evidence,
});
const strong = (kind: Link['kind'], to: string, evidence: string): Link => ({
  kind,
  to,
  confidence: 'strong',
  evidence,
});

/** The demo company's memory and the questions asked of it. */
export function demoVault(seed = 2026) {
  const rng = random(seed);
  const pages: PageWrite[] = [];
  const originals: Original[] = [];
  const golden: Golden[] = [];
  const taken = new Set<string>();
  const add = (frontmatter: PageFacts, text: string): string => {
    const path = pagePath(frontmatter, (p) => taken.has(p));
    taken.add(path);
    pages.push({ path, frontmatter, text });
    return path;
  };
  const original = (name: string, at: string, text: string): string => {
    const dot = name.lastIndexOf('.');
    const ref = `raw/${at.slice(0, 4)}/${at.slice(5, 7)}/${slugify(name.slice(0, dot), 80)}${name.slice(dot)}`;
    originals.push({ name, at: new Date(`${at}T09:00:00Z`), text, ref });
    return ref;
  };
  const ask = (query: RecallQuery, expect: Golden['expect']) =>
    golden.push({ id: `q${String(golden.length + 1).padStart(3, '0')}`, query, expect });

  // Companies.
  interface Company {
    name: string;
    path: string;
    siren: string;
    email: string;
    role: 'client' | 'fournisseur' | 'sous_traitant';
  }
  const companies: Company[] = [];
  const company = (name: string, role: Company['role']) => {
    const s = siren(rng);
    const email = `contact@${slugify(name)}.example`;
    const path = add(
      {
        type: 'tiers',
        title: name,
        sources: [`erp:tiers-${companies.length + 1}`],
        roles: [role],
        siren: s,
        siret: `${s}${String(rng.int(10, 99)).padStart(5, '0')}`,
        vat_id: vatOf(s),
        email,
        erp_ref: `T${String(companies.length + 1).padStart(4, '0')}`,
      },
      `${name}, ${role === 'client' ? 'client' : role === 'fournisseur' ? 'fournisseur' : 'sous-traitant'} de l'entreprise depuis ${rng.int(2015, 2025)}.`,
    );
    const c = { name, path, siren: s, email, role };
    companies.push(c);
    return c;
  };
  const clients = CLIENTS.map((n) => company(n, 'client'));
  const suppliers = SUPPLIERS.map((n) => company(n, 'fournisseur'));
  const subs = SUBCONTRACTORS.map((n) => company(n, 'sous_traitant'));
  // The same company entered twice, under two SIRENs: recall must not pick one.
  const twin = company('Électricité Moreau SARL', 'sous_traitant');
  const moreau = subs[0] as Company;

  // Articles.
  const articles = ARTICLES.map(([title, s, unit, price]) => {
    const supplier = suppliers[s] as Company;
    const path = add(
      {
        type: 'article',
        title,
        sources: [`erp:article-${slugify(title)}`],
        unit,
        suppliers: [supplier.path],
        last_price: price,
        links: [strong('supplied_by', supplier.path, 'Fournisseur habituel')],
      },
      `${title}, vendu au ${unit} par ${supplier.name}.`,
    );
    return { title, path, supplier, unit, price };
  });

  // Chantiers and who works on them.
  const sites = SITES.map(([title, c], i) => {
    const client = clients[c] as Company;
    const start = day('2026-01-12', i * 35);
    const status = i < 2 ? 'receptionne' : 'en_cours';
    const path = add(
      {
        type: 'chantier',
        title,
        sources: [`erp:chantier-${i + 1}`],
        client: client.path,
        status,
        start,
        ...(status === 'receptionne' && { reception_date: day(start, 180) }),
        retenue_pct: 5,
        erp_ref: `CH-${2026}-${String(i + 1).padStart(2, '0')}`,
      },
      `Chantier pour ${client.name}, commencé le ${start}.`,
    );
    return { title, path, client, start, status, crew: [] as Company[] };
  });
  subs.forEach((s, i) => {
    const site = sites[i % sites.length] as (typeof sites)[number];
    site.crew.push(s);
  });
  // A sous-traitant's page says where it works (the page is rewritten with its links).
  for (const s of subs) {
    const page = pages.find((p) => p.path === s.path) as PageWrite;
    const where = sites.filter((site) => site.crew.includes(s));
    page.frontmatter = {
      ...page.frontmatter,
      links: where.map((site) => strong('works_on', site.path, 'Contrat de sous-traitance')),
    };
  }

  // Documents: 200 of them.
  const docs = { vente: [] as string[], achat: [] as string[] };
  interface Sale {
    path: string;
    number: string;
    client: Company;
    site: string;
    paid: boolean;
    ttc: number;
    due: string;
    devis?: { path: string; number: string };
  }
  const sales: Sale[] = [];
  const quotes: { path: string; number: string }[] = [];
  // 25 quotes.
  for (let i = 0; i < 25; i++) {
    const site = sites[i % sites.length] as (typeof sites)[number];
    const number = `D-2026-${String(i + 1).padStart(3, '0')}`;
    const date = day(site.start, -20 + i);
    const ht = rng.int(2_000, 60_000) * 100;
    const path = add(
      {
        type: 'devis',
        title: `Devis ${number}`,
        sources: [`document:devis-${i + 1}`],
        number,
        party: site.client.path,
        chantier: site.path,
        date,
        status: i < 20 ? 'accepte' : i < 23 ? 'envoye' : 'refuse',
        ht,
        ttc: Math.round(ht * 1.2),
        links: [
          exact('issued_to', site.client.path, 'Client du devis'),
          exact('belongs_to', site.path, 'Chantier du devis'),
        ],
      },
      `Devis pour la ${rng.pick(WORKS)}.`,
    );
    quotes.push({ path, number });
  }
  // 40 sales invoices; the first 15 carry out a quote.
  for (let i = 0; i < 40; i++) {
    const site = sites[i % sites.length] as (typeof sites)[number];
    const number = `F-2026-${String(i + 1).padStart(3, '0')}`;
    const issue = day('2026-02-02', i * 6);
    const due = day(issue, 30);
    const ht = rng.int(1_500, 45_000) * 100;
    const tva = Math.round(ht * 0.2);
    const paid = due < '2026-09-01' && i % 4 !== 3;
    const quote = i < 15 ? quotes[i] : undefined;
    const path = add(
      {
        type: 'facture_vente',
        title: `Facture ${number}`,
        sources: [`invoice:sale-${i + 1}`],
        number,
        party: site.client.path,
        issue_date: issue,
        due_date: due,
        ht,
        tva,
        ttc: ht + tva,
        chantier: site.path,
        ...(paid && { paid_at: day(due, rng.int(-10, 12)) }),
        links: [
          exact('issued_to', site.client.path, 'SIREN de la facture'),
          exact('belongs_to', site.path, 'Référence chantier (BT-11)'),
          ...(quote ? [exact('fulfils', quote.path, `Devis ${quote.number} (BT-13)`)] : []),
        ],
      },
      `Facture de ${rng.pick(WORKS)} pour ${site.client.name}.`,
    );
    docs.vente.push(path);
    sales.push({
      path,
      number,
      client: site.client,
      site: site.path,
      paid,
      ttc: ht + tva,
      due,
      ...(quote && { devis: quote }),
    });
  }
  // 20 situations: 4 per chantier.
  const situations: { path: string; site: string; n: number; cumul: number }[] = [];
  for (const site of sites) {
    let cumul = 0;
    for (let n = 1; n <= 4; n++) {
      const ht = rng.int(8_000, 40_000) * 100;
      cumul += ht;
      const issue = day(site.start, n * 30);
      const path = add(
        {
          type: 'situation',
          title: `Situation n°${n} ${site.title}`,
          sources: [`sheet:situation-${slugify(site.title)}-${n}`],
          chantier: site.path,
          number: n,
          cumul_ht: cumul,
          party: site.client.path,
          issue_date: issue,
          due_date: day(issue, 45),
          ht,
          ttc: Math.round(ht * 1.2),
          retenue: Math.round(ht * 0.05),
          links: [
            exact('belongs_to', site.path, 'Chantier de la situation'),
            exact('issued_to', site.client.path, 'Client du chantier'),
          ],
        },
        `Situation de travaux n°${n} : avancement ${n * 22} %.`,
      );
      situations.push({ path, site: site.path, n, cumul });
    }
  }
  // 60 purchase invoices: the first 20 came by mail and keep it in raw/.
  interface Purchase {
    path: string;
    number: string;
    supplier: Company;
    ttc: number;
    site?: string;
  }
  const purchases: Purchase[] = [];
  for (let i = 0; i < 60; i++) {
    const article = articles[i % articles.length] as (typeof articles)[number];
    const supplier = article.supplier;
    const site = i % 7 === 6 ? undefined : (sites[i % sites.length] as (typeof sites)[number]);
    const number = `${supplier.name.slice(0, 2).toUpperCase()}-${rng.int(10000, 99999)}`;
    const issue = day('2026-01-20', i * 4);
    const quantity = rng.int(5, 120);
    const ht = quantity * article.price;
    const tva = Math.round(ht * 0.2);
    const sources = [`invoice:purchase-${i + 1}`];
    if (i < 20) {
      sources.push(
        original(
          `Facture ${number}.eml`,
          issue,
          [
            `De : facturation@${slugify(supplier.name)}.example`,
            `Objet : Facture ${number}`,
            '',
            'Bonjour,',
            `Veuillez trouver notre facture ${number} du ${issue} : ${quantity} ${article.unit} de ${article.title}, ${euros(ht + tva)} € TTC.`,
            site ? `Livraison sur le chantier ${site.title}.` : 'Livraison au dépôt.',
            'Cordialement,',
            supplier.name,
          ].join('\n'),
        ),
      );
    }
    const extra =
      {
        8: ' Livraison de nuit à la demande du chef de chantier.',
        13: ` Livraison au dépôt ; code du portail du chantier ${(sites[3] as (typeof sites)[number]).title} : 4512.`,
        20: ' Palette consignée, à rendre au fournisseur.',
        27: ` Pour le chantier ${(sites[1] as (typeof sites)[number]).title}, la benne à gravats passe le lundi matin.`,
        30: ' Déchargement par camion-grue.',
      }[i] ?? '';
    const path = add(
      {
        type: 'facture_achat',
        title: `Facture ${number} ${supplier.name}`,
        sources,
        number,
        party: supplier.path,
        issue_date: issue,
        due_date: day(issue, 45),
        ht,
        tva,
        ttc: ht + tva,
        ...(site && { chantier: site.path }),
        lines: [
          {
            label: article.title,
            quantity,
            unit_price: article.price,
            amount: ht,
            article: article.path,
          },
        ],
        links: [
          exact('issued_by', supplier.path, 'SIREN du vendeur'),
          ...(site ? [strong('belongs_to', site.path, 'Adresse de livraison')] : []),
          strong('uses', article.path, 'Désignation de la ligne'),
        ],
      },
      `${quantity} ${article.unit} de ${article.title}.${extra}`,
    );
    docs.achat.push(path);
    purchases.push({ path, number, supplier, ttc: ht + tva, ...(site && { site: site.path }) });
  }
  // 25 purchase orders.
  for (let i = 0; i < 25; i++) {
    const article = articles[(i * 3) % articles.length] as (typeof articles)[number];
    const site = sites[i % sites.length] as (typeof sites)[number];
    const number = `BC-2026-${String(i + 1).padStart(3, '0')}`;
    add(
      {
        type: 'commande',
        title: `Commande ${number}`,
        sources: [`document:commande-${i + 1}`],
        number,
        party: article.supplier.path,
        chantier: site.path,
        date: day('2026-01-15', i * 9),
        ht: rng.int(10, 80) * article.price,
        links: [
          exact('issued_to', article.supplier.path, 'Fournisseur de la commande'),
          exact('belongs_to', site.path, 'Chantier de la commande'),
        ],
      },
      `Commande de ${article.title} pour ${site.title}.`,
    );
  }
  // 20 standing documents: vigilance and decennale for each sous-traitant.
  const vigilance = new Map<string, { path: string; to: string }>();
  for (const [i, s] of subs.entries()) {
    const from = day('2026-07-01', i * 7);
    const to = day(from, 180);
    const path = add(
      {
        type: 'attestation_vigilance',
        title: `Attestation de vigilance ${s.name}`,
        sources: [`document:vigilance-${i + 1}`],
        party: s.path,
        valid_from: from,
        valid_to: to,
        links: [exact('covers', s.path, 'SIREN de l’attestation')],
      },
      `Attestation URSSAF de ${s.name}.`,
    );
    vigilance.set(s.path, { path, to });
    add(
      {
        type: 'attestation_assurance_decennale',
        title: `Attestation décennale ${s.name}`,
        sources: [`document:decennale-${i + 1}`],
        party: s.path,
        valid_from: '2026-01-01',
        valid_to: '2026-12-31',
        links: [exact('covers', s.path, 'SIREN de l’attestation')],
      },
      `Assurance décennale de ${s.name} pour 2026.`,
    );
  }
  // 10 other documents: a PV de réception for the two finished chantiers, 8 sous-traitance contracts.
  for (const site of sites.filter((s) => s.status === 'receptionne')) {
    add(
      {
        type: 'document',
        title: `PV de réception ${site.title}`,
        sources: [`document:pv-${slugify(site.title)}`],
        kind: 'pv_reception',
        party: site.client.path,
        chantier: site.path,
        date: day(site.start, 180),
        links: [exact('belongs_to', site.path, 'Chantier du PV')],
      },
      'Réception prononcée sans réserve.',
    );
  }
  for (const s of subs.slice(0, 8)) {
    const site = sites.find((x) => x.crew.includes(s)) as (typeof sites)[number];
    add(
      {
        type: 'document',
        title: `Contrat de sous-traitance ${s.name}`,
        sources: [`document:contrat-${slugify(s.name)}`],
        kind: 'contrat_sous_traitance',
        party: s.path,
        chantier: site.path,
        date: day(site.start, -5),
        links: [
          exact('belongs_to', site.path, 'Chantier du contrat'),
          exact('issued_to', s.path, 'Sous-traitant du contrat'),
        ],
      },
      `Contrat de sous-traitance pour ${site.title}.`,
    );
  }

  // Mails no page cites yet: new bank details from four suppliers, and one nobody filed.
  const ribs = suppliers.slice(0, 4).map((s, i) => {
    const value = iban(rng);
    const ref = original(
      `Nouveau RIB ${s.name}.eml`,
      day('2026-09-01', i * 9),
      [
        `De : compta@${slugify(s.name)}.example`,
        'Objet : Changement de coordonnées bancaires',
        '',
        'Bonjour,',
        'Veuillez noter notre nouveau RIB pour vos prochains règlements.',
        `IBAN : ${value}`,
        'BIC : DEMOFRPPXXX',
        'Cordialement,',
        s.name,
      ].join('\n'),
    );
    return { supplier: s, ref, line: `IBAN : ${value}` };
  });
  const lost = original(
    'Accès dépôt.eml',
    '2026-10-02',
    [
      'Objet : Accès au dépôt de Chenôve',
      '',
      'Le cadenas du dépôt de Chenôve a été changé : nouveau code 7731.',
    ].join('\n'),
  );

  // The questions.
  const fact = (
    question: string,
    subject: RecallQuery['subject'],
    field: string,
    path: string,
    value: unknown,
    level: Golden['expect']['level'] = 1,
  ) =>
    ask(
      { intent: 'fact', question, ...(subject && { subject }), field },
      { status: 'found', level, paths: [path], value },
    );
  const others = companies.filter((c) => c !== moreau && c !== twin);
  for (const c of others.slice(0, 10)) {
    fact(
      `Quel est le SIREN de ${c.name} ?`,
      { by: 'name', value: c.name },
      'siren',
      c.path,
      c.siren,
    );
  }
  for (const c of others.slice(10, 16)) {
    fact(`Quelle est l'adresse e-mail de ${c.name} ?`, undefined, 'email', c.path, c.email);
  }
  for (const c of others.slice(23, 28)) {
    fact(
      `Quel est le numéro de TVA de ${c.name} ?`,
      { by: 'name', value: c.name },
      'vat_id',
      c.path,
      vatOf(c.siren),
    );
  }
  for (const c of others.slice(0, 4)) {
    fact(`À qui appartient le SIREN ${c.siren} ?`, undefined, 'title', c.path, c.name);
  }
  for (const s of sales.slice(0, 10)) {
    fact(
      `Quel est le montant TTC de la facture ${s.number} ?`,
      undefined,
      'ttc',
      s.path,
      euros(s.ttc),
    );
  }
  for (const s of sales.slice(10, 16)) {
    fact(
      `Quand la facture ${s.number} est-elle due ?`,
      { by: 'number', value: s.number },
      'due_date',
      s.path,
      s.due,
    );
  }
  for (const p of purchases.slice(0, 8)) {
    fact(
      `Combien fait la facture ${p.number} de ${p.supplier.name} ?`,
      { by: 'number', value: p.number },
      'ttc',
      p.path,
      euros(p.ttc),
    );
  }
  for (const site of sites) {
    fact(
      `Qui est le client du chantier ${site.title} ?`,
      { by: 'name', value: site.title },
      'client',
      site.path,
      site.client.path,
    );
  }
  for (const a of articles.slice(0, 4)) {
    fact(
      `Quel est le dernier prix de ${a.title} ?`,
      undefined,
      'last_price',
      a.path,
      euros(a.price),
    );
  }
  for (const sit of situations.filter((x) => x.n === 3).slice(0, 3)) {
    const site = sites.find((s) => s.path === sit.site) as (typeof sites)[number];
    const leaf = site.path.slice(site.path.indexOf('/') + 1);
    fact(
      `Quel est le cumul HT de la situation 3 du chantier ${site.title} ?`,
      { by: 'number', value: `${leaf} 3` },
      'cumul_ht',
      sit.path,
      euros(sit.cumul),
    );
  }
  // Is it already here? (before a page is made, or a document read twice)
  for (const s of sales.slice(20, 23)) {
    ask(
      {
        intent: 'exists',
        question: `La facture ${s.number} est-elle déjà enregistrée ?`,
        subject: { by: 'number', value: s.number },
      },
      { status: 'found', level: 1, paths: [s.path] },
    );
  }
  // The twin: one name, two pages, two SIRENs.
  ask(
    {
      intent: 'exists',
      question: `Avons-nous déjà une page pour ${moreau.name} ?`,
      subject: { by: 'name', value: moreau.name },
      type: 'tiers',
    },
    { status: 'ambiguous', level: 1, paths: [moreau.path, twin.path] },
  );
  ask(
    {
      intent: 'fact',
      question: `Quel est le SIREN de ${moreau.name} ?`,
      subject: { by: 'name', value: moreau.name },
      field: 'siren',
      mustBeExhaustive: true,
    },
    { status: 'ambiguous', level: 1, paths: [moreau.path, twin.path] },
  );

  // Level 2: one or two links away.
  for (const s of suppliers.slice(0, 4)) {
    ask(
      {
        intent: 'list',
        question: `Quelles factures avons-nous reçues de ${s.name} ?`,
        subject: { by: 'name', value: s.name },
        type: 'facture_achat',
        via: ['issued_by'],
      },
      {
        status: 'found',
        level: 2,
        paths: purchases.filter((p) => p.supplier === s).map((p) => p.path),
      },
    );
  }
  for (const site of sites.slice(0, 3)) {
    ask(
      {
        intent: 'list',
        question: `Quelles situations pour le chantier ${site.title} ?`,
        subject: { by: 'name', value: site.title },
        type: 'situation',
        via: ['belongs_to'],
      },
      {
        status: 'found',
        level: 2,
        paths: situations.filter((x) => x.site === site.path).map((x) => x.path),
      },
    );
    ask(
      {
        intent: 'list',
        question: `Quels sous-traitants travaillent sur ${site.title} ?`,
        subject: { by: 'name', value: site.title },
        type: 'tiers',
        via: ['works_on'],
      },
      { status: 'found', level: 2, paths: site.crew.map((c) => c.path) },
    );
  }
  for (const s of subs.slice(1, 5)) {
    const v = vigilance.get(s.path) as { path: string; to: string };
    ask(
      {
        intent: 'fact',
        question: `Jusqu'à quand l'attestation de vigilance de ${s.name} est-elle valable ?`,
        subject: { by: 'name', value: s.name },
        type: 'attestation_vigilance',
        via: ['covers'],
        field: 'valid_to',
      },
      { status: 'found', level: 2, paths: [v.path], value: v.to },
    );
  }
  for (const s of sales.filter((x) => x.devis).slice(0, 3)) {
    const quote = s.devis as { path: string; number: string };
    ask(
      {
        intent: 'fact',
        question: `Quel devis la facture ${s.number} exécute-t-elle ?`,
        subject: { by: 'number', value: s.number },
        type: 'devis',
        via: ['fulfils'],
        field: 'number',
      },
      { status: 'found', level: 2, paths: [quote.path], value: quote.number },
    );
  }
  for (const c of clients.slice(0, 2)) {
    ask(
      {
        intent: 'list',
        question: `Quelles factures de ${c.name} restent impayées ?`,
        subject: { by: 'name', value: c.name },
        type: 'facture_vente',
        via: ['issued_to'],
        unset: ['paid_at'],
      },
      {
        status: 'found',
        level: 2,
        paths: sales.filter((s) => s.client === c && !s.paid).map((s) => s.path),
      },
    );
  }
  for (const c of [clients[2], clients[4]] as Company[]) {
    ask(
      {
        intent: 'list',
        question: `Sur quels chantiers travaillons-nous pour ${c.name} ?`,
        subject: { by: 'name', value: c.name },
        type: 'chantier',
        via: ['issued_to', 'belongs_to'],
      },
      { status: 'found', level: 2, paths: sites.filter((s) => s.client === c).map((s) => s.path) },
    );
  }

  // Levels 3 and 4: full-text.
  const night = docs.achat[8] as string;
  ask(
    {
      intent: 'fact',
      question: "Quelle facture d'achat parle d'une livraison de nuit ?",
      type: 'facture_achat',
      match: ['livraison', 'nuit'],
    },
    { status: 'found', level: 3, paths: [night] },
  );
  for (const [i, words] of [
    [20, ['palette', 'consignee']],
    [30, ['camion', 'grue']],
  ] as const) {
    ask(
      {
        intent: 'fact',
        question: `Quelle facture d'achat mentionne ${words.join(' ')} ?`,
        type: 'facture_achat',
        match: [...words],
      },
      { status: 'found', level: 3, paths: [docs.achat[i] as string] },
    );
  }
  const lilas = sites[3] as (typeof sites)[number];
  ask(
    {
      intent: 'fact',
      question: `Quel est le code du portail du chantier ${lilas.title} ?`,
      subject: { by: 'name', value: lilas.title },
      match: ['code', 'portail'],
    },
    { status: 'found', level: 4, paths: [docs.achat[13] as string] },
  );
  const vignes = sites[1] as (typeof sites)[number];
  ask(
    {
      intent: 'fact',
      question: `Quand passe la benne à gravats du chantier ${vignes.title} ?`,
      subject: { by: 'name', value: vignes.title },
      match: ['benne', 'gravats'],
    },
    { status: 'found', level: 4, paths: [docs.achat[27] as string] },
  );

  // Level 5: only a mail says it; the answer goes onto the company's page.
  for (const r of ribs) {
    ask(
      {
        intent: 'fact',
        question: `Quel est l'IBAN de ${r.supplier.name} ?`,
        subject: { by: 'name', value: r.supplier.name },
        match: ['iban'],
      },
      { status: 'found', level: 5, paths: [r.ref] },
    );
  }
  ask(
    {
      intent: 'fact',
      question: 'Quel est le code du cadenas du dépôt de Chenôve ?',
      match: ['code', 'cadenas'],
    },
    { status: 'found', level: 5, paths: [lost] },
  );

  // Level 6: nothing, and recall must say so.
  ask(
    {
      intent: 'fact',
      question: `Quel est l'IBAN de ${(suppliers[8] as Company).name} ?`,
      subject: { by: 'name', value: (suppliers[8] as Company).name },
      match: ['iban'],
    },
    { status: 'not_found', level: 6 },
  );
  ask(
    {
      intent: 'fact',
      question: 'Quel est le SIREN de Terrassements Inconnus ?',
      subject: { by: 'name', value: 'Terrassements Inconnus' },
      field: 'siren',
    },
    { status: 'not_found', level: 6 },
  );
  ask(
    {
      intent: 'list',
      question: 'Quelles factures parlent de la piscine ?',
      type: 'facture_vente',
      match: ['piscine'],
    },
    { status: 'not_found', level: 6 },
  );

  return { pages, originals, golden, today: TODAY };
}

/** Writes the demo vault into the empty folder `root`. */
export async function writeDemoVault(
  root: string,
  seed = 2026,
): Promise<ReturnType<typeof demoVault>> {
  const demo = demoVault(seed);
  for (const o of demo.originals) {
    const ref = await addRaw(
      root,
      { name: o.name, bytes: new TextEncoder().encode(o.text), text: o.text },
      o.at,
    );
    if (ref !== o.ref) throw new Error(`${o.name}: kept as ${ref}, expected ${o.ref}`);
  }
  const done = await compile(
    root,
    { reason: 'ingest', actor: 'agent:demo', pages: demo.pages, note: 'vault de démonstration' },
    { now: DEMO_NOW, sourceExists: () => true },
  );
  if (!done.ok) throw new Error(`demo vault: ${done.code} ${done.detail}`);
  return demo;
}
