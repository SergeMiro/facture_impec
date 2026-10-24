// Conversations for the ChatAgent eval (R8): « expliquer → corriger → annuler » on the plan's 300/400
// case, a correction asked on an invoice already sent, and one asked where no single cell corrects
// the finding. The fixture plays the pane: each proposeFix or undoEdit gets the answer the person's
// click and the checks would give.
import { t } from '@fi/shared';
import {
  convertToModelMessages,
  type LanguageModelMiddleware,
  type ModelMessage,
  type StaticToolCall,
  wrapLanguageModel,
} from 'ai';
import type { AiHandle } from '../src/ai';
import {
  type ChatReader,
  type ChatTools,
  chatAgent,
  type FixOutcome,
  openingMessage,
  type UndoOutcome,
} from '../src/chat';
import { Pseudonymizer } from '../src/pseudonymize';

export type ClientCall = { tool: 'proposeFix' } | { tool: 'undoEdit'; editId?: string };

export interface ChatTurn {
  say: string;
  /** The card the agent must show on this turn, or null when it must show none. */
  expect: ClientCall | null;
  /** The card may be left out: the agent can tell from the finding what its answer would be. */
  optional?: true;
  /** What the pane answers to that card. */
  answer?: FixOutcome | UndoOutcome;
  /** Words the last answer of the turn contains (lower case). */
  says?: string[];
}

export interface ChatFixture {
  name: string;
  /** The first message of the conversation: the finding's own wording. */
  opening: string;
  finding: Record<string, unknown>;
  documents: Record<string, Record<string, unknown>>;
  history: Record<string, unknown[]>;
  parties: string[];
  turns: ChatTurn[];
}

const ORDER = 'd-order-c118';
const INVOICE = 'd-invoice-f042';

const chairs = (number: string, price: string, amount: number) => ({
  kind: 'invoice',
  number,
  issueDate: '2026-09-15',
  partyName: 'Menuiserie Dubois SARL',
  netTotal: amount,
  lines: [
    {
      position: 1,
      itemId: 'CHAISE',
      name: 'Chaise',
      quantity: '10',
      netPrice: price,
      netAmount: amount,
    },
  ],
});

const order = {
  kind: 'order',
  number: 'C-118',
  issueDate: '2026-09-01',
  partyName: 'Menuiserie Dubois SARL',
  netTotal: 40_000,
  lines: [
    {
      position: 1,
      itemId: 'CHAISE',
      name: 'Chaise',
      quantity: '10',
      netPrice: '40',
      netAmount: 40_000,
    },
  ],
};

const B1_MESSAGE =
  'La facture F-2026-042 facture 10 « Chaise » pour 300,00 €, alors que la commande C-118 prévoyait 400,00 € : il manque 100,00 €.';

const finding300 = (id: string, sent: boolean) => ({
  id,
  rule: 'B1',
  severity: 'blocking',
  status: 'open',
  message: B1_MESSAGE,
  amount: 10_000,
  invoice: { number: 'F-2026-042', issueDate: '2026-09-15', sent },
  evidence: [
    { role: 'subject', docId: INVOICE, number: 'F-2026-042', cell: 'Factures!D2' },
    { role: 'order', docId: ORDER, number: 'C-118', cell: 'Commandes!D2' },
  ],
  fix: { cell: 'Factures!D2', field: 'price', before: '30', after: '40' },
});

const MAIN_ID = 'f0e1d2c3-b4a5-4697-8879-6a5b4c3d2e1f';
const MAIN_EDIT = 'e1d2c3b4-a5f6-4788-9a0b-1c2d3e4f5a6b';
const SENT_ID = 'a1b2c3d4-e5f6-4071-8293-a4b5c6d7e8f9';
const NOFIX_ID = 'c9d8e7f6-a5b4-4c3d-8e2f-1a0b9c8d7e6f';

export const CHAT_FIXTURES: ChatFixture[] = [
  {
    name: '300-400',
    opening: B1_MESSAGE,
    finding: finding300(MAIN_ID, false),
    documents: { [INVOICE]: chairs('F-2026-042', '30', 30_000), [ORDER]: order },
    history: {
      CHAISE: [{ kind: 'order', number: 'C-118', issueDate: '2026-09-01', netPrice: '40' }],
    },
    parties: ['Menuiserie Dubois SARL'],
    turns: [
      { say: 'Pourquoi ? Je ne comprends pas.', expect: null, says: ['40'] },
      {
        say: 'D’accord, corrigez la facture pour moi.',
        expect: { tool: 'proposeFix' },
        answer: { status: 'applied', editId: MAIN_EDIT, resolved: true, remaining: [] },
        says: ['corrig'],
      },
      {
        say: 'En fait non, annulez cette correction.',
        expect: { tool: 'undoEdit', editId: MAIN_EDIT },
        answer: { status: 'reverted', editId: MAIN_EDIT, resolved: false },
      },
    ],
  },
  {
    name: 'sent-invoice',
    opening: B1_MESSAGE,
    finding: finding300(SENT_ID, true),
    documents: { [INVOICE]: chairs('F-2026-042', '30', 30_000), [ORDER]: order },
    history: {},
    parties: ['Menuiserie Dubois SARL'],
    turns: [
      {
        say: 'Corrigez le prix sur la facture.',
        expect: { tool: 'proposeFix' },
        optional: true,
        answer: {
          status: 'refused',
          editId: null,
          // What the API answers (api.error.invoice_sent).
          message: t('api.error.invoice_sent', {
            number: 'F-2026-042',
            date: '15/09/2026',
            amount: '100,00 €',
          }),
        },
        says: ['avoir'],
      },
    ],
  },
  {
    name: 'no-fix',
    opening: 'La facture F-2026-050 cite la commande C-999, qu’aucune de vos feuilles ne contient.',
    finding: {
      id: NOFIX_ID,
      rule: 'A3',
      severity: 'warning',
      status: 'open',
      message:
        'La facture F-2026-050 cite la commande C-999, qu’aucune de vos feuilles ne contient.',
      amount: null,
      invoice: { number: 'F-2026-050', issueDate: '2026-10-02', sent: false },
      evidence: [
        { role: 'subject', docId: 'd-invoice-f050', number: 'F-2026-050', cell: 'Factures!F7' },
      ],
      fix: null,
    },
    documents: {},
    history: {},
    parties: ['Menuiserie Dubois SARL'],
    turns: [{ say: 'Corrigez-le pour moi.', expect: null, says: ['f7'] }],
  },
];

