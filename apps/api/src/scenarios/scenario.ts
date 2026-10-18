// fixtures/scenarios/<name>.json (plan §9 "Scenario"): one outbound cycle against the mock platform,
// and with `chase`, the chasing of an invoice paid late on the accelerated business clock.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STATES, STEP_REASONS } from '@fi/core';
import { MockControl } from '@fi/pdp-adapter';
import { REPO_ROOT } from '@fi/shared/env';
import { z } from 'zod';

export const ChaseExpectation = z.object({
  /** The invoices fall due this many days after today (Europe/Paris). */
  dueInDays: z.number().int().min(4).max(60),
  /** Synthetic address on the invoices (BT-58): where the autopilot writes. */
  customerEmail: z.email(),
  /** Réglages of the scenario's company, set before its first invoice (PATCH /settings). */
  settings: z.object({
    mode: z.enum(['review', 'autopilot']),
    autopilotMaxAmount: z.number().int().min(0).nullable().optional(),
    chaseCadence: z.array(z.number().int()).optional(),
  }),
  /** How each step must end up, on its own business day (due date + offset). */
  steps: z
    .array(
      z.object({
        offset: z.number().int(),
        status: z.enum(['sent', 'drafted']),
        reason: z.enum(STEP_REASONS).optional(),
      }),
    )
    .min(1),
  /** E-mails the customer receives from the autopilot, per invoice. */
  mails: z.number().int().min(0),
});
export type ChaseExpectation = z.infer<typeof ChaseExpectation>;

export const Scenario = z.object({
  description: z.string(),
  /** How many invoices the scenario creates and sends (numbers F<year>-0001, -0002…). */
  invoices: z.number().int().min(1).max(200),
  /** Mock platform controls set before the first send (PUT /control). */
  platform: MockControl.default({}),
  /** Each invoice is created `create` times and sent `send` times, all at once: > 1 tests idempotency. */
  repeat: z
    .object({
      create: z.number().int().min(1).default(1),
      send: z.number().int().min(1).default(1),
    })
    .default({ create: 1, send: 1 }),
  /** Chasing: the API runs on the platform's clock (`platform.speed`) and its steps are checked. */
  chase: ChaseExpectation.optional(),
  expect: z.object({
    status: z.enum(STATES),
    withinSeconds: z.number().positive(),
    /** Invoices the platform holds for each number at the end. */
    depositsPerInvoice: z.number().int().min(0).default(1),
  }),
});
export type Scenario = z.infer<typeof Scenario>;

export const SCENARIO_DIR = resolve(REPO_ROOT, 'fixtures/scenarios');

export function scenarioNames(): string[] {
  return readdirSync(SCENARIO_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

export function loadScenario(name: string): Scenario {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`bad scenario name ${name}`);
  return Scenario.parse(JSON.parse(readFileSync(resolve(SCENARIO_DIR, `${name}.json`), 'utf8')));
}
