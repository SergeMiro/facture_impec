import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, envField } from 'astro/config';

// One root .env for the whole repo (CLAUDE.md); shell variables win over the file.
const envDir = fileURLToPath(new URL('../..', import.meta.url));
const envFile = `${envDir}.env`;
const env = {
  ...(existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {}),
  ...process.env,
};

export default defineConfig({
  site: env.PUBLIC_SITE_URL ?? 'https://facture-impec-site.vercel.app',
  output: 'static',
  adapter: vercel(),
  integrations: [react()],
  server: { port: Number(env.SITE_PORT ?? 4321) },
  vite: { envDir, plugins: [tailwindcss()] },
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      SUPABASE_PUBLISHABLE_KEY: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      TRIAL_NOTIFY_TELEGRAM_BOT_TOKEN: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      TRIAL_NOTIFY_TELEGRAM_CHAT_ID: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      PUBLIC_CONTACT_EMAIL: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
    },
  },
});
