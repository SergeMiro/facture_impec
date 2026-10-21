// ChatAgent (R8): the conversation the pane opens on one finding. The person asks « pourquoi ? » and
// the agent answers from the registry through read tools; asked to correct, it calls proposeFix and
// the code builds the correction from the finding (one cell, before → after): the model never writes
// a value. proposeFix and undoEdit have no execute: the pane shows the « Avant → Après » card, the
// person's click writes the cell, and the tool result says what the checks found afterwards.
//
// Personal data never reaches the model: the middleware masks every call's prompt (the history is
// stored readable and masked again on each turn) and unmasks the answer, the stream included.
import {
  createAgentUIStreamResponse,
  type InferUITools,
  type LanguageModelMiddleware,
  safeValidateUIMessages,
  stepCountIs,
  ToolLoopAgent,
  tool,
  type UIDataTypes,
  type UIMessage,
  wrapLanguageModel,
} from 'ai';
import { z } from 'zod';
import type { AiHandle } from './ai';
import { promptHash, readPrompt, type Usage } from './llm';
import type { Pseudonymizer } from './pseudonymize';

/** What the server-side tools read, for this tenant only. */
export interface ChatReader {
  /** The finding the conversation is about, as the pane shows it. */
  finding(): Promise<unknown>;
  /** One document of the registry, or null. */
  document(docId: string): Promise<unknown>;
  /** The prices an article had on earlier documents, newest first. */
  itemHistory(itemId: string): Promise<unknown>;
}

/** What the pane answers to proposeFix, once the person clicked (or the server refused). */
export const FixOutcome = z.object({
  status: z.enum(['applied', 'declined', 'conflict', 'refused']),
  editId: z.string().nullable(),
  /** The checks ran again: the finding is closed. */
  resolved: z.boolean().optional(),
  /** What the checks still find on the invoice. */
  remaining: z.array(z.string()).optional(),
  /** Why it was refused or what the cell held, in French. */
  message: z.string().optional(),
});
export type FixOutcome = z.infer<typeof FixOutcome>;

/** What the pane answers to undoEdit. */
export const UndoOutcome = z.object({
  status: z.enum(['reverted', 'declined', 'conflict', 'refused']),
  editId: z.string(),
  resolved: z.boolean().optional(),
  message: z.string().optional(),
});
export type UndoOutcome = z.infer<typeof UndoOutcome>;

const DESCRIPTIONS = {
  finding: 'The problem this conversation is about, with its documents and its correction (fix).',
  document: 'One document of the registry by its docId: number, date, lines, totals.',
  itemHistory: 'The prices an article had on earlier documents, by its itemId, newest first.',
  proposeFix:
    "Shows the person the « Avant → Après » card for this conversation's finding. Only when asked to correct and the finding has a fix.",
  undoEdit:
    'Shows the person the card that puts back what the cell held before a correction (editId from proposeFix; left out: the last one). Only when asked to undo.',
} as const;

const INPUTS = {
  finding: z.object({}),
  document: z.object({ docId: z.string() }),
  itemHistory: z.object({ itemId: z.string() }),
  // The conversation is about one finding: the model never has to copy its id.
  proposeFix: z.object({}),
  undoEdit: z.object({ editId: z.string().optional() }),
};

const SYSTEM = readPrompt('chat.md');
export const CHAT_PROMPT_HASH = promptHash(
  SYSTEM,
  z.object({ ...INPUTS, fix: FixOutcome, undo: UndoOutcome }),
  Object.entries(DESCRIPTIONS).map(([name, d]) => `${name}: ${d}`),
);

/** Model turns in one answer: a few reads, then the text or a card. */
export const CHAT_MAX_STEPS = 6;

export function chatTools(reader: ChatReader) {
  return {
    finding: tool({
      description: DESCRIPTIONS.finding,
      inputSchema: INPUTS.finding,
      execute: () => reader.finding(),
    }),
    document: tool({
      description: DESCRIPTIONS.document,
      inputSchema: INPUTS.document,
      execute: async ({ docId }) => (await reader.document(docId)) ?? { error: 'not_found' },
    }),
    itemHistory: tool({
      description: DESCRIPTIONS.itemHistory,
      inputSchema: INPUTS.itemHistory,
      execute: ({ itemId }) => reader.itemHistory(itemId),
    }),
    // No execute: the pane runs them, after the person's click.
    proposeFix: tool({
      description: DESCRIPTIONS.proposeFix,
      inputSchema: INPUTS.proposeFix,
      outputSchema: FixOutcome,
    }),
    undoEdit: tool({
      description: DESCRIPTIONS.undoEdit,
      inputSchema: INPUTS.undoEdit,
      outputSchema: UndoOutcome,
    }),
  };
}
export type ChatTools = ReturnType<typeof chatTools>;
/** A message of the conversation, as the pane shows it and the API stores it. */
export type ChatMessage = UIMessage<unknown, UIDataTypes, InferUITools<ChatTools>>;

