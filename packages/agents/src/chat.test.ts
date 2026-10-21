import {
  convertArrayToReadableStream,
  convertReadableStreamToArray,
  MockLanguageModelV4,
} from 'ai/test';
import { describe, expect, it } from 'vitest';
import {
  answerChat,
  CHAT_PROMPT_HASH,
  type ChatMessage,
  type ChatReader,
  chatAgent,
  maskPrompt,
  openingMessage,
  pseudonymizing,
  readConversation,
  recentMessages,
  unmaskStream,
} from './chat';
import { Pseudonymizer } from './pseudonymize';
import { failingModel, handleFor, mockModel, textResult, toolCallResult } from './test-model';

const FINDING_ID = '0b8f0c4e-3d1a-4f7e-9a51-1c2d3e4f5a6b';

const reader = (calls: string[] = []): ChatReader => ({
  finding: async () => {
    calls.push('finding');
    return {
      id: FINDING_ID,
      message: 'Facture F-12 à Boulangerie Martin SARL : 30 € au lieu de 40 € commandés.',
      amount: 10_000,
      fix: { sheet: 'Factures', cell: 'D2', before: '30', after: '40' },
    };
  },
  document: async (docId) => {
    calls.push(`document:${docId}`);
    return docId === 'doc-1' ? { number: 'F-12', partyName: 'Boulangerie Martin SARL' } : null;
  },
  itemHistory: async (itemId) => {
    calls.push(`itemHistory:${itemId}`);
    return [{ number: 'F-08', netPrice: '40' }];
  },
});

describe('the boundary', () => {
  it('masks user text and tool results, never ids or our instructions', () => {
    const p = new Pseudonymizer().protect('PARTY', 'Boulangerie Martin');
    const masked = maskPrompt(p, [
      { role: 'system', content: 'Keep {{PARTY_1}} as written.' },
      { role: 'user', content: [{ type: 'text', text: 'Pourquoi Boulangerie Martin ?' }] },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'finding',
            output: {
              type: 'json',
              value: {
                findingId: '123 456 789',
                partyName: 'Boulangerie Martin',
                siren: '123 456 789',
              },
            },
          },
        ],
      },
    ]);
    expect(masked[0]).toEqual({ role: 'system', content: 'Keep {{PARTY_1}} as written.' });
    expect(JSON.stringify(masked[1])).toContain('Pourquoi {{PARTY_1}} ?');
    const result = JSON.stringify(masked[2]);
    expect(result).toContain('"findingId":"123 456 789"');
    expect(result).toContain('"partyName":"{{PARTY_1}}"');
    expect(result).toContain('"siren":"{{SIREN_1}}"');
    expect(result).not.toContain('Boulangerie');
  });

  it('the model sees tokens; the answer and tool inputs come back readable', async () => {
    const p = new Pseudonymizer().protect('PARTY', 'Boulangerie "Le Fournil"');
    let seen = '';
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        seen = JSON.stringify(options.prompt);
        return {
          ...textResult('Votre client {{PARTY_1}} a commandé à 40 €.'),
          content: [
            { type: 'text', text: 'Votre client {{PARTY_1}} a commandé à 40 €.' },
            {
              type: 'tool-call',
              toolCallId: 'c1',
              toolName: 'itemHistory',
              input: '{"itemId":"{{PARTY_1}}"}',
            },
          ],
        };
      },
    });
    const middleware = pseudonymizing(p);
    const params = await middleware.transformParams?.({
      type: 'generate',
      model,
      params: {
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Et Boulangerie "Le Fournil" ?' }] },
        ],
      },
    });
    expect(JSON.stringify(params?.prompt)).toContain('{{PARTY_1}}');
    const result = await middleware.wrapGenerate?.({
      model,
      params: params ?? { prompt: [] },
      doGenerate: () => model.doGenerate(params ?? { prompt: [] }),
      doStream: () => model.doStream(params ?? { prompt: [] }),
    });
    expect(seen).not.toContain('Fournil');
    expect(result?.content[0]).toMatchObject({
      text: 'Votre client Boulangerie "Le Fournil" a commandé à 40 €.',
    });
    const call = result?.content[1];
    expect(call?.type === 'tool-call' && JSON.parse(call.input)).toEqual({
      itemId: 'Boulangerie "Le Fournil"',
    });
  });

  it('a token cut between two deltas is held until it is whole', async () => {
    const p = new Pseudonymizer();
    p.token('PARTY', 'Martin SARL');
    const parts = await convertReadableStreamToArray(
      convertArrayToReadableStream([
        { type: 'text-start' as const, id: 't' },
        { type: 'text-delta' as const, id: 't', delta: 'Client {' },
        { type: 'text-delta' as const, id: 't', delta: '{PAR' },
        { type: 'text-delta' as const, id: 't', delta: 'TY_1}' },
        { type: 'text-delta' as const, id: 't', delta: '} : 40 € {' },
        { type: 'text-end' as const, id: 't' },
      ]).pipeThrough(unmaskStream(p)),
    );
    const text = parts.map((x) => (x.type === 'text-delta' ? x.delta : '')).join('');
    expect(text).toBe('Client Martin SARL : 40 € {');
    expect(parts.at(-1)).toEqual({ type: 'text-end', id: 't' });
    // Nothing that is not a token waits: a lone brace leaves at the end of the text.
    expect(parts.filter((x) => x.type === 'text-delta').map((x) => x.delta)).toEqual([
      'Client ',
      'Martin SARL : 40 € ',
      '{',
    ]);
  });
});

