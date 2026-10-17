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
| `astro` (site) | Static-first framework for the marketing site: pages ship as HTML, React only where a section is interactive. |
| `@astrojs/vercel` (site) | Builds the trial-form endpoint as a Vercel function, where the old MVP is already hosted. |
| `@astrojs/react` (site) | Lets the site reuse React 18 for its three interactive islands. |
| `@astrojs/check` (dev, site) | Type-checks `.astro` files; it pins TypeScript ≤ 6, so the site has its own `typescript@6` dev dependency. |
| `tailwindcss`, `@tailwindcss/vite` (dev, site) | Utility CSS with the brand tokens in one `@theme` block; the native engine is over 1 MB. |
| `@fontsource-variable/fraunces`, `@fontsource-variable/inter` (site) | Self-hosted font files (RGPD: no request to Google Fonts); each package is over 1 MB because it ships every subset. |
