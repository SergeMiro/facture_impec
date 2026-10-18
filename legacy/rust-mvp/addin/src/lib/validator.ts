// Chargeur du cœur de validation WASM (`facture-core` via `facture-wasm`).
// Le même moteur tourne ici (navigateur) et côté backend (Phase 3) — une seule source de règles.

import init, { validate_json, core_version } from "@/wasm/facture_wasm.js";
import type { Invoice, ValidationReport } from "./types";

let initPromise: Promise<unknown> | null = null;

function ensureReady(): Promise<unknown> {
  // `init()` (cible web) charge facture_wasm_bg.wasm émis par le bundler via import.meta.url.
  if (!initPromise) initPromise = init();
  return initPromise;
}

/** Valide une facture localement et renvoie le rapport (erreurs dures + avertissements doux). */
export async function validateInvoice(invoice: Invoice): Promise<ValidationReport> {
  await ensureReady();
  const reportJson = validate_json(JSON.stringify(invoice));
  return JSON.parse(reportJson) as ValidationReport;
}

/** Version du cœur de validation chargé (vérifie que le WASM est bien là). */
export async function wasmVersion(): Promise<string> {
  await ensureReady();
  return core_version();
}
