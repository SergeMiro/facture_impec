// The pane's chat about one finding (R8): the ChatAgent reads the finding, the documents behind it and
// an article's earlier prices through the reader here, and asks the pane for « Avant → Après » cards
// (proposeFix, undoEdit) that the person clicks. One conversation per finding, kept with it; the model
// sees the names of the company and its customers only as tokens.
import {
  answerChat,
  CHAT_PROMPT_HASH,
  type ChatMessage,
  type ChatReader,
  openingMessage,
  Pseudonymizer,
  type RunRecord,
  readConversation,
  type Usage,
} from '@fi/agents';
import {
  and,
  asc,
  audit,
  chats,
  type DbOrTx,
  desc,
  docLines,
  docs,
  eq,
  type FindingRow,
  findings,
  inArray,
  invoices,
  type TenantRow,
} from '@fi/db';
import { t } from '@fi/shared';
import { z } from 'zod';
import { tenantAi } from './ai';
import { findingView, placesOf } from './checks';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { EDITABLE } from './invoices';
import { logLine } from './log';

export const ChatBody = z.object({
  /** The finding the conversation is about. */
  id: z.uuid(),
  /** The whole conversation as the pane has it, the new question (or a card's answer) last. */
  messages: z.array(z.unknown()).min(1).max(200),
});
export type ChatBody = z.infer<typeof ChatBody>;

async function ownFinding(db: DbOrTx, tenant: TenantRow, id: string): Promise<FindingRow> {
  const [row] = await db
    .select()
    .from(findings)
    .where(and(eq(findings.id, id), eq(findings.tenantId, tenant.id)));
  if (!row) throw new ApiError(404, 'finding_not_found');
  return row;
}

/** The finding as the agent reads it: what the pane shows, plus whether its invoice already left. */
async function chatFinding(db: DbOrTx, row: FindingRow) {
  const places = await placesOf(db, [row.docId, ...row.evidence.map((e) => e.docId)]);
  const view = findingView(row, places);
  const [invoice] = row.invoiceId
    ? await db
        .select({ number: invoices.number, issueDate: invoices.issueDate, status: invoices.status })
        .from(invoices)
        .where(eq(invoices.id, row.invoiceId))
    : [];
  // « Factures!K2 », as the person reads it in Excel; evidence cells already carry their sheet.
  const at = (sheet: string | null, cell: string | null) =>
    cell && sheet && !cell.includes('!') ? `${sheet}!${cell}` : cell;
  return {
    id: row.id,
    rule: row.rule,
    severity: row.severity,
    status: row.status,
    message: view.message,
    amount: row.amount,
    invoice: invoice
      ? {
          number: invoice.number,
          issueDate: invoice.issueDate,
          sent: !EDITABLE.includes(invoice.status),
        }
      : null,
    evidence: view.evidence.map((e) => ({
      role: e.role,
      docId: e.docId,
      number: e.number,
      cell: at(e.sheet, e.cell),
    })),
    fix: view.fix
      ? {
          cell: at(view.fix.sheet, view.fix.cell),
          field: view.fix.field,
          before: view.fix.before,
          after: view.fix.after,
        }
      : null,
  };
}

const isUuid = (value: string) => z.uuid().safeParse(value).success;

/** What the agent's read tools see: this tenant's documents only, real or test like the finding. */
function readerFor(db: DbOrTx, tenant: TenantRow, row: FindingRow, p: Pseudonymizer): ChatReader {
  return {
    finding: async () => chatFinding(db, await ownFinding(db, tenant, row.id)),
    document: async (docId) => {
      if (!isUuid(docId)) return null;
      const [doc] = await db
        .select()
        .from(docs)
        .where(and(eq(docs.id, docId), eq(docs.tenantId, tenant.id)));
      if (!doc) return null;
      p.protect('PARTY', doc.partyName ?? undefined);
      const lines = await db
        .select()
        .from(docLines)
        .where(eq(docLines.docId, doc.id))
        .orderBy(asc(docLines.position));
      return {
        kind: doc.kind,
        number: doc.number,
        issueDate: doc.issueDate,
        partyName: doc.partyName,
        partySiren: doc.partySiren,
        orderRef: doc.orderRef,
        netTotal: doc.netTotal,
        lines: lines.map((l) => ({
          position: l.position,
          itemId: l.itemId,
          name: l.name,
          quantity: l.quantity,
          unitCode: l.unitCode,
          netPrice: l.netPrice,
          netAmount: l.netAmount,
        })),
      };
    },
    itemHistory: async (itemId) => {
      if (!isUuid(itemId)) return [];
      return db
        .select({
          kind: docs.kind,
          number: docs.number,
          issueDate: docs.issueDate,
          quantity: docLines.quantity,
          netPrice: docLines.netPrice,
        })
        .from(docLines)
        .innerJoin(docs, eq(docs.id, docLines.docId))
        .where(
          and(
            eq(docLines.tenantId, tenant.id),
            eq(docLines.itemId, itemId),
            eq(docs.isTest, row.isTest),
          ),
        )
        .orderBy(desc(docs.issueDate))
        .limit(20);
    },
  };
}

