// Scenario tooling (plan §9): scripts/run-scenario.ts and src/scenarios.test.ts use it; `pnpm perf`
// (scripts/perf) too.
export { main } from './cli';
export { SCENARIO_SELLER, scenarioDraft } from './invoice';
export {
  BUDGETS,
  formatPerf,
  type PathResult,
  type PerfOptions,
  type PerfReport,
  percentile,
  runPerf,
} from './perf';
export { type Endpoints, runScenario, type ScenarioReport } from './runner';
export { ChaseExpectation, loadScenario, Scenario, scenarioNames } from './scenario';
export { type Stack, type StackOptions, stackFor, startStack } from './stack';
