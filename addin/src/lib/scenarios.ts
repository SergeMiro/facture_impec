// Jeux de données de démonstration : une facture conforme + variantes qui déclenchent
// différentes familles de règles. Sert au playground (test sans Excel).

import type { Invoice } from "./types";

/** Facture de référence, conforme de bout en bout (entité SIREN 732829320). */
export function validInvoice(): Invoice {
  return {
    invoice_number: "F-2026-001",
    issue_date: "2026-09-01",
    due_date: "2026-10-01",
    type_code: "380",
    currency: "EUR",
    seller: {
      name: "Vendeur SARL",
      siren: "732829320",
      siret: "73282932000074",
      vat_id: "FR44732829320",
      address: { line1: "1 rue de Paris", postal_code: "75001", city: "Paris", country_code: "FR" },
    },
    buyer: {
      name: "Acheteur SAS",
      address: { line1: "2 avenue de Lyon", postal_code: "69001", city: "Lyon", country_code: "FR" },
    },
    lines: [
      {
        description: "Prestation de conseil",
        quantity: "10",
        unit: "h",
        unit_price: "100.00",
        line_amount: "1000.00",
        vat_rate: "20",
        vat_category: "S",
      },
      {
        description: "Frais de déplacement",
        quantity: "2",
        unit: "u",
        unit_price: "50.00",
        line_amount: "100.00",
        vat_rate: "20",
        vat_category: "S",
      },
    ],
    vat_breakdown: [
      { category: "S", rate: "20", taxable_amount: "1100.00", tax_amount: "220.00" },
    ],
    totals: {
      line_extension_amount: "1100.00",
      tax_exclusive_amount: "1100.00",
      tax_amount: "220.00",
      tax_inclusive_amount: "1320.00",
      payable_amount: "1320.00",
    },
    payment: { iban: "FR1420041010050500013M02606", bic: "BNPAFRPP", terms: "30 jours" },
  };
}

export interface Scenario {
  id: string;
  label: string;
  description: string;
  build: () => Invoice;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "valid",
    label: "Facture conforme",
    description: "Aucune erreur : prête à être envoyée.",
    build: validInvoice,
  },
  {
    id: "calc",
    label: "Erreurs de calcul",
    description: "Montant de ligne et total TTC incohérents.",
    build: () => {
      const inv = validInvoice();
      inv.lines[0].line_amount = "950.00"; // ≠ 10 × 100
      inv.totals.tax_inclusive_amount = "1300.00"; // ≠ HT + TVA
      return inv;
    },
  },
  {
    id: "french",
    label: "Identifiants FR invalides",
    description: "SIRET et clé de TVA français erronés.",
    build: () => {
      const inv = validInvoice();
      inv.seller.siret = "73282932000075"; // Luhn cassé
      inv.seller.vat_id = "FR99732829320"; // mauvaise clé
      return inv;
    },
  },
  {
    id: "missing",
    label: "Champs obligatoires manquants",
    description: "Numéro, devise et pays acheteur absents.",
    build: () => {
      const inv = validInvoice();
      inv.invoice_number = null;
      inv.currency = null;
      inv.buyer.address!.country_code = null;
      return inv;
    },
  },
  {
    id: "soft",
    label: "Avertissements (IA)",
    description: "Devise USD, échéance avant émission, taux inhabituel — jaune, non bloquant.",
    build: () => {
      const inv = validInvoice();
      inv.currency = "USD"; // AI-CURRENCY
      inv.due_date = "2026-08-15"; // avant l'émission → AI-DATE-LOGIC
      inv.lines[0].vat_rate = "7"; // hors taux usuels → AI-VAT-RATE
      return inv;
    },
  },
];
