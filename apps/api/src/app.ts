// HTTP API (plan §1): tenants, invoices, validation, platform webhooks, and the add-in's routes
// (sign-in, sheet sync, settings, Mode test, supplier invoices, RGPD). Business rules live in the modules next to this
// file and in @fi/core; this file reads requests (Zod) and shapes answers.
import { Address, InvoiceDraft, isIsoDate, SheetMapping, STATES, toCii } from '@fi/core';
import {
  and,
  audit,
  desc,
  eq,
  inArray,
  invoices,
  PDP_PROVIDERS,
  type TenantRow,
  tenants,
} from '@fi/db';
import { PdpRequestError } from '@fi/pdp-adapter';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { adminRoutes } from './admin';
import { archivedPdf } from './archive';
import { explainInvoice, invoicePdf, rehearseInvoice } from './assist';
import { type TenantEnv, tenantAuth, who } from './auth';
import { holdAutopilot } from './autopilot';
import { billingPages, billingRoutes, handleStripeWebhook } from './billing';
import { checksView, decideLink } from './checks';
import { markStepSent, prepareChase, recordPromise } from './collect';
import type { ApiDeps } from './deps';
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
import { PaymentBody, recordPayment } from './payments';
import { awaitsGoLive } from './platform';
import { reportFor } from './report';
import { DeleteBody, deleteTenant, exportTenant } from './rgpd';
import { playScenario, SCENARIOS } from './sandbox';
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
const ListQuery = z.object({
  status: z.enum(STATES).optional(),
  /** Comma-separated: the task pane asks only for the invoices its sheet is waiting on. */
  ids: z
    .string()
    .transform((s) => s.split(','))
    .pipe(z.array(z.uuid()).min(1).max(200))
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

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

  // A sheet of 5 000 rows is a few MB; nothing else comes near 2 MB, and webhooks stay small.
  const bigBody = maxBody(16 * MB);
  const body2Mb = maxBody(2 * MB);
  const smallBody = maxBody(256 * KB);
  app.use('*', (c, next) => {
    const path = c.req.path;
    if (path.startsWith('/workbooks/') || path === '/detect') return bigBody(c, next);
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
    '/checks',
    '/links/*',
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

  // ── Checks across documents (R2) ──────────────────────────────────────────────────────────────
  api.get('/checks', async (c) => c.json(await checksView(deps, c.get('tenant'))));

  api.post('/links/:id', async (c) => {
    const { status } = await body(c, LinkDecisionBody);
    const by = who(c.get('principal'));
    return c.json(await decideLink(deps, c.get('tenant'), by, uuid(c.req.param('id')), status));
  });

  // ── Invoices ──────────────────────────────────────────────────────────────────────────────────
  api.post('/invoices', async (c) => {
    const tenant = c.get('tenant');
    const { test, ...input } = await body(c, NewInvoice);
    if (test) assertTestMode(deps, tenant);
    const { row, created } = await createInvoice(deps, tenant, { ...input, isTest: test });
    return c.json(invoiceDetail(row, await invoiceDetailData(deps, row)), created ? 201 : 200);
  });

  api.get('/invoices', async (c) => {
    const q = parse(ListQuery, c.req.query());
    const tenant = c.get('tenant');
    const rows = await deps.db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenant.id),
          q.status ? eq(invoices.status, q.status) : undefined,
          q.ids ? inArray(invoices.id, q.ids) : undefined,
        ),
      )
      .orderBy(desc(invoices.createdAt), desc(invoices.id))
      .limit(q.limit)
      .offset(q.offset);
    return c.json({ invoices: rows.map(invoiceSummary), limit: q.limit, offset: q.offset });
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
