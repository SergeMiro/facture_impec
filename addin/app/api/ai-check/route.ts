import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Couche IA douce (avertissements jaunes, jamais bloquants).
// - Si `BACKEND_URL` est défini, on relaie vers le backend Rust (`/api/ai-check` → Mistral EU).
// - Sinon : IA LLM désactivée → `{ enabled:false, warnings:[] }`. Les avertissements déterministes
//   (devise, dates, taux) sont déjà produits localement par le WASM, sans envoi de données.
export async function POST(req: NextRequest) {
  let invoice: unknown;
  try {
    invoice = await req.json();
  } catch {
    return NextResponse.json({ enabled: false, warnings: [] }, { status: 400 });
  }

  const backend = process.env.BACKEND_URL;
  if (backend) {
    try {
      const r = await fetch(`${backend.replace(/\/$/, "")}/api/ai-check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(invoice),
      });
      return NextResponse.json(await r.json(), { status: r.status });
    } catch (e) {
      return NextResponse.json({
        enabled: false,
        warnings: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({ enabled: false, warnings: [] });
}
