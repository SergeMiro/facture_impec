// The chasing half of a scenario (plan §11 M5): each step on its own business day with the outcome the
// fixture names, the e-mails the customer received, never a formal notice, and a plan the payment ended.
import { addDays, ChaseStep, parisToday } from '@fi/core';
import { z } from 'zod';
import type { ChaseExpectation } from './scenario';

export const ChaseView = z.object({ steps: z.array(ChaseStep) }).nullable();

export const OutboxMail = z.object({
  to: z.string(),
  subject: z.string(),
  text: z.string(),
  at: z.string(),
});
export type OutboxMail = z.infer<typeof OutboxMail>;

export interface ChasedInvoice {
  number: string;
  dueDate: string;
  events: { type: string; event: string | null; actor: string; at: string; payload: unknown }[];
  chase: z.infer<typeof ChaseView>;
}

const Note = z.object({
  offset: z.number(),
  kind: z.string(),
  status: z.string(),
  reason: z.string().nullable(),
  by: z.string().nullable(),
});

const OPEN = ['pending', 'drafted', 'sending'];

const paris = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'short',
    timeStyle: 'short',
  });

export const planEnded = (chase: ChasedInvoice['chase']) =>
  chase !== null && !chase.steps.some((s) => OPEN.includes(s.status));

/** The invoice's chasing against the fixture: returns the report lines and the failures. */
export function checkChase(
  invoice: ChasedInvoice,
  want: ChaseExpectation,
  outbox: OutboxMail[],
): { lines: string[]; failures: string[] } {
  const lines: string[] = [];
  const failures: string[] = [];
  const fail = (message: string) => failures.push(`${invoice.number}: ${message}`);
  const notes = invoice.events.flatMap((e) => {
    if (e.type !== 'note' || e.event !== 'chase') return [];
    const parsed = Note.safeParse(e.payload);
    return parsed.success ? [{ ...parsed.data, at: e.at, actor: e.actor }] : [];
  });

  for (const step of want.steps) {
    const label = `J${step.offset < 0 ? '' : '+'}${step.offset}`;
    const day = addDays(invoice.dueDate, step.offset);
    const done = notes.find(
      (n) =>
        n.offset === step.offset &&
        n.status === step.status &&
        (step.reason === undefined || n.reason === step.reason),
    );
    if (!done) {
      const seen = notes.filter((n) => n.offset === step.offset);
      fail(
        `${label}: expected ${step.status}${step.reason ? ` (${step.reason})` : ''}, saw ${
          seen.map((n) => `${n.status}${n.reason ? `/${n.reason}` : ''}`).join(', ') || 'nothing'
        }`,
      );
      continue;
    }
    lines.push(
      `${label.padEnd(5)} ${done.kind.padEnd(13)} ${done.status}${done.by ? ` by ${done.by}` : ''}${
        done.reason ? ` (${done.reason})` : ''
      } — ${paris(done.at)}`,
    );
    if (parisToday(new Date(done.at)) !== day) {
      fail(`${label}: ${done.status} on ${parisToday(new Date(done.at))}, expected ${day}`);
    }
    if (step.status === 'sent' && done.by !== 'agent') fail(`${label}: sent by ${done.by}`);
  }

  const mails = outbox.filter(
    (m) => m.to === want.customerEmail && m.subject.includes(invoice.number),
  );
  if (mails.length !== want.mails) {
    fail(`${mails.length} e-mail(s) to the customer, expected ${want.mails}`);
  }
  if (mails.some((m) => /mise en demeure/i.test(`${m.subject}\n${m.text}`))) {
    fail('a formal notice was e-mailed: it must stay a draft');
  }
  const sentDays = new Set(
    want.steps.filter((s) => s.status === 'sent').map((s) => addDays(invoice.dueDate, s.offset)),
  );
  for (const m of mails) {
    const day = parisToday(new Date(m.at));
    if (!sentDays.has(day)) fail(`an e-mail went out on ${day}, a day without a step to send`);
  }
  if (!planEnded(invoice.chase)) fail('the chasing plan did not end with the payment');
  return { lines, failures };
}