// ── The boundary: masked prompt in, readable answer out ────────────────────────────────────────

type Middleware = Required<Pick<LanguageModelMiddleware, 'transformParams' | 'wrapStream'>>;
type Params = Awaited<ReturnType<Middleware['transformParams']>>;
type StreamPart =
  Awaited<ReturnType<Middleware['wrapStream']>>['stream'] extends ReadableStream<infer P>
    ? P
    : never;

/** Keys whose strings are ours (ids, part types, tool names): never masked. */
const KEEP_KEYS = new Set(['type', 'role', 'toolCallId', 'toolName', 'mediaType', 'state']);
const PROVIDER_KEYS = new Set(['providerOptions', 'providerMetadata']);
const isIdKey = (key: string) => key === 'id' || key.endsWith('Id') || key.endsWith('Ids');

function maskValue(p: Pseudonymizer, value: unknown, key: string): unknown {
  if (PROVIDER_KEYS.has(key)) return value;
  if (typeof value === 'string') return KEEP_KEYS.has(key) || isIdKey(key) ? value : p.mask(value);
  if (value instanceof Uint8Array || value instanceof URL) return value;
  if (Array.isArray(value)) return value.map((v) => maskValue(p, v, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskValue(p, v, k)]));
  }
  return value;
}

/** Every message but our own instructions, masked. */
export function maskPrompt(p: Pseudonymizer, prompt: Params['prompt']): Params['prompt'] {
  return prompt.map((m) =>
    m.role === 'system' ? m : ({ ...m, content: maskValue(p, m.content, 'content') } as typeof m),
  );
}

/** A tool input is JSON text: tokens are replaced inside its strings, so quotes stay escaped. */
function unmaskJson(p: Pseudonymizer, input: string): string {
  try {
    return JSON.stringify(p.unmaskDeep(JSON.parse(input)).value);
  } catch {
    return p.unmask(input).text;
  }
}

/** The start of a token a later delta completes (`{`, `{{PAR`, `{{PARTY_1}`), held back until then. */
const PARTIAL_TOKEN = /\{(?:\{(?:[A-Z]+(?:_(?:\d+\}?)?)?)?)?$/;

const DELTA_OF = {
  'text-end': 'text-delta',
  'reasoning-end': 'reasoning-delta',
  'tool-input-end': 'tool-input-delta',
} as const;

/** Unmasks a model stream; a token cut between two deltas is held until it is whole. */
export function unmaskStream(p: Pseudonymizer): TransformStream<StreamPart, StreamPart> {
  const held = new Map<string, string>();
  const release = (id: string, delta: string, end: boolean) => {
    const text = (held.get(id) ?? '') + delta;
    const cut = end ? -1 : text.search(PARTIAL_TOKEN);
    if (cut < 0) held.delete(id);
    else held.set(id, text.slice(cut));
    return p.unmask(cut < 0 ? text : text.slice(0, cut)).text;
  };
  return new TransformStream({
    transform(part, controller) {
      switch (part.type) {
        case 'text-delta':
        case 'reasoning-delta':
        case 'tool-input-delta': {
          const delta = release(part.id, part.delta, false);
          if (delta) controller.enqueue({ ...part, delta });
          return;
        }
        case 'text-end':
        case 'reasoning-end':
        case 'tool-input-end': {
          const rest = release(part.id, '', true);
          if (rest) controller.enqueue({ type: DELTA_OF[part.type], id: part.id, delta: rest });
          controller.enqueue(part);
          return;
        }
        case 'tool-call':
          controller.enqueue({ ...part, input: unmaskJson(p, part.input) });
          return;
        default:
          controller.enqueue(part);
      }
    },
  });
}

/** Masks what goes to the model and unmasks what comes back, for generate and stream alike. */
export function pseudonymizing(p: Pseudonymizer): LanguageModelMiddleware {
  return {
    specificationVersion: 'v4',
    transformParams: async ({ params }) => ({ ...params, prompt: maskPrompt(p, params.prompt) }),
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate();
      return {
        ...result,
        content: result.content.map((c) => {
          switch (c.type) {
            case 'text':
            case 'reasoning':
              return { ...c, text: p.unmask(c.text).text };
            case 'tool-call':
              return { ...c, input: unmaskJson(p, c.input) };
            default:
              return c;
          }
        }),
      };
    },
    wrapStream: async ({ doStream }) => {
      const result = await doStream();
      return { ...result, stream: result.stream.pipeThrough(unmaskStream(p)) };
    },
  };
}

