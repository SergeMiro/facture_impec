// Files a person uploads from the pane (R6): a workbook (.xlsx, .xlsm, .csv) whose sheets are included
// like a picked file's (R4, src/sources.ts), or a supplier invoice (Factur-X PDF, UBL or CII XML) read
// with the readers of M6 into the registry as bought, where B2 takes its prices as the cost
// (src/registry.ts). What a file is comes from its bytes, not its name. The same name again replaces
// the file: its included sheets are read again. Removing it deletes everything it gave.
import { createHash } from 'node:crypto';
import {
  FILE_LIMITS,
  type Invoice,
  InvoiceXmlError,
  parseInvoiceXml,
  partySiren,
  readSheetFile,
  SheetFileError,
  type SheetSnapshot,
  supplierKey,
} from '@fi/core';
import { FacturXPdfError, readFacturXPdf } from '@fi/core/pdf';
import {
  and,
  audit,
  eq,
  inboundQueue,
  isNotNull,
  ne,
  sources,
  type TenantRow,
  type UploadFormat,
  type UploadRow,
  uploads,
} from '@fi/db';
import { type Principal, who } from './auth';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { detectSource, includeSource, readSource, sourceView } from './sources';

type Read =
  | { kind: 'workbook'; format: 'xlsx' | 'xlsm' | 'csv'; sheets: SheetSnapshot[] }
  | { kind: 'invoice'; format: 'facturx' | 'ubl' | 'cii'; invoice: Invoice };

const WORKBOOK_FORMATS: readonly UploadFormat[] = ['xlsx', 'xlsm', 'csv'];
export const isWorkbook = (format: UploadFormat) => WORKBOOK_FORMATS.includes(format);

const startsWith = (bytes: Uint8Array, text: string) =>
  [...text].every((ch, i) => bytes[i] === ch.charCodeAt(0));

/** The name as shown: without a path a browser may add, trimmed, 200 characters at most. */
export function uploadName(value: string | undefined): string {
  const name = (value ?? '').split(/[\\/]/).at(-1)?.trim() ?? '';
  if (!name || name.length > 200) throw new ApiError(400, 'invalid_request', undefined, 'name');
  return name;
}

const extension = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();

function invoiceOf(xml: string): { format: 'ubl' | 'cii'; invoice: Invoice } {
  try {
    const parsed = parseInvoiceXml(xml);
    return { format: parsed.syntax, invoice: parsed.invoice };
  } catch (e) {
    if (e instanceof InvoiceXmlError)
      throw new ApiError(422, 'upload_unreadable', undefined, e.message);
    throw e;
  }
}

async function workbookOf(bytes: Uint8Array<ArrayBuffer>, readAs: string) {
  try {
    return (await readSheetFile(bytes, readAs)).sheets;
  } catch (e) {
    if (e instanceof SheetFileError) {
      throw new ApiError(
        e.reason === 'too_large' ? 413 : 422,
        e.reason === 'too_large' ? 'upload_too_large' : 'upload_unreadable',
        undefined,
        e.message,
      );
    }
    throw e;
  }
}

/** What the bytes are: a PDF must carry Factur-X data, an XML an invoice, a zip a workbook. */
async function readUpload(name: string, bytes: Uint8Array<ArrayBuffer>): Promise<Read> {
  if (bytes.byteLength === 0) throw new ApiError(422, 'upload_unreadable');
  if (bytes.byteLength > FILE_LIMITS.maxBytes) throw new ApiError(413, 'upload_too_large');
  if (startsWith(bytes, '%PDF')) {
    let xml: string;
    try {
      xml = (await readFacturXPdf(bytes)).xml;
    } catch (e) {
      if (e instanceof FacturXPdfError) {
        // A plain PDF waits for the owner's decision (docs/TODO.md).
        throw new ApiError(422, e.reason === 'no-xml' ? 'upload_plain_pdf' : 'upload_unreadable');
      }
      throw e;
    }
    return { kind: 'invoice', ...invoiceOf(xml), format: 'facturx' };
  }
  if (startsWith(bytes, 'PK')) {
    const format = extension(name) === 'xlsm' ? 'xlsm' : 'xlsx';
    return { kind: 'workbook', format, sheets: await workbookOf(bytes, `upload.${format}`) };
  }
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).replace(/^﻿/, '').trimStart();
  if (head.startsWith('<'))
    return { kind: 'invoice', ...invoiceOf(new TextDecoder().decode(bytes)) };
  if (extension(name) === 'csv') {
    return { kind: 'workbook', format: 'csv', sheets: await workbookOf(bytes, 'upload.csv') };
  }
  throw new ApiError(415, 'upload_unsupported');
}

