// `pnpm runner:restore <dump> <folder>`: the runner's database back from one of its daily dumps
// (vault/_system/dumps/base-YYYY-MM-DD.tar.gz) into an empty folder, the runner stopped. Then set
// PGLITE_DIR to that folder and start it again (docs/RUNBOOK.md § Runner).
import { resolve } from 'node:path';
import { restoreDump } from '../src/runner';

const [dump, folder] = process.argv.slice(2);
if (!dump || !folder) {
  console.error(
    'usage: pnpm runner:restore <vault/_system/dumps/base-YYYY-MM-DD.tar.gz> <empty folder>',
  );
  process.exitCode = 2;
} else {
  const companies = await restoreDump(resolve(dump), resolve(folder));
  console.info(`restored into ${resolve(folder)}: ${companies.join(', ') || 'no company'}`);
}
