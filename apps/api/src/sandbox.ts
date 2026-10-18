// « Mode test » scenarios (plan §3): the scenario panel plays a platform event on a test invoice
// already sent to the test platform. The mock plays it itself and the normal sync brings it back;
// on a platform that cannot, the ScenarioInjector writes the events as the platform would have.
import { type InvoiceState, parisToday, transition } from '@fi/core';
import {
  applyTransition,
  audit,
  eq,
  type InvoiceRow,
  invoiceEvents,
  invoices,
  type TenantRow,
} from '@fi/db';
import {
  eventFor,
  PdpUnavailableError,
  ScenarioConflict,
  type ScenarioInput,
} from '@fi/pdp-adapter';
import { t } from '@fi/shared';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { type Route, routeFor } from './platform';

export const SCENARIOS = ['pdp_reject', 'customer_refuse', 'pay_late', 'siren_unknown'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export type ScenarioStep = Pick<ScenarioInput, 'status' | 'reason' | 'after'>;

/** Sent and not final yet: the platform still has something to say. */
const PLAYABLE: readonly InvoiceState[] = ['deposited', 'delivered', 'accepted'];
/** Days late in « Simuler paiement à J+45 ». */
export const LATE_DAYS = 45;

const days = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export function stepsFor(scenario: Scenario, row: InvoiceRow, today: string): ScenarioStep[] {
  const reason = (code: string) => ({ code, text: t(`scenario.reason.${scenario}`) });
  switch (scenario) {
    case 'pdp_reject':
      return [{ status: 'rejected', reason: reason('SIMULATION') }];
    case 'customer_refuse':
      return [{ status: 'refused', reason: reason('SIMULATION') }];
    case 'siren_unknown':
      return [{ status: 'rejected', reason: reason('ANNUAIRE') }];
    case 'pay_late': {
      const due = Math.max(0, days(today, row.dueDate ?? today));
      return [
        ...(row.status === 'accepted' ? [] : [{ status: 'accepted' as const }]),
        { status: 'payment_received', after: `P${due + LATE_DAYS}D`, reason: reason('SIMULATION') },
      ];
    }
  }
}

/** Whether the steps can happen from this status: a platform rejects at deposit, not after. */
function playable(status: InvoiceState, steps: readonly ScenarioStep[]): boolean {
  let state = status;
  for (const step of steps) {
    const event = eventFor(step.status);
    const moved = event ? transition(state, event, 'pdp') : null;
    if (!moved?.ok) return false;
    state = moved.to;
  }
  return true;
}

/**
 * Plays the steps on the test platform. False when the platform cannot play scenarios: the caller
 * then fakes the events itself.
 */
export async function injectScenario(
  deps: ApiDeps,
  route: Route,
  pdpRef: string,
  steps: readonly ScenarioStep[],
): Promise<boolean> {
  const port = deps.test?.scenarios;
  if (!port) return false;
  for (const step of steps) {
    try {
      await port.force({ account: route.account, pdpRef, ...step });
    } catch (e) {
      if (e instanceof ScenarioConflict) throw new ApiError(409, 'scenario_too_late');
      if (e instanceof PdpUnavailableError) throw new ApiError(503, 'scenario_unavailable');
      throw e;
    }
  }
  return true;
}

/** The ScenarioInjector's own path: the events, marked as simulated, as the platform would send them. */
async function fakeEvents(deps: ApiDeps, row: InvoiceRow, steps: readonly ScenarioStep[]) {
  await deps.db.transaction(async (tx) => {
    for (const step of steps) {
      const event = eventFor(step.status);
      if (step.after || !event) {
        // A delayed event needs the platform's clock; the timeline says what would happen.
        await tx.insert(invoiceEvents).values({
          invoiceId: row.id,
          type: 'note',
          actor: 'system',
          event: 'scenario_planned',
          payload: { simulated: true, status: step.status, after: step.after ?? null },
        });
        continue;
      }
      const applied = await applyTransition(tx, {
        invoiceId: row.id,
        event,
        actor: 'pdp',
        payload: { simulated: true, ...(step.reason && { reason: step.reason }) },
      });
      // Checked by playable(); a concurrent change makes the whole simulation roll back.
      if (!applied.ok)
        throw new ApiError(409, 'scenario_not_now', { status: t(`invoice.status.${row.status}`) });
    }
  });
}

export async function playScenario(
  deps: ApiDeps,
  tenant: TenantRow,
  row: InvoiceRow,
  scenario: Scenario,
): Promise<InvoiceRow> {
  if (!row.isTest) throw new ApiError(409, 'not_test');
  const route = routeFor(deps, tenant, true);
  if (!route?.adapter) throw new ApiError(409, 'test_platform_missing');
  if (!row.pdpRef || !PLAYABLE.includes(row.status)) throw new ApiError(409, 'scenario_needs_send');

  const steps = stepsFor(scenario, row, parisToday(deps.now()));
  if (!playable(row.status, steps)) {
    throw new ApiError(409, 'scenario_not_now', { status: t(`invoice.status.${row.status}`) });
  }
  await deps.db.transaction(async (tx) => {
    await tx.insert(invoiceEvents).values({
      invoiceId: row.id,
      type: 'note',
      actor: 'user',
      event: 'scenario',
      payload: { scenario },
    });
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'invoice.scenario',
      objectType: 'invoice',
      objectId: row.id,
      after: { scenario },
    });
  });
  if (await injectScenario(deps, route, row.pdpRef, steps)) {
    await deps.jobs.enqueueSync({
      provider: route.provider,
      account: route.account,
      pdpRef: row.pdpRef,
    });
  } else {
    await fakeEvents(deps, row, steps);
  }
  const [after] = await deps.db.select().from(invoices).where(eq(invoices.id, row.id));
  return after ?? row;
}
