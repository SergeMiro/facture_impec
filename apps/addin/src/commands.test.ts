// manifest.xml is hand-written XML that no build step reads: these checks keep it in line with the
// code (function command ids, files served by Vite, icon sizes) before Excel finds out.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from './commands';

const root = new URL('../', import.meta.url);
const manifest = readFileSync(new URL('manifest.xml', root), 'utf8');
const all = (re: RegExp) => [...manifest.matchAll(re)].map((m) => m[1] ?? '');

describe('manifest.xml', () => {
  it('declares exactly the commands main.tsx associates', () => {
    expect(all(/<FunctionName>([^<]+)<\/FunctionName>/g).sort()).toEqual([...COMMANDS].sort());
  });

  it('points every URL at the dev server, at a file it serves', () => {
    const urls = all(/"(https:\/\/localhost[^"]*)"/g).filter((u) => !u.endsWith(':3000'));
    expect(urls.length).toBeGreaterThan(5);
    for (const url of urls) {
      const { origin, pathname } = new URL(url);
      expect(origin).toBe('https://localhost:3000');
      const file = pathname.slice(1);
      const served = existsSync(new URL(`public/${file}`, root)) || existsSync(new URL(file, root));
      expect(served, url).toBe(true);
    }
  });

  it('gives each icon the size its id announces', () => {
    const icons = [
      ...manifest.matchAll(
        /<bt:Image id="Icon\.(\d+)x\d+" DefaultValue="https:\/\/localhost:3000\/([^"]+)"/g,
      ),
    ];
    expect(icons).toHaveLength(3);
    for (const [, size, file] of icons) {
      const png = readFileSync(new URL(`public/${file}`, root));
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], file).toEqual([
        Number(size),
        Number(size),
      ]);
    }
  });
});
