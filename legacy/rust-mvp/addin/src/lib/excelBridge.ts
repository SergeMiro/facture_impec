// Pont Office.js : insertion d'un modèle, lecture des plages nommées → Invoice,
// surlignage des cellules (rouge = erreur dure, jaune = avertissement).
//
// Office.js est chargé dynamiquement par le task pane ; on type les globals de façon souple.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const Excel: any;

import type { Invoice, ValidationReport } from "./types";

const FILL_HARD = "#F8C9C9";
const FILL_SOFT = "#FCE9B8";
const SHEET = "Facture";

/** Cartographie champ logique → cellule + valeur d'exemple. Plages nommées = "fi_<path>". */
interface FieldDef {
  path: string;
  cell: string;
  sample: string;
}

const FIELDS: FieldDef[] = [
  { path: "invoice_number", cell: "B3", sample: "F-2026-001" },
  { path: "issue_date", cell: "B4", sample: "2026-09-01" },
  { path: "currency", cell: "B5", sample: "EUR" },
  { path: "type_code", cell: "B6", sample: "380" },

  { path: "seller.name", cell: "B9", sample: "Vendeur SARL" },
  { path: "seller.siret", cell: "B10", sample: "73282932000074" },
  { path: "seller.vat_id", cell: "B11", sample: "FR44732829320" },
  { path: "seller.address.country_code", cell: "B12", sample: "FR" },

  { path: "buyer.name", cell: "E9", sample: "Acheteur SAS" },
  { path: "buyer.address.country_code", cell: "E12", sample: "FR" },

  { path: "lines[0].description", cell: "A16", sample: "Prestation de conseil" },
  { path: "lines[0].quantity", cell: "B16", sample: "10" },
  { path: "lines[0].unit_price", cell: "C16", sample: "100.00" },
  { path: "lines[0].line_amount", cell: "D16", sample: "1000.00" },
  { path: "lines[0].vat_rate", cell: "E16", sample: "20" },
  { path: "lines[0].vat_category", cell: "F16", sample: "S" },

  { path: "lines[1].description", cell: "A17", sample: "Frais de déplacement" },
  { path: "lines[1].quantity", cell: "B17", sample: "2" },
  { path: "lines[1].unit_price", cell: "C17", sample: "50.00" },
  { path: "lines[1].line_amount", cell: "D17", sample: "100.00" },
  { path: "lines[1].vat_rate", cell: "E17", sample: "20" },
  { path: "lines[1].vat_category", cell: "F17", sample: "S" },

  { path: "totals.line_extension_amount", cell: "D20", sample: "1100.00" },
  { path: "totals.tax_exclusive_amount", cell: "D21", sample: "1100.00" },
  { path: "totals.tax_amount", cell: "D22", sample: "220.00" },
  { path: "totals.tax_inclusive_amount", cell: "D23", sample: "1320.00" },
  { path: "totals.payable_amount", cell: "D24", sample: "1320.00" },
];

const LABELS: Array<{ cell: string; text: string }> = [
  { cell: "A1", text: "FACTURE — modèle Facture Impec" },
  { cell: "A3", text: "Numéro" }, { cell: "A4", text: "Date" }, { cell: "A5", text: "Devise" }, { cell: "A6", text: "Type" },
  { cell: "A8", text: "VENDEUR" }, { cell: "A9", text: "Nom" }, { cell: "A10", text: "SIRET" }, { cell: "A11", text: "N° TVA" }, { cell: "A12", text: "Pays" },
  { cell: "D8", text: "ACHETEUR" }, { cell: "D9", text: "Nom" }, { cell: "D12", text: "Pays" },
  { cell: "A15", text: "Description" }, { cell: "B15", text: "Qté" }, { cell: "C15", text: "P.U." }, { cell: "D15", text: "Montant" }, { cell: "E15", text: "TVA%" }, { cell: "F15", text: "Catég." },
  { cell: "C20", text: "Σ lignes HT" }, { cell: "C21", text: "Total HT" }, { cell: "C22", text: "Total TVA" }, { cell: "C23", text: "Total TTC" }, { cell: "C24", text: "Net à payer" },
];

