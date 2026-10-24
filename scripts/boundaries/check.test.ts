import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { checkBoundaries, importsOf } from './check';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('importsOf', () => {
  it('finds every form of import with its line, and none in a comment', () => {
    const code = [
      "import { a } from 'one';",
      "import type { B } from '@fi/two/sub';",
      'import {',
      '  c,',
      "  d } from 'three';",
      "export { e } from './four';",
      "export * from 'five';",
      "import 'six';",
      "const pdf = await import('@fi/core/pdf');",
      "// import x from 'pg';",
      "/* import y from 'hono';",
      "   import z from 'ai'; */",
      "const url = 'https://example.fr/import/from';",
    ].join('\n');
    expect(importsOf(code)).toEqual([
      { specifier: 'one', line: 1 },
      { specifier: '@fi/two/sub', line: 2 },
      { specifier: 'three', line: 5 },
      { specifier: './four', line: 6 },
      { specifier: 'five', line: 7 },
      { specifier: 'six', line: 8 },
      { specifier: '@fi/core/pdf', line: 9 },
    ]);
  });
});

describe('checkBoundaries', () => {
  const root = mkdtempSync(join(tmpdir(), 'boundaries-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const manifest = (name: string, extra: object = {}) => JSON.stringify({ name, ...extra });

  put('packages/domain/package.json', manifest('@fi/domain'));
  put('packages/domain/src/index.ts', "import { z } from 'zod';\nimport _ from 'lodash';\n");
  put(
    'packages/core/package.json',
    manifest('@fi/core', { dependencies: { '@fi/domain': 'workspace:*' } }),
  );
  put(
    'packages/core/src/a.ts',
    [
      "import { Kind } from '@fi/domain';",
      "import pg from 'pg';",
      "import { readFileSync } from 'node:fs';",
      "import { sneaky } from '../../domain/src/index';",
      "const api = await import('@fi/api');",
      "import { self } from '@fi/core';",
      "import { gone } from '@fi/nowhere';",
      "// import pg from 'pg';",
    ].join('\n'),
  );
  put('packages/core/src/a.test.ts', "import { harness } from '@fi/api';\nimport pg from 'pg';\n");
  put('packages/core/scripts/gen.ts', "import { readFileSync } from 'node:fs';\n");
  put(
    'apps/api/package.json',
    manifest('@fi/api', { dependencies: { '@fi/core': 'workspace:*' } }),
  );
  put('apps/api/src/app.ts', "import { a } from '@fi/core';\nimport { K } from '@fi/domain';\n");
  put('packages/extra/package.json', manifest('@fi/extra'));

  const violations = checkBoundaries(root, {
    'packages/domain': { imports: [], allow: ['zod'], browser: ['src'] },
    'packages/core': { imports: ['domain'], forbid: ['pg'], browser: ['src'] },
    'apps/api': { imports: ['core', 'domain'] },
  });
  const said = violations.map((v) => `${v.file}:${v.line} ${v.specifier} — ${v.reason}`);

  it('fails on each kind of forbidden import, and on a package without a rule', () => {
    expect(said.sort()).toEqual(
      [
        'apps/api/src/app.ts:2 @fi/domain — @fi/domain is not in apps/api/package.json dependencies',
        'packages/core/src/a.test.ts:1 @fi/api — @fi/api is not in packages/core/package.json dependencies or devDependencies',
        'packages/core/src/a.ts:2 pg — @fi/core may not import pg',
        'packages/core/src/a.ts:3 node:fs — a Node module in code that runs in the browser',
        'packages/core/src/a.ts:4 ../../domain/src/index — reaches into another package by path',
        'packages/core/src/a.ts:5 @fi/api — @fi/core may not import @fi/api',
        'packages/core/src/a.ts:5 @fi/api — @fi/api is not in packages/core/package.json dependencies',
        'packages/core/src/a.ts:7 @fi/nowhere — no such workspace package',
        'packages/domain/src/index.ts:2 lodash — @fi/domain imports only zod',
        'packages/extra/package.json:1 @fi/extra — a workspace package without a rule in scripts/boundaries/rules.ts',
      ].sort(),
    );
  });

  it('lets tests and scripts reach what they declare, Node included', () => {
    expect(said.filter((s) => s.includes('a.test.ts:2') || s.includes('scripts/gen.ts'))).toEqual(
      [],
    );
  });
});

describe('the repository', () => {
  it('keeps its package boundaries', () => {
    expect(checkBoundaries(ROOT)).toEqual([]);
  });
});
