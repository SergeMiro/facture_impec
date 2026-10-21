// The pane's chat (R8), end to end with a scripted model: the conversation opens on the finding as
// read, the answer streams with the names of the company and its customer kept from the model, the
// conversation is kept with the finding, the run is recorded and audited; the chat stays off with AI
// off, stops at the day's budget, and reads nothing of another company.
import { CHAT_PROMPT_HASH, type ResolvedAi } from '@fi/agents';
import { handleFor, mockModel, textResult, toolCallResult } from '@fi/agents/testing';
import type { Database } from '@fi/db';
import { agentRuns, chats, eq, tenants } from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkNow } from './checks';
import { companies, invoiceRow, invoiceSheet, orders, SEP1 } from './checks.fixtures';
import { fakeAdapter, testAi, testApi, testDatabase, today } from './test-helpers';

const adapter = fakeAdapter({ lookupRecipient: async ({ siren }) => ({ siren }) });
const INCLUDED: ResolvedAi = {
  settings: {
    mode: 'included',
    provider: 'mistral',
    models: { agent: 'mock-agent', classify: 'mock-classify' },
  },
  apiKey: 'test',
};

let database: Database;
let withAi: ReturnType<typeof testApi>;
let withoutAi: ReturnType<typeof testApi>;
let model = mockModel(textResult('…'));
const clock = new Date(`${today()}T08:00:00Z`);

beforeAll(async () => {
  database = await testDatabase();
  withAi = testApi(database, { mock: adapter }, undefined, {
    now: () => clock,
    ai: testAi(database, {
      included: INCLUDED,
      handle: (resolved) => (resolved ? handleFor(model) : null),
      // One answer of the scripted model (250 tokens) uses up the day.
      budget: { runTokens: 50_000, tenantDailyTokens: 200 },
    }),
  });
  withoutAi = testApi(database, { mock: adapter }, undefined, { now: () => clock });
});
afterAll(async () => {
  await database.close();
});

interface Message {
  id: string;
  role: string;
  parts: Record<string, unknown>[];
}

async function example(api: ReturnType<typeof testApi>, workbook: string) {
  const c = await companies({ request: api.request, database })(workbook);
  await c.includeOrders(orders(['C-118', SEP1, 'Durand SARL', 'Chaise pliante', 10, 40]));
  await c.syncInvoices(invoiceSheet(invoiceRow('F-2026-042', 'C-118', 'Chaise pliante', 10, 30)));
  await checkNow(database.db, c.id, clock);
  const [finding] = (await c.checks()).findings;
  if (!finding) throw new Error('no finding');
  const ask = (messages: unknown[], id = finding.id) =>
    api.request('/chat', { method: 'POST', token: c.apiKey, body: { id, messages } });
  return { ...c, finding, ask };
}

const question = (id: string, text: string): Message => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
});

