// Every test file: the API's JSON log lines (src/log.ts) are dropped, so a failing test's own output
// is not buried under the warnings of the jobs it retries. `FI_TEST_LOGS=1 pnpm test` shows them.
import { captureLogs } from './log';

if (process.env.FI_TEST_LOGS !== '1') captureLogs(() => {});
