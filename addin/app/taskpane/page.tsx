"use client";

import { useCallback, useEffect, useState } from "react";
import type { ValidationReport } from "@/lib/types";
import { validateInvoice } from "@/lib/validator";
import { insertTemplate, readInvoice, highlightCells } from "@/lib/excelBridge";
import IssuePanel from "@/components/IssuePanel";

type HostState = "loading" | "excel" | "browser";

export default function TaskPane() {
  const [host, setHost] = useState<HostState>("loading");
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) setHost("browser");
    }, 3000);

    const s = document.createElement("script");
    s.src = "https://appsforoffice.microsoft.com/lib/1/hosted/office.js";
    s.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const O = (window as any).Office;
      if (!O?.onReady) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      O.onReady((info: any) => {
        settled = true;
        clearTimeout(timer);
        setHost(info?.host ? "excel" : "browser");
      });
    };
    s.onerror = () => {
      settled = true;
      clearTimeout(timer);
      setHost("browser");
    };
    document.body.appendChild(s);
    return () => clearTimeout(timer);
  }, []);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setErr(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const onInsert = () => run(insertTemplate);
  const onValidate = () =>
    run(async () => {
      const invoice = await readInvoice();
      const r = await validateInvoice(invoice);
      setReport(r);
      await highlightCells(r);
    });

  const hard = report?.issues.filter((i) => i.severity === "hard").length ?? 0;
  const soft = report?.issues.filter((i) => i.severity === "soft").length ?? 0;

  return (
    <main className="wrap taskpane">
      <header className="app">
        <div>
          <h1>Facture Impec</h1>
          <p>Validez votre facture sans quitter Excel.</p>
        </div>
      </header>

      {host === "loading" && <div className="notice">Connexion à Excel…</div>}

      {host === "browser" && (
        <div className="notice">
          <p>
            Ce panneau est conçu pour s'exécuter <b>dans Excel</b> (sideload du manifeste).
            Ouvert dans un navigateur classique, il n'a pas accès à la feuille.
          </p>
          <p style={{ marginTop: 8 }}>
            👉 Pour tester le moteur de validation tout de suite, utilisez la{" "}
            <a href="/">démo interactive</a>.
          </p>
          <p style={{ marginTop: 8 }}>
            Pour le tester dans Excel : Excel sur le web → <span className="kbd">Insertion</span> →{" "}
            <span className="kbd">Compléments</span> → <span className="kbd">Charger mon complément</span>{" "}
            → choisir <span className="kbd">manifest.xml</span>.
          </p>
        </div>
      )}

      {host === "excel" && (
        <>
          <section className="panel">
            <h2>Actions</h2>
            <div className="actions">
              <button className="btn" onClick={onInsert} disabled={busy}>
                Insérer le modèle
              </button>
              <button className="btn primary" onClick={onValidate} disabled={busy}>
                Valider
              </button>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              « Insérer le modèle » remplit une feuille « Facture » avec des plages nommées, puis
              « Valider » lit les cellules, signale les erreurs et les surligne.
            </p>
            {err && <p className="status bad" style={{ marginTop: 8 }}><span className="dot" /> {err}</p>}
          </section>

          {report && (
            <section className="panel">
              <h2>Rapport</h2>
              <p
                className={`status ${hard > 0 ? "bad" : soft > 0 ? "warn" : "ok"}`}
                style={{ marginBottom: 10 }}
              >
                <span className="dot" />
                {hard > 0
                  ? `${hard} erreur(s) bloquante(s)`
                  : soft > 0
                  ? `${soft} avertissement(s)`
                  : "Facture conforme — prête à envoyer"}
              </p>
              <IssuePanel report={report} />
            </section>
          )}
        </>
      )}
    </main>
  );
}
