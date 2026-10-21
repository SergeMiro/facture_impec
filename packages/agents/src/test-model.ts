// Test doubles for a model: canned answers, tool calls and failures. Never imported by app code.
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import type { AiHandle } from './ai';
import { MemoryRunStore, Orchestrator } from './orchestrator';

type Result = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

export function textResult(text: string, tokens = { input: 100, output: 50 }): Result {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: usage(tokens.input, tokens.output),
    warnings: [],
  } as Result;
}

export function toolCallResult(toolName: string, input: unknown): Result {
  return {
    content: [
      { type: 'tool-call', toolCallId: `call-${toolName}`, toolName, input: JSON.stringify(input) },
    ],
    finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
    usage: usage(80, 20),
    warnings: [],
  } as Result;
}

type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer P>
    ? P
    : never;

/** A canned result as a stream: the text in one delta, each tool call whole. */
function streamOf(r: Result): StreamPart[] {
  const parts: StreamPart[] = [{ type: 'stream-start', warnings: [] }];
  for (const [i, c] of r.content.entries()) {
    if (c.type === 'text') {
      const id = `text-${i}`;
      parts.push(
        { type: 'text-start', id },
        { type: 'text-delta', id, delta: c.text },
        { type: 'text-end', id },
      );
    } else if (c.type === 'tool-call') {
      parts.push(c);
    }
  }
  parts.push({ type: 'finish', finishReason: r.finishReason, usage: r.usage });
  return parts;
}

/** A model that returns these results in order (the last one repeats), generated or streamed. */
export function mockModel(...results: Result[]) {
  let i = 0;
  const next = () => {
    const r = results[Math.min(i, results.length - 1)];
    i++;
    if (!r) throw new Error('no canned result');
    return r;
  };
  return new MockLanguageModelV4({
    doGenerate: async () => next(),
    doStream: async () => ({ stream: convertArrayToReadableStream(streamOf(next())) }),
  });
}

export function failingModel(error: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw error;
    },
    doStream: async () => {
      throw error;
    },
  });
}

export function handleFor(model: MockLanguageModelV4, tools = true): AiHandle {
  return { provider: 'mock', modelId: () => 'mock-model', model: () => model, tools };
}

export function testOrchestrator(
  overrides: Partial<ConstructorParameters<typeof Orchestrator>[0]> = {},
) {
  const store = new MemoryRunStore();
  const orchestrator = new Orchestrator({
    store,
    budget: { runTokens: 50_000, tenantDailyTokens: 1_000_000 },
    sleep: async () => {},
    ...overrides,
  });
  return { store, orchestrator };
}
