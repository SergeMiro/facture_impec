import { defineConfig } from 'drizzle-kit';

// `pnpm --filter @fi/db generate` diffs src/schema.ts against drizzle/ and writes the next migration.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
});
