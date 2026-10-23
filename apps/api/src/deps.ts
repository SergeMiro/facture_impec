import type { AiHandle, Budget, Orchestrator, ProbeResult, ResolvedAi, RunStore } from '@fi/agents';
import type { FacturXOptions } from '@fi/core/pdf';
import type { Db, PdpProvider } from '@fi/db';
import type { PdpAdapter, ScenarioPort } from '@fi/pdp-adapter';
import type { ServerEnv } from '@fi/shared/env';
import type { Billing } from './billing';
import type { GoogleConnector, MicrosoftConnector } from './connectors';
import type { RequestWindows } from './limits';
import type { Directory } from './sirene';

/** The adapters this deployment can use; a tenant on a missing provider cannot send yet. */
export type PdpRegistry = Partial<Record<PdpProvider, PdpAdapter>>;

/**
 * Companies that bring their own platform key (docs/B2BROUTER.md §12): their real invoices, statuses,
 * inbox and payments go through it instead of the deployment's key; « Mode test » does not.
 */
export interface OwnPlatform {
  /** PDP_KEY_SEALING_KEY: company keys are sealed with it at rest. */
  sealingKey: string;
  /**
   * An adapter calling the platform with this company key. Throws on a key this deployment cannot use
   * (another environment's); null: the provider takes no company key.
   */
  adapter(provider: PdpProvider, apiKey: string): PdpAdapter | null;
}

/** An invoice at a platform: what a webhook or the sweep asks the sync job to refresh. */
export interface SyncTarget {
  provider: PdpProvider;
  account: string;
  pdpRef: string;
}

/** Background work the routes start (pg-boss in src/jobs.ts). */
export interface Jobs {
  enqueueSend(invoiceId: string): Promise<void>;
  enqueueSync(target: SyncTarget): Promise<void>;
  /** MonitorAgent: advice after a rejection or a refusal (src/monitor.ts). */
  enqueueMonitor(invoiceId: string): Promise<void>;
  /** Report a payment the user recorded to the platform (src/payments.ts). */
  enqueueReportPayment(invoiceId: string): Promise<void>;
  /** Bring a company's registry up to date (src/registry.ts). */
  enqueueRegistry(tenantId: string): Promise<void>;
  /** Check a connected account's picked files (src/connectors.ts). */
  enqueueConnector(connectionId: string): Promise<void>;
}

export interface AiDeps {
  orchestrator: Orchestrator;
  /** Where the orchestrator writes agent_runs; the deterministic TestAgent writes there too. */
  store: RunStore;
  /** The AI included in the subscription (AI_PROVIDER…); null when the operator set none. */
  included: ResolvedAi | null;
  /** AI_KEY_SEALING_KEY; without it tenants cannot save their own key. */
  sealingKey: string | undefined;
  /** « Tester la connexion » before BYOK settings are saved; tests replace it. */
  probe(resolved: ResolvedAi): Promise<ProbeResult>;
  /** The token caps (AI_RUN_TOKENS, AI_DAILY_TOKENS): the chat reads them without the orchestrator. */
  budget: Budget;
  /** Settings → models (default `aiHandle`); tests put a scripted model here. */
  handle?: (resolved: ResolvedAi | null) => AiHandle | null;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  /** The sender's display name when an accounting firm's brand replaces ours (white label). */
  fromName?: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** « Mode test » (plan §3): where test invoices go, and how their scenarios are played. */
export interface TestPlatform {
  /** The mock platform, or B2Brouter when the deployment holds a sandbox key (runtime.ts). */
  provider: PdpProvider;
  /** Null when the platform cannot play scenarios: the ScenarioInjector fakes the events. */
  scenarios: ScenarioPort | null;
}

export interface ApiDeps {
  env: Pick<
    ServerEnv,
    | 'FI_ENV'
    | 'ADMIN_TOKEN'
    | 'API_PUBLIC_URL'
    | 'ADDIN_ORIGINS'
    | 'TRUST_PROXY_HEADER'
    | 'TERMS_URL'
  >;
  db: Db;
  jobs: Jobs;
  pdp: PdpRegistry;
  /** Null: this deployment offers no test platform, and « Mode test » is unavailable. */
  test: TestPlatform | null;
  ai: AiDeps;
  /**
   * Null: no sign-in or sign-up links, no chasing e-mail sent by the autopilot, no weekly report by
   * mail (outside local without MAIL_SMTP_URL).
   */
  mailer: Mailer | null;
  fonts: FacturXOptions['fonts'];
  /** Stripe (src/billing.ts); absent or null: nobody is billed and no send waits for a plan. */
  billing?: Billing | null;
  /** The company directory behind « Créer un compte » (src/sirene.ts); absent: no sign-up. */
  directory?: Directory | null;
  /** Company platform keys (PDP_KEY_SEALING_KEY); absent or null: every company uses ours. */
  ownPdp?: OwnPlatform | null;
  /** OneDrive files read without Excel (src/connectors.ts); absent or null: not offered. */
  microsoft?: MicrosoftConnector | null;
  /** Google Drive files read without Excel (R5, src/connectors.ts); absent or null: not offered. */
  google?: GoogleConnector | null;
  /** Request counters (src/limits.ts); default: fresh ones per app. */
  limits?: RequestWindows;
  now: () => Date;
}
