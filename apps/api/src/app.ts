// HTTP API (plan §1): tenants, invoices, validation, platform webhooks, and the add-in's routes
// (sign-in, sheet sync, settings, Mode test, RGPD). Business rules live in the modules next to this
// file and in @fi/core; this file reads requests (Zod) and shapes answers.
import {
  Address,
  InvoiceDraft,
  isIsoDate,
  isValidSiren,
  SheetMapping,
  STATES,
  toCii,
} from '@fi/core';
import {
  and,
  apiKeys,
  audit,
  desc,
  eq,
  inArray,
  invoices,
  PDP_PROVIDERS,
  sha256,
  type TenantRow,
  tenants,
  users,
} from '@fi/db';
import { PdpRequestError } from '@fi/pdp-adapter';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { explainInvoice, invoicePdf, rehearseInvoice } from './assist';
import { adminAuth, newApiKey, type TenantEnv, tenantAuth } from './auth';
import { markStepSent, prepareChase, recordPromise } from './collect';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { body, Email, parse, uuid } from './http';
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
import { loginRoutes } from './login';
import { OutboxMailer } from './mail';
import { PaymentBody, recordPayment } from './payments';
import { reportFor } from './report';
import { DeleteBody, deleteTenant, exportTenant } from './rgpd';
import { playScenario, SCENARIOS } from './sandbox';
import { AiChoice, SettingsPatch, saveAi, settingsView, updateSettings } from './settings';
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
const NewTenant = z.object({
  name: z.string().min(1),
  siren: z.string().refine(isValidSiren, 'not a valid SIREN'),
  vatId: z.string().min(1).optional(),
  address: Address.optional(),
  pdpProvider: z.enum(PDP_PROVIDERS).default('mock'),
  /** Defaults to the SIREN: B2Brouter keeps one account per SIREN (docs/B2BROUTER.md §3.2). */
  pdpAccount: z.string().min(1).optional(),
  vatOnDebits: z.boolean().default(false),
  /** The person who signs in to the add-in with a link (role owner). */
  ownerEmail: Email.optional(),
});
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

  // ── Admin ─────────────────────────────────────────────────────────────────────────────────────
  const admin = new Hono();
  admin.use(adminAuth(deps));
  admin.post('/tenants', async (c) => {
    const input = await body(c, NewTenant);
    if (!deps.pdp[input.pdpProvider]) throw new ApiError(409, 'pdp_not_configured');
    const apiKey = newApiKey();
    const tenant = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(tenants)
        .values({
          name: input.name,
          siren: input.siren,
          vatId: input.vatId ?? null,
          address: input.address ?? null,
          pdpProvider: input.pdpProvider,
          pdpAccount: input.pdpAccount ?? input.siren,
          vatOnDebits: input.vatOnDebits,
        })
        .returning();
      if (!row) throw new Error('insert returned nothing');
      if (input.ownerEmail) {
        const [owner] = await tx
          .insert(users)
          .values({ tenantId: row.id, email: input.ownerEmail, role: 'owner' })
          .returning({ id: users.id });
        await audit(tx, {
          tenantId: row.id,
          actor: 'admin',
          action: 'user.create',
          objectType: 'user',
          objectId: owner?.id ?? '',
        });
      }
      const [key] = await tx
        .insert(apiKeys)
        .values({ tenantId: row.id, hash: sha256(apiKey), label: 'initial' })
        .returning({ id: apiKeys.id });
      await audit(tx, {
        tenantId: row.id,
        actor: 'admin',
        action: 'tenant.create',
        objectType: 'tenant',
        objectId: row.id,
        after: tenantView(row),
      });
      await audit(tx, {
        tenantId: row.id,
        actor: 'admin',
        action: 'api_key.create',
        objectType: 'api_key',
        objectId: key?.id ?? '',
      });
      return row;
    });
    // The key is shown here once and never again (only its hash is stored).
    return c.json({ tenant: tenantView(tenant), apiKey }, 201);
  });
  // Local only: the mails the outbox kept (src/mail.ts), for the E2E run, scenarios and the developer.
  admin.get('/outbox', (c) => {
    if (!(deps.mailer instanceof OutboxMailer)) throw new ApiError(404, 'route_not_found');
    return c.json({ mails: deps.mailer.sent });
  });
  app.route('/admin', admin);

  // ── Sign-in links (no tenant key yet) ─────────────────────────────────────────────────────────
  app.route('/auth', loginRoutes(deps));

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
    '/invoices',
    '/invoices/*',
    '/report',
  ]) {
    api.use(path, tenantAuth(deps));
  }

  api.get('/me', (c) => {
    const tenant = c.get('tenant');
    const principal = c.get('principal');
    return c.json({
      tenant: tenantView(tenant),
      user: principal.kind === 'session' ? { email: principal.email, role: principal.role } : null,
      testMode: { enabled: tenant.sandboxEnabled, available: deps.test !== null },
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
    const { row, alreadySent } = await requestSend(deps, c.get('tenant'), uuid(c.req.param('id')));
    return c.json({ ...invoiceSummary(row), alreadySent }, 202);
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
    const pdf = await invoicePdf(deps, row.document);
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

  app.route('/', api);
  return app;
}
