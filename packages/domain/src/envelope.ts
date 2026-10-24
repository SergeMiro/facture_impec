// What every adapter hands to the ingest queue (BTP plan §5 `DocumentEnvelope`): the file is already
// stored, so the envelope carries its key and fingerprint, never its bytes. One envelope per file: an
// e-mail with three attachments is three envelopes with the same `sourceRef`.
import { z } from 'zod';
import { DocumentSource } from './kinds';

/** A file larger than this is refused at the door: no invoice or attestation is 20 MB. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** The file types the ingest worker can read: a PDF (text or scanned), an image, the XML of an invoice. */
export const DOCUMENT_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'application/xml',
  'text/xml',
] as const;
export const DocumentMime = z.enum(DOCUMENT_MIMES);
export type DocumentMime = z.infer<typeof DocumentMime>;

/** A SHA-256 written as 64 lowercase hex digits: the key of « the same file twice ». */
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'sha256');

/**
 * An invoice that arrived already structured: the XML of a Factur-X PDF or of a UBL/CII file (the
 * PDP), or a row an ERP returned. Structured data wins over reading the PDF (BTP plan §7).
 */
export const StructuredPayload = z.discriminatedUnion('format', [
  z.object({ format: z.enum(['factur-x', 'ubl', 'cii']), xml: z.string().min(1) }),
  z.object({ format: z.literal('erp-json'), record: z.record(z.string(), z.unknown()) }),
]);
export type StructuredPayload = z.infer<typeof StructuredPayload>;

/** What the source said about the file, used to classify it before any model is asked. */
export const EnvelopeHints = z
  .object({
    senderEmail: z.email().max(254),
    subject: z.string().max(500),
    folderPath: z.string().max(1000),
  })
  .partial();
export type EnvelopeHints = z.infer<typeof EnvelopeHints>;

export const DocumentEnvelope = z.object({
  /** The company (BTP plan `orgId`; docs/DECISIONS.md D2). */
  tenantId: z.uuid(),
  source: DocumentSource,
  /** The source's own id: a message id, a drive item id, a PDP document id, an upload id. */
  sourceRef: z.string().min(1).max(500),
  receivedAt: z.iso.datetime({ offset: true }),
  /** The file's name as the source gave it, shown to people. */
  name: z.string().min(1).max(255),
  mime: DocumentMime,
  size: z.int().min(1).max(MAX_DOCUMENT_BYTES),
  storageKey: z.string().min(1).max(500),
  sha256: Sha256,
  structured: StructuredPayload.optional(),
  hints: EnvelopeHints.default({}),
  /** Arrived in Mode test: it never creates a real obligation or action (CLAUDE.md « Mode test »). */
  isTest: z.boolean(),
});
export type DocumentEnvelope = z.infer<typeof DocumentEnvelope>;