/** A supplier invoice addressed to the company: not its own, not another buyer's, not one already in. */
async function checkInvoice(
  deps: Pick<ApiDeps, 'db'>,
  tenant: TenantRow,
  name: string,
  invoice: Invoice,
) {
  if (partySiren(invoice.seller) === tenant.siren) throw new ApiError(422, 'upload_own_invoice');
  const buyer = partySiren(invoice.buyer);
  if (buyer && buyer !== tenant.siren) throw new ApiError(422, 'upload_other_buyer');
  const key = supplierKey(invoice.seller) ?? null;
  const number = invoice.number?.trim() || null;
  if (!key || !number) return { key, number };
  const [received] = await deps.db
    .select({ id: inboundQueue.id })
    .from(inboundQueue)
    .where(
      and(
        eq(inboundQueue.tenantId, tenant.id),
        eq(inboundQueue.isTest, false),
        isNotNull(inboundQueue.triagedAt),
        eq(inboundQueue.supplierKey, key),
        eq(inboundQueue.number, number),
      ),
    );
  if (received) throw new ApiError(409, 'upload_already_received', { number });
  const [twin] = await deps.db
    .select({ name: uploads.name })
    .from(uploads)
    .where(
      and(
        eq(uploads.tenantId, tenant.id),
        eq(uploads.supplierKey, key),
        eq(uploads.number, number),
        ne(uploads.name, name),
      ),
    );
  if (twin) throw new ApiError(409, 'upload_duplicate', { number, file: twin.name });
  return { key, number };
}

/**
 * « Importer un fichier »: read first, kept only if it reads. The same bytes under the same name change
 * nothing; other bytes replace the file (a workbook keeps its included sheets and reads them again).
 */
export async function addUpload(
  deps: ApiDeps,
  tenant: TenantRow,
  principal: Principal,
  rawName: string | undefined,
  bytes: Uint8Array<ArrayBuffer>,
) {
  const name = uploadName(rawName);
  const read = await readUpload(name, bytes);
  const facts =
    read.kind === 'invoice' ? await checkInvoice(deps, tenant, name, read.invoice) : null;
  const hash = createHash('sha256').update(bytes).digest('hex');
  const [before] = await deps.db
    .select()
    .from(uploads)
    .where(and(eq(uploads.tenantId, tenant.id), eq(uploads.name, name)));
  if (before?.sha256 === hash) return { upload: await uploadView(deps, before), replaced: false };

  const now = deps.now();
  const values = {
    format: read.format,
    size: bytes.byteLength,
    sha256: hash,
    content: read.kind === 'workbook' ? Buffer.from(bytes).toString('base64') : null,
    sheets: read.kind === 'workbook' ? read.sheets.map((s) => s.sheet) : [],
    parsed: read.kind === 'invoice' ? read.invoice : null,
    supplierKey: facts?.key ?? null,
    number: facts?.number ?? null,
    uploadedBy: who(principal),
    uploadedAt: now,
    updatedAt: now,
  };
  // A workbook replaced by a workbook keeps its row, so its included sheets stay; anything else starts over.
  const keep = before && isWorkbook(before.format) && read.kind === 'workbook';
  const row = await deps.db.transaction(async (tx) => {
    if (before && !keep) await tx.delete(uploads).where(eq(uploads.id, before.id));
    const [written] = keep
      ? await tx.update(uploads).set(values).where(eq(uploads.id, before.id)).returning()
      : await tx
          .insert(uploads)
          .values({ tenantId: tenant.id, name, ...values })
          .returning();
    if (!written) throw new Error('upload not written');
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: before ? 'upload.replace' : 'upload.add',
      objectType: 'upload',
      objectId: written.id,
      after: { name, format: read.format, size: bytes.byteLength, sha256: hash },
    });
    return written;
  });

  if (read.kind === 'workbook' && keep) {
    const included = await deps.db.select().from(sources).where(eq(sources.uploadId, row.id));
    for (const source of included) {
      const snapshot = read.sheets.find((s) => s.sheet === source.sheet);
      if (snapshot) await readSource(deps, tenant.id, source, snapshot);
    }
  }
  // The registry job projects an invoice, and checks again after a sheet changed or a file left.
  await deps.jobs.enqueueRegistry(tenant.id);
  return { upload: await uploadView(deps, row), replaced: before !== undefined };
}

async function uploadOf(deps: Pick<ApiDeps, 'db'>, tenantId: string, id: string) {
  const [row] = await deps.db
    .select()
    .from(uploads)
    .where(and(eq(uploads.tenantId, tenantId), eq(uploads.id, id)));
  if (!row) throw new ApiError(404, 'upload_not_found');
  return row;
}