function readerOf(f: ChatFixture): ChatReader {
  return {
    finding: async () => f.finding,
    document: async (docId) => f.documents[docId] ?? null,
    itemHistory: async (itemId) => f.history[itemId] ?? [],
  };
}

const CLIENT = new Set(['proposeFix', 'undoEdit']);
type Call = StaticToolCall<ChatTools>;

function asClientCall(c: Call): ClientCall | null {
  if (c.toolName === 'proposeFix') return { tool: 'proposeFix' };
  if (c.toolName === 'undoEdit') {
    return { tool: 'undoEdit', ...(c.input.editId !== undefined && { editId: c.input.editId }) };
  }
  return null;
}

/** The card shown is the one expected; an undo without its editId means the last correction. */
function sameCall(expected: ClientCall, shown: ClientCall): boolean {
  if (expected.tool !== shown.tool) return false;
  if (expected.tool === 'undoEdit' && shown.tool === 'undoEdit') {
    return shown.editId === undefined || shown.editId === expected.editId;
  }
  return true;
}

export interface TurnScore {
  fixture: string;
  turn: number;
  ok: boolean;
  why: string[];
}

/** Document numbers (« C-118 », « F-2026-042 ») the answer cites that none of the data holds. */
function invented(text: string, f: ChatFixture): string[] {
  const known = JSON.stringify([f.finding, f.documents, f.history, f.turns]);
  return [...text.matchAll(/\b[A-Z]{1,3}-\d[\d-]*\d\b/g)]
    .map((m) => m[0])
    .filter((n) => !known.includes(n));
}

/** Plays a fixture's conversation through the agent and scores each turn. */
export async function playChat(f: ChatFixture, ai: AiHandle): Promise<TurnScore[]> {
  const p = new Pseudonymizer();
  for (const name of f.parties) p.protect('PARTY', name);
  const agent = chatAgent({ ai, reader: readerOf(f), p });
  const messages: ModelMessage[] = await convertToModelMessages([
    openingMessage(f.finding, f.opening),
  ]);
  const scores: TurnScore[] = [];
  for (const [i, turn] of f.turns.entries()) {
    const why: string[] = [];
    messages.push({ role: 'user', content: turn.say });
    const shown: ClientCall[] = [];
    let text = '';
    // The answer, then once more when the pane answered a card: the agent says what came of it.
    for (let round = 0; round < 2; round++) {
      const result = await agent.generate({ messages });
      messages.push(...result.response.messages);
      text = result.text;
      const pending = (result.steps.at(-1)?.toolCalls ?? []).filter((c) => CLIENT.has(c.toolName));
      if (pending.length === 0) break;
      shown.push(...pending.flatMap((c) => asClientCall(c as Call) ?? []));
      const answer: FixOutcome | UndoOutcome = turn.answer ?? { status: 'declined', editId: null };
      messages.push({
        role: 'tool',
        content: pending.map((c) => ({
          type: 'tool-result' as const,
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          output: { type: 'json' as const, value: answer },
        })),
      });
    }
    const expected = turn.expect;
    if (expected === null && shown.length > 0)
      why.push(`card not asked for: ${JSON.stringify(shown)}`);
    const right = expected && shown.length === 1 && shown[0] && sameCall(expected, shown[0]);
    if (expected && !right && !(turn.optional && shown.length === 0)) {
      why.push(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(shown)}`);
    }
    const lower = text.toLowerCase();
    for (const w of turn.says ?? []) if (!lower.includes(w)) why.push(`does not say « ${w} »`);
    if (/\{\{[A-Z]+_\d+\}\}/.test(text)) why.push('a token the pseudonymizer never issued');
    for (const n of invented(text, f)) why.push(`a document number no tool gave: ${n}`);
    if (text.trim() === '') why.push('no text');
    scores.push({ fixture: f.name, turn: i, ok: why.length === 0, why });
  }
  return scores;
}

/** The model's raw answers (masked, as the model wrote them), for a recording. */
export type RawAnswer = Awaited<ReturnType<NonNullable<LanguageModelMiddleware['wrapGenerate']>>>;

/** Wraps a model so every raw answer is kept: the record script saves them, the replay plays them. */
export function recording(ai: AiHandle, into: unknown[]): AiHandle {
  const middleware: LanguageModelMiddleware = {
    specificationVersion: 'v4',
    wrapGenerate: async ({ doGenerate }) => {
      const r = await doGenerate();
      into.push({ content: r.content, finishReason: r.finishReason, usage: r.usage, warnings: [] });
      return r;
    },
  };
  return {
    ...ai,
    model: (role) => {
      const model = ai.model(role);
      if (typeof model === 'string') throw new Error('The chat needs a model instance, not an id');
      return wrapLanguageModel({ model, middleware });
    },
  };
}
