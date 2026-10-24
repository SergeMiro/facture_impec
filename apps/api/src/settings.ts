// Réglages (plan §5 screen 6): test mode, chasing cadence and its autopilot, the defaults every sheet
// invoice reuses, the PDP connection and the AI. A tenant's own AI key, like its own platform key, is
// tested before it is saved, sealed at rest, and only its last four characters ever come back.
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
import { PdpRequestError, PdpUnavailableError } from '@fi/pdp-adapter';
import { t } from '@fi/shared';
import { z } from 'zod';
import { isOwner, type Principal } from './auth';
import { planAll, unplanAll } from './autopilot';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { recheckSubcontracting } from './inbound';
import { recheckCompany } from './invoices';
import { adapterFor } from './platform';

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
    /**
     * Autopilot (plan §0.2, §6): chasing e-mails go by themselves, and so do invoices to the customers
     * opted in for « Envoi automatique » (src/autopilot.ts). Review: everything waits for a click.
     */
    mode: z.enum(['review', 'autopilot']),
    /** Cents; the highest invoice amount the autopilot sends and chases by itself. */
    autopilotMaxAmount: z.number().int().min(0).max(100_000_000).nullable(),
    /** The margin wanted on what the company resells, % of the sale price (rule B2); null: none. */
    minMarginPercent: z.number().int().min(1).max(90).nullable(),
    /** « Entreprise du bâtiment (BTP) »: the BTP rules and switches (docs/research/BTP_RULES.md). */
    btp: z.boolean(),
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

/** « Votre propre clé B2Brouter » (docs/B2BROUTER.md §12). */
export const PdpKeyBody = z
  .object({
    apiKey: z.string().trim().min(8).max(200),
    /** The company's account id under that key; omitted: keep the current one. */
    account: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

/** Whether a sealed key still opens and gives an adapter: false hides nothing, it stops sends. */
function reachable(deps: ApiDeps, tenant: TenantRow): boolean {
  try {
    return Boolean(adapterFor(deps, tenant, tenant.pdpProvider));
  } catch {
    return false;
  }
}

export function settingsView(deps: ApiDeps, tenant: TenantRow) {
  const stored = tenant.aiSettings;
  const own = stored && stored.mode !== 'off' ? AiSettings.safeParse(stored) : undefined;
  const byok = own?.success && own.data.mode === 'byok' ? own.data : undefined;
  return {
    mode: tenant.mode,
    /** The autopilot sends chasing e-mails itself: only where the deployment can send mail. */
    autopilotAvailable: Boolean(deps.mailer),
    autopilotMaxAmount: tenant.autopilotMaxAmount,
    minMarginPercent: tenant.minMarginPercent,
    btp: tenant.btp,
    sandboxEnabled: tenant.sandboxEnabled,
    testPlatform: deps.test !== null,
    /** Always on during the pilot (docs/DEFERRED.md). */
    pseudonymizeLlm: true,
    chaseCadence: tenant.chaseCadence,
    invoiceDefaults: tenant.invoiceDefaults,
    pdp: {
      provider: tenant.pdpProvider,
      account: tenant.pdpAccount,
      connected: reachable(deps, tenant),
      ownKey: { available: Boolean(deps.ownPdp), hint: tenant.pdpKeyHint },
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
  actor: 'user' | 'api' = 'user',
) {
  if (Object.keys(patch).length === 0) return before;
  return deps.db.transaction(async (tx) => {
    const [row] = await tx.update(tenants).set(patch).where(eq(tenants.id, before.id)).returning();
    if (!row) throw new ApiError(404, 'not_found');
    await audit(tx, {
      tenantId: row.id,
      actor,
      action,
      objectType: 'tenant',
      objectId: row.id,
      after,
    });
    // The autopilot's switch or ceiling moved: what leaves by itself is decided again.
    if (row.mode !== before.mode || row.autopilotMaxAmount !== before.autopilotMaxAmount) {
      if (row.mode === 'autopilot') await planAll(tx, deps.now(), row);
      else await unplanAll(tx, row.id);
    }
    // The BTP rules start or stop speaking: the invoices not yet sent, and the received ones still to
    // decide, are checked again.
    if (row.btp !== before.btp) {
      await recheckCompany(tx, row, deps.now());
      await recheckSubcontracting(tx, row, deps.now());
    }
    return row;
  });
}

export async function updateSettings(
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
  const row = await save(deps, tenant, patch, 'settings.update', patch);
  // The margin the rules read moved: the company's documents are checked again (src/checks.ts).
  if (row.minMarginPercent !== tenant.minMarginPercent) await deps.jobs.enqueueRegistry(row.id);
  return row;
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

const probeProblem = (e: unknown): 'unavailable' | 'key' | 'account' | 'other' => {
  if (e instanceof PdpUnavailableError) return 'unavailable';
  if (e instanceof PdpRequestError && (e.status === 401 || e.status === 403)) return 'key';
  // TODO(verify) docs/B2BROUTER.md §12: an account the key cannot reach is assumed to answer 404.
  if (e instanceof PdpRequestError && e.status === 404) return 'account';
  return 'other';
};

/**
 * The company's own platform key: tried on its account before anything is saved, so a wrong key or
 * account never stops sends. Once live, the account is fixed (its invoices are followed there) and a
 * key can only be replaced by one that reaches the same account.
 */
export async function savePdpKey(
  deps: ApiDeps,
  tenant: TenantRow,
  principal: Principal,
  input: z.infer<typeof PdpKeyBody>,
) {
  if (!isOwner(principal)) throw new ApiError(403, 'owner_only');
  const own = deps.ownPdp;
  if (!own) throw new ApiError(409, 'pdp_key_disabled');
  const account = input.account ?? tenant.pdpAccount;
  if (tenant.liveAt && account !== tenant.pdpAccount) throw new ApiError(409, 'tenant_live');
  let adapter: ReturnType<typeof own.adapter>;
  try {
    adapter = own.adapter(tenant.pdpProvider, input.apiKey);
  } catch (e) {
    const details = e instanceof Error ? e.message : String(e);
    throw new ApiError(
      422,
      'pdp_key_refused',
      { problem: t('pdpKey.problem.environment') },
      details,
    );
  }
  if (!adapter) throw new ApiError(409, 'pdp_key_unsupported');
  try {
    // The cheapest call that needs both the key and the account (the same as « passer en réel »).
    await adapter.listInbound({ account, since: deps.now() });
  } catch (e) {
    const details = e instanceof Error ? e.message : String(e);
    const problem = t(`pdpKey.problem.${probeProblem(e)}`);
    throw new ApiError(422, 'pdp_key_refused', { problem }, details);
  }
  const hint = keyHint(input.apiKey);
  return save(
    deps,
    tenant,
    {
      pdpKeySealed: sealSecret(input.apiKey, own.sealingKey),
      pdpKeyHint: hint,
      pdpAccount: account,
    },
    'settings.pdp_key',
    { hint, account },
    principal.kind === 'key' ? 'api' : 'user',
  );
}

/** Back to the operator key; not once live, where the invoices sit under the company's own key. */
export async function removePdpKey(deps: ApiDeps, tenant: TenantRow, principal: Principal) {
  if (!isOwner(principal)) throw new ApiError(403, 'owner_only');
  if (!tenant.pdpKeySealed) return tenant;
  if (tenant.liveAt) throw new ApiError(409, 'tenant_live');
  return save(
    deps,
    tenant,
    { pdpKeySealed: null, pdpKeyHint: null },
    'settings.pdp_key_remove',
    { hint: tenant.pdpKeyHint },
    principal.kind === 'key' ? 'api' : 'user',
  );
}
