// Plan §9 "Scenario": a full outbound cycle against the mock platform, in one process.
//   pnpm scenario happy            pnpm scenario duplicate-send network-flap            pnpm scenario all
// Scenarios live in fixtures/scenarios/*.json; the logic in apps/api/src/scenarios/.
import { main } from '@fi/api/scenarios';

process.exitCode = await main(process.argv.slice(2));
