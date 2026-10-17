// Writes docs/RULES.md and docs/STATE_MACHINE.md (repository root).
// Run: pnpm --filter @fi/core gen:docs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderRules, renderStateMachine } from './docs';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Rule ids of the CEN CII validation XSLT (the UBL one has the same set). */
export function cenRuleIds(): string[] {
  const xslt = readFileSync(here('../vendor/cen-1.3.17/xslt/EN16931-CII-validation.xslt'), 'utf8');
  const ids = [...xslt.matchAll(/<xsl:attribute name="id">(BR-[A-Z0-9-]+)<\/xsl:attribute>/g)];
  return [...new Set(ids.map((m) => m[1] ?? ''))].sort();
}

export const DOCS = {
  rules: here('../../../docs/RULES.md'),
  stateMachine: here('../../../docs/STATE_MACHINE.md'),
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(DOCS.rules, renderRules(cenRuleIds()));
  writeFileSync(DOCS.stateMachine, renderStateMachine());
  console.info('docs/RULES.md and docs/STATE_MACHINE.md written');
}
