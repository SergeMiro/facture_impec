"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Invoice, Issue, ValidationReport } from "@/lib/types";
import { validateInvoice, wasmVersion } from "@/lib/validator";
import { SCENARIOS, validInvoice } from "@/lib/scenarios";
import { structureText } from "@/lib/importer";
import { issuesByField } from "@/lib/ui";
import ErrorModal from "@/components/ErrorModal";

export default function DemoPage() {
  const [invoice, setInvoice] = useState<Invoice>(() => validInvoice());
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [active, setActive] = useState("valid");
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [version, setVersion] = useState<string>("");
  const [importText, setImportText] = useState("");

  useEffect(() => {
    wasmVersion().then(setVersion).catch(() => setVersion("?"));
  }, []);

  useEffect(() => {
    let alive = true;
    validateInvoice(invoice)
      .then((r) => alive && setReport(r))
      .catch((e) => console.error("validation", e));
    return () => {
      alive = false;
    };
  }, [invoice]);

  const byField = useMemo(
    () => (report ? issuesByField(report) : new Map<string, Issue[]>()),
    [report]
  );

  const update = useCallback(
    (path: string, value: string) => {
      setInvoice((prev) => {
        const clone = structuredClone(prev);
        // setPath inline (évite import circulaire de typage)
        const parts = path
          .split(".")
          .flatMap((seg) => {
            const m = seg.match(/^([^[]+)(\[(\d+)\])?$/);
            return m && m[3] !== undefined ? [m[1], Number(m[3])] : [seg];
          });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let cur: any = clone;
        for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
        cur[parts[parts.length - 1]] = value === "" ? null : value;
        return clone;
      });
    },
    []
  );

  function loadScenario(id: string) {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s) return;
    setActive(id);
    setInvoice(s.build());
  }

  function doImport() {
    if (!importText.trim()) return;
    setActive("import");
    setInvoice(structureText(importText));
    setToast("Facture importée localement — vérifiez et complétez les lignes.");
    setTimeout(() => setToast(null), 4500);
  }

  async function openValidation() {
    if (!report) return;
    let merged = report;
    try {
      const res = await fetch("/api/ai-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(invoice),
      });
      if (res.ok) {
        const j = await res.json();
        const extra: Issue[] = (j.warnings ?? []).filter(
          (w: Issue) => !merged.issues.some((i) => i.code === w.code && i.field === w.field)
        );
        if (extra.length) merged = { ...merged, issues: [...merged.issues, ...extra] };
      }
    } catch {
      /* IA indisponible → on conserve le rapport local (WASM). */
    }
    setReport(merged);
    setModal(true);
  }

  async function send() {
    setModal(false);
    setToast("Envoi en cours…");
    try {
      const r = await fetch("/api/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(invoice),
      });
      const body = await r.json();
      if (!r.ok) {
        setToast(`Envoi refusé (${r.status}) : ${body.message ?? "erreur"}`);
      } else if (body.simulated) {
        setToast(`✓ Simulation : facture acceptée (id ${body.id}). Configurez B2Brouter pour un envoi réel.`);
      } else {
        setToast(`✓ Envoyée via ${body.provider} — statut : ${body.status} (id ${body.id}).`);
      }
    } catch {
      setToast("Erreur réseau lors de l'envoi.");
    }
    setTimeout(() => setToast(null), 5500);
  }

  const hard = report?.issues.filter((i) => i.severity === "hard").length ?? 0;
  const soft = report?.issues.filter((i) => i.severity === "soft").length ?? 0;
  const statusClass = !report ? "" : hard > 0 ? "bad" : soft > 0 ? "warn" : "ok";
  const statusText = !report
    ? "Chargement du moteur…"
    : hard > 0
    ? `${hard} erreur(s) bloquante(s)`
    : soft > 0
    ? `${soft} avertissement(s)`
    : "Facture conforme";

  return (
    <main className="wrap">
      <header className="app">
        <div>
          <h1>Facture Impec — Démonstration</h1>
          <p>
            Le cœur de validation (Rust → WebAssembly) tourne <b>localement dans votre navigateur</b>.
            Modifiez la facture : les erreurs dures (EN 16931 / format) apparaissent en <b>rouge</b>,
            les avertissements en <b>jaune</b>. Aucun envoi réel — c'est un banc d'essai.
          </p>
        </div>
        <span className="pill">WASM facture-core v{version || "…"}</span>
      </header>

      <section className="panel">
        <h2>Scénarios</h2>
        <div className="scenarios">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              className={`scenario ${active === s.id ? "active" : ""}`}
              onClick={() => loadScenario(s.id)}
            >
              <b>{s.label}</b>
              <span>{s.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Importer une facture (texte)</h2>
        <p className="hint" style={{ marginTop: -4, marginBottom: 8 }}>
          Collez le texte d'une facture (ou l'extraction d'un PDF). La structuration s'effectue
          <b> localement</b> dans le navigateur — aucune donnée n'est envoyée. En-tête et totaux
          sont remplis ; complétez les lignes. (L'import PDF direct passe par le backend.)
        </p>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={"FACTURE n° F-2026-042\nDate : 01/09/2026\nSIRET 73282932000074\nTotal HT : 1 100,00 €\nTotal TVA : 220,00 €\nTotal TTC : 1 320,00 €"}
          rows={5}
          style={{
            width: "100%",
            fontFamily: "ui-monospace, monospace",
            fontSize: 13,
            padding: 10,
            border: "1px solid var(--line)",
            borderRadius: 8,
            resize: "vertical",
          }}
        />
        <div className="actions" style={{ marginTop: 10 }}>
          <button className="btn" onClick={doImport} disabled={!importText.trim()}>
            Structurer et charger
          </button>
        </div>
      </section>

      <div className="grid2">
        <section className="panel">
          <h2>Facture</h2>
          <Field label="Numéro" path="invoice_number" v={invoice.invoice_number} byField={byField} onChange={update} />
          <Field label="Date d'émission" path="issue_date" v={invoice.issue_date} byField={byField} onChange={update} />
          <Field label="Devise" path="currency" v={invoice.currency} byField={byField} onChange={update} />
          <Field label="Type (380 = facture)" path="type_code" v={invoice.type_code} byField={byField} onChange={update} />
        </section>

        <section className="panel">
          <h2>Vendeur</h2>
          <Field label="Nom" path="seller.name" v={invoice.seller.name} byField={byField} onChange={update} />
          <Field label="SIRET" path="seller.siret" v={invoice.seller.siret} byField={byField} onChange={update} />
          <Field label="N° TVA intracom." path="seller.vat_id" v={invoice.seller.vat_id} byField={byField} onChange={update} />
          <Field label="Pays" path="seller.address.country_code" v={invoice.seller.address?.country_code} byField={byField} onChange={update} />
        </section>
      </div>

      <section className="panel">
        <h2>Lignes</h2>
        <table className="lines">
          <thead>
            <tr>
              <th style={{ width: "34%" }}>Description</th>
              <th>Qté</th>
              <th>P.U. net</th>
              <th>Montant</th>
              <th>TVA %</th>
              <th>Catég.</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((ln, i) => (
              <tr key={i}>
                <Cell path={`lines[${i}].description`} v={ln.description} byField={byField} onChange={update} />
                <Cell path={`lines[${i}].quantity`} v={ln.quantity} byField={byField} onChange={update} />
                <Cell path={`lines[${i}].unit_price`} v={ln.unit_price} byField={byField} onChange={update} />
                <Cell path={`lines[${i}].line_amount`} v={ln.line_amount} byField={byField} onChange={update} />
                <Cell path={`lines[${i}].vat_rate`} v={ln.vat_rate} byField={byField} onChange={update} />
                <SelectCell path={`lines[${i}].vat_category`} v={ln.vat_category} byField={byField} onChange={update} />
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid2">
        <section className="panel">
          <h2>Totaux</h2>
          <Field label="Somme des lignes (HT)" path="totals.line_extension_amount" v={invoice.totals.line_extension_amount} byField={byField} onChange={update} />
          <Field label="Total HT" path="totals.tax_exclusive_amount" v={invoice.totals.tax_exclusive_amount} byField={byField} onChange={update} />
          <Field label="Total TVA" path="totals.tax_amount" v={invoice.totals.tax_amount} byField={byField} onChange={update} />
          <Field label="Total TTC" path="totals.tax_inclusive_amount" v={invoice.totals.tax_inclusive_amount} byField={byField} onChange={update} />
          <Field label="Net à payer" path="totals.payable_amount" v={invoice.totals.payable_amount} byField={byField} onChange={update} />
        </section>

        <section className="panel">
          <h2>Acheteur</h2>
          <Field label="Nom" path="buyer.name" v={invoice.buyer.name} byField={byField} onChange={update} />
          <Field label="Pays" path="buyer.address.country_code" v={invoice.buyer.address?.country_code} byField={byField} onChange={update} />
          <div className="actions" style={{ marginTop: 18 }}>
            <span className={`status ${statusClass}`}>
              <span className="dot" /> {statusText}
            </span>
          </div>
          <div className="actions" style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={openValidation} disabled={!report}>
              Valider
            </button>
            <span className="hint">Analyse (local + IA) puis options d'envoi.</span>
          </div>
        </section>
      </div>

      {modal && report && (
        <ErrorModal report={report} onClose={() => setModal(false)} onSend={send} />
      )}
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

// — Champs —————————————————————————————————————————————————————————

interface FieldProps {
  label: string;
  path: string;
  v?: string | null;
  byField: Map<string, Issue[]>;
  onChange: (path: string, value: string) => void;
}

function sev(byField: Map<string, Issue[]>, path: string): { cls: string; msg?: string } {
  const list = byField.get(path);
  if (!list || list.length === 0) return { cls: "" };
  const hard = list.find((i) => i.severity === "hard");
  const chosen = hard ?? list[0];
  return { cls: hard ? "hard" : "soft", msg: chosen.message_fr };
}

function Field({ label, path, v, byField, onChange }: FieldProps) {
  const { cls, msg } = sev(byField, path);
  return (
    <div className={`field ${cls}`}>
      <label>{label}</label>
      <input value={v ?? ""} onChange={(e) => onChange(path, e.target.value)} />
      {msg && <div className="msg">{msg}</div>}
    </div>
  );
}

function Cell({ path, v, byField, onChange }: Omit<FieldProps, "label">) {
  const { cls, msg } = sev(byField, path);
  return (
    <td className={cls}>
      <input value={v ?? ""} onChange={(e) => onChange(path, e.target.value)} />
      {msg && <div className="cellmsg">{msg}</div>}
    </td>
  );
}

function SelectCell({ path, v, byField, onChange }: Omit<FieldProps, "label">) {
  const { cls, msg } = sev(byField, path);
  return (
    <td className={cls}>
      <select value={v ?? ""} onChange={(e) => onChange(path, e.target.value)}>
        <option value="S">S — standard</option>
        <option value="Z">Z — taux zéro</option>
        <option value="E">E — exonéré</option>
        <option value="AE">AE — autoliq.</option>
      </select>
      {msg && <div className="cellmsg">{msg}</div>}
    </td>
  );
}
