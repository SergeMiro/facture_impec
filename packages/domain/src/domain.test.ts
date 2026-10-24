import { describe, expect, it } from 'vitest';
import {
  ACTION_KINDS,
  ApprovalDecision,
  DOCUMENT_KINDS,
  DocumentEnvelope,
  FatalError,
  INVOICE_KINDS,
  isFatal,
  MAX_DOCUMENT_BYTES,
  OBLIGATION_KINDS,
  RetryableError,
} from './index';

const envelope = {
  tenantId: '0b5c6a1e-4a43-4c4f-9a6e-3b1a2f6c7d80',
  source: 'mail',
  sourceRef: '<CAF=abc@mail.example.fr>',
  receivedAt: '2026-10-24T08:15:00Z',
  name: 'Facture F-2026-118.pdf',
  mime: 'application/pdf',
  size: 184_331,
  storageKey: 'blob/0b5c6a1e/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  isTest: false,
};

describe('DocumentEnvelope', () => {
  it('reads an e-mail attachment, the hints defaulting to none', () => {
    expect(DocumentEnvelope.parse(envelope)).toEqual({ ...envelope, hints: {} });
  });

  it('keeps the XML of a Factur-X and the row of an ERP', () => {
    const fx = DocumentEnvelope.parse({
      ...envelope,
      structured: { format: 'factur-x', xml: '<rsm:CrossIndustryInvoice/>' },
      hints: { senderEmail: 'compta@platrerie-dumas.fr', subject: 'Facture octobre' },
    });
    expect(fx.structured).toEqual({ format: 'factur-x', xml: '<rsm:CrossIndustryInvoice/>' });
    expect(fx.hints.senderEmail).toBe('compta@platrerie-dumas.fr');
    const erp = DocumentEnvelope.parse({
      ...envelope,
      source: 'erp',
      structured: { format: 'erp-json', record: { numero: 'SIT-04', chantier: 'Les Tilleuls' } },
    });
    expect(erp.structured?.format).toBe('erp-json');
  });

  it('refuses what an adapter must never send', () => {
    const bad = (patch: Record<string, unknown>) =>
      DocumentEnvelope.safeParse({ ...envelope, ...patch }).success;
    expect(bad({ sha256: envelope.sha256.toUpperCase() })).toBe(false);
    expect(bad({ sha256: 'abc' })).toBe(false);
    expect(bad({ size: 0 })).toBe(false);
    expect(bad({ size: MAX_DOCUMENT_BYTES + 1 })).toBe(false);
    expect(bad({ mime: 'application/x-msdownload' })).toBe(false);
    expect(bad({ source: 'fax' })).toBe(false);
    expect(bad({ receivedAt: '24/10/2026' })).toBe(false);
    expect(bad({ tenantId: 'acme' })).toBe(false);
    expect(bad({ structured: { format: 'ubl', xml: '' } })).toBe(false);
    expect(bad({ structured: { format: 'erp-json', xml: '<x/>' } })).toBe(false);
    expect(bad({ hints: { senderEmail: 'pas une adresse' } })).toBe(false);
    expect(bad({ size: MAX_DOCUMENT_BYTES })).toBe(true);
  });
});

describe('ApprovalDecision', () => {
  const decision = {
    actionId: '7d9f0c52-1c1f-4b8e-8f5b-2d6a4c3e1f00',
    revision: 2,
    decision: 'approve',
    channel: 'telegram',
  };

  it('reads an approval, a rejection with a note, an edit and a snooze', () => {
    expect(ApprovalDecision.parse(decision)).toEqual(decision);
    expect(
      ApprovalDecision.parse({ ...decision, decision: 'reject', comment: '  Déjà payé  ' }).comment,
    ).toBe('Déjà payé');
    expect(
      ApprovalDecision.safeParse({ ...decision, decision: 'edit', comment: 'Bonjour…' }).success,
    ).toBe(true);
    expect(
      ApprovalDecision.safeParse({
        ...decision,
        decision: 'snooze',
        snoozeUntil: '2026-10-28T07:00:00+01:00',
      }).success,
    ).toBe(true);
  });

  it('takes a recipient with an edit only, and only an address', () => {
    const edit = { ...decision, decision: 'edit', comment: 'Bonjour…' };
    expect(ApprovalDecision.parse({ ...edit, to: 'compta@client.example' }).to).toBe(
      'compta@client.example',
    );
    const issues = (patch: Record<string, unknown>) =>
      ApprovalDecision.safeParse({ ...decision, ...patch }).error?.issues.map((i) => i.message);
    expect(issues({ to: 'compta@client.example' })).toEqual(['recipient_edit_only']);
    expect(issues({ decision: 'edit', comment: 'Bonjour…', to: 'pas une adresse' })).toHaveLength(
      1,
    );
  });

  it('refuses an edit without text, a snooze without a date, a date on anything else', () => {
    const issues = (patch: Record<string, unknown>) =>
      ApprovalDecision.safeParse({ ...decision, ...patch }).error?.issues.map((i) => i.message);
    expect(issues({ decision: 'edit' })).toEqual(['edit_needs_text']);
    expect(issues({ decision: 'edit', comment: '   ' })).toContain('edit_needs_text');
    expect(issues({ decision: 'snooze' })).toEqual(['snooze_needs_date']);
    expect(issues({ snoozeUntil: '2026-10-28T07:00:00Z' })).toEqual(['snooze_only']);
    expect(issues({ decision: 'timeout' })).toHaveLength(1);
    expect(issues({ channel: 'system' })).toHaveLength(1);
    expect(issues({ revision: -1 })).toHaveLength(1);
    expect(issues({ comment: 'x'.repeat(2001) })).toHaveLength(1);
  });
});

describe('kinds', () => {
  it('has no duplicate and every invoice kind is a document kind', () => {
    for (const list of [DOCUMENT_KINDS, OBLIGATION_KINDS, ACTION_KINDS]) {
      expect(new Set(list).size).toBe(list.length);
    }
    for (const kind of INVOICE_KINDS) expect(DOCUMENT_KINDS).toContain(kind);
  });
});

describe('errors', () => {
  it('tells a fatal error from a retryable one', () => {
    const fatal = new FatalError('not_a_pdf');
    expect(isFatal(fatal)).toBe(true);
    expect(fatal.message).toBe('not_a_pdf');
    expect(isFatal(new RetryableError('model_timeout', 'no answer in 30 s'))).toBe(false);
    expect(isFatal(new Error('x'))).toBe(false);
  });
});
