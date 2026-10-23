// The task pane's only door to the API. Every answer is checked with Zod (rule 4); an API error
// arrives as ApiFailure with the server's French message, a network failure as Offline.
import {
  ChaseDraft,
  ChaseStep,
  DOC_KINDS,
  LayoutMapping,
  SheetMapping,
  SheetSnapshot,
} from '@fi/core';
import type { UIDataTypes, UIMessage } from 'ai';
import { z } from 'zod';
import type { PickedFile } from './microsoft/port';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The request never reached the API: the action can wait for the connection. */
export class Offline extends Error {}

const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** An accounting firm's brand on the company (white label, M7). */
const Brand = z.object({
  firmName: z.string(),
  accentColor: z.string().optional(),
  full: z.boolean(),
});

const Tenant = z.object({
  id: z.string(),
  name: z.string(),
  siren: z.string(),
  pdpProvider: z.string(),
  mode: z.string(),
  sandboxEnabled: z.boolean(),
  whiteLabel: Brand.nullable().default(null),
});
const User = z.object({ email: z.string(), role: z.string() });

export const Me = z.object({
  tenant: Tenant,
  user: User.nullable(),
  testMode: z.object({ enabled: z.boolean(), available: z.boolean() }),
  /** Prod: real sends wait until the operator switches the company live. */
  awaitingGoLive: z.boolean().default(false),
});
export type Me = z.infer<typeof Me>;

const SignupOffer = z.object({ termsVersion: z.string(), termsUrl: z.string().nullable() });
export type SignupOffer = z.infer<typeof SignupOffer>;
const Options = z.object({
  magicLink: z.boolean(),
  signup: SignupOffer.nullable().default(null),
});

const PostalAddress = z.object({
  line1: z.string().optional(),
  line2: z.string().optional(),
  line3: z.string().optional(),
  city: z.string().optional(),
  postCode: z.string().optional(),
  subdivision: z.string().optional(),
  country: z.string().optional(),
});
export type PostalAddress = z.infer<typeof PostalAddress>;

/** What the company directory knows of a SIREN (« Créer un compte »). */
export const DirectoryCompany = z.object({
  siren: z.string(),
  name: z.string().nullable(),
  address: PostalAddress.nullable(),
  vatId: z.string().nullable(),
  vatSource: z.enum(['dgfip', 'computed']),
  masked: z.boolean(),
});
export type DirectoryCompany = z.infer<typeof DirectoryCompany>;

export interface SignupRequest {
  siren: string;
  email: string;
  company: { name: string; address: PostalAddress | null; vatId: string | null };
  termsVersion: string;
}

/** Réglages → Abonnement (GET /billing). */
export const BillingView = z.object({
  enabled: z.boolean(),
  status: z.enum(['trial', 'active', 'past_due', 'ended', 'pilot']),
  plan: z.enum(['essentiel', 'croissance']).nullable(),
  interval: z.enum(['month', 'year']).nullable(),
  trialEndsAt: z.string().nullable(),
  periodEnd: z.string().nullable(),
  trial: z.object({ sends: z.number(), left: z.number() }).nullable(),
  month: z.object({
    month: z.string(),
    sent: z.number(),
    included: z.number().nullable(),
    overage: z.boolean(),
  }),
  offers: z.array(
    z.object({
      plan: z.enum(['essentiel', 'croissance']),
      interval: z.enum(['month', 'year']),
      included: z.number(),
      overage: z.boolean(),
    }),
  ),
  portal: z.boolean(),
});
export type BillingView = z.infer<typeof BillingView>;
export type Offer = BillingView['offers'][number];
const PageUrl = z.object({ url: z.string().url() });

export const Tone = z.enum(['ok', 'warning', 'error', 'progress', 'neutral']);

export const RowStatus = z.object({
  rowKey: z.string(),
  rows: z.array(z.number().int()),
  invoiceId: z.string().nullable(),
  number: z.string().nullable(),
  isTest: z.boolean(),
  status: z.string().nullable(),
  label: z.string(),
  detail: z.string(),
  tone: Tone,
  errors: z.number(),
  warnings: z.number(),
});
export type RowStatus = z.infer<typeof RowStatus>;

export const SyncResult = z.object({
  sheet: z.string(),
  test: z.boolean(),
  rows: z.array(RowStatus),
  ignoredRows: z.array(z.number()),
});
export type SyncResult = z.infer<typeof SyncResult>;

/** The most invoices one status check asks about (the API lists at most 200 at a time). */
const MAX_IDS = 200;
const InvoiceStatuses = z.object({
  invoices: z.array(z.object({ id: z.string(), status: z.string() })),
});

export const Degraded = z.enum(['ai_off', 'daily_budget', 'run_budget', 'error']);
export type Degraded = z.infer<typeof Degraded>;

export const Detection = z.object({ mapping: SheetMapping, degraded: Degraded.nullable() });
export type Detection = z.infer<typeof Detection>;

const SavedMapping = z.object({ mapping: SheetMapping, updatedAt: z.string() });

/** What one read of an included sheet found (R1). */
const SourceStats = z.object({
  docs: z.number(),
  lines: z.number(),
  rows: z.number(),
  ignoredRows: z.number(),
  unreadRows: z.number(),
  /** False: the confirmed header row is nowhere in the sheet any more; nothing was read. */
  headerFound: z.boolean(),
});

