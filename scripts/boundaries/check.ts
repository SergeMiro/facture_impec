// Fails the gate when a package imports what its rule forbids (scripts/boundaries/rules.ts): another
// workspace package it may not depend on, an outside package of the wrong layer, a `node:` module in
// browser code, a file of another package by relative path, or a workspace package its package.json
// does not declare (the API's Docker image installs the declared ones only).
// Usage: `pnpm boundaries` (part of `pnpm verify`).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type PackageRule, RULES, TEST_INFRA } from './rules';

export interface Violation {
  /** Repository-relative, with `/`. */
  file: string;
  line: number;
  specifier: string;
  reason: string;
}

const SOURCE = /\.(tsx?|mts|cts|astro)$/;
const SKIP = new Set([
  'node_modules',
  'dist',
  '.astro',
  '.turbo',
  'coverage',
  'test-results',
  'playwright-report',
]);
const WORKSPACE = /^@fi\/([a-z0-9-]+)/;

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Every `import … from 'x'`, `export … from 'x'`, `import 'x'` and `import('x')`, with its line. */
export function importsOf(code: string): { specifier: string; line: number }[] {
  // Comments go first (a comment may quote an import); line comments only where a line starts with
  // one, so a URL inside a string stays whole. Lengths are kept, so line numbers stay true.
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  const text = code.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^[ \t]*\/\/.*$/gm, blank);
  const found: { specifier: string; line: number }[] = [];
  const pattern =
    /(?:^|[\s;{}])(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s*)?['"]([^'"\n]+)['"]|\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  for (const m of text.matchAll(pattern)) {
    const specifier = m[1] ?? m[2];
    if (!specifier) continue;
    const at = (m.index ?? 0) + m[0].indexOf(specifier);
    found.push({ specifier, line: text.slice(0, at).split('\n').length });
  }
  return found;
}

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. */
const packageOf = (specifier: string) =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');

const matches = (name: string, specifier: string, patterns: readonly string[]) =>
  patterns.some((p) =>
    p.endsWith('*') ? specifier.startsWith(p.slice(0, -1)) : p === name || p === specifier,
  );

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (SOURCE.test(entry.name)) out.push(path);
  }
  return out;
}

/** The workspace packages: `apps/*` and `packages/*` that have a package.json. */
function workspace(root: string): Map<string, Manifest> {
  const found = new Map<string, Manifest>();
  for (const group of ['apps', 'packages']) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const manifest = join(base, entry.name, 'package.json');
      if (entry.isDirectory() && existsSync(manifest)) {
        found.set(`${group}/${entry.name}`, JSON.parse(readFileSync(manifest, 'utf8')) as Manifest);
      }
    }
  }
  return found;
}

export function checkBoundaries(
  root: string,
  rules: Record<string, PackageRule> = RULES,
): Violation[] {
  const packages = workspace(root);
  const dirOf = new Map([...packages].map(([dir, m]) => [m.name, dir]));
  const violations: Violation[] = [];
  for (const [dir, manifest] of packages) {
    const rule = rules[dir];
    if (!rule) {
      violations.push({
        file: `${dir}/package.json`,
        line: 1,
        specifier: manifest.name,
        reason: 'a workspace package without a rule in scripts/boundaries/rules.ts',
      });
      continue;
    }
    const base = join(root, dir);
    for (const path of sourceFiles(base)) {
      const inside = relative(base, path).split(sep).join('/');
      const file = `${dir}/${inside}`;
      const test = TEST_INFRA.some((p) => p.test(inside));
      const browser = !test && (rule.browser ?? []).some((b) => inside.startsWith(`${b}/`));
      for (const { specifier, line } of importsOf(readFileSync(path, 'utf8'))) {
        const refuse = (reason: string) => violations.push({ file, line, specifier, reason });
        if (specifier.startsWith('.')) {
          const target = relative(base, resolve(dirname(path), specifier));
          if (target.startsWith('..')) refuse('reaches into another package by path');
          continue;
        }
        if (specifier.startsWith('node:')) {
          if (browser) refuse('a Node module in code that runs in the browser');
          continue;
        }
        const workspaceName = WORKSPACE.exec(specifier)?.[0];
        if (workspaceName) {
          const target = dirOf.get(workspaceName);
          if (!target) {
            refuse('no such workspace package');
            continue;
          }
          if (workspaceName === manifest.name) continue;
          const short = target.split('/')[1] ?? target;
          if (!test && !rule.imports.includes(short)) {
            refuse(`${manifest.name} may not import ${workspaceName}`);
          }
          const declared =
            manifest.dependencies?.[workspaceName] ??
            (test ? manifest.devDependencies?.[workspaceName] : undefined);
          if (!declared) {
            refuse(
              `${workspaceName} is not in ${dir}/package.json ${test ? 'dependencies or devDependencies' : 'dependencies'}`,
            );
          }
          continue;
        }
        if (test) continue;
        const name = packageOf(specifier);
        if (rule.forbid && matches(name, specifier, rule.forbid)) {
          refuse(`${manifest.name} may not import ${name}`);
        } else if (rule.allow && !matches(name, specifier, rule.allow)) {
          refuse(`${manifest.name} imports only ${rule.allow.join(', ')}`);
        }
      }
    }
  }
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const violations = checkBoundaries(root);
  for (const v of violations) console.error(`${v.file}:${v.line}  '${v.specifier}' — ${v.reason}`);
  if (violations.length) {
    console.error(`\n${violations.length} boundary violation(s): scripts/boundaries/rules.ts`);
    process.exit(1);
  }
  console.log(`boundaries: ${workspace(root).size} packages, no violation`);
}
