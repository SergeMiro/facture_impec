# legacy/ — frozen, read-only

`rust-mvp/` is the previous Facture Impec MVP (Rust core + WASM, Axum backend, Next.js add-in),
exactly as it was on `main @ 4c6b294` (2026-07-07). It is still deployed at
https://facture-impec.vercel.app until the new add-in replaces it in M3.

Why it is here: M0 decided to port the validation rules to TypeScript (`docs/ARCHITECTURE.md`).
This copy is reading material for that port, nothing else:

- it is outside the pnpm workspace and ignored by Biome; nothing imports it;
- do not edit it and do not build new features on it;
- it is deleted at the end of M1, once every rule id listed in `docs/PROGRESS.md` exists in `packages/core`.

Permanent record with full history: branch `archive/rust-mvp-v1`.