/** A sheet of the workbook the company included in the check (« Inclure cette feuille »). */
export const Source = z.object({
  id: z.string(),
  /** `file`: a sheet of a OneDrive file the API reads itself (R4), not of an open workbook. */
  type: z.enum(['sheet', 'file']).default('sheet'),
  fileId: z.string().nullable().default(null),
  workbookId: z.string(),
  sheet: z.string(),
  kind: z.enum(DOC_KINDS),
  layout: LayoutMapping,
  consentedAt: z.string(),
  readAt: z.string().nullable(),
  changedAt: z.string().nullable(),
  stats: SourceStats.nullable(),
});
export type Source = z.infer<typeof Source>;

/** What a sheet holds: a profile the company confirmed before, else LayoutAgent or the dictionary. */
export const LayoutDetection = z.object({
  layout: LayoutMapping,
  profile: z.object({ id: z.string(), version: z.number() }).nullable(),
  degraded: Degraded.nullable(),
  included: z.boolean(),
});
export type LayoutDetection = z.infer<typeof LayoutDetection>;

const SourceRead = z.object({ source: Source, written: z.number(), removed: z.number() });
export type SourceRead = z.infer<typeof SourceRead>;

/** A sheet of a OneDrive file: the proposal, and the first rows its column pickers name. */
export const FileDetection = LayoutDetection.extend({ sample: SheetSnapshot });
export type FileDetection = z.infer<typeof FileDetection>;

/** The « Fichiers OneDrive » section (R4). */
export const ConnectorView = z.object({
  /** Null: the owner registered no Microsoft app; the section says so and offers nothing. */
  microsoft: z.object({ clientId: z.string(), scope: z.string() }).nullable(),
  /** Scout: the signed-in person's mail domain is served by Microsoft (its MX record). */
  mailOnMicrosoft: z.boolean().default(false),
  connection: z
    .object({
      label: z.string(),
      accountKind: z.enum(['personal', 'work']),
      /** `reconnect`: Microsoft refused the token; nothing is read until « Reconnecter ». */
      status: z.enum(['active', 'reconnect']),
      /** Where « Choisir des fichiers » opens and the token it wants; null: no picker. */
      picker: z
        .object({ baseUrl: z.string(), scope: z.string(), authority: z.string().optional() })
        .nullable(),
      /** True: a change shows within minutes; false: at the next hourly check. */
      notified: z.boolean(),
      connectedAt: z.string(),
      checkedAt: z.string().nullable(),
      files: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          /** Why the file is not read now: gone, out of reach, too large, unreadable. */
          problem: z.string().nullable(),
          pickedAt: z.string(),
          checkedAt: z.string().nullable(),
          changedAt: z.string().nullable(),
          sheets: z.array(
            z.object({
              sheet: z.string(),
              /** False: renamed or deleted in the file; what it gave stays as it was. */
              present: z.boolean(),
              source: Source.nullable(),
            }),
          ),
        }),
      ),
    })
    .nullable(),
});
export type ConnectorView = z.infer<typeof ConnectorView>;
export type ConnectedFile = NonNullable<ConnectorView['connection']>['files'][number];

/** The « Fichiers Google Drive » section (R5): files are picked in Google's own window. */
export const GoogleView = z.object({
  /** False: the owner registered no Google client; the section says so and offers nothing. */
  available: z.boolean(),
  connection: z
    .object({
      label: z.string(),
      accountKind: z.enum(['personal', 'work']),
      /** `reconnect`: Google refused the token; nothing is read until the window is opened again. */
      status: z.enum(['active', 'reconnect']),
      notified: z.boolean(),
      connectedAt: z.string(),
      checkedAt: z.string().nullable(),
      files: ConnectorView.shape.connection.unwrap().shape.files,
    })
    .nullable(),
});
export type GoogleView = z.infer<typeof GoogleView>;
export type DriveProvider = 'microsoft' | 'google';

/** The « Registre » screen. */
export const Registry = z.object({
  /** `file`: the OneDrive file a sheet comes from (R4). */
  sources: z.array(Source.extend({ file: z.string().nullable().default(null) })),
  invoices: z.object({ sent: z.number(), received: z.number() }),
  /** Suppliers known from the invoices they sent (R3). */
  suppliers: z.number().default(0),
  recent: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(DOC_KINDS),
      direction: z.enum(['out', 'in']),
      number: z.string().nullable(),
      issueDate: z.string().nullable(),
      partyName: z.string().nullable(),
      /** Cents; null when a line of the document has no amount. */
      netTotal: z.number().nullable(),
      sheet: z.string().nullable(),
      /** The OneDrive file it was read from: no cell of the open workbook to select. */
      file: z.string().nullable().default(null),
      /** Where the document starts in its sheet, e.g. `Commandes!E2`. */
      cell: z.string().nullable(),
      updatedAt: z.string(),
    }),
  ),
});
export type Registry = z.infer<typeof Registry>;

