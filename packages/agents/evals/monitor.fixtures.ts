// Customer refusals for the MonitorAgent eval: the platform's reason codes (docs/B2BROUTER.md §7) and
// free texts, each with the proposal a careful bookkeeper would make. Synthetic companies only.
import type { MonitorInvoice, MonitorProposal } from '../src/monitor';

export interface MonitorFixture {
  name: string;
  invoice: MonitorInvoice;
  reason: { code?: string; text?: string } | null;
  expected: MonitorProposal;
}

const invoice = (number: string, payable: number, customer: string): MonitorInvoice => ({
  number,
  issueDate: '2026-10-05',
  dueDate: '2026-11-04',
  payable,
  currency: 'EUR',
  seller: 'Atelier Dupont SARL',
  customer,
  to: 'compta@exemple-client.fr',
});

export const MONITOR_FIXTURES: MonitorFixture[] = [
  {
    name: 'address',
    invoice: invoice('F2026-0101', 145_000, 'Boulangerie Martin SAS'),
    reason: { code: 'ADR_ERR', text: "L'adresse de facturation est celle de l'ancien siège." },
    expected: 'fix_and_resend',
  },
  {
    name: 'order-missing',
    invoice: invoice('F2026-0102', 1_250_000, 'Transports Leroy SA'),
    reason: { code: 'REF_CT_ABSENT', text: 'Merci d’indiquer notre numéro de bon de commande.' },
    expected: 'fix_and_resend',
  },
  {
    name: 'order-wrong',
    invoice: invoice('F2026-0103', 89_900, 'Garage Petit SARL'),
    reason: { code: 'CMD_ERR' },
    expected: 'fix_and_resend',
  },
  {
    name: 'vat-rate',
    invoice: invoice('F2026-0104', 330_000, 'Clinique des Lilas SAS'),
    reason: {
      code: 'TX_TVA_ERR',
      text: 'Prestation de formation exonérée, la TVA à 20 % est à retirer.',
    },
    expected: 'fix_and_resend',
  },
  {
    name: 'total',
    invoice: invoice('F2026-0105', 512_040, 'Menuiserie Bernard SARL'),
    reason: { code: 'MONTANTTOTAL_ERR', text: 'Le devis signé prévoyait 4 800,00 € HT.' },
    expected: 'fix_and_resend',
  },
  {
    name: 'calculation',
    invoice: invoice('F2026-0106', 72_000, 'Cabinet Moreau SELARL'),
    reason: { code: 'CALCUL_ERR', text: "La remise de 10 % convenue n'apparaît pas." },
    expected: 'fix_and_resend',
  },
  {
    name: 'duplicate',
    invoice: invoice('F2026-0107', 240_000, 'Hôtel du Port SAS'),
    reason: { code: 'DOUBLON', text: 'Facture déjà reçue sous le numéro F2026-0098.' },
    expected: 'credit_note',
  },
  {
    name: 'billed-twice',
    invoice: invoice('F2026-0108', 18_000, 'Pharmacie Centrale SNC'),
    reason: { code: 'DOUBLE_FACT' },
    expected: 'credit_note',
  },
  {
    name: 'cancelled-order',
    invoice: invoice('F2026-0109', 960_000, 'Imprimerie Roux SAS'),
    reason: { text: 'Commande annulée par courrier du 2 octobre, la prestation n’a pas eu lieu.' },
    expected: 'credit_note',
  },
  {
    name: 'unknown-transaction',
    invoice: invoice('F2026-0110', 54_000, 'Fromagerie Girard SARL'),
    reason: { code: 'TRANSAC_INC' },
    expected: 'contact_customer',
  },
  {
    name: 'contract-ended',
    invoice: invoice('F2026-0111', 199_000, 'Agence Fontaine SAS'),
    reason: { code: 'CONTRAT_TERM', text: 'Contrat de maintenance résilié au 30 septembre.' },
    expected: 'contact_customer',
  },
  {
    name: 'vague',
    invoice: invoice('F2026-0112', 410_000, 'Laboratoire Mercier SA'),
    reason: { code: 'NON_CONFORME' },
    expected: 'contact_customer',
  },
  {
    name: 'no-reason',
    invoice: invoice('F2026-0113', 66_600, 'Studio Lambert EURL'),
    reason: null,
    expected: 'contact_customer',
  },
];
