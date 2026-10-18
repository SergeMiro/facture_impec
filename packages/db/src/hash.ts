import { createHash } from 'node:crypto';

/** JSON with object keys sorted at every level, so equal values give equal text. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** SHA-256 of the stable JSON of a value: invoice fingerprints and audit hashes. */
export const hashOf = (value: unknown) => sha256(stableJson(value));
