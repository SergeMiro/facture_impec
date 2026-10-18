// HTTP API (plan §1): tenants, invoices, validation, platform webhooks. Business rules live in
// src/invoices.ts and @fi/core; this file reads requests (Zod) and shapes answers.
import { Address, InvoiceDraft, isValidSiren, STATES, toCii } from '@fi/core';
import { and, apiKeys, audit, desc, eq, invoices, PDP_PROVIDERS, sha256, tenants } from '@fi/db';
import { PdpRequestError } from '@fi/pdp-adapter';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { adminAuth, newApiKey, type TenantEnv, tenantAuth } from './auth';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
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
import { invoiceDetail, invoiceSummary, tenantView } from './views';

const ExcelBinding = z.object({
  workbookId: z.string().min(1),
  sheet: z.string().min(1),
  rowKey: z.string().min(1),
});
const InvoiceBody = z.object({ draft: InvoiceDraft, excelBinding: ExcelBinding.optional() });
const NewTenant = z.object({
  name: z.string().min(1),
  siren: z.string().refine(isValidSiren, 'not a valid SIREN'),
  vatId: z.string().min(1).optional(),
  address: Address.optional(),
  pdpProvider: z.enum(PDP_PROVIDERS).default('mock'),
  /** Defaults to the SIREN: B2Brouter keeps one account per SIREN (docs/B2BROUTER.md §3.2). */
  pdpAccount: z.string().min(1).optional(),
  vatOnDebits: z.boolean().default(false),
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
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, 'invalid_request', undefined, 'body is not JSON');
  }
  return parse(schema, raw);
}

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(400, 'invalid_request', undefined, z.prettifyError(result.error));
  }
  return result.data;
}

export function createApp(deps: ApiDeps) {
  const app = new Hono();

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
  app.route('/admin', admin);

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
  for (const path of ['/tenant', '/validate', '/invoices', '/invoices/*']) {
    api.use(path, tenantAuth(deps));
  }

  api.get('/tenant', (c) => c.json(tenantView(c.get('tenant'))));

  api.patch('/tenant', async (c) => {
    const patch = await body(c, TenantPatch);
    const before = c.get('tenant');
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

  api.post('/invoices', async (c) => {
    const tenant = c.get('tenant');
    const { row, created } = await createInvoice(deps, tenant, await body(c, InvoiceBody));
    const { issues, events } = await invoiceDetailData(deps, row);
    return c.json(invoiceDetail(row, issues, events), created ? 201 : 200);
  });

  api.get('/invoices', async (c) => {
    const q = parse(ListQuery, c.req.query());
    const tenant = c.get('tenant');
    const rows = await deps.db
      .select()
      .from(invoices)
      .where(
        and(eq(invoices.tenantId, tenant.id), q.status ? eq(invoices.status, q.status) : undefined),
      )
      .orderBy(desc(invoices.createdAt), desc(invoices.id))
      .limit(q.limit)
      .offset(q.offset);
    return c.json({ invoices: rows.map(invoiceSummary), limit: q.limit, offset: q.offset });
  });

  api.get('/invoices/:id', async (c) => {
    const row = await getInvoice(deps, c.get('tenant'), uuid(c.req.param('id')));
    const { issues, events } = await invoiceDetailData(deps, row);
    return c.json(invoiceDetail(row, issues, events));
  });

  api.put('/invoices/:id', async (c) => {
    const { row } = await updateInvoice(
      deps,
      c.get('tenant'),
      uuid(c.req.param('id')),
      await body(c, InvoiceBody),
    );
    const { issues, events } = await invoiceDetailData(deps, row);
    return c.json(invoiceDetail(row, issues, events));
  });

  api.post('/invoices/:id/validate', async (c) => {
    const { row } = await revalidateInvoice(deps, c.get('tenant'), uuid(c.req.param('id')));
    const { issues, events } = await invoiceDetailData(deps, row);
    return c.json(invoiceDetail(row, issues, events));
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
      'content-disposition': `inline; filename="${(row.number ?? row.id).replace(/[^\w.-]/g, '_')}.xml"`,
    });
  });

  app.route('/', api);
  return app;
}

/** A malformed id is an invoice we do not have. */
function uuid(value: string): string {
  if (!z.uuid().safeParse(value).success) throw new ApiError(404, 'not_found');
  return value;
}