describe('the chat agent', () => {
  it('reads through its tools, then leaves proposeFix to the pane', async () => {
    const calls: string[] = [];
    const model = mockModel(toolCallResult('finding', {}), toolCallResult('proposeFix', {}));
    let used = 0;
    const agent = chatAgent({
      ai: handleFor(model),
      reader: reader(calls),
      p: new Pseudonymizer().protect('PARTY', 'Boulangerie Martin SARL'),
      onEnd: (u) => {
        used = u.inputTokens + u.outputTokens;
      },
    });
    const result = await agent.generate({
      messages: [{ role: 'user', content: 'Corrigez-la, s’il vous plaît.' }],
    });
    expect(calls).toEqual(['finding']);
    // The finding the model read carried the customer's name as a token only.
    const second = JSON.stringify(model.doGenerateCalls[1]?.prompt);
    expect(second).toContain('{{PARTY_1}}');
    expect(second).not.toContain('Boulangerie');
    const last = result.steps.at(-1);
    expect(last?.toolCalls).toEqual([
      expect.objectContaining({ toolName: 'proposeFix', input: {} }),
    ]);
    expect(last?.toolResults).toEqual([]);
    expect(result.steps).toHaveLength(2);
    expect(used).toBe(200);
  });

  it('a document it asks for that is not there is said so, not invented', async () => {
    const calls: string[] = [];
    const model = mockModel(
      toolCallResult('document', { docId: 'nope' }),
      textResult('Je ne trouve pas ce document.'),
    );
    const agent = chatAgent({
      ai: handleFor(model),
      reader: reader(calls),
      p: new Pseudonymizer(),
    });
    const result = await agent.generate({ messages: [{ role: 'user', content: 'La commande ?' }] });
    expect(calls).toEqual(['document:nope']);
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain('not_found');
    expect(result.text).toBe('Je ne trouve pas ce document.');
  });

  it('identifies its prompt and tools for the eval', () => {
    expect(CHAT_PROMPT_HASH).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('the conversation the pane sends', () => {
  const question = (id: string, text: string): ChatMessage => ({
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
  });

  it('is read against the tools, and garbage is not a conversation', async () => {
    const opening = openingMessage({ id: FINDING_ID }, 'Il manque 100,00 €.');
    expect(await readConversation([opening, question('q1', 'Pourquoi ?')])).toHaveLength(2);
    expect(await readConversation([{ id: 'x', role: 'robot', parts: [] }])).toBeNull();
    expect(
      await readConversation([
        {
          id: 'a',
          role: 'assistant',
          parts: [
            {
              type: 'tool-proposeFix',
              toolCallId: 'c',
              state: 'output-available',
              input: {},
              output: { status: 'nope' },
            },
          ],
        },
      ]),
    ).toBeNull();
  });

  it('sends the opening and the latest questions; older ones stay stored', () => {
    const opening = { id: 'opening', role: 'assistant' as const };
    const turns = Array.from({ length: 12 }, (_, i) => [
      { id: `q${i}`, role: 'user' as const },
      { id: `a${i}`, role: 'assistant' as const },
    ]).flat();
    const sent = recentMessages([opening, ...turns], 3);
    expect(sent.map((m) => m.id)).toEqual(['opening', 'q9', 'a9', 'q10', 'a10', 'q11', 'a11']);
    expect(recentMessages([opening, ...turns.slice(0, 4)], 3).map((m) => m.id)).toEqual([
      'opening',
      'q0',
      'a0',
      'q1',
      'a1',
    ]);
  });

  it('streams the answer, then hands the whole conversation back to be kept', async () => {
    const model = mockModel(textResult('Votre client {{PARTY_1}} avait commandé à 40 €.'));
    const kept: ChatMessage[][] = [];
    let used = 0;
    const opening = openingMessage({ id: FINDING_ID }, 'Il manque 100,00 €.') as ChatMessage;
    const response = await answerChat({
      ai: handleFor(model),
      reader: reader(),
      p: new Pseudonymizer().protect('PARTY', 'Boulangerie Martin SARL'),
      messages: [opening, question('q1', 'Pourquoi Boulangerie Martin SARL ?')],
      onEnd: (u) => {
        used = u.inputTokens + u.outputTokens;
      },
      onMessages: async (all) => {
        kept.push(all);
      },
      onError: () => 'erreur',
    });
    const body = await response.text();
    expect(body).toContain('Boulangerie Martin SARL avait commandé à 40 €.');
    expect(body).not.toContain('{{PARTY_1}}');
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).not.toContain('Boulangerie');
    expect(used).toBe(150);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant']);
    expect(JSON.stringify(kept[0]?.at(-1))).toContain('Boulangerie Martin SARL avait commandé');
  });

  it('a failed answer shows the calm text, never the error', async () => {
    const response = await answerChat({
      ai: handleFor(failingModel(new Error('upstream said: secret prompt'))),
      reader: reader(),
      p: new Pseudonymizer(),
      messages: [question('q1', 'Pourquoi ?')],
      onMessages: async () => {},
      onError: () => 'L’assistant n’a pas pu répondre.',
    });
    const body = await response.text();
    expect(body).toContain('L’assistant n’a pas pu répondre.');
    expect(body).not.toContain('secret');
  });
});
