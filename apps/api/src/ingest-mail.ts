// The `mail` adapter, its half that needs no provider (BTP plan §5, docs/DECISIONS.md D3): a raw
// e-mail (RFC 5322, an `.eml` file) becomes one document per attachment, the sender and the subject
// as hints for stage 2's classifier. Which address receives the company's mail waits for the owner;
// whatever brings the raw message will call `ingestMail`. Nothing here sends anything.
import { createHash } from 'node:crypto';
import type { TenantRow } from '@fi/db';
import { EnvelopeHints, MAX_DOCUMENT_BYTES } from '@fi/domain';
import PostalMime, { type Attachment } from 'postal-mime';
import { ApiError } from './errors';
import { checkBacklog, type Ingested, ingestFile, sniffMime } from './ingest';

/** An e-mail as mail servers take it: 25 MB of attachments, a third more once in base64. */
export const MAX_MAIL_BYTES = 35 * 1024 * 1024;
/** A message forwarded inside a message inside a message: past this, nobody meant it. */
const NESTING = 3;
/** A forwarded message is opened here (the invoice is inside it); a crafted one stops early. */
const PARSE = { forceRfc822Attachments: true, maxNestingDepth: 50, maxPartCount: 500 } as const;

export type SkipReason = 'inline' | 'unsupported' | 'empty' | 'too_large';

export interface MailPart {
  name: string;
  bytes: Uint8Array;
}

export interface SplitMail {
  /** The Message-ID, or the e-mail's own SHA-256 when it has none: the documents' `sourceRef`. */
  messageRef: string;
  hints: EnvelopeHints;
  files: MailPart[];
  skipped: { name: string; reason: SkipReason }[];
}

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/tiff': 'tif',
  'application/xml': 'xml',
};

const bytesOf = (content: Attachment['content']) =>
  typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);

/** What the e-mail carries: the files the worker reads, and why each other part was left. */
export async function splitMail(raw: Uint8Array): Promise<SplitMail> {
  const email = await PostalMime.parse(raw, PARSE);
  const files: MailPart[] = [];
  const skipped: SplitMail['skipped'] = [];
  const visit = async (attachments: Attachment[], depth: number) => {
    for (const part of attachments) {
      const bytes = bytesOf(part.content);
      if (part.mimeType === 'message/rfc822' && depth < NESTING) {
        const inner = await PostalMime.parse(bytes, PARSE);
        await visit(inner.attachments, depth + 1);
        continue;
      }
      const mime = sniffMime(bytes);
      const name =
        part.filename?.trim() ||
        `piece-jointe-${files.length + skipped.length + 1}.${(mime && EXTENSIONS[mime]) ?? 'bin'}`;
      // An image the HTML shows by its Content-ID is a logo or a signature, not a document.
      if (part.related) skipped.push({ name, reason: 'inline' });
      else if (bytes.byteLength === 0) skipped.push({ name, reason: 'empty' });
      else if (bytes.byteLength > MAX_DOCUMENT_BYTES) skipped.push({ name, reason: 'too_large' });
      else if (!mime) skipped.push({ name, reason: 'unsupported' });
      else files.push({ name: name.split(/[\\/]/).at(-1)?.slice(0, 255) || name, bytes });
    }
  };
  await visit(email.attachments, 0);

  const from = email.from && 'address' in email.from ? email.from.address : undefined;
  const hints = EnvelopeHints.parse({
    ...(from && EnvelopeHints.shape.senderEmail.safeParse(from).success && { senderEmail: from }),
    ...(email.subject?.trim() && { subject: email.subject.trim().slice(0, 500) }),
  });
  return {
    messageRef:
      email.messageId?.trim() || `sha256:${createHash('sha256').update(raw).digest('hex')}`,
    hints,
    files,
    skipped,
  };
}

/**
 * Each attachment as a document (source `mail`), the company's backlog checked once for the whole
 * e-mail. The same e-mail twice gives the same documents back: a file is known by its bytes.
 */
export async function ingestMail(
  deps: Parameters<typeof ingestFile>[0] & { now: () => Date },
  tenant: Pick<TenantRow, 'id'>,
  raw: Uint8Array,
  options: { actor: 'user' | 'api'; isTest: boolean },
): Promise<{ documents: Ingested[]; skipped: SplitMail['skipped'] }> {
  if (raw.byteLength === 0) throw new ApiError(422, 'ingest_empty');
  let mail: SplitMail;
  try {
    mail = await splitMail(raw);
  } catch {
    throw new ApiError(422, 'mail_unreadable');
  }
  if (mail.files.length === 0) throw new ApiError(422, 'mail_no_attachment');
  await checkBacklog(deps.db, tenant.id);
  const documents: Ingested[] = [];
  for (const file of mail.files) {
    documents.push(
      await ingestFile(
        deps,
        tenant,
        {
          source: 'mail',
          sourceRef: mail.messageRef,
          name: file.name,
          bytes: file.bytes,
          isTest: options.isTest,
          receivedAt: deps.now(),
          hints: mail.hints,
        },
        { actor: options.actor },
      ),
    );
  }
  return { documents, skipped: mail.skipped };
}
