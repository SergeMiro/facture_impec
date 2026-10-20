// Which model answers for a tenant (docs/AI_PROVIDERS.md). Settings are data, never code: changing
// provider or model is a config change, and a request never moves to another provider on its own.
import { z } from 'zod';

export const PROVIDERS = [
  'mistral',
  'anthropic',
  'openai',
  'google',
  'azure',
  'openai-compatible',
] as const;
export const ProviderId = z.enum(PROVIDERS);
export type ProviderId = z.infer<typeof ProviderId>;

/** `agent`: tool calling and explanations. `classify`: cheap labelling such as column mapping. */
export const Role = z.enum(['agent', 'classify']);
export type Role = z.infer<typeof Role>;

export const AiMode = z.enum(['included', 'byok', 'off']);
export type AiMode = z.infer<typeof AiMode>;

/** What "Test connection" found (probe.ts). */
export const Capabilities = z.object({
  text: z.boolean(),
  json: z.boolean(),
  tools: z.boolean(),
  checkedAt: z.string(),
});
export type Capabilities = z.infer<typeof Capabilities>;

const needsBaseUrl = new Set<ProviderId>(['azure', 'openai-compatible']);

export const AiSettings = z
  .object({
    mode: AiMode,
    provider: ProviderId,
    models: z.object({ agent: z.string().min(1).max(200), classify: z.string().min(1).max(200) }),
    /** Azure: `https://<resource>.openai.azure.com/openai`. OpenAI-compatible: the `/v1` root. */
    baseUrl: z.url().optional(),
    /** Extra headers for an OpenAI-compatible endpoint (e.g. OpenRouter attribution). */
    headers: z.record(z.string().min(1).max(100), z.string().max(500)).optional(),
    /** Azure api-version; the provider's default when absent. */
    apiVersion: z.string().min(1).max(40).optional(),
    /** OpenAI-compatible endpoints that accept a JSON schema (`response_format: json_schema`). */
    structuredOutputs: z.boolean().optional(),
    /**
     * Fields added to every request body of an OpenAI-compatible endpoint, e.g. OpenRouter's
     * `provider` routing (`docs/AI_PROVIDERS.md`).
     */
    body: z.record(z.string().min(1).max(60), z.json()).optional(),
    capabilities: Capabilities.optional(),
  })
  .superRefine((s, ctx) => {
    if (needsBaseUrl.has(s.provider) && !s.baseUrl)
      ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: `required for ${s.provider}` });
  });
export type AiSettings = z.infer<typeof AiSettings>;

/** The settings plus the decrypted key, only ever held in the API process for one call. */
export interface ResolvedAi {
  settings: AiSettings;
  apiKey: string | undefined;
}