/** What the checks across documents found (R2): its money at stake and the cells to look at. */
export const Finding = z.object({
  id: z.string(),
  rule: z.string(),
  severity: z.enum(['blocking', 'warning', 'info']),
  message: z.string(),
  /** Cents at stake; null when nothing tells the amount. */
  amount: z.number().nullable(),
  invoiceId: z.string().nullable(),
  /** « Envoyer quand même » sends it back: a finding that changed since asks again. */
  fingerprint: z.string(),
  isTest: z.boolean(),
  evidence: z.array(
    z.object({
      role: z.enum(['invoice', 'order', 'delivery', 'price_list', 'history', 'purchase']),
      docId: z.string(),
      number: z.string().nullable(),
      /** The cell to select, e.g. `Commandes!D2`, in that sheet of that workbook. */
      cell: z.string().nullable(),
      sheet: z.string().nullable(),
      workbookId: z.string().nullable(),
      /** A supplier invoice received through the platform: « Réception » shows it. */
      inboundId: z.string().nullable().default(null),
      /** The OneDrive file it was read from (R4): no cell of the open workbook to select. */
      file: z.string().nullable().default(null),
    }),
  ),
  /** B2: the purchase's link to the invoice, for « Ce n'est pas le même article ». */
  costLinkId: z.string().nullable().default(null),
  /** R8: the one cell that corrects it, « Avant → Après »; null when no single cell does. */
  fix: z
    .object({
      sheet: z.string(),
      cell: z.string(),
      workbookId: z.string().nullable(),
      field: z.string(),
      before: z.string(),
      after: z.string(),
    })
    .nullable()
    .default(null),
  /** R7: « C'est normal » may be answered; `customer` null: the document names none. */
  normal: z.object({ customer: z.string().nullable() }).nullable().default(null),
  firstSeenAt: z.string(),
});
export type Finding = z.infer<typeof Finding>;
export type Evidence = Finding['evidence'][number];

const DocBrief = z.object({
  id: z.string(),
  kind: z.enum(['invoice', ...DOC_KINDS]),
  number: z.string().nullable(),
  issueDate: z.string().nullable(),
  partyName: z.string().nullable(),
  netTotal: z.number().nullable(),
});

/** The « Contrôles » screen. */
export const Checks = z.object({
  checkedAt: z.string().nullable(),
  /** Cents at stake on the real documents. */
  atStake: z.number(),
  blocking: z.number(),
  /** R8: « Demander à l'assistant » on each finding; false when AI is off or calls no tools. */
  assistant: z.boolean().default(false),
  findings: z.array(Finding),
  /** Documents that look alike with no number to tie them: « Oui » / « Non ». */
  links: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['billed_by', 'fulfils', 'cost']),
      score: z.number(),
      from: DocBrief.nullable(),
      to: DocBrief.nullable(),
    }),
  ),
  /** R7: « Est-ce le même article ? ». */
  synonyms: z
    .array(z.object({ id: z.string(), sold: z.string(), bought: z.string(), score: z.number() }))
    .default([]),
  /** R7: the « C'est normal » answers still running. */
  exceptions: z
    .array(
      z.object({
        id: z.string(),
        rule: z.enum(['A5', 'B1', 'B2', 'B4', 'B7']),
        customer: z.string().nullable(),
        oneCustomer: z.boolean(),
        item: z.string(),
        until: z.string().nullable(),
      }),
    )
    .default([]),
});
export type Checks = z.infer<typeof Checks>;
export type ProposedLink = Checks['links'][number];
export type RuleException = Checks['exceptions'][number];
/** « C'est normal »: for the finding's customer or every one, for 3 or 12 months or with no end. */
export interface NormalChoice {
  everyCustomer: boolean;
  months: 3 | 12 | null;
}

/** A correction of one cell (R8), « Avant → Après »: proposed, then applied or not, then maybe undone. */
export const Edit = z.object({
  id: z.string(),
  findingId: z.string().nullable(),
  invoiceId: z.string(),
  status: z.enum(['proposed', 'applied', 'declined', 'conflict', 'reverted']),
  workbookId: z.string().nullable(),
  sheet: z.string(),
  /** A1, without the sheet. */
  cell: z.string(),
  field: z.string(),
  /** Decimal text: « 30 » → « 40 ». */
  before: z.string(),
  after: z.string(),
  found: z.string().nullable(),
  reason: z.enum(['changed', 'formula', 'missing']).nullable(),
  /** Written, so « Annuler la correction » can take it back. */
  undoable: z.boolean(),
});
export type Edit = z.infer<typeof Edit>;

/** What the pane reports after a click: written or not, and what the checks say since. */
export type EditDecision =
  | { status: 'applied' | 'declined' | 'reverted' | 'kept' }
  | {
      status: 'conflict';
      found: string;
      formula?: string;
      reason: 'changed' | 'formula' | 'missing';
    };

export const EditDecided = z.object({
  edit: Edit,
  /** Closed by the checks: only then is it « corrigé ». */
  resolved: z.boolean().nullable(),
  remaining: z.array(z.object({ id: z.string(), message: z.string() })),
});
export type EditDecided = z.infer<typeof EditDecided>;

/** The pane's answers to the agent's cards (the server's FixOutcome and UndoOutcome). */
export interface FixOutcome {
  status: 'applied' | 'declined' | 'conflict' | 'refused';
  editId: string | null;
  resolved?: boolean;
  remaining?: string[];
  message?: string;
}
export interface UndoOutcome {
  status: 'reverted' | 'declined' | 'conflict' | 'refused';
  editId: string;
  resolved?: boolean;
  message?: string;
}

