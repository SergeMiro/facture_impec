// `pnpm runner:key`: a new Ed25519 key for the runner's RELAY_RUNNER_KEY (docs/RUNBOOK.md § Relay).
// The secret goes to standard output only: put it in the runner's .env, never in the vault. The relay
// learns the public half when the runner registers with its licence.
import { newRunnerKey, runnerKey } from '@fi/shared/relay';

const secret = newRunnerKey();
console.error(`public key (what the relay will hold): ${runnerKey(secret).publicKey}`);
console.log(`RELAY_RUNNER_KEY=${secret}`);
