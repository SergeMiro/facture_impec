// One structured call to a model. The orchestrator owns retries, so the SDK's own are off.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  generateText,
  JSONParseError,
  type LanguageModel,
  NoObjectGeneratedError,
  Output,
  stepCountIs,
  type ToolSet,
  TypeValidationError,
} from 'ai';
import { z } from 'zod';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredCall<S extends z.ZodType> {
  model: LanguageModel;
  system: string;
  prompt: string;
  schema: S;
  schemaName: string;
  tools?: ToolSet;
  /** Model turns allowed when tools are given (each tool round trip is one). */
  maxSteps?: number;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface StructuredResult<T> {
  output: T;
  usage: Usage;
}

export async function callStructured<S extends z.ZodType>(
  call: StructuredCall<S>,
): Promise<StructuredResult<z.infer<S>>> {
  const result = await generateText({
    model: call.model,
    system: call.system,
    prompt: call.prompt,
    output: Output.object({ schema: call.schema, name: call.schemaName }),
    ...(call.tools && { tools: call.tools, stopWhen: stepCountIs(call.maxSteps ?? 4) }),
    maxOutputTokens: call.maxOutputTokens,
    maxRetries: 0,
    temperature: 0,
    ...(call.signal && { abortSignal: call.signal }),
  });
  return {
    output: call.schema.parse(result.output),
    usage: {
      inputTokens: result.totalUsage.inputTokens ?? 0,
      outputTokens: result.totalUsage.outputTokens ?? 0,
    },
  };
}

/** The model answered, but not in the schema: asking again rarely helps (BTP plan §7). */
export const malformed = (error: unknown): boolean =>
  error instanceof z.ZodError ||
  NoObjectGeneratedError.isInstance(error) ||
  JSONParseError.isInstance(error) ||
  TypeValidationError.isInstance(error);

const PROMPTS = new URL('../prompts/', import.meta.url);

/** A prompt file of packages/agents/prompts/. */
export const readPrompt = (name: string) => readFileSync(new URL(name, PROMPTS), 'utf8');

/**
 * Identifies what a recording was made with: the system prompt, the output schema and the tool
 * descriptions. An eval replay fails when it changes (CLAUDE.md rule 5).
 */
export function promptHash(
  system: string,
  schema: z.ZodType,
  tools: readonly string[] = [],
): string {
  return createHash('sha256')
    .update(system)
    .update(JSON.stringify(z.toJSONSchema(schema)))
    .update(tools.join('\n'))
    .digest('hex')
    .slice(0, 16);
}

/** Rough token count before a call (4 characters per token), to refuse an oversized input early. */
export const estimateTokens = (...texts: string[]) =>
  Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4);
