// HTTP API (plan §1): tenants, invoices, validation, platform webhooks, and the add-in's routes
// (sign-in, sheet sync, settings, Mode test, supplier invoices, RGPD). Business rules live in the modules next to this
// file and in @fi/core; this file reads requests (Zod) and shapes answers.
import { Address, InvoiceDraft, isIsoDate, LayoutMapping, SheetMapping, toCii } from '@fi/core';
import { audit, CONNECTION_PROVIDERS, eq, PDP_PROVIDERS, type TenantRow, tenants } from '@fi/db';
import { PdpRequestError } from '@fi/pdp-adapter';
import { t } from '@fi/shared';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { adminRoutes } from './admin';
import { archivedPdf } from './archive';
import { explainInvoice, invoicePdf, rehearseInvoice } from './assist';
import { type TenantEnv, tenantAuth, who } from './auth';
import { holdAutopilot } from './autopilot';
import { billingPages, billingRoutes, handleStripeWebhook } from './billing';
import { answerFinding, ChatBody, chatView } from './chat';
import { checksView, decideLink } from './checks';
import { markStepSent, prepareChase, recordPromise } from './collect';
import {
  ConnectBody,
  connect,
  connectorView,
  detectFileSheet,
  disconnect,
  GOOGLE_COOKIE,
  type GoogleOutcome,
  googleBegin,
  googleCallback,
  googleNotified,
  googleStart,
  googleView,
  includeFileSheet,
  MicrosoftNotifications,
  notified,
  ownFile,
  PickBody,
  pickFiles,
  removeFile,
} from './connectors';
import { createCreditNote, writeOff } from './credits';
import type { ApiDeps } from './deps';
import {
  decideEdit,
  EditDecision,
  FixBody,
  getEdit,
  lastUndoable,
  proposeFix,
  proposeUndo,
} from './edits';
import { ApiError } from './errors';
import { body, optionalBody, parse, uuid } from './http';
import {
  ApproveBody,
  approveInbound,
  DisputeBody,
  disputeInbound,
  ExportBody,
  exportInbound,
  exportView,
  getExport,
  getInbound,
  InboundQuery,
  inboundId,
  inboundView,
  injectTestInbound,
  listExports,
  listInbound,
  TestInboundBody,
} from './inbound';
import {
  cancelInvoice,
  createInvoice,
  getInvoice,
  invoiceDetailData,
  requestSend,
  revalidateInvoice,
  updateInvoice,
  validateDraft,
} from './invoices';
import {
  KB,
  type LimitName,
  limitByAddress,
  limitByTenant,
  MB,
  maxBody,
  RequestWindows,
} from './limits';
import { loginRoutes } from './login';
import { onboardingRoutes } from './onboarding';
import { page } from './page';
import {
  confirmCustomer,
  deleteParty,
  listParties,
  PartyConfirm,
  PartyPatch,
  PartySearch,
  searchParties,
  updateParty,
} from './parties';
import { acceptFinding, decideSynonym, NormalBody, removeException, SynonymBody } from './patterns';
import { PaymentBody, recordPayment } from './payments';
import { awaitsGoLive } from './platform';
import { reportFor } from './report';
import { DeleteBody, deleteTenant, exportTenant } from './rgpd';
import { playScenario, SCENARIOS } from './sandbox';
import { ListQuery, listInvoices } from './search';
import {
  AiChoice,
  PdpKeyBody,
  removePdpKey,
  SettingsPatch,
  saveAi,
  savePdpKey,
  settingsView,
  updateSettings,
} from './settings';
import {
  ConfirmBody,
  detectSource,
  includeSource,
  listSources,
  registryView,
  removeSource,
  SourceSync,
  syncSource,
} from './sources';
import {
  addUpload,
  detectUploadSheet,
  includeUploadSheet,
  listUploads,
  ownUpload,
  removeUpload,
} from './uploads';
import { checkBuyerVat } from './vat-checks';
import { invoiceDetail, invoiceSummary, tenantView } from './views';
import {
  assertTestMode,
  detect,
  getMapping,
  Snapshot,
  SyncBody,
  saveMapping,
  syncSheet,
  WorkbookId,
} from './workbooks';

const ExcelBinding = z.object({
  workbookId: z.string().min(1),
  sheet: z.string().min(1),
  rowKey: z.string().min(1),
});
const InvoiceBody = z.object({ draft: InvoiceDraft, excelBinding: ExcelBinding.optional() });
const NewInvoice = InvoiceBody.extend({ test: z.boolean().default(false) });
const TenantPatch = z
  .object({
    name: z.string().min(1),
    vatId: z.string().min(1).nullable(),
    address: Address.nullable(),
    vatOnDebits: z.boolean(),
  })
  .partial();

