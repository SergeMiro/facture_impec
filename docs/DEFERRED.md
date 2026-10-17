# Deferred

Things that exist in the old MVP or come to mind, but no milestone's acceptance criteria need them.
Each line says where it came from and what would bring it back.

| Item | Origin | Bring back when |
|---|---|---|
| Import of PDF invoices (text extraction + regex field extractor, `/api/import`) | MVP Phase 5 (`legacy/rust-mvp/crates/facture-backend/src/ocr`) | A pilot customer keeps invoices as PDFs instead of Excel rows. |
| Word documents as input | MVP Phase 6 idea | Never for emission (a .docx is not structured); maybe extraction, on demand. |
| Turborepo remote cache | M0 scaffold | CI runs on GitHub again and builds get slow. |
| Rate limiting on `POST /api/trial` beyond honeypot + fill time + one row per e-mail | Marketing site | Spam actually reaches the table; then Vercel WAF rule or Upstash rate limit. |
| Site in other languages, blog, analytics | Marketing site | The French pilot converts and there is content worth translating or measuring (analytics would need a consent banner). |
| Automatic trial provisioning (account + install link sent on submit) | Marketing site | M3 has accounts; until then the owner answers each request by hand. |