// ── The agent ──────────────────────────────────────────────────────────────────────────────────

export interface ChatSetup {
  ai: AiHandle;
  reader: ChatReader;
  /** Knows the conversation's personal values (the API declares the parties of the finding). */
  p: Pseudonymizer;
  /** Tokens the answer used, every step included. */
  onEnd?: (usage: Usage) => void | Promise<void>;
}

/**
 * The conversation's first message: the finding's own wording, with the finding already read for
 * the model, so the first answer rests on its data and not on the sentence alone. No model call.
 */
export function openingMessage(finding: unknown, text: string) {
  return {
    id: 'opening',
    role: 'assistant' as const,
    parts: [
      {
        type: 'tool-finding' as const,
        toolCallId: 'opening',
        state: 'output-available' as const,
        input: {},
        output: finding,
      },
      { type: 'text' as const, text },
    ],
  };
}

/** One conversation's agent: built per request, the history comes with the request. */
export function chatAgent(setup: ChatSetup) {
  const model = setup.ai.model('agent');
  if (typeof model === 'string') throw new Error('The chat needs a model instance, not an id');
  return new ToolLoopAgent({
    model: wrapLanguageModel({ model, middleware: pseudonymizing(setup.p) }),
    instructions: SYSTEM,
    tools: chatTools(setup.reader),
    stopWhen: stepCountIs(CHAT_MAX_STEPS),
    maxOutputTokens: 1200,
    temperature: 0,
    maxRetries: 1,
    onEnd: async ({ totalUsage }) => {
      await setup.onEnd?.({
        inputTokens: totalUsage.inputTokens ?? 0,
        outputTokens: totalUsage.outputTokens ?? 0,
      });
    },
  });
}

// ── One answer, as the pane receives it ────────────────────────────────────────────────────────

/** The tools' schemas: a conversation the pane sends back is checked against them. */
const SCHEMAS = {
  finding: { inputSchema: INPUTS.finding },
  document: { inputSchema: INPUTS.document },
  itemHistory: { inputSchema: INPUTS.itemHistory },
  proposeFix: { inputSchema: INPUTS.proposeFix, outputSchema: FixOutcome },
  undoEdit: { inputSchema: INPUTS.undoEdit, outputSchema: UndoOutcome },
};

/** The conversation as the pane sent it, or null when it is not one. */
export async function readConversation(raw: unknown): Promise<ChatMessage[] | null> {
  const result = await safeValidateUIMessages<ChatMessage>({ messages: raw, tools: SCHEMAS });
  return result.success ? result.data : null;
}

/** Exchanges the model reads back: the older ones stay stored and shown, not sent. */
export const CHAT_RECENT_TURNS = 10;

/** The opening (the finding as read) and the conversation from the last `turns` questions on. */
export function recentMessages<M extends Pick<UIMessage, 'id' | 'role'>>(
  messages: readonly M[],
  turns = CHAT_RECENT_TURNS,
): M[] {
  let cut = 0;
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user' && ++seen === turns) {
      cut = i;
      break;
    }
  }
  const first = messages[0];
  const head = cut > 0 && first?.id === 'opening' ? [first] : [];
  return [...head, ...messages.slice(cut)];
}

export interface ChatAnswer extends ChatSetup {
  /** The whole conversation, the person's new question (or the pane's tool output) last. */
  messages: ChatMessage[];
  signal?: AbortSignal;
  /** The conversation with the answer in it, once the answer ended: the API stores it. */
  onMessages(messages: ChatMessage[]): Promise<void>;
  /** The text the pane shows when the answer failed; never the error itself. */
  onError(error: unknown): string;
}

/** The agent's answer as a UI message stream (the pane reads it with `ai`'s Chat). */
export function answerChat(a: ChatAnswer): Promise<Response> {
  return createAgentUIStreamResponse({
    agent: chatAgent(a),
    uiMessages: recentMessages(a.messages),
    originalMessages: a.messages,
    ...(a.signal && { abortSignal: a.signal }),
    onEnd: ({ messages }) => a.onMessages(messages),
    onError: a.onError,
  });
}
