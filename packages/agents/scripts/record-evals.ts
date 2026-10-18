// Records what a live model answers on the eval fixtures, for the replay tests (evals/evals.test.ts).
// Synthetic data only. The key comes from the environment and is never written anywhere:
//
//   EVAL_PROVIDER=openai-compatible EVAL_BASE_URL=http://127.0.0.1:47821/v1 EVAL_API_KEY=… \
//   EVAL_MODEL='auto - Smart models - Hermes' EVAL_LABEL=llmfp-smart \
//   pnpm --filter @fi/agents eval:record [mapping|explain]
//
// EVAL_GATE=true marks the recording as the one the plan's thresholds apply to.

import { EXPLAIN_FIXTURES } from '../evals/explain.fixtures';
import { type Recording, ratio, saveRecording, scoreMapping } from '../evals/harness';
import { MAPPING_FIXTURES } from '../evals/mapping.fixtures';
import { aiHandle } from '../src/ai';
import { EXPLAIN_PROMPT_HASH, explainIssues } from '../src/explain';
import { MAPPING_PROMPT_HASH, proposeMapping } from '../src/mapping';
import {
  MemoryRunStore,
  Orchestrator,
  type RunOutcome,
  type RunRequest,
} from '../src/orchestrator';
import { AiSettings } from '../src/providers/types';

class CapturingOrchestrator extends Orchestrator {
  last: unknown = null;
  override async run<T>(req: RunRequest<T>): Promise<RunOutcome<T>> {
    this.last = null;
    const out = await super.run(req);
    if (out.ok) this.last = out.output;
    return out;
  }
}

const env = process.env;
const settings = AiSettings.parse({
  mode: 'byok',
  provider: env.EVAL_PROVIDER ?? 'openai-compatible',
  models: { agent: env.EVAL_MODEL, classify: env.EVAL_MODEL_CLASSIFY ?? env.EVAL_MODEL },
  ...(env.EVAL_BASE_URL && { baseUrl: env.EVAL_BASE_URL }),
  structuredOutputs: env.EVAL_STRUCTURED === 'true',
});
const ai = aiHandle({ settings, apiKey: env.EVAL_API_KEY });
if (!ai) throw new Error('AI is off');
const label =
  env.EVAL_LABEL ?? `${settings.provider}-${settings.models.agent}`.replace(/[^\w.-]+/g, '-');
const which = process.argv[2] ?? 'all';
const orchestrator = new CapturingOrchestrator({
  store: new MemoryRunStore(),
  budget: { runTokens: 100_000, tenantDailyTokens: Number.POSITIVE_INFINITY },
  timeoutMs: 120_000,
  retries: 2,
});
const base = {
  label,
  provider: settings.provider,
  model: settings.models.agent,
  recordedAt: new Date().toISOString().slice(0, 10),
  gate: env.EVAL_GATE === 'true',
};

if (which === 'all' || which === 'mapping') {
  const answers: Recording['answers'] = {};
  const scores = [];
  for (const f of MAPPING_FIXTURES) {
    const { mapping, degraded } = await proposeMapping(f.snapshot, {
      tenantId: 'eval',
      orchestrator,
      ai,
    });
    answers[f.name] = orchestrator.last;
    const s = scoreMapping(f, mapping);
    scores.push(s);
    console.log(
      `${f.name}: ${s.correct}/${s.total}${degraded ? ` (${degraded})` : ''} ${s.misses.join('; ')}`,
    );
  }
  const file = saveRecording({
    agent: 'mapping',
    promptHash: MAPPING_PROMPT_HASH,
    answers,
    ...base,
  });
  console.log(`mapping: ${(ratio(scores) * 100).toFixed(1)} % on core fields → ${file.pathname}`);
}

if (which === 'all' || which === 'explain') {
  const answers: Recording['answers'] = {};
  let agent = 0;
  let total = 0;
  const rejected = { forbiddenAutoFix: 0, wrongAutoFix: 0, unknownTokens: 0, missing: 0 };
  for (const f of EXPLAIN_FIXTURES) {
    const r = await explainIssues(f.invoice, f.issues, { tenantId: 'eval', orchestrator, ai });
    answers[f.name] = orchestrator.last;
    agent += r.explanations.filter((e) => e.source === 'agent').length;
    total += r.explanations.length;
    for (const k of Object.keys(rejected) as (keyof typeof rejected)[])
      rejected[k] += r.rejected[k];
    console.log(
      `${f.name}: ${r.explanations.filter((e) => e.source === 'agent').length}/${r.explanations.length}${r.degraded ? ` (${r.degraded})` : ''}`,
    );
  }
  const file = saveRecording({
    agent: 'explain',
    promptHash: EXPLAIN_PROMPT_HASH,
    answers,
    ...base,
  });
  console.log(
    `explain: ${agent}/${total} explained by the agent, rejected ${JSON.stringify(rejected)} → ${file.pathname}`,
  );
}