/** The agent's tools as the pane sees them: only proposeFix and undoEdit wait for the pane. */
export type ChatTools = {
  finding: { input: Record<string, never>; output: unknown };
  document: { input: { docId: string }; output: unknown };
  itemHistory: { input: { itemId: string }; output: unknown };
  proposeFix: { input: Record<string, never>; output: FixOutcome };
  undoEdit: { input: { editId?: string }; output: UndoOutcome };
};
export type ChatMessage = UIMessage<unknown, UIDataTypes, ChatTools>;

const ChatOpened = z.object({
  /** False when the assistant is off: « Corriger pour moi » stays. */
  available: z.boolean(),
  // The server validated them against the agent's tools before keeping them.
  messages: z.array(
    z.looseObject({
      id: z.string(),
      role: z.enum(['system', 'user', 'assistant']),
      parts: z.array(z.looseObject({ type: z.string() })),
    }),
  ),
});
export interface ChatOpened {
  available: boolean;
  messages: ChatMessage[];
}

export const Issue = z.object({
  ruleId: z.string(),
  severity: z.enum(['error', 'warning']),
  path: z.string(),
  messageFr: z.string(),
  fixHintFr: z.string(),
});
export type Issue = z.infer<typeof Issue>;

export const InvoiceEvent = z.object({
  at: z.string(),
  type: z.string(),
  actor: z.string(),
  event: z.string().nullable(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  payload: z.unknown(),
});
export type InvoiceEvent = z.infer<typeof InvoiceEvent>;

const InvoiceSummary = z.object({
  id: z.string(),
  number: z.string().nullable(),
  status: z.string(),
  statusLabel: z.string(),
  issueDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  currency: z.string().nullable(),
  buyerName: z.string().nullable(),
  payable: z.number().nullable(),
  pdpRef: z.string().nullable(),
  isTest: z.boolean(),
  /** The customer of the fiche clients this invoice was matched to; null: none yet. */
  partyId: z.string().nullable().default(null),
  /** « Envoi automatique »: when it leaves by itself, or held for good by « Annuler ». */
  autopilot: z
    .object({ at: z.string().nullable(), held: z.boolean() })
    .default({ at: null, held: false }),
  excelBinding: z
    .object({
      sheet: z.string(),
      rowKey: z.string(),
      rows: z.array(z.number()).optional(),
      cells: z.record(z.string(), z.string()).optional(),
    })
    .nullable(),
});

/** The chasing plan (« Relancer »): the cadence's steps with their dates and outcomes. */
export const ChasePlan = z.object({
  cadence: z.array(z.number()),
  dueDate: z.string(),
  steps: z.array(ChaseStep),
  nextStepOn: z.string().nullable(),
  paused: z.boolean(),
  promisedUntil: z.string().nullable(),
});
export type ChasePlan = z.infer<typeof ChasePlan>;

export const MONITOR_PROPOSALS = ['fix_and_resend', 'credit_note', 'contact_customer'] as const;

/** The MonitorAgent's advice on a rejection or refusal still open. */
export const NextStep = z.object({
  kind: z.enum(['rejection', 'refusal']),
  proposal: z.enum(MONITOR_PROPOSALS).nullable(),
  why: z.string(),
  rules: z.array(z.string()),
  draft: ChaseDraft.nullable(),
});
export type NextStep = z.infer<typeof NextStep>;

export const InvoiceDetail = InvoiceSummary.extend({
  issues: z.array(Issue),
  /** Open findings of the checks across documents; a blocking one makes « Envoyer quand même ». */
  findings: z.array(Finding).default([]),
  events: z.array(InvoiceEvent),
  chase: ChasePlan.nullable(),
  nextStep: NextStep.nullable(),
});
export type InvoiceDetail = z.infer<typeof InvoiceDetail>;

export const Explanation = z.object({
  ruleId: z.string(),
  path: z.string(),
  severity: z.enum(['error', 'warning']),
  message_fr: z.string(),
  why_it_matters: z.string(),
  fix_steps: z.array(z.string()),
  cell: z.string().nullable(),
});
export type Explanation = z.infer<typeof Explanation>;

export const Explained = z.object({
  explanations: z.array(Explanation),
  note: z.string().nullable(),
});
export type Explained = z.infer<typeof Explained>;

export const Rehearsal = z.object({
  ready: z.boolean(),
  summary: z.string(),
  checklist: z.array(
    z.object({
      item: z.string(),
      label: z.string(),
      ok: z.boolean(),
      detail: z.string().nullable(),
    }),
  ),
});
export type Rehearsal = z.infer<typeof Rehearsal>;

const Sent = InvoiceSummary.extend({ alreadySent: z.boolean() });

export const AI_PROVIDERS = [
  'mistral',
  'anthropic',
  'openai',
  'google',
  'azure',
  'openai-compatible',
] as const;

export const Settings = z.object({
  mode: z.enum(['review', 'autopilot']),
  autopilotAvailable: z.boolean(),
  /** Cents: the highest invoice amount the autopilot chases by itself. */
  autopilotMaxAmount: z.number().nullable(),
  sandboxEnabled: z.boolean(),
  testPlatform: z.boolean(),
  pseudonymizeLlm: z.boolean(),
  chaseCadence: z.array(z.number()),
  /** Under this margin over the purchase price, a sold line is « À vérifier » (R3); null: none. */
  minMarginPercent: z.number().nullable().default(null),
  // Loose: the fields this pane does not edit (payment means, legal notes) go back unchanged, since
  // PATCH /settings replaces the whole object.
  invoiceDefaults: z.looseObject({
    siret: z.string().optional(),
    iban: z.string().optional(),
    bic: z.string().optional(),
    paymentDays: z.number().optional(),
    operationCategory: z.enum(['goods', 'services', 'mixed']).optional(),
  }),
  pdp: z.object({
    provider: z.string(),
    account: z.string(),
    connected: z.boolean(),
    /** The company's own platform key: where the server offers it, and the end of the one saved. */
    ownKey: z
      .object({ available: z.boolean(), hint: z.string().nullable() })
      .default({ available: false, hint: null }),
  }),
  ai: z.object({
    mode: z.enum(['included', 'off', 'byok']),
    includedProvider: z.string().nullable(),
    byokAvailable: z.boolean(),
    provider: z.string().optional(),
    models: z.object({ agent: z.string(), classify: z.string() }).optional(),
    baseUrl: z.string().nullish(),
    keyHint: z.string().nullish(),
  }),
});
export type Settings = z.infer<typeof Settings>;

export type SettingsPatch = Partial<{
  sandboxEnabled: boolean;
  chaseCadence: number[];
  invoiceDefaults: Settings['invoiceDefaults'];
  mode: Settings['mode'];
  autopilotMaxAmount: number | null;
  minMarginPercent: number | null;
}>;

/** A customer of the fiche clients, confirmed against the company directory (plan §4 parties). */
export const Party = z.object({
  id: z.string(),
  legalName: z.string(),
  siren: z.string(),
  vatId: z.string().nullable(),
  address: PostalAddress.nullable(),
  email: z.string().nullable(),
  names: z.array(z.string()),
  /** What the platform's directory said when the customer was confirmed. */
  routing: z.object({ found: z.boolean(), checkedAt: z.string() }).nullable(),
  autopilot: z.boolean(),
  /** What the checks know about the customer (rules FF-PO-01, DGFIP-G2.32). */
  requiresPurchaseOrder: z.boolean(),
  publicEntity: z.boolean(),
  verifiedAt: z.string(),
});
export type Party = z.infer<typeof Party>;

/** One company « Chercher dans l'annuaire » found (PartyAgent). */
export const PartyCandidate = z.object({
  siren: z.string(),
  name: z.string().nullable(),
  address: PostalAddress.nullable(),
  vatId: z.string().nullable(),
  /** Null: the platform could not be asked. */
  routing: z.boolean().nullable(),
  refusal: z.enum(['closed', 'duplicate']).nullable(),
  keptSiren: z.string().nullable(),
  /** Already in the fiche clients. */
  partyId: z.string().nullable(),
});
export type PartyCandidate = z.infer<typeof PartyCandidate>;

export const PartyFinding = z.object({ question: z.string(), candidates: z.array(PartyCandidate) });
export type PartyFinding = z.infer<typeof PartyFinding>;

export interface PartyQuery {
  name?: string;
  siren?: string;
  postCode?: string;
}

export type PartyPatch = Partial<{
  email: string | null;
  autopilot: boolean;
  requiresPurchaseOrder: boolean;
  publicEntity: boolean;
}>;

/** The weekly report (Tableau de bord card): numbers first, then what to do. */
export const WeeklyReport = z.object({
  subject: z.string(),
  title: z.string(),
  numbers: z.array(z.string()),
  actions: z.array(z.string()),
  text: z.string(),
});
export type WeeklyReport = z.infer<typeof WeeklyReport>;

/** A supplier invoice received (Réception, plan §3 screen 5), as the InboundAgent sorted it. */
export const InboundFlag = z.object({
  code: z.string(),
  level: z.enum(['block', 'alert', 'warn', 'info']),
  message: z.string(),
  details: z.array(z.string()),
  relatedId: z.string().nullable(),
});
export type InboundFlag = z.infer<typeof InboundFlag>;

export const Inbound = z.object({
  id: z.string(),
  status: z.enum(['new', 'approved', 'disputed', 'exported']),
  statusLabel: z.string(),
  isTest: z.boolean(),
  triaged: z.boolean(),
  supplierName: z.string(),
  number: z.string().nullable(),
  creditNote: z.boolean(),
  issueDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  amount: z.number().int().nullable(),
  currency: z.string().nullable(),
  iban: z.string().nullable(),
  receivedAt: z.string(),
  flags: z.array(InboundFlag),
  canApprove: z.boolean(),
  needsIbanCheck: z.boolean(),
  canDispute: z.boolean(),
  decidedAt: z.string().nullable(),
  disputeReason: z.string().nullable(),
  exportId: z.string().nullable(),
});
export type Inbound = z.infer<typeof Inbound>;

export const InboundExport = z.object({
  id: z.string(),
  isTest: z.boolean(),
  count: z.number().int(),
  skipped: z.number().int(),
  fecName: z.string(),
  csvName: z.string(),
  createdAt: z.string(),
});
export type InboundExport = z.infer<typeof InboundExport>;

export const TEST_INBOUND_KINDS = ['normal', 'duplicate', 'iban_change'] as const;
export type TestInboundKind = (typeof TEST_INBOUND_KINDS)[number];
export type ExportFile = 'fec' | 'csv';

export type AiChoice =
  | { mode: 'included' }
  | { mode: 'off' }
  | {
      mode: 'byok';
      provider: (typeof AI_PROVIDERS)[number];
      models: { agent: string; classify: string };
      baseUrl?: string;
      apiKey?: string;
    };

const LinkStarted = z.object({ requestId: z.string() });
const LinkPoll = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('ok'), token: z.string() }),
]);
export type LinkPoll = z.infer<typeof LinkPoll>;

