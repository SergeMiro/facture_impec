import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Import PDF/texte → Invoice. L'extraction PDF (pdf-extract) vit dans le backend Rust.
// - Si `BACKEND_URL` est défini → on relaie l'appel (extraction réelle + structuration).
// - Sinon → 501 : côté banc d'essai, l'import de TEXTE se fait en local (client, sans serveur) ;
//   seul le PDF requiert le backend.
export async function POST(req: NextRequest) {
  const backend = process.env.BACKEND_URL;
  if (!backend) {
    return NextResponse.json(
      {
        error: "backend_absent",
        message:
          "L'import PDF nécessite le backend (BACKEND_URL non défini). Le texte peut être structuré localement.",
      },
      { status: 501 }
    );
  }
  const body = await req.text();
  try {
    const r = await fetch(`${backend.replace(/\/$/, "")}/api/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch (e) {
    return NextResponse.json(
      { error: "backend", message: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
