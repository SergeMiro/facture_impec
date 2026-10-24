# AI providers

Status: design, 2026-10-17. Implemented in M3 (`packages/agents`). It replaces the Anthropic-only
choice of plan §1: the owner asked on 2026-10-17 that every major provider, and any
OpenAI-compatible endpoint, can be plugged in.

## Rules that do not change

- **The deterministic core decides.** Validity, totals, routing and sending never depend on a model.
  If every provider is down, invoices are still checked and sent; only explanations, column mapping
  suggestions and reminder drafts are missing (plan §0).
- **Pseudonymize first.** Names, SIREN/SIRET, VAT numbers, IBAN, addresses and e-mails are replaced by
  tokens before any call, whatever the provider (plan §0, `packages/agents` pseudonymizer). A
  tenant cannot switch this off for a provider we host; with their own key it stays on by default.
- **No silent provider switch.** A request never moves from the tenant's chosen provider to another
  one: the choice can carry a data-residency promise (EU, self-hosted). On failure we retry the same
  provider, then degrade to "no AI" for that action and say so in the UI.
- **Prompts and evals.** Every prompt lives in `packages/agents/prompts/` with an eval fixture
  (CLAUDE.md rule 5). An eval runs against each provider/model pair we offer by default.

## Library

[Vercel AI SDK](https://ai-sdk.dev) — `ai` 7.x plus one provider package each. It gives one
`generateText` / `generateObject` / tool-calling API over every provider, with Zod schemas for
structured output, which fits "Zod at every boundary". Versions on npm, checked 2026-10-17:

| Package | Version | Provider |
|---|---|---|
| `ai` | 7.0.143 | core |
| `@ai-sdk/mistral` | 4.0.66 | Mistral (EU) |
| `@ai-sdk/anthropic` | 4.0.82 | Anthropic Claude |
| `@ai-sdk/openai` | 4.0.96 | OpenAI |
| `@ai-sdk/google` | 4.0.99 | Google Gemini |
| `@ai-sdk/azure` | 4.0.104 | Azure OpenAI (EU regions) |
| `@ai-sdk/openai-compatible` | 3.0.71 | anything that speaks the OpenAI Chat Completions API |

The OpenAI-compatible package covers Scaleway Generative APIs, OVHcloud AI Endpoints, OpenRouter,
Groq, Together, DeepSeek, vLLM, Ollama and LM Studio, so no community provider packages are needed.
Provider packages are only imported by `packages/agents/src/providers/models.ts`.

## Model

```ts
// packages/agents/src/providers/types.ts (M3)
type ProviderId = 'mistral' | 'anthropic' | 'openai' | 'google' | 'azure' | 'openai-compatible';
type Role = 'agent' | 'classify';          // tool-calling and explanations | cheap mapping/labelling

interface AiSettings {                     // one row per tenant, Zod-validated
  mode: 'included' | 'byok' | 'off';
  provider: ProviderId;
  models: Record<Role, string>;            // e.g. { agent: 'mistral-medium-latest', classify: 'mistral-small-latest' }
  baseUrl?: string;                        // openai-compatible and azure only; BYOK: public https (providers/net.ts)
  apiVersion?: string;                     // azure only; the provider default when absent
  structuredOutputs?: boolean;             // openai-compatible: endpoint accepts json_schema
  headers?: Record<string, string>;        // openai-compatible extras (e.g. OpenRouter attribution)
  keyRef?: string;                         // id of the sealed key, never the key itself
  capabilities?: { tools: boolean; json: boolean; checkedAt: string };
}
```

- **Included** (default): our account, our choice of provider and models, set from env
  (`AI_PROVIDER`, `AI_MODEL_AGENT`, `AI_MODEL_CLASSIFY`, plus the provider's key). Changing model is a
  config change, never a code change. Fair-use quotas per plan are in `docs/research/PRICING.md` §3.2.
- **BYOK**: the tenant's provider, models and key. The key is sealed with AES-256-GCM under a key
  from the server env (`AI_KEY_SEALING_KEY`), stored in Postgres, decrypted only in the API process
  for the call, never returned to the add-in, never logged. The UI shows the last four characters.
- **Off**: no AI. Everything deterministic keeps working.

## "Test connection"

Saving BYOK settings runs a probe before they are accepted:

1. a minimal `generateText` call (auth, base URL, model id);
2. a `generateObject` call with a two-field Zod schema (structured output);
3. a call with one dummy tool (tool calling).

Results go to `capabilities`. A model without tool calling can still do `classify` and explanations
through structured output; the agent role then uses a JSON-plan fallback instead of native tools.
A model that fails step 2 is refused, with the reason in plain French
(« ce modèle ne sait pas répondre dans un format structuré ; choisissez-en un autre »).

## Data residency, shown to the tenant

| Choice | Where data is processed | Shown as |
|---|---|---|
| Mistral (La Plateforme) | EU | UE |
| Azure OpenAI, EU region deployment | EU region chosen by the tenant | UE |
| Scaleway, OVHcloud | France | UE |
| Ollama / LM Studio / vLLM on the tenant's server | tenant's server | UE (self-hosted) |
| Anthropic, OpenAI, Google, OpenRouter, Groq | depends on the provider's terms; may be outside the EU | « hors UE possible » |

The marketing site lists the same table (`apps/site/src/content/site.ts`, `providers`). Before
claiming a residency for a provider in the product, record the provider's own page and date here
(CLAUDE.md rule 3).

## Default for "included"

Decided with the evals, not before. Candidates: Mistral (EU residency, the strongest message for
French SMEs) and Anthropic Claude (the plan's original choice; current ids `claude-sonnet-5-5` and
`claude-haiku-5-5`). The eval scores and the cost per action decide, and the result is recorded here.
Paying for either is the owner's decision (CLAUDE.md rule 9); until then `AI_PROVIDER` stays empty and
every agent gives its deterministic answer.

**Owner's decision, 2026-10-20:** production uses **Mistral**; preprod (the test deployment) uses a
**free OpenRouter model**. The gating eval recordings are therefore made with the Mistral model that
production runs: a score measured on another model says nothing about it.

| Environment | `AI_PROVIDER` | Model | Notes |
|---|---|---|---|
| prod | `mistral` | chosen by the gating evals | EU residency; the key is the owner's |
| preprod | `openai-compatible`, `AI_BASE_URL=https://openrouter.ai/api/v1` | `nvidia/nemotron-3-super-120b-a12b:free` (structured output and tools, 262k context; listed 2026-10-20) | Free models may keep or train on prompts: preprod holds test data only, never a customer's. `AI_STRUCTURED_OUTPUTS=true`. |

OpenRouter routing (`https://openrouter.ai/docs/guides/routing/provider-selection`, read 2026-10-20): the
request body takes a `provider` object; `data_collection: "deny"` uses "only providers which do not
collect user data", `zdr: true` only Zero Data Retention endpoints, `require_parameters: true` only
providers that support every parameter sent (the JSON schema among them), `sort: "price"` the cheapest.
`AI_REQUEST_BODY` (and `EVAL_REQUEST_BODY` for recordings) adds such a JSON object to every
OpenAI-compatible request. A free model has no endpoint that keeps nothing, so `zdr` is for a paid one:
the cheapest such DeepSeek, `deepseek/deepseek-v4.1-flash`, had ZDR endpoints with structured output
from $0.035 / $0.011 per million tokens in and out (fp4) or $0.112 / $0.336 (fp8) on 2026-10-20.

### Eval results so far

MappingAgent, 20 messy sheets of `evals/mapping.fixtures.ts`, the 8 core fields (gate: ≥ 95 %).
Recorded with `pnpm --filter @fi/agents eval:record` on synthetic data only; replayed by `pnpm verify`.

| Date | Provider / model | Core fields | Notes |
|---|---|---|---|
| 2026-10-18 | none (dictionary only, `detectMapping`) | 91.3 % | the floor every agent answer must beat |
| 2026-10-18 | llmfp `auto - Smart models - Hermes` (free models, dev proxy) | 98.1 % | 15/20 answered by the model, 5 fell back to the dictionary after 3 retries (free routing has no JSON schema mode); `mapping.llmfp-smart.json`, not a gate |

MonitorAgent, 13 customer refusals of `evals/monitor.fixtures.ts` (the proposal among fix and resend /
credit note / contact the customer; gate when one is set: ≥ 85 %, and never a wrong amount in a draft):

| Date | Provider / model | Right proposal | Notes |
|---|---|---|---|
| 2026-10-18 | llmfp `auto - Smart models - Hermes` (free models, dev proxy) | 11/13 (85 %) | `total`: the draft was refused by the guardrail and fell back to the three options; `billed-twice`: no proposal; `monitor.llmfp-smart.json`, not a gate |

LayoutAgent (R1), 20 sheets of `evals/layout.fixtures.ts` (five orders, delivery notes, purchases and
price lists), the kind and 7 key fields (number, date, other party, reference, designation, quantity,
unit price; gate: ≥ 95 %):

| Date | Provider / model | Kind + key fields | Notes |
|---|---|---|---|
| 2026-10-19 | none (dictionary only, `detectLayout`) | 96.25 % | optimistic: the dictionary was tuned next to these sheets; the floor, not a proof |
| 2026-10-19 | llmfp `auto - Smart models - Hermes` (free models, dev proxy) | 97.5 % | `delivery-04` fell back to the dictionary after 3 retries, `delivery-01` missed the reference column; `layout.llmfp-smart.json`, not a gate |

ChatAgent (R8), the conversations of `evals/chat.fixtures.ts`: « expliquer → corriger → annuler » on the
300 € / 400 € invoice (three turns), a sent invoice and a finding no single cell corrects. A turn is
right when the agent calls the right card (`proposeFix`, `undoEdit`, or none), says « corrigé » only once
the tool result says the finding is resolved, and writes no amount the finding does not hold. Gate:
the 300/400 conversation whole and ≥ 80 % of all turns.

| Date | Provider / model | Right turns | Notes |
|---|---|---|---|
| 2026-10-21 | llmfp `auto - Smart models - Hermes` (free models, dev proxy) | 5/5 | `chat.llmfp-smart.json`, `gate: true` until a Mistral recording replaces it: it holds the code path (tools, cards, re-hydrated amounts) to real answers; it says nothing of the production model |

ClassifyAgent (BTP plan stage 2), 45 synthetic French documents of `evals/classify.fixtures.ts` over
the 14 labels (scans, foreign and look-alike documents among them). The patterns answer first; the
model only when they are unsure. Gate: rules then model ≥ 95 %; the patterns alone are never wrong
(a title skips the model).

| Date | Provider / model | Right kind | Notes |
|---|---|---|---|
| 2026-10-24 | none (patterns only, `classifyByRules`) | 31/45 answered, 0 wrong | the floor asserted by the eval; the 14 others go to the model |
| 2026-10-24 | llmfp `auto - Smart models - Hermes` (free models, dev proxy) | model alone 45/45; rules then model 45/45 | `classify.llmfp-smart.json`, `gate: true` for the code path, as ChatAgent's. Latency through llmfp on this server: p50 2.5 s, p95 5.6 s, max 14 s on the 20 documents the patterns left to the model (rules alone: 0 ms) |

**Output cap and reasoning models (2026-10-24).** The first recording scored 29/45: with
`maxOutputTokens: 200` a reasoning model in the free pool spent the budget thinking, and 6 of the first
20 answers came back cut (`finishReason: length`, read as malformed). The answer is twenty tokens; the
cap is 2 000 so the thinking fits. Any agent with a small structured answer needs the same headroom.

Not recorded yet: Mistral and Claude (need a paid key: owner), and ExplainAgent against a live model
(its guardrail tests run on scripted answers).

## Open points

- Exact EU-residency terms of each hosted provider (TODO(verify) before M3 ships BYOK).
- Per-tenant spend limit for BYOK calls made by background agents (the reminder agent runs unattended).
