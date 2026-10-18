// Réglages (plan §5 screen 6): test mode, chasing cadence and its autopilot, the defaults every sheet
// invoice reuses, the PDP connection (read only) and the AI. A tenant's own AI key is tested before it
// is saved, sealed at rest, and only its last four characters ever come back.
import {
  AiSettings,
  byokUrlProblem,
  keyHint,
  openSecret,
  ProviderId,
  sealSecret,
} from '@fi/agents';
import { InvoiceDefaults } from '@fi/core';
import { audit, eq, type TenantRow, tenants } from '@fi/db';
import { t } from '@fi/shared';
import { z } from 'zod';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';

export const ChaseCadence = z
  .array(z.number().int().min(-30).max(120))
  .min(1)
  .max(8)
  .refine((days) => days.every((d, i) => i === 0 || d > (days[i - 1] ?? d)), 'in increasing order');

export const SettingsPatch = z
  .object({
    sandboxEnabled: z.boolean(),
    chaseCadence: ChaseCadence,
    invoiceDefaults: InvoiceDefaults,
    /** Autopilot covers chasing only (plan §0.2, §6); invoices still leave on « Envoyer ». */
    mode: z.enum(['review', 'autopilot']),
    /** Cents; the highest invoice amount the autopilot chases by itself. */
    autopilotMaxAmount: z.number().int().min(0).max(100_000_000).nullable(),
  })
  .partial()
  // The pseudonymization switch is not settable yet (docs/DEFERRED.md).
  .strict();

export const AiChoice = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('included') }),
  z.object({ mode: z.literal('off') }),
  z.object({
    mode: z.literal('byok'),
    provider: ProviderId,
    models: z.object({ agent: z.string().min(1).max(200), classify: z.string().min(1).max(200) }),
    baseUrl: z.url().optional(),
    apiVersion: z.string().min(1).max(40).optional(),
    structuredOutputs: z.boolean().optional(),
    /** Omitted: keep the key already saved. */
    apiKey: z.string().min(1).max(500).optional(),
  }),
]);
export type AiChoice = z.infer<typeof AiChoice>;

export function settingsView(deps: ApiDeps, tenant: TenantRow) {
  const stored = tenant.aiSettings;
  const own = stored && stored.mode !== 'off' ? AiSettings.safeParse(stored) : undefined;
  const byok = own?.success && own.data.mode === 'byok' ? own.data : undefined;
  return {
    mode: tenant.mode,
    /** The autopilot sends chasing e-mails itself: only where the deployment can send mail. */
    autopilotAvailable: Boolean(deps.mailer),
    autopilotMaxAmount: tenant.autopilotMaxAmount,
    sandboxEnabled: tenant.sandboxEnabled,
    testPlatform: deps.test !== null,
    /** Always on during the pilot (docs/DEFERRED.md). */
    pseudonymizeLlm: true,
    chaseCadence: tenant.chaseCadence,
    invoiceDefaults: tenant.invoiceDefaults,
    pdp: {
      provider: tenant.pdpProvider,
      account: tenant.pdpAccount,
      connected: Boolean(deps.pdp[tenant.pdpProvider]),
    },
    ai: {
      mode: !stored ? 'included' : byok ? 'byok' : stored.mode === 'off' ? 'off' : 'included',
      includedProvider: deps.ai.included?.settings.provider ?? null,
      byokAvailable: Boolean(deps.ai.sealingKey),
      ...(byok && {
        provider: byok.provider,
        models: byok.models,
        baseUrl: byok.baseUrl ?? null,
        capabilities: byok.capabilities ?? null,
        keyHint: tenant.aiKeyHint,
      }),
    },
  };
}

async function save(
  deps: ApiDeps,
  before: TenantRow,
  patch: Partial<typeof tenants.$inferInsert>,
  action: string,
  after: unknown,
) {
  if (Object.keys(patch).length === 0) return before;
  return deps.db.transaction(async (tx) => {
    const [row] = await tx.update(tenants).set(patch).where(eq(tenants.id, before.id)).returning();
    if (!row) throw new ApiError(404, 'not_found');
    await audit(tx, {
      tenantId: row.id,
      actor: 'user',
      action,
      objectType: 'tenant',
      objectId: row.id,
      after,
    });
    return row;
  });
}

export function updateSettings(
  deps: ApiDeps,
  tenant: TenantRow,
  patch: z.infer<typeof SettingsPatch>,
) {
  if ((patch.mode ?? tenant.mode) === 'autopilot') {
    if (patch.mode === 'autopilot' && !deps.mailer)
      throw new ApiError(409, 'autopilot_unavailable');
    const ceiling =
      patch.autopilotMaxAmount === undefined ? tenant.autopilotMaxAmount : patch.autopilotMaxAmount;
    if (ceiling === null) throw new ApiError(400, 'autopilot_needs_ceiling');
  }
  return save(deps, tenant, patch, 'settings.update', patch);
}

export async function saveAi(deps: ApiDeps, tenant: TenantRow, choice: AiChoice) {
  const cleared = { aiKeySealed: null, aiKeyHint: null };
  if (choice.mode === 'included') {
    return save(deps, tenant, { aiSettings: null, ...cleared }, 'ai.settings', {
      mode: 'included',
    });
  }
  if (choice.mode === 'off') {
    return save(deps, tenant, { aiSettings: { mode: 'off' }, ...cleared }, 'ai.settings', {
      mode: 'off',
    });
  }
  const sealingKey = deps.ai.sealingKey;
  if (!sealingKey) throw new ApiError(409, 'byok_disabled');
  const { apiKey: given, ...rest } = choice;
  const settings = AiSettings.safeParse(rest);
  if (!settings.success) {
    throw new ApiError(400, 'invalid_request', undefined, z.prettifyError(settings.error));
  }
  const problem = settings.data.baseUrl ? byokUrlProblem(settings.data.baseUrl) : null;
  if (problem) throw new ApiError(422, 'ai_probe', { problem: t('ai.probe.url') }, problem);
  const apiKey =
    given ?? (tenant.aiKeySealed ? openSecret(tenant.aiKeySealed, sealingKey) : undefined);
  const probe = await deps.ai.probe({ settings: settings.data, apiKey });
  if (probe.failure) {
    throw new ApiError(422, 'ai_probe', { problem: t(`ai.probe.${probe.failure}`) }, probe.detail);
  }
  const stored = { ...settings.data, capabilities: probe.capabilities };
  return save(
    deps,
    tenant,
    {
      aiSettings: stored,
      aiKeySealed: apiKey ? sealSecret(apiKey, sealingKey) : null,
      aiKeyHint: apiKey ? keyHint(apiKey) : null,
    },
    'ai.settings',
    stored,
  );
}
