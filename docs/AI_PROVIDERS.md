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

Not recorded yet: Mistral and Claude (need a paid key: owner), and ExplainAgent against a live model
(its guardrail tests run on scripted answers).

## Open points

- Exact EU-residency terms of each hosted provider (TODO(verify) before M3 ships BYOK).
- Per-tenant spend limit for BYOK calls made by background agents (the reminder agent runs unattended).
