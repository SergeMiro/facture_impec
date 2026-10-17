import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderRules, renderStateMachine } from '../scripts/docs';
import { cenRuleIds, DOCS } from '../scripts/generate-docs';

describe('generated docs', () => {
  it('reads the 223 rule ids of the CEN artefacts', () => {
    expect(cenRuleIds()).toHaveLength(223);
  });

  it('docs/RULES.md is up to date (pnpm --filter @fi/core gen:docs)', () => {
    expect(readFileSync(DOCS.rules, 'utf8')).toBe(renderRules(cenRuleIds()));
  });

  it('docs/STATE_MACHINE.md is up to date (pnpm --filter @fi/core gen:docs)', () => {
    expect(readFileSync(DOCS.stateMachine, 'utf8')).toBe(renderStateMachine());
  });

  it('explains every CEN rule it does not apply', () => {
    expect(() => renderRules([...cenRuleIds(), 'BR-99'])).toThrow('BR-99');
  });
});
