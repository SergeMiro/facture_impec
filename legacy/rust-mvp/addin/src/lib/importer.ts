// Structuration heuristique côté client (miroir de facture-backend/src/ocr).
// Sert au banc d'essai : coller le texte d'une facture → Invoice, sans serveur (RGPD : local).
// L'en-tête et les totaux sont extraits ; les lignes restent à compléter par l'utilisateur.

import type { Invoice } from "./types";

function parseAmount(raw: string): string | null {
  const cleaned = raw.replace(/[\s  ]/g, "");
  let normalized: string;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    normalized =
      cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else {
    normalized = cleaned.replace(",", ".");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

function findAmount(text: string, labels: string[]): string | null {
  const lower = text.toLowerCase();
  for (const label of labels) {
    const pos = lower.indexOf(label);
    if (pos >= 0) {
      const after = text.slice(pos + label.length);
      const m = after.match(/([0-9][0-9   .,]*[0-9]|[0-9])/);
      if (m) {
        const a = parseAmount(m[1]);
        if (a) return a;
      }
    }
  }
  return null;
}

export function structureText(text: string): Invoice {
  const num = text.match(
    /(?:facture|invoice)\s*(?:n[°ºo]|no|num[ée]ro)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{1,})/i
  );
  const date = text.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/);
  const siret = text.match(/\b(\d{14})\b/);
  const siren = siret ? null : text.match(/\b(\d{9})\b/);
  const vat = text.match(/\b(FR\s?[0-9A-Z]{2}\s?\d{9})\b/);
  const currency = /€|eur/i.test(text) ? "EUR" : /\$|usd/i.test(text) ? "USD" : null;

  const ht = findAmount(text, ["total ht", "montant ht", "hors taxes"]);
  const tva = findAmount(text, ["total tva", "montant tva", "tva"]);
  const ttc = findAmount(text, ["total ttc", "montant ttc", "net à payer", "total à payer"]);

  const issue_date = date
    ? `${date[3]}-${date[2].padStart(2, "0")}-${date[1].padStart(2, "0")}`
    : null;

  return {
    invoice_number: num?.[1]?.trim() ?? null,
    issue_date,
    currency,
    type_code: "380",
    seller: {
      siret: siret?.[1] ?? null,
      siren: siren?.[1] ?? null,
      vat_id: vat ? vat[1].replace(/\s/g, "") : null,
      address: {},
    },
    buyer: { address: {} },
    lines: [],
    vat_breakdown: [],
    totals: {
      line_extension_amount: ht,
      tax_exclusive_amount: ht,
      tax_amount: tva,
      tax_inclusive_amount: ttc,
      payable_amount: ttc,
    },
  };
}
