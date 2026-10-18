// "Test connection" before BYOK settings are saved (docs/AI_PROVIDERS.md): plain text, then structured
// output, then one tool call. A model without structured output is refused; one without tools is
// accepted and the agents call it without tools.
import { APICallError, generateText, type LanguageModel, Output, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import type { Capabilities } from './types';

export type ProbeFailure = 'auth' | 'model' | 'network' | 'json';

export interface ProbeResult {
  capabilities: Capabilities;
  /** Set when the settings must be refused; `ai.probe.<failure>` in fr.json says why. */
  failure?: ProbeFailure;
  /** The provider's own message, for the server log only. */
  detail?: string;
}

const TIMEOUT_MS = 20_000;

function failureOf(error: unknown): ProbeFailure {
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) return 'auth';
    if (error.statusCode === 404 || error.statusCode === 400) return 'model';
    return 'network';
  }
  return 'network';
}

const detailOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function probeModel(
  model: LanguageModel,
  now = () => new Date(),
): Promise<ProbeResult> {
  const base = { model, maxRetries: 0, timeout: TIMEOUT_MS } as const;
  const caps: Capabilities = { text: false, json: false, tools: false, checkedAt: '' };
  const done = (extra: Omit<ProbeResult, 'capabilities'> = {}): ProbeResult => ({
    capabilities: { ...caps, checkedAt: now().toISOString() },
    ...extra,
  });

  try {
    const r = await generateText({
      ...base,
      prompt: 'Répondez seulement : OK',
      maxOutputTokens: 20,
    });
    caps.text = r.text.trim().length > 0;
    if (!caps.text) return done({ failure: 'model', detail: 'empty answer' });
  } catch (error) {
    return done({ failure: failureOf(error), detail: detailOf(error) });
  }

  try {
    const r = await generateText({
      ...base,
      prompt: 'Donnez la capitale de la France au format JSON {"city": string, "country": string}.',
      output: Output.object({ schema: z.object({ city: z.string(), country: z.string() }) }),
      maxOutputTokens: 100,
    });
    caps.json = r.output.city.length > 0;
  } catch (error) {
    return done({ failure: 'json', detail: detailOf(error) });
  }

  try {
    const r = await generateText({
      ...base,
      prompt: 'Appelez l’outil echo avec le mot « facture ».',
      tools: {
        echo: tool({
          description: 'Renvoie le mot reçu.',
          inputSchema: z.object({ word: z.string() }),
          execute: async ({ word }) => word,
        }),
      },
      toolChoice: 'required',
      stopWhen: stepCountIs(1),
      maxOutputTokens: 100,
    });
    caps.tools = r.toolCalls.length > 0;
  } catch {
    caps.tools = false;
  }
  return done();
}
