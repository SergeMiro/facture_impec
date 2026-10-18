// The agents' side of the API (plan §6): which model answers for a tenant, and agent_runs in
// Postgres. Settings are data: a tenant on its own key (BYOK) never falls back to ours.
import {
  type AiHandle,
  AiSettings,
  aiHandle,
  type Budget,
  createModel,
  Orchestrator,
  openSecret,
  probeModel,
  type ResolvedAi,
  type RunRecord,
  type RunStore,
} from '@fi/agents';
import { parisToday } from '@fi/core';
import { agentRuns, and, type Db, eq, gte, sql, type TenantRow } from '@fi/db';
import type { AiDeps } from './deps';

/** Midnight in Europe/Paris, as an instant: the daily budget starts there. */
export function parisMidnight(now: Date): Date {
  const day = parisToday(now);
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  // Paris is UTC+1 or UTC+2: midnight there is 22:00 or 23:00 UTC the day before.
  for (const hours of [2, 1]) {
    const candidate = new Date(utcMidnight - hours * 3_600_000);
    if (parisToday(candidate) === day && parisToday(new Date(candidate.getTime() - 1)) !== day)
      return candidate;
  }
  return new Date(utcMidnight);
}

export class DbRunStore implements RunStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date,
  ) {}

  async record(run: RunRecord): Promise<void> {
    await this.db.insert(agentRuns).values({
      ...run,
      startedAt: new Date(run.startedAt),
      finishedAt: new Date(run.finishedAt),
    });
  }

  async tokensToday(tenantId: string): Promise<number> {
    const [row] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${agentRuns.inputTokens} + ${agentRuns.outputTokens}), 0)`,
      })
      .from(agentRuns)
      .where(
        and(eq(agentRuns.tenantId, tenantId), gte(agentRuns.startedAt, parisMidnight(this.now()))),
      );
    return Number(row?.total ?? 0);
  }
}

export interface AiOptions {
  db: Db;
  now: () => Date;
  included: ResolvedAi | null;
  sealingKey: string | undefined;
  budget: Budget;
  probe?: AiDeps['probe'];
}

export function createAiDeps(options: AiOptions): AiDeps {
  const store = new DbRunStore(options.db, options.now);
  return {
    store,
    orchestrator: new Orchestrator({ store, budget: options.budget, now: options.now }),
    included: options.included,
    sealingKey: options.sealingKey,
    probe: options.probe ?? ((resolved) => probeModel(createModel(resolved, 'agent'), options.now)),
  };
}

/** What the tenant chose: null → the included AI, `{mode: 'off'}` → none, else its own settings. */
export function resolveAi(ai: AiDeps, tenant: TenantRow): ResolvedAi | null {
  const stored = tenant.aiSettings;
  if (!stored) return ai.included;
  if (stored.mode === 'off') return null;
  const settings = AiSettings.safeParse(stored);
  if (!settings.success) return null;
  if (settings.data.mode === 'included') return ai.included;
  const apiKey =
    tenant.aiKeySealed && ai.sealingKey ? openSecret(tenant.aiKeySealed, ai.sealingKey) : undefined;
  return { settings: settings.data, apiKey };
}

export const tenantAi = (ai: AiDeps, tenant: TenantRow): AiHandle | null =>
  aiHandle(resolveAi(ai, tenant));
