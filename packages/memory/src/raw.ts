// The originals (memory doc §3 `raw/`): each file a document came in, under the month it arrived,
// with the text read from it beside it (`<file>.txt`), so a search finds what no page says yet.
// Append only: a file is never replaced; another file of the same name gets `-2`, `-3`…
import { parisToday } from '@fi/core';
import { commitFiles, type FileContent } from './journal';
import { slugify } from './slug';
import { VaultFiles } from './vault';

export interface RawFile {
  /** The name it came with: « Facture 2026-114.pdf ». */
  name: string;
  bytes: Uint8Array;
  /** What was read from it (PDF text, OCR, a mail's body). */
  text?: string;
}

/** Keeps `file` in `raw/`; returns its source reference (`raw/2026/10/facture-2026-114.pdf`). */
export async function addRaw(root: string, file: RawFile, now: Date): Promise<string> {
  const vault = new VaultFiles(root, now);
  const dot = file.name.lastIndexOf('.');
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  const base = slugify(dot > 0 ? file.name.slice(0, dot) : file.name, 80);
  const suffix = /^[a-z0-9]{1,8}$/.test(ext) ? `.${ext}` : '';
  const dir = `raw/${parisToday(now).slice(0, 7).replace('-', '/')}`;
  for (let n = 1; ; n++) {
    const ref = `${dir}/${base}${n > 1 ? `-${n}` : ''}${suffix}`;
    const existing = await vault.bytes(ref);
    if (existing && Buffer.from(existing).equals(Buffer.from(file.bytes))) return ref;
    if (existing) continue;
    const out = new Map<string, FileContent>([[ref, file.bytes]]);
    if (file.text !== undefined) out.set(`${ref}.txt`, file.text);
    await commitFiles(root, out);
    return ref;
  }
}
