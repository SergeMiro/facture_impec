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
| `react-dom` (add-in, site) | Required renderer for React 18, the plan's UI library. |
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
| `astro` (site) | Static-first framework for the marketing site: pages ship as HTML, React only where a section is interactive. |
| `@astrojs/vercel` (site) | Builds the trial-form endpoint as a Vercel function, where the old MVP is already hosted. |
| `@astrojs/react` (site) | Lets the site reuse React 18 for its three interactive islands. |
| `@astrojs/check` (dev, site) | Type-checks `.astro` files; it pins TypeScript ≤ 6, so the site has its own `typescript@6` dev dependency. |
| `tailwindcss`, `@tailwindcss/vite` (dev, site) | Utility CSS with the brand tokens in one `@theme` block; the native engine is over 1 MB. |
| `@fontsource-variable/fraunces`, `@fontsource-variable/inter` (site) | Self-hosted font files (RGPD: no request to Google Fonts); each package is over 1 MB because it ships every subset. |
| `ai` (agents) | Vercel AI SDK: one `generateText` + structured output + tool API over every provider the owner asked for (`docs/AI_PROVIDERS.md`); 9.8 MB installed, Node only (the add-in never imports `@fi/agents`). |
| `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google` (agents) | The providers' official adapters for the AI SDK, 2.5–3.3 MB each; imported only by `packages/agents/src/providers/models.ts`. |
| `fast-check` (dev, agents) | Property tests for the pseudonymizer round trip (plan §6); 1.2 MB, dev only. |
| `@fluentui/react-components` (add-in) | Microsoft's Fluent UI v9, the look of Office itself, so the pane feels like part of Excel. 2 MB, and about 350 MB installed with its transitive `@fluentui/react-icons` (icon sources); bundles keep only what is imported: the whole pane is 889 kB minified, 255 kB gzipped. |
| `@types/office-js` (dev, add-in) | The office.js type definitions Learn points to; 8.5 MB of `.d.ts`, types only. |
| `@playwright/test` → `playwright-core` (dev, add-in) | The E2E runner of plan §11; 14 MB. It drives the machine's Chrome (`channel: 'chrome'`), no browser download. |