function rangeName(path: string): string {
  return "fi_" + path.replace(/[.[\]]/g, "_");
}

function setNested(obj: any, path: string, value: string) {
  const parts = path
    .split(".")
    .flatMap((seg) => {
      const m = seg.match(/^([^[]+)(\[(\d+)\])?$/);
      return m && m[3] !== undefined ? [m[1], Number(m[3])] : [seg];
    });
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nextIsIndex = typeof parts[i + 1] === "number";
    if (cur[key] === undefined || cur[key] === null) cur[key] = nextIsIndex ? [] : {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value === "" ? null : value;
}

function getNested(obj: any, path: string): unknown {
  const parts = path.split(".").flatMap((seg) => {
    const m = seg.match(/^([^[]+)(\[(\d+)\])?$/);
    return m && m[3] !== undefined ? [m[1], Number(m[3])] : [seg];
  });
  let cur: any = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

function emptyInvoice(): Invoice {
  return { seller: {}, buyer: {}, lines: [], vat_breakdown: [], totals: {} } as Invoice;
}

/** Insère le modèle (libellés + valeurs d'exemple) et crée les plages nommées. */
export async function insertTemplate(): Promise<void> {
  await Excel.run(async (ctx: any) => {
    const sheets = ctx.workbook.worksheets;
    sheets.load("items/name");
    await ctx.sync();

    let sheet = sheets.items.find((s: any) => s.name === SHEET);
    if (!sheet) sheet = sheets.add(SHEET);
    sheet.activate();

    for (const l of LABELS) sheet.getRange(l.cell).values = [[l.text]];
    for (const f of FIELDS) {
      sheet.getRange(f.cell).values = [[f.sample]];
      ctx.workbook.names.add(rangeName(f.path), sheet.getRange(f.cell));
    }
    sheet.getRange("A1:F24").format.autofitColumns();
    await ctx.sync();
  });
}

/** Lit les plages nommées → Invoice, en renseignant la cartographie cellules. */
export async function readInvoice(): Promise<Invoice> {
  const invoice = emptyInvoice();
  invoice.cells = {};

  await Excel.run(async (ctx: any) => {
    const ranges = FIELDS.map((f) => {
      const r = ctx.workbook.names.getItemOrNullObject(rangeName(f.path)).getRangeOrNullObject();
      r.load(["address", "values", "isNullObject"]);
      return { f, r };
    });
    await ctx.sync();

    for (const { f, r } of ranges) {
      if (r.isNullObject) continue;
      const raw = r.values?.[0]?.[0];
      const value = raw === null || raw === undefined ? "" : String(raw).trim();
      setNested(invoice, f.path, value);
      const addr = String(r.address).split("!").pop(); // "Facture!B10" → "B10"
      if (addr) invoice.cells![f.path] = addr;
    }
  });

  return invoice;
}

/** Efface les surlignages précédents puis colore les cellules en erreur/avertissement. */
export async function highlightCells(report: ValidationReport): Promise<void> {
  await Excel.run(async (ctx: any) => {
    const sheet = ctx.workbook.worksheets.getItem(SHEET);
    sheet.getRange("A1:F24").format.fill.clear();

    for (const issue of report.issues) {
      const cell = issue.cell_ref;
      if (!cell) continue;
      sheet.getRange(cell).format.fill.color =
        issue.severity === "hard" ? FILL_HARD : FILL_SOFT;
    }
    await ctx.sync();
  });
}

/// Écrit une Invoice (issue de l'import) dans la feuille : crée le modèle puis remplit les cellules.
export async function writeInvoice(invoice: Invoice): Promise<void> {
  await insertTemplate();
  await Excel.run(async (ctx: any) => {
    const sheet = ctx.workbook.worksheets.getItem(SHEET);
    for (const f of FIELDS) {
      const v = getNested(invoice, f.path);
      sheet.getRange(f.cell).values = [[v ?? ""]];
    }
    await ctx.sync();
  });
}
