// Which workspace package may import which (BTP plan §3 « violation = build failure »; Biome has no
// such rule, docs/DECISIONS.md D1). Production code only: tests and their helpers may reach anything
// they declare. The arrows point down: domain ← shared ← core ← (db, pdp-adapter, agents) ← api.

export interface PackageRule {
  /** Workspace packages its production code may import, by folder name (`core` for `@fi/core`). */
  imports: readonly string[];
  /** Outside packages its production code must not import; a trailing `*` matches a prefix. */
  forbid?: readonly string[];
  /** When set, the only outside packages its production code may import. */
  allow?: readonly string[];
  /** Folders whose code runs in a browser: no `node:` module there. */
  browser?: readonly string[];
}

/** What only a server holds: the database, the queues, the HTTP server, the mail. */
const SERVER = [
  'pg',
  'pg-boss',
  'drizzle-orm',
  'drizzle-orm/*',
  '@electric-sql/*',
  'hono',
  'hono/*',
  '@hono/*',
  'nodemailer',
];
/** The model SDKs: only `@fi/agents` talks to a model (CLAUDE.md « deterministic core, AI on top »). */
const PROVIDERS = ['@ai-sdk/*'];
const MODELS = ['ai', 'ai/*', ...PROVIDERS];

export const RULES: Record<string, PackageRule> = {
  'packages/domain': { imports: [], allow: ['zod'], browser: ['src'] },
  'packages/shared': { imports: ['domain'], forbid: [...SERVER, ...MODELS] },
  'packages/core': {
    imports: ['shared', 'domain'],
    forbid: [...SERVER, ...MODELS],
    browser: ['src'],
  },
  'packages/db': {
    imports: ['core', 'shared', 'domain'],
    forbid: ['pg-boss', 'hono', 'hono/*', '@hono/*', ...MODELS],
  },
  'packages/pdp-adapter': { imports: ['core', 'shared', 'domain'], forbid: [...SERVER, ...MODELS] },
  'packages/agents': { imports: ['core', 'shared', 'domain'], forbid: SERVER },
  // The pane streams the API's chat with the client half of `ai` (R8); it never holds a provider.
  'apps/addin': {
    imports: ['core', 'shared', 'domain'],
    forbid: [...SERVER, ...PROVIDERS],
    browser: ['src'],
  },
  'apps/site': { imports: ['shared', 'core', 'domain'], forbid: [...SERVER, ...MODELS] },
  'apps/mock-pdp': {
    imports: ['core', 'shared', 'pdp-adapter', 'domain'],
    forbid: ['pg', 'pg-boss', 'drizzle-orm', 'drizzle-orm/*', '@electric-sql/*', ...MODELS],
  },
  'apps/api': { imports: ['agents', 'core', 'db', 'domain', 'pdp-adapter', 'shared'] },
};

/** Test infrastructure, by path inside its package: exempt from `imports`, `forbid` and `browser`. */
export const TEST_INFRA: readonly RegExp[] = [
  /\.test\.tsx?$/,
  /(^|\/)test-helpers\.tsx?$/,
  /(^|\/)(test|e2e|evals|scenarios|scripts)\//,
  /(^|\/)[^/]+\.config\.[cm]?ts$/,
];