describe('the chat about a finding', () => {
  it('opens on the finding, answers in a stream without the names, and keeps the conversation', async () => {
    const c = await example(withAi, 'wb-chat-01');
    expect(((await c.call('/checks')) as { assistant: boolean }).assistant).toBe(true);
    const opened = (await c.call(`/findings/${c.finding.id}/chat`)) as {
      available: boolean;
      messages: Message[];
    };
    expect(opened.available).toBe(true);
    const [opening] = opened.messages;
    expect(opening?.id).toBe('opening');
    expect(opening?.parts[0]).toMatchObject({
      type: 'tool-finding',
      state: 'output-available',
      output: {
        id: c.finding.id,
        rule: 'B1',
        amount: 10_000,
        invoice: { number: 'F-2026-042', issueDate: '2026-09-10', sent: false },
        fix: { cell: 'Factures!K2', field: 'price', before: '30', after: '40' },
        evidence: expect.arrayContaining([
          expect.objectContaining({ role: 'order', number: 'C-118', cell: 'Commandes!D2' }),
        ]),
      },
    });
    expect(opening?.parts[1]).toEqual({ type: 'text', text: c.finding.message });

    model = mockModel(
      toolCallResult('finding', {}),
      textResult('La commande C-118 prévoyait 40 € par chaise.'),
    );
    const res = await c.ask([...opened.messages, question('q1', 'Pourquoi Durand SARL ?')]);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(await res.text()).toContain('La commande C-118 prévoyait 40 € par chaise.');

    // The model read the finding and the question, never the names.
    const [tenant] = await database.db.select().from(tenants).where(eq(tenants.id, c.id));
    const seen = JSON.stringify(model.doStreamCalls.map((call) => call.prompt));
    expect(seen).toContain('F-2026-042');
    expect(seen).not.toContain('Durand');
    expect(seen).not.toContain(tenant?.name);

    const [kept] = await database.db.select().from(chats).where(eq(chats.findingId, c.finding.id));
    expect(((kept?.messages ?? []) as Message[]).map((m) => m.role)).toEqual([
      'assistant',
      'user',
      'assistant',
    ]);
    const again = (await c.call(`/findings/${c.finding.id}/chat`)) as { messages: Message[] };
    expect(again.messages).toHaveLength(3);
    expect(JSON.stringify(again.messages.at(-1))).toContain('prévoyait 40 €');

    // The sheet's layout was read with AI on too: only the chat's runs here.
    const chatRuns = async () =>
      (await database.db.select().from(agentRuns).where(eq(agentRuns.tenantId, c.id))).filter(
        (r) => r.agent === 'chat',
      );
    expect(await chatRuns()).toEqual([
      expect.objectContaining({
        agent: 'chat',
        status: 'ok',
        promptHash: CHAT_PROMPT_HASH,
        inputTokens: 180,
        outputTokens: 70,
      }),
    ]);
    expect(await c.audits('chat.ask')).toHaveLength(1);

    // The day's tokens are spent: the next question waits for tomorrow.
    const spent = await c.ask([...again.messages, question('q2', 'Et ensuite ?')]);
    expect(spent.status).toBe(429);
    expect(((await spent.json()) as { error: { code: string } }).error.code).toBe('ai_budget');
    expect(await chatRuns()).toContainEqual(
      expect.objectContaining({ status: 'skipped', reason: 'daily_budget' }),
    );
  });

  it('exports the conversation with the account, and erases it with it', async () => {
    const c = await example(withAi, 'wb-chat-06');
    model = mockModel(textResult('La commande prévoyait 40 €.'));
    await (await c.ask([question('q1', 'Pourquoi ?')])).text();
    const data = (await c.call('/tenant/export')) as {
      registry: { findings: { id: string }[]; chats: { finding: string; messages: Message[] }[] };
    };
    expect(data.registry.chats).toEqual([
      { finding: c.finding.id, messages: expect.any(Array), updatedAt: expect.any(String) },
    ]);
    expect(data.registry.findings.map((f) => f.id)).toContain(c.finding.id);
    await c.call('/tenant', 'DELETE', { confirmSiren: '100000009' });
    expect(await database.db.select().from(chats).where(eq(chats.tenantId, c.id))).toEqual([]);
  });

  it('leaves the correction to the pane: the card is asked for, nothing is written here', async () => {
    const c = await example(withAi, 'wb-chat-02');
    model = mockModel(toolCallResult('proposeFix', {}));
    const res = await c.ask([question('q1', 'Corrigez-la pour moi.')]);
    const body = await res.text();
    expect(body).toContain('"toolName":"proposeFix"');
    expect(body).toContain('tool-input-available');
    expect(await c.audits('edit.propose')).toEqual([]);
  });

  it('refuses what is not a conversation, and a finding of another company', async () => {
    const c = await example(withAi, 'wb-chat-03');
    const garbage = await c.ask([{ id: 'x', role: 'robot', parts: [] }]);
    expect(garbage.status).toBe(400);
    const other = await companies({ request: withAi.request, database })('wb-chat-04');
    const foreign = await withAi.request('/chat', {
      method: 'POST',
      token: other.apiKey,
      body: { id: c.finding.id, messages: [question('q1', 'Pourquoi ?')] },
    });
    expect(foreign.status).toBe(404);
    expect(((await foreign.json()) as { error: { code: string } }).error.code).toBe(
      'finding_not_found',
    );
  });

  it('stays off when the assistant is', async () => {
    const c = await example(withoutAi, 'wb-chat-05');
    expect(((await c.call('/checks')) as { assistant: boolean }).assistant).toBe(false);
    const opened = (await c.call(`/findings/${c.finding.id}/chat`)) as { available: boolean };
    expect(opened.available).toBe(false);
    const res = await c.ask([question('q1', 'Pourquoi ?')]);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('chat_unavailable');
  });
});