/** The names the model must not read: the company's own, and those of the documents in question. */
async function pseudonymizerFor(db: DbOrTx, tenant: TenantRow, row: FindingRow) {
  const p = new Pseudonymizer().protect('PARTY', tenant.name);
  const ids = [row.docId, ...row.evidence.map((e) => e.docId)];
  const named = await db
    .select({ name: docs.partyName })
    .from(docs)
    .where(inArray(docs.id, [...new Set(ids)]));
  for (const { name } of named) p.protect('PARTY', name ?? undefined);
  return p;
}

/** The conversation kept for the finding, or its opening: the finding's own wording, already read. */
export async function chatView(deps: Pick<ApiDeps, 'db' | 'ai'>, tenant: TenantRow, id: string) {
  const row = await ownFinding(deps.db, tenant, id);
  const [kept] = await deps.db.select().from(chats).where(eq(chats.findingId, row.id));
  const finding = await chatFinding(deps.db, row);
  return {
    /** False when the assistant is off, or its model calls no tools: « Corriger pour moi » stays. */
    available: tenantAi(deps.ai, tenant)?.tools === true,
    messages: kept?.messages.length ? kept.messages : [openingMessage(finding, finding.message)],
  };
}

/**
 * One answer, streamed as the pane's Chat reads it. The opening is read again from the finding (the
 * pane's copy may be old); the conversation with the answer is kept once it ends; the run is
 * recorded in agent_runs like the background agents', without taking their slots.
 */
export async function answerFinding(
  deps: ApiDeps,
  tenant: TenantRow,
  input: ChatBody,
  signal?: AbortSignal,
): Promise<Response> {
  const row = await ownFinding(deps.db, tenant, input.id);
  const ai = tenantAi(deps.ai, tenant);
  if (!ai?.tools) throw new ApiError(409, 'chat_unavailable');
  const messages = await readConversation(input.messages);
  if (!messages) {
    throw new ApiError(400, 'invalid_request', undefined, 'messages are not a conversation');
  }
  const startedAt = deps.now().toISOString();
  const run = (status: RunRecord['status'], usage: Usage, error: string | null): RunRecord => ({
    tenantId: tenant.id,
    invoiceId: row.invoiceId,
    agent: 'chat',
    provider: ai.provider,
    model: ai.modelId('agent'),
    promptHash: CHAT_PROMPT_HASH,
    status,
    reason: status === 'ok' ? null : status === 'failed' ? 'error' : 'daily_budget',
    attempts: 1,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    error,
    startedAt,
    finishedAt: deps.now().toISOString(),
  });
  const none = { inputTokens: 0, outputTokens: 0 };
  if ((await deps.ai.store.tokensToday(tenant.id)) >= deps.ai.budget.tenantDailyTokens) {
    await deps.ai.store.record(run('skipped', none, null));
    throw new ApiError(429, 'ai_budget');
  }

  const finding = await chatFinding(deps.db, row);
  const opening = openingMessage(finding, finding.message) as ChatMessage;
  const conversation = messages[0]?.id === opening.id ? [opening, ...messages.slice(1)] : messages;
  await deps.db.transaction((tx) =>
    audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'chat.ask',
      objectType: 'finding',
      objectId: row.id,
      after: { invoice: row.invoiceId, messages: conversation.length },
    }),
  );

  const p = await pseudonymizerFor(deps.db, tenant, row);
  let recorded = false;
  const record = async (status: RunRecord['status'], usage: Usage, error: string | null) => {
    if (recorded) return;
    recorded = true;
    await deps.ai.store.record(run(status, usage, error));
  };
  return answerChat({
    ai,
    reader: readerFor(deps.db, tenant, row, p),
    p,
    messages: conversation,
    ...(signal && { signal }),
    onEnd: (usage) => record('ok', usage, null),
    onMessages: async (all) => {
      const now = deps.now();
      await deps.db
        .insert(chats)
        .values({ findingId: row.id, tenantId: tenant.id, messages: all })
        .onConflictDoUpdate({ target: chats.findingId, set: { messages: all, updatedAt: now } });
    },
    onError: (error) => {
      // English and without the conversation: the provider's text may quote the prompt.
      const name = error instanceof Error ? error.name : 'error';
      record('failed', none, `chat failed: ${name}`).catch((e) =>
        logLine('error', 'chat run not recorded', { error: e }),
      );
      return t('api.error.chat_failed');
    },
  });
}
