// Keep rendered media traceable to the exact editable source and animation dependency.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function demoSourceFingerprint() {
  const paths = [
    '../src/components/film/ProductFilm.tsx',
    '../src/components/film/film.css',
    '../src/content/demo-film.ts',
    '../src/styles/global.css',
    './render-demo.ts',
    './demo-source.ts',
    '../node_modules/motion/package.json',
  ];
  const source = await Promise.all(
    paths.map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
  );
  return createHash('sha256').update(source.join('\0')).digest('hex');
}
