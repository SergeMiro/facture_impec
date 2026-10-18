// The only file that imports provider packages: one factory per provider, same LanguageModel out.
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createGoogle } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { ResolvedAi, Role } from './types';

export class AiDisabledError extends Error {
  constructor() {
    super('AI is off for this tenant');
    this.name = 'AiDisabledError';
  }
}

/** The model for a role. Throws AiDisabledError in mode `off`. */
export function createModel({ settings, apiKey }: ResolvedAi, role: Role): LanguageModel {
  if (settings.mode === 'off') throw new AiDisabledError();
  const id = settings.models[role];
  const key = apiKey ?? '';
  switch (settings.provider) {
    case 'mistral':
      return createMistral({ apiKey: key })(id);
    case 'anthropic':
      return createAnthropic({ apiKey: key })(id);
    case 'openai':
      return createOpenAI({ apiKey: key })(id);
    case 'google':
      return createGoogle({ apiKey: key })(id);
    case 'azure':
      // Chat Completions: every Azure api-version has it, the Responses API only recent ones.
      return createAzure({
        baseURL: settings.baseUrl,
        apiKey: key,
        ...(settings.apiVersion && { apiVersion: settings.apiVersion }),
      }).chat(id);
    case 'openai-compatible':
      return createOpenAICompatible({
        name: 'openai-compatible',
        baseURL: settings.baseUrl ?? '',
        ...(apiKey && { apiKey }),
        ...(settings.headers && { headers: settings.headers }),
        includeUsage: true,
        supportsStructuredOutputs: settings.structuredOutputs ?? false,
      })(id);
  }
}
