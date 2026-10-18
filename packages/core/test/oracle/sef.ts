// Compiles each schematron XSLT to a SaxonJS SEF once and caches it under
// .oracle-cache/sef/<sha256(xslt)>-saxonjs-<version>.json (docs/research/FORMATS.md §5.3).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { CACHE, STYLESHEETS, type Stylesheet } from './paths';

const require = createRequire(import.meta.url);
const SAXON_VERSION: string = require('saxon-js/package.json').version;

export function sefPath(name: Stylesheet): string {
  const hash = createHash('sha256').update(readFileSync(STYLESHEETS[name])).digest('hex');
  return `${CACHE}sef/${hash}-saxonjs-${SAXON_VERSION}.json`;
}

/** Compiles the stylesheet if its SEF is missing (15–18 s and up to 0.7 GB the first time). */
export function ensureSef(name: Stylesheet): string {
  const target = sefPath(name);
  if (existsSync(target)) return target;
  mkdirSync(`${CACHE}sef`, { recursive: true });
  const xslt3 = require.resolve('xslt3/xslt3.js');
  execFileSync(
    process.execPath,
    [xslt3, `-xsl:${STYLESHEETS[name]}`, `-export:${target}`, '-nogo', '-relocate:on'],
    { stdio: 'inherit' },
  );
  return target;
}