export const SCENARIOS = ['pdp_reject', 'customer_refuse', 'pay_late', 'siren_unknown'] as const;
export type Scenario = (typeof SCENARIOS)[number];

const filePath = (provider: DriveProvider, fileId: string, sheet?: string) =>
  `/connectors/${provider}/files/${encodeURIComponent(fileId)}${sheet === undefined ? '' : `/sheets/${encodeURIComponent(sheet)}`}`;

const sourcesPath = (workbookId: string, sheet?: string) =>
  `/workbooks/${encodeURIComponent(workbookId)}/sources${sheet === undefined ? '' : `/${encodeURIComponent(sheet)}`}`;

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** A body already in JSON (the chat's, from `ai`), sent as it is. */
  json?: string;
  signal?: AbortSignal;
}

export class ApiClient {
  readonly #base: string;
  readonly #token: () => string | null;
  readonly #fetch: typeof fetch;

  constructor(
    base: string,
    token: () => string | null,
    // Wrapped: a browser's fetch called as a method of this class throws "Illegal invocation".
    fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.#base = base.replace(/\/$/, '');
    this.#token = token;
    this.#fetch = fetchFn;
  }

  async #send(
    path: string,
    { method = 'GET', body, json, signal }: RequestOptions = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    const token = this.#token();
    if (token) headers.authorization = `Bearer ${token}`;
    const payload = json ?? (body === undefined ? undefined : JSON.stringify(body));
    if (payload !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await this.#fetch(`${this.#base}${path}`, {
        method,
        headers,
        ...(payload !== undefined && { body: payload }),
        ...(signal && { signal }),
      });
    } catch (e) {
      // Stopped on purpose (« Arrêter », the pane closed): not a lost connection.
      if (signal?.aborted) throw e;
      throw new Offline(e instanceof Error ? e.message : String(e));
    }
    // A proxy or gateway answering for an API that is down is the same as no connection.
    if (res.status === 502 || res.status === 504) throw new Offline(`HTTP ${res.status}`);
    if (!res.ok) {
      const parsed = ErrorBody.safeParse(await res.json().catch(() => null));
      if (parsed.success) {
        throw new ApiFailure(res.status, parsed.data.error.code, parsed.data.error.message);
      }
      throw new ApiFailure(res.status, 'internal', `HTTP ${res.status}`);
    }
    return res;
  }

  async #json<T>(schema: z.ZodType<T>, path: string, options?: RequestOptions): Promise<T> {
    const res = await this.#send(path, options);
    return schema.parse(await res.json());
  }

  options = () => this.#json(Options, '/auth/options');
  requestLink = (email: string) =>
    this.#json(LinkStarted, '/auth/magic-link', { method: 'POST', body: { email } });
  pollLink = (requestId: string) =>
    this.#json(LinkPoll, '/auth/magic-link/poll', { method: 'POST', body: { requestId } });
  logout = async () => {
    await this.#send('/auth/logout', { method: 'POST' });
  };
  me = () => this.#json(Me, '/me');

  lookupCompany = (siren: string) =>
    this.#json(
      DirectoryCompany,
      `/onboarding/company/${encodeURIComponent(siren.replace(/\s/g, ''))}`,
    );
  signup = (request: SignupRequest) =>
    this.#json(LinkStarted, '/onboarding/signup', {
      method: 'POST',
      body: { ...request, acceptTerms: true },
    });
  pollSignup = (requestId: string) =>
    this.#json(LinkPoll, '/onboarding/poll', { method: 'POST', body: { requestId } });

  billing = () => this.#json(BillingView, '/billing');
  checkout = (offer: Pick<Offer, 'plan' | 'interval'>) =>
    this.#json(PageUrl, '/billing/checkout', {
      method: 'POST',
      body: { plan: offer.plan, interval: offer.interval },
    });
  portal = () => this.#json(PageUrl, '/billing/portal', { method: 'POST' });
  /** RGPD erasure: the owner types the SIREN again. */
  deleteAccount = async (confirmSiren: string) => {
    await this.#send('/tenant', { method: 'DELETE', body: { confirmSiren } });
  };

  detect = (snapshot: SheetSnapshot) =>
    this.#json(Detection, '/detect', { method: 'POST', body: { snapshot } });
  getMapping = (workbookId: string, sheet: string) =>
    this.#json(
      SavedMapping,
      `/workbooks/${encodeURIComponent(workbookId)}/mappings/${encodeURIComponent(sheet)}`,
    );
  saveMapping = (workbookId: string, mapping: SheetMapping) =>
    this.#json(
      SavedMapping,
      `/workbooks/${encodeURIComponent(workbookId)}/mappings/${encodeURIComponent(mapping.sheet)}`,
      { method: 'PUT', body: { mapping } },
    );
  sync = (
    workbookId: string,
    body: { snapshot: SheetSnapshot; mapping: SheetMapping; test: boolean },
  ) =>
    this.#json(SyncResult, `/workbooks/${encodeURIComponent(workbookId)}/sync`, {
      method: 'POST',
      body,
    });

  /** The workbook's other sheets (R1): orders, delivery notes, purchases, price lists. */
  detectSource = (workbookId: string, snapshot: SheetSnapshot) =>
    this.#json(LayoutDetection, `${sourcesPath(workbookId)}/detect`, {
      method: 'POST',
      body: { snapshot },
    });
  sources = (workbookId: string) =>
    this.#json(z.object({ sources: z.array(Source) }), sourcesPath(workbookId));
  /** « Inclure cette feuille »: the confirmed layout, and the whole sheet for its first read. */
  includeSource = (workbookId: string, layout: LayoutMapping, snapshot: SheetSnapshot) =>
    this.#json(SourceRead, sourcesPath(workbookId, layout.sheet), {
      method: 'PUT',
      body: { layout, snapshot },
    });
  removeSource = (workbookId: string, sheet: string) =>
    this.#json(
      z.object({ removed: z.boolean(), sheet: z.string() }),
      sourcesPath(workbookId, sheet),
      {
        method: 'DELETE',
      },
    );
  syncSource = (workbookId: string, snapshot: SheetSnapshot) =>
    this.#json(SourceRead, `${sourcesPath(workbookId, snapshot.sheet)}/sync`, {
      method: 'POST',
      body: { snapshot },
    });
  registry = () => this.#json(Registry, '/registry');

  /** « Fichiers OneDrive » (R4): the connected account and the files the API reads itself. */
  connector = () => this.#json(ConnectorView, '/connectors/microsoft');
  /** The pane's token for our API, which the API exchanges on the person's behalf. */
  connect = (token: string) =>
    this.#json(ConnectorView, '/connectors/microsoft', { method: 'POST', body: { token } });
  disconnect = () => this.#json(ConnectorView, '/connectors/microsoft', { method: 'DELETE' });
  pickFiles = (files: PickedFile[]) =>
    this.#json(ConnectorView, '/connectors/microsoft/files', { method: 'POST', body: { files } });
  removeFile = (fileId: string) =>
    this.#json(ConnectorView, filePath('microsoft', fileId), { method: 'DELETE' });
  detectFileSheet = (fileId: string, sheet: string, provider: DriveProvider = 'microsoft') =>
    this.#json(FileDetection, `${filePath(provider, fileId, sheet)}/detect`, { method: 'POST' });
  includeFileSheet = (
    fileId: string,
    layout: LayoutMapping,
    provider: DriveProvider = 'microsoft',
  ) =>
    this.#json(SourceRead, filePath(provider, fileId, layout.sheet), {
      method: 'PUT',
      body: { layout },
    });
  removeFileSheet = (fileId: string, sheet: string, provider: DriveProvider = 'microsoft') =>
    this.#json(
      z.object({ removed: z.boolean(), sheet: z.string() }),
      filePath(provider, fileId, sheet),
      { method: 'DELETE' },
    );

  /** « Fichiers Google Drive » (R5): the account and the files picked in Google's window. */
  google = () => this.#json(GoogleView, '/connectors/google');
  /** The address of Google's window, for one person and 15 minutes. */
  googleStart = () =>
    this.#json(z.object({ url: z.string() }), '/connectors/google/start', { method: 'POST' });
  disconnectGoogle = () => this.#json(GoogleView, '/connectors/google', { method: 'DELETE' });
  removeGoogleFile = (fileId: string) =>
    this.#json(GoogleView, filePath('google', fileId), { method: 'DELETE' });
  /** « Contrôles » (R2): the open findings, the money at stake, the links to confirm. */
  checks = () => this.#json(Checks, '/checks');
  decideLink = (id: string, status: 'confirmed' | 'rejected') =>
    this.#json(Checks, `/links/${id}`, { method: 'POST', body: { status } });
  /** R7: « C'est normal », « Retirer », and « Oui » / « Non » on two articles. */
  acceptFinding = (id: string, choice: NormalChoice) =>
    this.#json(Checks, `/findings/${id}/normal`, { method: 'POST', body: choice });
  removeException = (id: string) => this.#json(Checks, `/exceptions/${id}`, { method: 'DELETE' });
  decideSynonym = (id: string, status: 'confirmed' | 'rejected') =>
    this.#json(Checks, `/synonyms/${id}`, { method: 'POST', body: { status } });

  /** « Corriger pour moi » (R8): the card; asked again right before writing, the same card. */
  fix = (findingId: string, body: { by: 'agent' | 'person'; toolCallId?: string }) =>
    this.#json(Edit, `/findings/${findingId}/fix`, { method: 'POST', body });
  /** The latest correction of the finding that can be taken back. */
  lastEdit = (findingId: string) => this.#json(Edit, `/findings/${findingId}/edits/last`);
  undoEdit = (id: string) => this.#json(Edit, `/edits/${id}/undo`, { method: 'POST' });
  decideEdit = (id: string, decision: EditDecision) =>
    this.#json(EditDecided, `/edits/${id}`, { method: 'POST', body: decision });
  /** The conversation kept for the finding, or its opening. */
  chat = async (findingId: string): Promise<ChatOpened> => {
    const opened = await this.#json(ChatOpened, `/findings/${findingId}/chat`);
    return { available: opened.available, messages: opened.messages as ChatMessage[] };
  };
  /** The chat's answers as a stream, for `ai`'s Chat: its fetch, with this client's errors. */
  chatFetch = (init: RequestInit | undefined): Promise<Response> =>
    this.#send('/chat', {
      method: 'POST',
      ...(typeof init?.body === 'string' && { json: init.body }),
      ...(init?.signal && { signal: init.signal }),
    });

  invoice = (id: string) => this.#json(InvoiceDetail, `/invoices/${id}`);
  /** Where these invoices are now: cheaper than a sync, which reads and validates the whole sheet. */
  statuses = (ids: string[]) =>
    this.#json(
      InvoiceStatuses,
      `/invoices?limit=${MAX_IDS}&ids=${ids.slice(0, MAX_IDS).join(',')}`,
    );
  explain = (id: string) => this.#json(Explained, `/invoices/${id}/explain`, { method: 'POST' });
  rehearse = (id: string) => this.#json(Rehearsal, `/invoices/${id}/rehearse`, { method: 'POST' });
  /** `acknowledge`: the blocking findings the user saw and sends past (« Envoyer quand même »). */
  send = (id: string, acknowledge: string[] = []) =>
    this.#json(Sent, `/invoices/${id}/send`, {
      method: 'POST',
      ...(acknowledge.length > 0 && { body: { acknowledge } }),
    });
  scenario = (id: string, scenario: Scenario) =>
    this.#json(InvoiceDetail, `/invoices/${id}/scenario`, { method: 'POST', body: { scenario } });
  /** « Encaissée »: the customer paid; chasing stops and the platform is told. */
  recordPayment = (id: string, paidOn?: string) =>
    this.#json(InvoiceDetail, `/invoices/${id}/payment`, {
      method: 'POST',
      body: paidOn ? { paidOn } : {},
    });
  /** « Promesse de paiement » until that day; null withdraws it. */
  promise = (id: string, until: string | null) =>
    this.#json(InvoiceDetail, `/invoices/${id}/promise`, { method: 'POST', body: { until } });
  prepareChase = (id: string) =>
    this.#json(InvoiceDetail, `/invoices/${id}/chase`, { method: 'POST' });
  markChaseSent = (id: string, offset: number) =>
    this.#json(InvoiceDetail, `/invoices/${id}/chase/steps/${offset}/sent`, { method: 'POST' });
  report = () => this.#json(WeeklyReport, '/report');
  /** The XML as text, the PDF as bytes: the fiche shows them inline. */
  xml = async (id: string) => (await this.#send(`/invoices/${id}/xml`)).text();
  pdf = async (id: string) => (await this.#send(`/invoices/${id}/pdf`)).blob();

  settings = () => this.#json(Settings, '/settings');
  patchSettings = (patch: SettingsPatch) =>
    this.#json(Settings, '/settings', { method: 'PATCH', body: patch });
  saveAi = (choice: AiChoice) =>
    this.#json(Settings, '/settings/ai', { method: 'PUT', body: choice });
  savePdpKey = (body: { apiKey: string; account?: string }) =>
    this.#json(Settings, '/settings/pdp', { method: 'PUT', body });
  removePdpKey = () => this.#json(Settings, '/settings/pdp', { method: 'DELETE' });

  parties = () => this.#json(z.object({ parties: z.array(Party) }), '/parties');
  searchParties = (query: PartyQuery) =>
    this.#json(PartyFinding, '/parties/search', { method: 'POST', body: query });
  confirmParty = (siren: string, name?: string) =>
    this.#json(Party, '/parties', { method: 'POST', body: { siren, ...(name && { name }) } });
  patchParty = (id: string, patch: PartyPatch) =>
    this.#json(Party, `/parties/${id}`, { method: 'PATCH', body: patch });
  deleteParty = async (id: string) => {
    await this.#send(`/parties/${id}`, { method: 'DELETE' });
  };
  /** « Annuler l'envoi automatique »: the invoice waits for « Envoyer » for good. */
  cancelAutopilot = (id: string) =>
    this.#json(InvoiceDetail, `/invoices/${id}/autopilot/cancel`, { method: 'POST' });
  exportData = async () => (await this.#send('/tenant/export')).blob();

  inbound = (test: boolean) =>
    this.#json(z.object({ inbound: z.array(Inbound) }), `/inbound?test=${test}`);
  inboundExports = (test: boolean) =>
    this.#json(z.object({ exports: z.array(InboundExport) }), `/inbound/exports?test=${test}`);
  approveInbound = (id: string, ibanChecked: boolean) =>
    this.#json(Inbound, `/inbound/${id}/approve`, { method: 'POST', body: { ibanChecked } });
  disputeInbound = (id: string, reason: string) =>
    this.#json(Inbound, `/inbound/${id}/dispute`, { method: 'POST', body: { reason } });
  exportInbound = (test: boolean) =>
    this.#json(InboundExport, '/inbound/export', { method: 'POST', body: { test } });
  exportFile = async (id: string, file: ExportFile) =>
    (await this.#send(`/inbound/exports/${id}/${file}`)).blob();
  testInbound = (kind: TestInboundKind) =>
    this.#json(Inbound, '/inbound/test', { method: 'POST', body: { kind } });
}
