import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Node-only: import from '@fi/shared/env', never from the add-in bundle.

export const FiEnv = z.enum(['local', 'sandbox', 'prod']);
export type FiEnv = z.infer<typeof FiEnv>;

/** The repository root: relative paths in .env are read from here, whatever the process cwd. */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const port = (fallback: number) => z.coerce.number().int().min(1).max(65535).default(fallback);
/** `KEY=` in .env means "not set". */
const blank = (value: unknown) => (value === '' ? undefined : value);
const optionalText = (min = 1) => z.preprocess(blank, z.string().min(min).optional());
/** `price_a,price_b` → ['price_a', 'price_b']; empty: that plan is not sold. */
const priceList = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v;
    const ids = v
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    return ids.length ? ids : undefined;
  },
  z
    .array(z.string().regex(/^price_\w+$/, 'price_…'))
    .min(1)
    .max(5)
    .optional(),
);
const flag = (fallback: boolean) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? !['false', '0', 'no', 'off'].includes(v.toLowerCase()) : v),
    z.boolean().default(fallback),
  );

export const ServerEnvSchema = z
  .object({
    FI_ENV: FiEnv.default('local'),
    API_PORT: port(4000),
    /** 0.0.0.0 in a container; the default keeps a dev API off the network. */
    API_HOST: z.string().min(1).default('127.0.0.1'),
    /**
     * Behind a reverse proxy: the request header that carries the client's address
     * (`cf-connecting-ip` behind Cloudflare, `x-forwarded-for` behind nginx). Empty: the socket's.
     */
    TRUST_PROXY_HEADER: z.preprocess(
      (v) => (typeof v === 'string' ? blank(v.trim().toLowerCase()) : v),
      z.string().optional(),
    ),
    MOCK_PDP_PORT: port(4010),
    DATABASE_URL: optionalText(),
    PGLITE_DIR: z.string().default('.data/pglite'),
    ADMIN_TOKEN: optionalText(24),
    API_WORKERS: flag(true),
    PDP_SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(300),
    MOCK_PDP_URL: z.url().default('http://localhost:4010'),
    MOCK_PDP_WEBHOOK_URL: z.preprocess(blank, z.url().optional()),
    MOCK_PDP_WEBHOOK_SECRET: z.string().min(16).default('local-mock-pdp-webhook-secret'),
    MOCK_PDP_SPEED: z.coerce.number().positive().default(86_400),
    MOCK_PDP_B2BROUTER_WEBHOOK_URL: z.preprocess(blank, z.url().optional()),
    // One operator key for every company account of our B2Brouter integration (docs/B2BROUTER.md §1).
    B2BROUTER_API_KEY: optionalText(),
    // Empty: B2Brouter's API host, which serves the sandbox to `test_` keys.
    B2BROUTER_BASE_URL: z.preprocess(blank, z.url().optional()),
    B2BROUTER_WEBHOOK_SECRET: optionalText(),
    // prod only: a sandbox key (test_…) of the same integration, where « Mode test » sends.
    B2BROUTER_SANDBOX_API_KEY: optionalText(),
    B2BROUTER_SANDBOX_WEBHOOK_SECRET: optionalText(),
    // Seals the platform keys companies bring themselves (docs/B2BROUTER.md §12); empty: none.
    PDP_KEY_SEALING_KEY: z.preprocess(
      blank,
      z
        .string()
        .refine((v) => Buffer.from(v, 'base64').length === 32, '32 bytes in base64')
        .optional(),
    ),
    // Sign-in links, chasing e-mails and the weekly report outside local (src/mail.ts in the API).
    MAIL_SMTP_URL: optionalText(),
    MAIL_FROM: optionalText(),
    SIRENE_URL: z.url().default('https://recherche-entreprises.api.gouv.fr'),
    // EU customers' VAT numbers (docs/ONBOARDING.md §4), checked by the sweep (src/vat-checks.ts).
    VIES_URL: z.url().default('https://ec.europa.eu/taxation_customs/vies/rest-api'),
    // The published terms a new account accepts (docs/ONBOARDING.md). Empty: no sign-up outside local.
    TERMS_URL: z.preprocess(blank, z.url().optional()),
    // Billing (docs/BILLING.md): the owner's Stripe account. Empty key: nobody is billed or gated.
    STRIPE_SECRET_KEY: optionalText(),
    STRIPE_WEBHOOK_SECRET: optionalText(),
    // Empty: Stripe's API host. Local and tests point it at the stand-in (apps/mock-pdp /stripe).
    STRIPE_BASE_URL: z.preprocess(blank, z.url().optional()),
    // Per plan and interval, the Checkout prices: the flat one first, then any metered one.
    STRIPE_PRICES_ESSENTIEL_MONTH: priceList,
    STRIPE_PRICES_ESSENTIEL_YEAR: priceList,
    STRIPE_PRICES_CROISSANCE_MONTH: priceList,
    STRIPE_PRICES_CROISSANCE_YEAR: priceList,
    // The meter's event name: one event per invoice sent beyond the month's quota. Empty: none.
    STRIPE_METER_EVENT: optionalText(),
    STRIPE_AUTOMATIC_TAX: flag(false),
    MOCK_STRIPE_WEBHOOK_URL: z.preprocess(blank, z.url().optional()),
    MOCK_STRIPE_WEBHOOK_SECRET: z.string().min(16).default('whsec_local-mock-stripe-secret'),
    API_PUBLIC_URL: z.url().default('http://localhost:4000'),
    ADDIN_ORIGINS: z.string().default('https://localhost:3000'),
    AI_PROVIDER: optionalText(),
    AI_MODEL_AGENT: optionalText(),
    AI_MODEL_CLASSIFY: optionalText(),
    AI_BASE_URL: z.preprocess(blank, z.url().optional()),
    AI_API_KEY: optionalText(),
    AI_STRUCTURED_OUTPUTS: flag(false),
    AI_REQUEST_BODY: optionalText(),
    AI_KEY_SEALING_KEY: z.preprocess(
      blank,
      z
        .string()
        .refine((v) => Buffer.from(v, 'base64').length === 32, '32 bytes in base64')
        .optional(),
    ),
    // OneDrive / SharePoint connector (docs/MICROSOFT365.md): the owner's app registration. Empty id:
    // no connector. The secret signs the on-behalf-of exchange; never commit it.
    MICROSOFT_CLIENT_ID: z.preprocess(blank, z.uuid().optional()),
    MICROSOFT_CLIENT_SECRET: optionalText(),
    // Empty: Microsoft's hosts. Local and tests: the stand-in (apps/mock-pdp /microsoft).
    MICROSOFT_LOGIN_URL: z.preprocess(blank, z.url().optional()),
    MICROSOFT_GRAPH_URL: z.preprocess(blank, z.url().optional()),
    // Google Drive connector (docs/GOOGLE.md): the owner's OAuth client (Web application). Empty id: no
    // connector. The secret signs the code exchange; never commit it.
    GOOGLE_CLIENT_ID: optionalText(),
    GOOGLE_CLIENT_SECRET: optionalText(),
    // Empty: Google's hosts. Local and tests: the stand-in (apps/mock-pdp /google).
    GOOGLE_ACCOUNTS_URL: z.preprocess(blank, z.url().optional()),
    GOOGLE_OAUTH_URL: z.preprocess(blank, z.url().optional()),
    GOOGLE_API_URL: z.preprocess(blank, z.url().optional()),
    // Seals the connected accounts' refresh tokens; required with either connector's client id.
    CONNECTOR_SEALING_KEY: z.preprocess(
      blank,
      z
        .string()
        .refine((v) => Buffer.from(v, 'base64').length === 32, '32 bytes in base64')
        .optional(),
    ),
    AI_RUN_TOKENS: z.coerce.number().int().positive().default(30_000),
    AI_DAILY_TOKENS: z.coerce.number().int().positive().default(300_000),
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_SMTP_URL && !env.MAIL_FROM) {
      ctx.addIssue({ code: 'custom', path: ['MAIL_FROM'], message: 'required with MAIL_SMTP_URL' });
    }
    if (env.B2BROUTER_SANDBOX_API_KEY) {
      const problem =
        env.FI_ENV !== 'prod'
          ? 'only prod takes a second key: elsewhere B2BROUTER_API_KEY is the sandbox one'
          : !env.B2BROUTER_SANDBOX_API_KEY.startsWith('test_')
            ? 'a B2Brouter sandbox key (test_…)'
            : null;
      if (problem) {
        ctx.addIssue({ code: 'custom', path: ['B2BROUTER_SANDBOX_API_KEY'], message: problem });
      }
    }
    if (env.STRIPE_SECRET_KEY) {
      if (!env.STRIPE_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['STRIPE_WEBHOOK_SECRET'],
          message: 'required with STRIPE_SECRET_KEY',
        });
      }
      // Real money only in prod; everywhere else a test key (docs.stripe.com/keys).
      const live = /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY);
      const test = /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY);
      if (env.FI_ENV === 'prod' ? !live : !test) {
        ctx.addIssue({
          code: 'custom',
          path: ['STRIPE_SECRET_KEY'],
          message:
            env.FI_ENV === 'prod'
              ? 'prod takes a live key (sk_live_… or rk_live_…)'
              : `${env.FI_ENV} takes a test key (sk_test_… or rk_test_…)`,
        });
      }
    }
    for (const [id, keys] of [
      ['MICROSOFT_CLIENT_ID', ['MICROSOFT_CLIENT_SECRET', 'CONNECTOR_SEALING_KEY']],
      ['GOOGLE_CLIENT_ID', ['GOOGLE_CLIENT_SECRET', 'CONNECTOR_SEALING_KEY']],
    ] as const) {
      if (!env[id]) continue;
      for (const key of keys) {
        if (!env[key]) {
          ctx.addIssue({ code: 'custom', path: [key], message: `required with ${id}` });
        }
      }
    }
    if (env.FI_ENV === 'local') return;
    const keys = [
      'DATABASE_URL',
      'ADMIN_TOKEN',
      ...(env.FI_ENV === 'sandbox' ? ['B2BROUTER_API_KEY' as const] : []),
    ] as const;
    for (const key of keys) {
      if (!env[key])
        ctx.addIssue({ code: 'custom', path: [key], message: `required in ${env.FI_ENV}` });
    }
    // The sandbox environment never reaches a real platform (plan §0.5), and prod never pretends
    // to send: each takes the B2Brouter key of its own environment (test_… is the sandbox).
    const sandboxKey = env.B2BROUTER_API_KEY?.startsWith('test_');
    if (env.B2BROUTER_API_KEY && sandboxKey !== (env.FI_ENV === 'sandbox')) {
      ctx.addIssue({
        code: 'custom',
        path: ['B2BROUTER_API_KEY'],
        message:
          env.FI_ENV === 'sandbox'
            ? 'sandbox takes a B2Brouter sandbox key (test_…)'
            : 'prod takes a B2Brouter production key, not a sandbox one (test_…)',
      });
    }
  })
  .transform((env) => ({
    ...env,
    PGLITE_DIR: isAbsolute(env.PGLITE_DIR) ? env.PGLITE_DIR : resolve(REPO_ROOT, env.PGLITE_DIR),
    ADDIN_ORIGINS: env.ADDIN_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  }));
export type ServerEnv = z.infer<typeof ServerEnvSchema>;

const ROOT_ENV_FILE = resolve(REPO_ROOT, '.env');

/** Loads the repo-root .env if present (already-set variables win), then validates. */
export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (source === process.env && existsSync(ROOT_ENV_FILE)) {
    process.loadEnvFile(ROOT_ENV_FILE);
  }
  return ServerEnvSchema.parse(source);
}
