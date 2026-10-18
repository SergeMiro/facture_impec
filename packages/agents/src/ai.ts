// What an agent needs from the tenant's AI settings: a model per role and whether it calls tools.
import type { LanguageModel } from 'ai';
import { createModel } from './providers/models';
import type { ResolvedAi, Role } from './providers/types';

export interface AiHandle {
  provider: string;
  modelId(role: Role): string;
  model(role: Role): LanguageModel;
  /** False when "Test connection" found no tool calling: agents then work without tools. */
  tools: boolean;
}

/** Null when AI is off. */
export function aiHandle(resolved: ResolvedAi | null): AiHandle | null {
  if (!resolved || resolved.settings.mode === 'off') return null;
  const { settings } = resolved;
  return {
    provider: settings.provider,
    modelId: (role) => settings.models[role],
    model: (role) => createModel(resolved, role),
    tools: settings.capabilities?.tools ?? true,
  };
}
