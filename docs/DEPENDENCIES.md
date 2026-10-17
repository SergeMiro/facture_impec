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
