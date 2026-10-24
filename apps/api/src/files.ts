// The FileStore (BTP plan §5): where the bytes of every ingested document are kept, apart from what
// was read from them. Its first driver keeps them in Postgres (`blobs`), so a document and its bytes
// are written in one transaction; an object store (S3) waits for the hosting (docs/TODO.md). Keys are
// the company and the SHA-256: the same bytes are stored once, whatever names they arrive under.
import { createHash } from 'node:crypto';
import { and, blobs, type DbOrTx, eq } from '@fi/db';

export interface StoredFile {
  key: string;
  sha256: string;
  size: number;
}

export interface FileStore {
  /** Keeps the bytes; the same bytes again give the same key and write nothing. */
  put(db: DbOrTx, file: { tenantId: string; bytes: Uint8Array; mime: string }): Promise<StoredFile>;
  /** Null: no such file for this company. */
  get(db: DbOrTx, tenantId: string, key: string): Promise<Uint8Array | null>;
}

export const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export const postgresFiles: FileStore = {
  async put(db, { tenantId, bytes, mime }) {
    const sha256 = sha256Of(bytes);
    const key = `${tenantId}/${sha256}`;
    await db
      .insert(blobs)
      .values({ key, tenantId, sha256, size: bytes.byteLength, mime, bytes })
      .onConflictDoNothing();
    return { key, sha256, size: bytes.byteLength };
  },
  async get(db, tenantId, key) {
    const [row] = await db
      .select({ bytes: blobs.bytes })
      .from(blobs)
      .where(and(eq(blobs.key, key), eq(blobs.tenantId, tenantId)));
    return row ? new Uint8Array(row.bytes) : null;
  },
};