/** An uploaded workbook's sheet, read from the bytes kept. */
async function uploadSheet(deps: Pick<ApiDeps, 'db'>, tenantId: string, id: string, sheet: string) {
  const upload = await uploadOf(deps, tenantId, id);
  if (!upload.content || !isWorkbook(upload.format)) throw new ApiError(404, 'upload_not_found');
  const sheets = await workbookOf(
    new Uint8Array(Buffer.from(upload.content, 'base64')),
    `upload.${upload.format === 'csv' ? 'csv' : 'xlsx'}`,
  );
  const snapshot = sheets.find((s) => s.sheet === sheet);
  if (!snapshot) throw new ApiError(404, 'connector_sheet_missing', { sheet });
  return { upload, snapshot };
}

/** What a sheet of an uploaded workbook holds (src/sources.ts detectSource), before « Inclure ». */
export async function detectUploadSheet(
  deps: ApiDeps,
  tenant: TenantRow,
  id: string,
  sheet: string,
  signal?: AbortSignal,
) {
  const { upload, snapshot } = await uploadSheet(deps, tenant.id, id, sheet);
  const detection = await detectSource(deps, tenant, upload.id, snapshot, signal);
  return { ...detection, sample: { sheet: snapshot.sheet, rows: snapshot.rows.slice(0, 50) } };
}

/** « Inclure cette feuille » for an uploaded workbook. */
export async function includeUploadSheet(
  deps: ApiDeps,
  tenant: TenantRow,
  principal: Principal,
  id: string,
  layout: Parameters<typeof includeSource>[4]['layout'],
) {
  const { upload, snapshot } = await uploadSheet(deps, tenant.id, id, layout.sheet);
  return includeSource(
    deps,
    tenant,
    principal,
    upload.id,
    { layout, snapshot },
    {
      uploadId: upload.id,
    },
  );
}

/** The upload's id once it is the company's (« Retirer » on one of its sheets). */
export async function ownUpload(deps: Pick<ApiDeps, 'db'>, tenant: TenantRow, id: string) {
  return (await uploadOf(deps, tenant.id, id)).id;
}

/** « Retirer le fichier »: the file, its sheets and every document it gave are deleted. */
export async function removeUpload(deps: ApiDeps, tenant: TenantRow, id: string) {
  const upload = await uploadOf(deps, tenant.id, id);
  await deps.db.transaction(async (tx) => {
    await tx.delete(uploads).where(eq(uploads.id, upload.id));
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'upload.remove',
      objectType: 'upload',
      objectId: upload.id,
      before: { name: upload.name, format: upload.format },
    });
  });
  await deps.jobs.enqueueRegistry(tenant.id);
  return listUploads(deps, tenant);
}

async function uploadView(deps: Pick<ApiDeps, 'db'>, row: UploadRow) {
  const included = isWorkbook(row.format)
    ? await deps.db.select().from(sources).where(eq(sources.uploadId, row.id))
    : [];
  // Delivered by the platform after it was uploaded: the registry counts the received one only.
  const [received] =
    row.supplierKey && row.number
      ? await deps.db
          .select({ id: inboundQueue.id })
          .from(inboundQueue)
          .where(
            and(
              eq(inboundQueue.tenantId, row.tenantId),
              eq(inboundQueue.isTest, false),
              isNotNull(inboundQueue.triagedAt),
              eq(inboundQueue.supplierKey, row.supplierKey),
              eq(inboundQueue.number, row.number),
            ),
          )
          .limit(1)
      : [];
  const names = [...new Set([...row.sheets, ...included.map((s) => s.sheet)])];
  const inv = row.parsed;
  return {
    id: row.id,
    name: row.name,
    format: row.format,
    kind: isWorkbook(row.format) ? ('workbook' as const) : ('invoice' as const),
    size: row.size,
    // The shape of a picked file (src/connectors.ts), so the pane shows both the same way.
    problem: null,
    pickedAt: row.uploadedAt.toISOString(),
    checkedAt: null,
    changedAt: null,
    sheets: names.map((sheet) => {
      const source = included.find((s) => s.sheet === sheet);
      return {
        sheet,
        present: row.sheets.includes(sheet),
        source: source ? sourceView(source) : null,
      };
    }),
    invoice: inv
      ? {
          number: inv.number ?? null,
          supplier: inv.seller.name?.trim() || null,
          issueDate: inv.issueDate ?? null,
          lines: inv.lines.length,
          netTotal: inv.totals.taxExclusive ?? null,
          currency: inv.currency ?? null,
          received: received !== undefined,
        }
      : null,
  };
}

/** « Fichiers importés » in « Registre ». */
export async function listUploads(deps: Pick<ApiDeps, 'db'>, tenant: TenantRow) {
  const rows = await deps.db
    .select()
    .from(uploads)
    .where(eq(uploads.tenantId, tenant.id))
    .orderBy(uploads.name);
  return { uploads: await Promise.all(rows.map((r) => uploadView(deps, r))) };
}