/** « Envoyer quand même »: the fingerprints of the blocking findings the user saw (src/checks.ts). */
const SendBody = z.object({ acknowledge: z.array(z.string().max(128)).max(200).default([]) });
const LinkDecisionBody = z.object({ status: z.enum(['confirmed', 'rejected']) });
const PromiseBody = z.object({ until: z.string().refine(isIsoDate, 'YYYY-MM-DD').nullable() });

const fileName = (row: { number: string | null; id: string }, ext: string) =>
  `${(row.number ?? row.id).replace(/[^\w.-]/g, '_')}.${ext}`;

export function createApp(deps: ApiDeps) {
  const app = new Hono();

  // The task pane runs on its own origin (ADDIN_ORIGINS); in dev, Vite proxies /api instead.
  app.use(
    '*',
    cors({
      origin: deps.env.ADDIN_ORIGINS,
      allowHeaders: ['authorization', 'content-type'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      maxAge: 600,
    }),
  );

  // Headers for the HTML pages (sign-in confirmation…): no framing, no sniffing, no referrer. The
  // task pane reads the API with CORS, which the resource policy would not affect, so it stays off.
  app.use('*', secureHeaders({ crossOriginResourcePolicy: false }));

  // A sheet of 5 000 rows is a few MB, an uploaded file 10 MB at most (R6); nothing else comes near
  // 2 MB, and webhooks stay small.
  const bigBody = maxBody(16 * MB);
  const body2Mb = maxBody(2 * MB);
  const smallBody = maxBody(256 * KB);
  app.use('*', (c, next) => {
    const path = c.req.path;
    if (path.startsWith('/workbooks/') || path === '/detect' || path === '/uploads') {
      return bigBody(c, next);
    }
    if (/^\/(webhooks|auth|onboarding)\//.test(path)) return smallBody(c, next);
    return body2Mb(c, next);
  });

  const windows = deps.limits ?? new RequestWindows();
  const byAddress = Object.fromEntries(
    (['public', 'poll', 'admin'] as const).map((name) => [
      name,
      limitByAddress(windows, name, deps.env.TRUST_PROXY_HEADER),
    ]),
  ) as Record<Exclude<LimitName, 'tenant'>, ReturnType<typeof limitByAddress>>;
  app.use('*', (c, next) => {
    const path = c.req.path;
    if (path.startsWith('/admin/')) return byAddress.admin(c, next);
    if (path === '/connectors/google/begin' || path === '/connectors/google/callback') {
      return byAddress.public(c, next);
    }
    if (path.startsWith('/auth/') || path.startsWith('/onboarding/')) {
      return (path.endsWith('/poll') ? byAddress.poll : byAddress.public)(c, next);
    }
    return next();
  });

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(err.body, err.status);
    if (err instanceof z.ZodError) {
      const e = new ApiError(400, 'invalid_request', undefined, z.prettifyError(err));
      return c.json(e.body, e.status);
    }
    console.error(err);
    const e = new ApiError(500, 'internal');
    return c.json(e.body, e.status);
  });
  app.notFound((c) => {
    const e = new ApiError(404, 'route_not_found');
    return c.json(e.body, e.status);
  });

  app.get('/health', (c) => c.json({ ok: true, service: 'api', env: deps.env.FI_ENV }));

  // ── Operator ──────────────────────────────────────────────────────────────────────────────────
  app.route('/admin', adminRoutes(deps));

  // ── Sign-in links (no tenant key yet) ─────────────────────────────────────────────────────────
  app.route('/auth', loginRoutes(deps));
  // « Créer un compte »: the directory lookup, the request, its e-mailed confirmation, the poll.
  app.route('/onboarding', onboardingRoutes(deps));

  // ── Platform webhooks (signed; no tenant key) ─────────────────────────────────────────────────
  app.post('/webhooks/pdp/:provider', async (c) => {
    const provider = z.enum(PDP_PROVIDERS).safeParse(c.req.param('provider'));
    const adapter = provider.success ? deps.pdp[provider.data] : undefined;
    if (!provider.success || !adapter) throw new ApiError(404, 'route_not_found');
    const raw = await c.req.text();
    if (!adapter.verifyWebhook({ headers: c.req.raw.headers, body: raw })) {
      throw new ApiError(401, 'webhook_signature');
    }
    let notices: ReturnType<typeof adapter.parseWebhook>;
    try {
      notices = adapter.parseWebhook(raw);
    } catch (e) {
      if (e instanceof PdpRequestError)
        throw new ApiError(400, 'invalid_request', undefined, e.message);
      throw e;
    }
    // The webhook only says "something changed": the sync job asks the platform what.
    for (const n of notices) await deps.jobs.enqueueSync({ provider: provider.data, ...n });
    return c.json({ received: notices.length }, 202);
  });

  // Stripe: subscription changes (signed), and the pages it sends the browser back to.
  app.post('/webhooks/stripe', async (c) =>
    c.json(await handleStripeWebhook(deps, c.req.raw.headers, await c.req.text())),
  );
  app.route('/billing', billingPages());

  // Microsoft Graph change notifications (src/connectors.ts). Learn: the subscription is checked by a
  // POST with ?validationToken, echoed as text/plain within 10 s; a notification is answered within
  // 3 s, so it only queues the check. Its clientState proves it comes from our subscription.
  app.post('/webhooks/microsoft', async (c) => {
    if (!deps.microsoft) throw new ApiError(404, 'route_not_found');
    const validationToken = c.req.query('validationToken');
    if (validationToken !== undefined) return c.text(validationToken, 200);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new ApiError(400, 'invalid_request', undefined, 'body is not JSON');
    }
    const notifications = parse(MicrosoftNotifications, raw);
    return c.json({ received: await notified(deps, notifications) }, 202);
  });

  // Google Drive (R5, docs/GOOGLE.md): the browser window the pane opens, and the notifications of a
  // channel. Registered before the tenant API, whose authentication covers `/connectors/*`: the window
  // carries no token, the ticket in its cookie says which company it is for.
  const googlePage = (outcome: GoogleOutcome) => {
    const title = t('google.page.title');
    if (outcome.done) {
      return page(
        title,
        outcome.picked
          ? t('google.page.done', { account: outcome.account, count: outcome.picked })
          : t('google.page.connected', { account: outcome.account }),
      );
    }
    return page(
      title,
      outcome.message ?? t(`google.page.${outcome.reason}`, { account: outcome.account ?? '' }),
    );
  };
  const googleLog = (message: string) => console.warn(message);
  app.get('/connectors/google/begin', (c) => {
    if (!deps.google) throw new ApiError(404, 'route_not_found');
    const begun = googleBegin(deps, c.req.query('ticket'));
    if (!begun) return c.html(googlePage({ done: false, reason: 'expired' }), 400);
    setCookie(c, GOOGLE_COOKIE, begun.cookie, {
      httpOnly: true,
      secure: begun.secure,
      sameSite: 'Lax',
      path: '/connectors/google',
      maxAge: 15 * 60,
    });
    return c.redirect(begun.location, 302);
  });
  app.get('/connectors/google/callback', async (c) => {
    if (!deps.google) throw new ApiError(404, 'route_not_found');
    const outcome = await googleCallback(
      deps,
      getCookie(c, GOOGLE_COOKIE),
      c.req.query(),
      googleLog,
    );
    deleteCookie(c, GOOGLE_COOKIE, { path: '/connectors/google' });
    return c.html(googlePage(outcome));
  });
  // A notification carries headers only; answered at once, it only queues the check.
  app.post('/webhooks/google', async (c) => {
    if (!deps.google) throw new ApiError(404, 'route_not_found');
    const received = await googleNotified(deps, {
      channelId: c.req.header('x-goog-channel-id'),
      token: c.req.header('x-goog-channel-token'),
      state: c.req.header('x-goog-resource-state'),
    });
    return c.json({ received }, 200);
  });

  // ── Tenant API ────────────────────────────────────────────────────────────────────────────────
  const api = new Hono<TenantEnv>();
  for (const path of [
    '/me',
    '/tenant',
    '/tenant/*',
    '/settings',
    '/settings/*',
    '/validate',
    '/detect',
    '/workbooks/*',
    '/registry',
    '/connectors/*',
    '/uploads',
    '/uploads/*',
    '/checks',
    '/links/*',
    '/findings/*',
    '/exceptions/*',
    '/synonyms/*',
    '/edits/*',
    '/chat',
    '/invoices',
    '/invoices/*',
    '/inbound',
    '/inbound/*',
    '/parties',
    '/parties/*',
    '/report',
    '/billing',
    '/billing/checkout',
    '/billing/portal',
  ]) {
    api.use(path, tenantAuth(deps), limitByTenant(windows));
  }

  api.get('/me', (c) => {
    const tenant = c.get('tenant');
    const principal = c.get('principal');
    return c.json({
      tenant: tenantView(tenant),
      user: principal.kind === 'session' ? { email: principal.email, role: principal.role } : null,
      testMode: { enabled: tenant.sandboxEnabled, available: deps.test !== null },
      // Prod: real sends wait for the operator's go-live switch; the pane says so.
      awaitingGoLive: awaitsGoLive(deps, tenant),
    });
  });

  api.get('/tenant', (c) => c.json(tenantView(c.get('tenant'))));

  api.get('/tenant/export', async (c) => {
    const data = await exportTenant(deps, c.get('tenant'), c.get('principal'));
    return c.json(data, 200, {
      'content-disposition': `attachment; filename="facture-impec-${data.tenant.siren}.json"`,
    });
  });

  api.delete('/tenant', async (c) => {
    const { confirmSiren } = await body(c, DeleteBody);
    return c.json(await deleteTenant(deps, c.get('tenant'), c.get('principal'), confirmSiren));
  });

  api.get('/settings', (c) => c.json(settingsView(deps, c.get('tenant'))));

  api.patch('/settings', async (c) => {
    const row = await updateSettings(deps, c.get('tenant'), await body(c, SettingsPatch));
    return c.json(settingsView(deps, row));
  });

  api.put('/settings/ai', async (c) => {
    const row = await saveAi(deps, c.get('tenant'), await body(c, AiChoice));
    return c.json(settingsView(deps, row));
  });

  api.put('/settings/pdp', async (c) => {
    const input = await body(c, PdpKeyBody);
    const row = await savePdpKey(deps, c.get('tenant'), c.get('principal'), input);
    return c.json(settingsView(deps, row));
  });

  api.delete('/settings/pdp', async (c) => {
    const row = await removePdpKey(deps, c.get('tenant'), c.get('principal'));
    return c.json(settingsView(deps, row));
  });

  api.patch('/tenant', async (c) => {
    const patch = await body(c, TenantPatch);
    const before = c.get('tenant');
    if (Object.keys(patch).length === 0) return c.json(tenantView(before));
    const updated = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .update(tenants)
        .set(patch)
        .where(eq(tenants.id, before.id))
        .returning();
      if (!row) throw new ApiError(404, 'not_found');
      await audit(tx, {
        tenantId: row.id,
        actor: 'user',
        action: 'tenant.update',
        objectType: 'tenant',
        objectId: row.id,
        before: tenantView(before),
        after: tenantView(row),
      });
      return row;
    });
    return c.json(tenantView(updated));
  });

  api.post('/validate', async (c) => {
    const { draft } = await body(c, z.object({ draft: InvoiceDraft }));
    return c.json(validateDraft(deps, c.get('tenant'), draft));
  });

  // ── The add-in's sheet ────────────────────────────────────────────────────────────────────────
  api.post('/detect', async (c) => {
    const { snapshot } = await body(c, z.object({ snapshot: Snapshot }));
    return c.json(await detect(deps, c.get('tenant'), snapshot, c.req.raw.signal));
  });

  api.get('/workbooks/:id/mappings/:sheet', async (c) => {
    const workbookId = parse(WorkbookId, c.req.param('id'));
    return c.json(await getMapping(deps, c.get('tenant'), workbookId, c.req.param('sheet')));
  });

  api.put('/workbooks/:id/mappings/:sheet', async (c) => {
    const workbookId = parse(WorkbookId, c.req.param('id'));
    const { mapping } = await body(c, z.object({ mapping: SheetMapping }));
    if (mapping.sheet !== c.req.param('sheet')) {
      throw new ApiError(400, 'invalid_request', undefined, 'mapping.sheet differs from the path');
    }
    return c.json(await saveMapping(deps, c.get('tenant'), workbookId, mapping));
  });

  api.post('/workbooks/:id/sync', async (c) => {
    const workbookId = parse(WorkbookId, c.req.param('id'));
    return c.json(await syncSheet(deps, c.get('tenant'), workbookId, await body(c, SyncBody)));
  });

  // ── The workbook's other sheets (R1) ──────────────────────────────────────────────────────────
  api.post('/workbooks/:id/sources/detect', async (c) => {
    const workbookId = parse(WorkbookId, c.req.param('id'));
    const { snapshot } = await body(c, z.object({ snapshot: Snapshot }));
    return c.json(
      await detectSource(deps, c.get('tenant'), workbookId, snapshot, c.req.raw.signal),
    );
  });

  api.get('/workbooks/:id/sources', async (c) => {
    const workbookId = parse(WorkbookId, c.req.param('id'));
    return c.json(await listSources(deps, c.get('tenant'), workbookId));
  });

  api.put('/workbooks/:id/sources/:sheet', async (c) => {
    const workbookId = parse(WorkbookId, c.req.param('id'));
    const input = await body(c, ConfirmBody);
    if (input.layout.sheet !== c.req.param('sheet')) {
      throw new ApiError(400, 'invalid_request', undefined, 'layout.sheet differs from the path');
    }
    const tenant = c.get('tenant');
    return c.json(await includeSource(deps, tenant, c.get('principal'), workbookId, input));
  });

  api.delete('/workbooks/:id/sources/:sheet', async (c) => {
    const workbookId = parse(WorkbookId, c.req.param('id'));
    return c.json(await removeSource(deps, c.get('tenant'), workbookId, c.req.param('sheet')));
  });

  api.post('/workbooks/:id/sources/:sheet/sync', async (c) => {
    const workbookId = parse(WorkbookId, c.req.param('id'));
    const { snapshot } = await body(c, SourceSync);
    const tenant = c.get('tenant');
    return c.json(await syncSource(deps, tenant, workbookId, c.req.param('sheet'), snapshot));
  });

  api.get('/registry', async (c) => c.json(await registryView(deps, c.get('tenant'))));

  // ── Files read without Excel: OneDrive (R4) ───────────────────────────────────────────────────
  const log = (message: string) => console.warn(message);
  api.get('/connectors/microsoft', async (c) =>
    c.json(await connectorView(deps, c.get('tenant'), c.get('principal'))),
  );

  api.post('/connectors/microsoft', async (c) => {
    const { token } = await body(c, ConnectBody);
    return c.json(await connect(deps, c.get('tenant'), c.get('principal'), token, log));
  });

  api.delete('/connectors/microsoft', async (c) =>
    c.json(await disconnect(deps, c.get('tenant'), log)),
  );

  api.post('/connectors/microsoft/files', async (c) => {
    const { files } = await body(c, PickBody);
    return c.json(await pickFiles(deps, c.get('tenant'), c.get('principal'), files));
  });

  api.get('/connectors/google', async (c) => c.json(await googleView(deps, c.get('tenant'))));

  api.post('/connectors/google/start', (c) =>
    c.json(googleStart(deps, c.get('tenant'), c.get('principal'))),
  );

  api.delete('/connectors/google', async (c) =>
    c.json(await disconnect(deps, c.get('tenant'), log, 'google')),
  );

  // A picked file's routes, whichever provider it comes from.
  const providerOf = (value: string) => parse(z.enum(CONNECTION_PROVIDERS), value);

  api.delete('/connectors/:provider/files/:id', async (c) =>
    c.json(
      await removeFile(
        deps,
        c.get('tenant'),
        uuid(c.req.param('id')),
        providerOf(c.req.param('provider')),
      ),
    ),
  );

  api.post('/connectors/:provider/files/:id/sheets/:sheet/detect', async (c) =>
    c.json(
      await detectFileSheet(
        deps,
        c.get('tenant'),
        uuid(c.req.param('id')),
        c.req.param('sheet'),
        c.req.raw.signal,
        providerOf(c.req.param('provider')),
      ),
    ),
  );

  api.put('/connectors/:provider/files/:id/sheets/:sheet', async (c) => {
    const { layout } = await body(c, z.object({ layout: LayoutMapping }));
    if (layout.sheet !== c.req.param('sheet')) {
      throw new ApiError(400, 'invalid_request', undefined, 'layout.sheet differs from the path');
    }
    const tenant = c.get('tenant');
    const fileId = uuid(c.req.param('id'));
    const provider = providerOf(c.req.param('provider'));
    return c.json(
      await includeFileSheet(deps, tenant, c.get('principal'), fileId, layout, provider),
    );
  });

  api.delete('/connectors/:provider/files/:id/sheets/:sheet', async (c) => {
    const tenant = c.get('tenant');
    const fileId = await ownFile(
      deps,
      tenant,
      uuid(c.req.param('id')),
      providerOf(c.req.param('provider')),
    );
    return c.json(await removeSource(deps, tenant, fileId, c.req.param('sheet')));
  });

  // ── Files uploaded from the pane (R6) ─────────────────────────────────────────────────────────
  api.get('/uploads', async (c) => c.json(await listUploads(deps, c.get('tenant'))));

  // The file's bytes as the body, its name in `?name=`: no multipart to parse.
  api.post('/uploads', async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const tenant = c.get('tenant');
    return c.json(await addUpload(deps, tenant, c.get('principal'), c.req.query('name'), bytes));
  });

  api.delete('/uploads/:id', async (c) =>
    c.json(await removeUpload(deps, c.get('tenant'), uuid(c.req.param('id')))),
  );

  api.post('/uploads/:id/sheets/:sheet/detect', async (c) =>
    c.json(
      await detectUploadSheet(
        deps,
        c.get('tenant'),
        uuid(c.req.param('id')),
        c.req.param('sheet'),
        c.req.raw.signal,
      ),
    ),
  );

  api.put('/uploads/:id/sheets/:sheet', async (c) => {
    const { layout } = await body(c, z.object({ layout: LayoutMapping }));
    if (layout.sheet !== c.req.param('sheet')) {
      throw new ApiError(400, 'invalid_request', undefined, 'layout.sheet differs from the path');
    }
    const tenant = c.get('tenant');
    const id = uuid(c.req.param('id'));
    return c.json(await includeUploadSheet(deps, tenant, c.get('principal'), id, layout));
  });

  api.delete('/uploads/:id/sheets/:sheet', async (c) => {
    const tenant = c.get('tenant');
    const id = await ownUpload(deps, tenant, uuid(c.req.param('id')));
    return c.json(await removeSource(deps, tenant, id, c.req.param('sheet')));
  });

  // ── Checks across documents (R2) ──────────────────────────────────────────────────────────────
  api.get('/checks', async (c) => c.json(await checksView(deps, c.get('tenant'))));

  api.post('/links/:id', async (c) => {
    const { status } = await body(c, LinkDecisionBody);
    const by = who(c.get('principal'));
    return c.json(await decideLink(deps, c.get('tenant'), by, uuid(c.req.param('id')), status));
  });

  // ── Patterns and learning (R7) ────────────────────────────────────────────────────────────────
  api.post('/findings/:id/normal', async (c) => {
    const input = await body(c, NormalBody);
    const by = who(c.get('principal'));
    return c.json(await acceptFinding(deps, c.get('tenant'), by, uuid(c.req.param('id')), input));
  });

  api.delete('/exceptions/:id', async (c) => {
    const by = who(c.get('principal'));
    return c.json(await removeException(deps, c.get('tenant'), by, uuid(c.req.param('id'))));
  });

  api.post('/synonyms/:id', async (c) => {
    const { status } = await body(c, SynonymBody);
    const by = who(c.get('principal'));
    return c.json(await decideSynonym(deps, c.get('tenant'), by, uuid(c.req.param('id')), status));
  });

  // ── Chat and corrections (R8) ──────────────────────────────────────────────────────────────────
  api.post('/findings/:id/fix', async (c) => {
    const input = await optionalBody(c, FixBody);
    return c.json(await proposeFix(deps, c.get('tenant'), uuid(c.req.param('id')), input));
  });

  api.get('/findings/:id/edits/last', async (c) =>
    c.json(await lastUndoable(deps, c.get('tenant'), uuid(c.req.param('id')))),
  );

  api.get('/edits/:id', async (c) =>
    c.json(await getEdit(deps, c.get('tenant'), uuid(c.req.param('id')))),
  );

  api.post('/edits/:id', async (c) => {
    const decision = await body(c, EditDecision);
    return c.json(await decideEdit(deps, c.get('tenant'), uuid(c.req.param('id')), decision));
  });

  api.post('/edits/:id/undo', async (c) =>
    c.json(await proposeUndo(deps, c.get('tenant'), uuid(c.req.param('id')))),
  );

  api.get('/findings/:id/chat', async (c) =>
    c.json(await chatView(deps, c.get('tenant'), uuid(c.req.param('id')))),
  );

  api.post('/chat', async (c) =>
    answerFinding(deps, c.get('tenant'), await body(c, ChatBody), c.req.raw.signal),
  );

  // ── Invoices ──────────────────────────────────────────────────────────────────────────────────
  api.post('/invoices', async (c) => {
    const tenant = c.get('tenant');
    const { test, ...input } = await body(c, NewInvoice);
    if (test) assertTestMode(deps, tenant);
    const { row, created } = await createInvoice(deps, tenant, { ...input, isTest: test });
    return c.json(invoiceDetail(row, await invoiceDetailData(deps, row)), created ? 201 : 200);
  });

  // The pane's sheet rows (`ids`), and « Retrouver une facture » (src/search.ts).
  api.get('/invoices', async (c) => {
    const q = parse(ListQuery, c.req.query());
    const { rows, total } = await listInvoices(deps, c.get('tenant'), q);
    return c.json({ invoices: rows.map(invoiceSummary), total, limit: q.limit, offset: q.offset });
  });

  api.get('/invoices/:id', async (c) => {
    const row = await getInvoice(deps, c.get('tenant'), uuid(c.req.param('id')));
    return c.json(invoiceDetail(row, await invoiceDetailData(deps, row)));
  });

  api.put('/invoices/:id', async (c) => {
    const { row } = await updateInvoice(
      deps,
      c.get('tenant'),
      uuid(c.req.param('id')),
      await body(c, InvoiceBody),
    );
    return c.json(invoiceDetail(row, await invoiceDetailData(deps, row)));
  });

  api.post('/invoices/:id/validate', async (c) => {
    const { row } = await revalidateInvoice(deps, c.get('tenant'), uuid(c.req.param('id')));
    return c.json(invoiceDetail(row, await invoiceDetailData(deps, row)));
  });

  api.post('/invoices/:id/send', async (c) => {
    const { acknowledge } = await optionalBody(c, SendBody);
    const tenant = c.get('tenant');
    const id = uuid(c.req.param('id'));
    const { row, alreadySent } = await requestSend(deps, tenant, id, acknowledge);
    return c.json({ ...invoiceSummary(row), alreadySent }, 202);
  });

  api.post('/invoices/:id/autopilot/cancel', async (c) => {
    const tenant = c.get('tenant');
    const id = uuid(c.req.param('id'));
    await holdAutopilot(deps, tenant, id);
    const row = await getInvoice(deps, tenant, id);
    return c.json(invoiceDetail(row, await invoiceDetailData(deps, row)));
  });

  api.post('/invoices/:id/cancel', async (c) => {
    const row = await cancelInvoice(deps, c.get('tenant'), uuid(c.req.param('id')));
    return c.json(invoiceSummary(row));
  });

  api.get('/invoices/:id/xml', async (c) => {
    const row = await getInvoice(deps, c.get('tenant'), uuid(c.req.param('id')));
    return c.body(row.xmlCii ?? toCii(row.document), 200, {
      'content-type': 'application/xml; charset=utf-8',
      'content-disposition': `inline; filename="${fileName(row, 'xml')}"`,
    });
  });

  api.get('/invoices/:id/pdf', async (c) => {
    const row = await getInvoice(deps, c.get('tenant'), uuid(c.req.param('id')));
    // A sent invoice shows the PDF archived when it left; any other is drawn now.
    const pdf =
      (await archivedPdf(deps.db, row.tenantId, row.id)) ?? (await invoicePdf(deps, row.document));
    return c.body(new Uint8Array(pdf), 200, {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${fileName(row, 'pdf')}"`,
    });
  });

  api.post('/invoices/:id/explain', async (c) => {
    const tenant = c.get('tenant');
    const row = await getInvoice(deps, tenant, uuid(c.req.param('id')));
    return c.json(await explainInvoice(deps, tenant, row, c.req.raw.signal));
  });

  api.post('/invoices/:id/rehearse', async (c) => {
    const tenant = c.get('tenant');
    const row = await getInvoice(deps, tenant, uuid(c.req.param('id')));
    return c.json(await rehearseInvoice(deps, tenant, row));
  });

  api.post('/invoices/:id/scenario', async (c) => {
    const tenant = c.get('tenant');
    const { scenario } = await body(c, z.object({ scenario: z.enum(SCENARIOS) }));
    const row = await getInvoice(deps, tenant, uuid(c.req.param('id')));
    const after = await playScenario(deps, tenant, row, scenario);
    return c.json(invoiceDetail(after, await invoiceDetailData(deps, after)), 202);
  });

  // ── Getting paid (plan §6 CollectAgent): « Relancer », « Encaissée », the weekly report ────────────
  const detailOf = async (tenant: TenantRow, id: string) => {
    const row = await getInvoice(deps, tenant, id);
    return invoiceDetail(row, await invoiceDetailData(deps, row));
  };

  api.post('/invoices/:id/payment', async (c) => {
    const tenant = c.get('tenant');
    const id = uuid(c.req.param('id'));
    await recordPayment(deps, tenant, id, await body(c, PaymentBody));
    return c.json(await detailOf(tenant, id));
  });

  // « Établir un avoir » (plan §4, src/credits.ts): the credit note's fiche; asked again, the same one.
  api.post('/invoices/:id/credit-note', async (c) => {
    const tenant = c.get('tenant');
    const { row, created } = await createCreditNote(deps, tenant, uuid(c.req.param('id')));
    return c.json(invoiceDetail(row, await invoiceDetailData(deps, row)), created ? 201 : 200);
  });

  api.post('/invoices/:id/write-off', async (c) => {
    const tenant = c.get('tenant');
    const id = uuid(c.req.param('id'));
    await writeOff(deps, tenant, id);
    return c.json(await detailOf(tenant, id));
  });

  api.post('/invoices/:id/promise', async (c) => {
    const tenant = c.get('tenant');
    const id = uuid(c.req.param('id'));
    const { until } = await body(c, PromiseBody);
    await recordPromise(deps, tenant, id, until);
    return c.json(await detailOf(tenant, id));
  });

  api.post('/invoices/:id/chase', async (c) => {
    const tenant = c.get('tenant');
    const id = uuid(c.req.param('id'));
    await prepareChase(deps, tenant, id);
    return c.json(await detailOf(tenant, id));
  });

  api.post('/invoices/:id/chase/steps/:offset/sent', async (c) => {
    const tenant = c.get('tenant');
    const id = uuid(c.req.param('id'));
    const offset = parse(z.coerce.number().int().min(-60).max(365), c.req.param('offset'));
    await markStepSent(deps, tenant, id, offset);
    return c.json(await detailOf(tenant, id));
  });

  // « Vérifier dans VIES » (plan §6, src/vat-checks.ts): the customer's EU number, asked now.
  api.post('/invoices/:id/vies', async (c) => {
    const tenant = c.get('tenant');
    const id = uuid(c.req.param('id'));
    await checkBuyerVat(deps, tenant, await getInvoice(deps, tenant, id));
    return c.json(await detailOf(tenant, id));
  });

  api.get('/report', async (c) => c.json(await reportFor(deps, c.get('tenant'))));

  // ── Customers (plan §4 parties, §6 PartyAgent): « Trouver ce client », « Envoi automatique » ─────
  const partyId = (value: string) => {
    if (!z.uuid().safeParse(value).success) throw new ApiError(404, 'party_missing');
    return value;
  };

  api.get('/parties', async (c) => c.json({ parties: await listParties(deps, c.get('tenant')) }));

  api.post('/parties/search', async (c) =>
    c.json(await searchParties(deps, c.get('tenant'), await body(c, PartySearch))),
  );

  api.post('/parties', async (c) =>
    c.json(await confirmCustomer(deps, c.get('tenant'), await body(c, PartyConfirm)), 201),
  );

  api.patch('/parties/:id', async (c) => {
    const id = partyId(c.req.param('id'));
    return c.json(await updateParty(deps, c.get('tenant'), id, await body(c, PartyPatch)));
  });

  api.delete('/parties/:id', async (c) =>
    c.json(await deleteParty(deps, c.get('tenant'), partyId(c.req.param('id')))),
  );

  // ── Supplier invoices (plan §3 screen 5, §6 InboundAgent) ─────────────────────────────────────────
  // Paths with a fixed word come before /inbound/:id.
  api.get('/inbound', async (c) => {
    const { test } = parse(InboundQuery, c.req.query());
    return c.json({ inbound: await listInbound(deps, c.get('tenant'), test) });
  });

  api.post('/inbound/test', async (c) => {
    const row = await injectTestInbound(deps, c.get('tenant'), await body(c, TestInboundBody));
    return c.json(inboundView(row), 201);
  });

  api.post('/inbound/export', async (c) => {
    const tenant = c.get('tenant');
    const row = await exportInbound(deps, tenant, c.get('principal'), await body(c, ExportBody));
    return c.json(exportView(row), 201);
  });

  api.get('/inbound/exports', async (c) => {
    const { test } = parse(InboundQuery, c.req.query());
    return c.json({ exports: await listExports(deps, c.get('tenant'), test) });
  });

  api.get('/inbound/exports/:id/:file{fec|csv}', async (c) => {
    const row = await getExport(deps, c.get('tenant'), c.req.param('id'));
    const fec = c.req.param('file') === 'fec';
    return c.body(fec ? row.fec : row.csv, 200, {
      'content-type': fec ? 'text/plain; charset=utf-8' : 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fec ? row.fecName : row.csvName}"`,
    });
  });

  api.get('/inbound/:id', async (c) => {
    const row = await getInbound(deps, c.get('tenant'), inboundId(c.req.param('id')));
    return c.json(inboundView(row));
  });

  api.post('/inbound/:id/approve', async (c) => {
    const tenant = c.get('tenant');
    const id = inboundId(c.req.param('id'));
    const input = await body(c, ApproveBody);
    return c.json(inboundView(await approveInbound(deps, tenant, c.get('principal'), id, input)));
  });

  api.post('/inbound/:id/dispute', async (c) => {
    const tenant = c.get('tenant');
    const id = inboundId(c.req.param('id'));
    const input = await body(c, DisputeBody);
    return c.json(inboundView(await disputeInbound(deps, tenant, c.get('principal'), id, input)));
  });

  api.route('/billing', billingRoutes(deps));

  app.route('/', api);
  return app;
}
