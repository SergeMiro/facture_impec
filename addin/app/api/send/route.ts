import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Route d'envoi.
// - Si `BACKEND_URL` est défini (backend Rust Axum déployé), on relaie l'appel → envoi réel via la PDP.
// - Sinon : mode **simulation** (démo) — accepte la facture et renvoie un identifiant factice.
//   La validation dure a déjà été faite côté client (WASM) ; le backend Rust la refait (defense in depth).
export async function POST(req: NextRequest) {
  let invoice: unknown;
  try {
    invoice = await req.json();
  } catch {
    return NextResponse.json({ error: "json", message: "Corps JSON invalide." }, { status: 400 });
  }

  const backend = process.env.BACKEND_URL;
  if (backend) {
    try {
      const r = await fetch(`${backend.replace(/\/$/, "")}/api/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(invoice),
      });
      const body = await r.json();
      return NextResponse.json(body, { status: r.status });
    } catch (e) {
      return NextResponse.json(
        { error: "backend", message: e instanceof Error ? e.message : String(e) },
        { status: 502 }
      );
    }
  }

  const num =
    (invoice as { invoice_number?: string } | null)?.invoice_number || "SANS-NUMERO";
  return NextResponse.json({
    id: `SIM-${num}`,
    status: "accepted",
    provider: "simulation",
    simulated: true,
  });
}
