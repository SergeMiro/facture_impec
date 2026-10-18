// "Included" AI: our account, set from the server env. No AI_PROVIDER means no included AI.
import { AiSettings, type ResolvedAi } from './types';

export interface AiEnv {
  AI_PROVIDER?: string | undefined;
  AI_MODEL_AGENT?: string | undefined;
  AI_MODEL_CLASSIFY?: string | undefined;
  AI_BASE_URL?: string | undefined;
  AI_API_KEY?: string | undefined;
}

/** Null when the operator configured no provider. Throws on a half-written configuration. */
export function includedAi(env: AiEnv): ResolvedAi | null {
  if (!env.AI_PROVIDER) return null;
  const agent = env.AI_MODEL_AGENT;
  const settings = AiSettings.parse({
    mode: 'included',
    provider: env.AI_PROVIDER,
    models: { agent, classify: env.AI_MODEL_CLASSIFY ?? agent },
    ...(env.AI_BASE_URL && { baseUrl: env.AI_BASE_URL }),
  });
  return { settings, apiKey: env.AI_API_KEY };
}
