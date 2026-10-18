# Dependencies needing a justification

Rule 7 of `CLAUDE.md`: any dependency over 1 MB installed, or under 1k weekly downloads, gets one line here.

| Package | Why it is worth it |
|---|---|
| `typescript` (dev) | The language of the whole repo; v7 is the native compiler, used only for `tsc` type checks. |
| `@biomejs/biome` (dev) | One native binary replaces ESLint + Prettier for lint and format. |
| `turbo` (dev) | Native binary that runs workspace tasks in dependency order with caching; the plan's chosen monorepo tool. |
| `vite` (dev, add-in) | Dev server and bundler for the task pane; the plan's chosen add-in toolchain. |
| `vitest` (dev) | Test runner for every package; the plan's chosen unit-test tool. |
| `esbuild` (transitive, via `tsx`/`vitest`) | Native transpiler behind `tsx` and Vitest; its install script is allowed in `pnpm-workspace.yaml`. |
| `react-dom` (add-in) | Required renderer for React 18, the plan's UI library. |
| `zod` (core, shared) | Schema checks at every boundary (plan §1, rule 4); 7.5 MB installed, most of it locales and source maps that no bundle ships. |
| `@cantoo/pdf-lib` (core) | Draws the Factur-X PDF and makes it PDF/A-3 with the XML attached (`embedFacturX`); maintained pdf-lib fork, 28 MB installed, about 600 KB in a bundle, so only `@fi/core/pdf` imports it (`docs/research/FORMATS.md` §3.3). |
| `@cantoo/fontkit` (core) | Embeds the TrueType subsets PDF/A requires; 12 MB installed. The only fontkit that subsets with `@cantoo/pdf-lib` (`@pdf-lib/fontkit` crashes). |
| `saxon-js` (dev, core) | Runs the official CEN and Factur-X schematrons (XSLT 2/3) in Node without Java: the test oracle (FORMATS §2.2). 2.4 MB. |
| DejaVu Sans fonts (`packages/core/fonts/`, 1.5 MB, not a package) | PDF/A forbids non-embedded fonts; DejaVu covers French and the euro sign, Bitstream Vera licence (`fonts/LICENSE.txt`). |
| `hono` (api, mock-pdp) | The HTTP framework of plan §1; 1.3 MB installed, mostly per-runtime adapters we do not load. |
| `@electric-sql/pglite` (db) | Postgres compiled to WASM: dev, tests and scenarios run on real Postgres SQL without Docker. 34 MB installed (the WASM build); never used when `DATABASE_URL` is set. |
| `drizzle-orm` (db) | Typed SQL and migrations over both PGlite and `pg`; 10 MB installed, one dialect loaded at run time. |
| `drizzle-kit` (dev, db) | Generates the SQL migration files from the schema; 9.7 MB, dev only. |
| `pg-boss` (api) | The job queue of plan §1, in Postgres (works on PGlite too); 1.3 MB. |
