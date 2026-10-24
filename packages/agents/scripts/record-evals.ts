// Records what a live model answers on the eval fixtures, for the replay tests (evals/evals.test.ts).
// Synthetic data only. The key comes from the environment and is never written anywhere:
//
//   EVAL_PROVIDER=openai-compatible EVAL_BASE_URL=http://127.0.0.1:47821/v1 EVAL_API_KEY=… \
//   EVAL_MODEL='auto - Smart models - Hermes' EVAL_LABEL=llmfp-smart \
//   pnpm --filter @fi/agents eval:record [mapping|layout|explain|monitor|chat|classify]
//
// EVAL_GATE=true marks the recording as the one the plan's thresholds apply to. EVAL_STRUCTURED=true
// and EVAL_REQUEST_BODY='{"provider":{…}}' as for AI_STRUCTURED_OUTPUTS and AI_REQUEST_BODY.

import { CHAT_FIXTURES, playChat, recording, type TurnScore } from '../evals/chat.fixtures';
import { CLASSIFY_FIXTURES } from '../evals/classify.fixtures';
import { EXPLAIN_FIXTURES } from '../evals/explain.fixtures';
import { type Recording, ratio, saveRecording, scoreLayout, scoreMapping } from '../evals/harness';
import { LAYOUT_FIXTURES } from '../evals/layout.fixtures';
import { MAPPING_FIXTURES } from '../evals/mapping.fixtures';
import { MONITOR_FIXTURES } from '../evals/monitor.fixtures';
import { aiHandle } from '../src/ai';
import { CHAT_PROMPT_HASH } from '../src/chat';
import {
  askModel,
  CLASSIFY_PROMPT_HASH,
  classifyByRules,
  MODEL_SURE,
  RULE_SURE,
} from '../src/classify';
import { EXPLAIN_PROMPT_HASH, explainIssues } from '../src/explain';
import { LAYOUT_PROMPT_HASH, proposeLayout } from '../src/layout';
import { MAPPING_PROMPT_HASH, proposeMapping } from '../src/mapping';
import { adviseNext, MONITOR_PROMPT_HASH } from '../src/monitor';
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
  ...(env.EVAL_REQUEST_BODY && { body: JSON.parse(env.EVAL_REQUEST_BODY) }),
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

if (which === 'all' || which === 'layout') {
  const answers: Recording['answers'] = {};
  const scores = [];
  for (const f of LAYOUT_FIXTURES) {
    const { layout, degraded } = await proposeLayout(f.snapshot, {
      tenantId: 'eval',
      orchestrator,
      ai,
    });
    answers[f.name] = orchestrator.last;
    const s = scoreLayout(f, layout);
    scores.push(s);
    console.log(
      `${f.name}: ${s.correct}/${s.total}${s.headerOk ? '' : ' (header row)'}${degraded ? ` (${degraded})` : ''} ${s.misses.join('; ')}`,
    );
  }
  const file = saveRecording({ agent: 'layout', promptHash: LAYOUT_PROMPT_HASH, answers, ...base });
  console.log(
    `layout: ${(ratio(scores) * 100).toFixed(1)} % on the kind and key fields → ${file.pathname}`,
  );
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

if (which === 'all' || which === 'monitor') {
  const answers: Recording['answers'] = {};
  let right = 0;
  const rejected = { unknownTokens: 0, wrongAmount: 0, tooLong: 0 };
  for (const f of MONITOR_FIXTURES) {
    const r = await adviseNext(
      f.invoice,
      { kind: 'refusal', reason: f.reason },
      { tenantId: 'eval', orchestrator, ai },
    );
    answers[f.name] = orchestrator.last;
    if (r.advice.proposal === f.expected) right++;
    for (const k of Object.keys(rejected) as (keyof typeof rejected)[])
      rejected[k] += r.rejected[k];
    console.log(
      `${f.name}: ${r.advice.proposal ?? '—'} (expected ${f.expected})${r.advice.degraded ? ` (${r.advice.degraded})` : ''}`,
    );
  }
  const file = saveRecording({
    agent: 'monitor',
    promptHash: MONITOR_PROMPT_HASH,
    answers,
    ...base,
  });
  console.log(
    `monitor: ${right}/${MONITOR_FIXTURES.length} expected proposals, rejected ${JSON.stringify(rejected)} → ${file.pathname}`,
  );
}

if (which === 'all' || which === 'chat') {
  const answers: Recording['answers'] = {};
  const scores: TurnScore[] = [];
  for (const f of CHAT_FIXTURES) {
    const raw: unknown[] = [];
    try {
      scores.push(...(await playChat(f, recording(ai, raw))));
      answers[f.name] = raw;
    } catch (e) {
      console.log(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      answers[f.name] = null;
    }
  }
  for (const s of scores) console.log(`${s.fixture} #${s.turn}: ${s.ok ? 'ok' : s.why.join('; ')}`);
  const file = saveRecording({ agent: 'chat', promptHash: CHAT_PROMPT_HASH, answers, ...base });
  console.log(
    `chat: ${scores.filter((s) => s.ok).length}/${scores.length} turns right → ${file.pathname}`,
  );
}

if (which === 'all' || which === 'classify') {
  // The model is asked on every document, even those the patterns take: a recording then still
  // holds when a pattern changes, and the model's own score is known.
  const answers: Recording['answers'] = {};
  let alone = 0;
  let whole = 0;
  for (const f of CLASSIFY_FIXTURES) {
    const out = await askModel(f.doc, { tenantId: 'eval', orchestrator, ai });
    answers[f.name] = out.ok ? out.output : null;
    const model = out.ok && out.output.confidence >= MODEL_SURE ? out.output.kind : null;
    // As classifyDocument: a sure pattern, else the model, else (no answer) a body pattern.
    const rule = classifyByRules(f.doc);
    const label =
      rule && rule.confidence >= RULE_SURE ? rule.label : out.ok ? model : (rule?.label ?? null);
    if (model === f.expected) alone++;
    if (label === f.expected) whole++;
    console.log(
      `${f.name}: ${out.ok ? `${out.output.kind} ${out.output.confidence}` : out.reason} (expected ${f.expected})`,
    );
  }
  const file = saveRecording({
    agent: 'classify',
    promptHash: CLASSIFY_PROMPT_HASH,
    answers,
    ...base,
    model: settings.models.classify,
  });
  console.log(
    `classify: model alone ${alone}/${CLASSIFY_FIXTURES.length}, rules then model ${whole}/${CLASSIFY_FIXTURES.length} → ${file.pathname}`,
  );
}
