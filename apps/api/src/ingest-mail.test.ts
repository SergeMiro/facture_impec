import { toCii } from '@fi/core';
import { computeGolden, golden } from '@fi/core/testing';
import { type Database, documents, eq, inArray } from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GOLDEN_COMPANIES, writePdf } from '../scripts/golden/documents';
import { INGEST_BACKLOG } from './ingest';
import { splitMail } from './ingest-mail';
import { fakeAdapter, newTenant, testApi, testDatabase } from './test-helpers';

let database: Database;
let api: ReturnType<typeof testApi>;

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: fakeAdapter() });
}, 60_000);
afterAll(async () => {
  await database.close();
});

const b64 = (bytes: Uint8Array | string) =>
  (
    Buffer.from(bytes)
      .toString('base64')
      .match(/.{1,76}/g) ?? []
  ).join('\r\n');
const pdf = (text: string) => writePdf([{ lines: [{ text }] }]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);
const CII = toCii(computeGolden(golden('01-services-standard-rate')));

/** What a forwarded attestation looks like inside the e-mail that forwards it. */
const forwarded = [
  'From: URSSAF <ne-pas-repondre@urssaf.fr>',
  'Subject: Votre attestation de vigilance',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="inner"',
  '',
  '--inner',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Veuillez trouver votre attestation.',
  '--inner',
  'Content-Type: application/pdf',
  'Content-Disposition: attachment; filename="attestation.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  b64(pdf('ATTESTATION DE VIGILANCE - URSSAF')),
  '--inner--',
  '',
].join('\r\n');

/** A supplier's e-mail as Outlook or Gmail saves it (.eml). */
function supplierMail(messageId = '<fa-12@atelier-dupont.fr>') {
  return new TextEncoder().encode(
    [
      'From: =?UTF-8?Q?Atelier_Dupont?= <compta@atelier-dupont.fr>',
      'To: factures@maconnerie-durand.fr',
      `Subject: =?UTF-8?B?${Buffer.from('Facture n° 12 – chantier Tanneurs').toString('base64')}?=`,
      `Message-ID: ${messageId}`,
      'Date: Fri, 23 Oct 2026 10:00:00 +0200',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="mixed"',
      '',
      '--mixed',
      'Content-Type: multipart/related; boundary="rel"',
      '',
      '--rel',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Bonjour, ci-joint notre facture.</p><img src="cid:logo@dupont">',
      '--rel',
      'Content-Type: image/png',
      'Content-ID: <logo@dupont>',
      'Content-Disposition: inline; filename="logo.png"',
      'Content-Transfer-Encoding: base64',
      '',
      b64(PNG),
      '--rel--',
      '--mixed',
      'Content-Type: application/pdf',
      "Content-Disposition: attachment; filename*=UTF-8''facture%20n%C2%B0%2012.pdf",
      'Content-Transfer-Encoding: base64',
      '',
      b64(pdf('FACTURE 12 - Atelier Dupont')),
      '--mixed',
      'Content-Type: application/xml',
      'Content-Disposition: attachment; filename="facture-12.xml"',
      'Content-Transfer-Encoding: base64',
      '',
      b64(CII),
      '--mixed',
      'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition: attachment; filename="devis.docx"',
      'Content-Transfer-Encoding: base64',
      '',
      b64(DOCX),
      '--mixed',
      'Content-Type: message/rfc822',
      'Content-Disposition: attachment; filename="Fwd.eml"',
      '',
      forwarded,
      '--mixed--',
      '',
    ].join('\r\n'),
  );
}

async function company() {
  const { siren, name, vatId } = GOLDEN_COMPANIES.buyer;
  const tenant = await newTenant(api.request, { siren, name, vatId });
  const send = async (raw: Uint8Array, query = '') => {
    const res = await api.request(`/ingest/mail${query}`, {
      method: 'POST',
      token: tenant.apiKey,
      body: raw,
    });
    return {
      status: res.status,
      body: (await res.json()) as {
        documents: { id: string; name: string; created: boolean; isTest: boolean }[];
        skipped: { name: string; reason: string }[];
        error?: { code: string };
      },
    };
  };
  return { ...tenant, send };
}

describe('an e-mail', () => {
  it('becomes one document per attachment, its sender and subject as hints', async () => {
    const c = await company();
    const first = await c.send(supplierMail());
    expect(first.status).toBe(201);
    expect(first.body.documents.map((d) => [d.name, d.created])).toEqual([
      ['facture n° 12.pdf', true],
      ['facture-12.xml', true],
      ['attestation.pdf', true],
    ]);
    // The signature's logo and a Word file are said, not stored.
    expect(first.body.skipped).toEqual([
      { name: 'logo.png', reason: 'inline' },
      { name: 'devis.docx', reason: 'unsupported' },
    ]);
    const ids = first.body.documents.map((d) => d.id);
    const rows = await database.db.select().from(documents).where(inArray(documents.id, ids));
    for (const row of rows) {
      expect(row).toMatchObject({
        tenantId: c.id,
        source: 'mail',
        sourceRef: '<fa-12@atelier-dupont.fr>',
        isTest: false,
        hints: {
          senderEmail: 'compta@atelier-dupont.fr',
          subject: 'Facture n° 12 – chantier Tanneurs',
        },
      });
    }
    expect(api.jobs.ingests).toEqual(expect.arrayContaining(ids));

    // The same e-mail again, from another forward: the same documents, nothing new.
    const again = await c.send(supplierMail('<other@atelier-dupont.fr>'));
    expect(again.status).toBe(200);
    expect(again.body.documents.map((d) => [d.id, d.created])).toEqual(
      ids.map((id) => [id, false]),
    );
    const test = await c.send(supplierMail(), '?test=true');
    expect(test.status).toBe(201);
    expect(test.body.documents.every((d) => d.isTest && d.created)).toBe(true);
  });

  it('without a readable attachment, or empty, is refused with nothing stored', async () => {
    const c = await company();
    const plain = new TextEncoder().encode(
      'From: a@b.fr\r\nSubject: Relance\r\n\r\nMerci de nous régler la facture 12.\r\n',
    );
    const none = await c.send(plain);
    expect([none.status, none.body.error?.code]).toEqual([422, 'mail_no_attachment']);
    const empty = await c.send(new Uint8Array());
    expect([empty.status, empty.body.error?.code]).toEqual([422, 'ingest_empty']);
    const stored = await database.db.select().from(documents).where(eq(documents.tenantId, c.id));
    expect(stored).toEqual([]);
  });

  it('waits, whole, while the company has too many documents to read', async () => {
    const c = await company();
    await database.db.insert(documents).values(
      Array.from({ length: INGEST_BACKLOG }, (_, i) => ({
        tenantId: c.id,
        source: 'mail' as const,
        sourceRef: `waiting-${i}`,
        name: `waiting-${i}.pdf`,
        mime: 'application/pdf',
        size: 1,
        sha256: i.toString(16).padStart(64, '0'),
        storageKey: `waiting-${i}`,
        isTest: false,
        receivedAt: new Date(),
      })),
    );
    const busy = await c.send(supplierMail());
    expect([busy.status, busy.body.error?.code]).toEqual([429, 'ingest_busy']);
    const stored = await database.db.select().from(documents).where(eq(documents.tenantId, c.id));
    expect(stored).toHaveLength(INGEST_BACKLOG);
  });

  it('without a Message-ID or a usable sender still has a reference and a name per file', async () => {
    const raw = new TextEncoder().encode(
      [
        'From: pas une adresse',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="b"',
        '',
        '--b',
        'Content-Type: application/pdf',
        'Content-Transfer-Encoding: base64',
        '',
        b64(pdf('Bon de livraison 4471')),
        '--b',
        'Content-Type: application/pdf',
        'Content-Disposition: attachment; filename="vide.pdf"',
        '',
        '',
        '--b--',
        '',
      ].join('\r\n'),
    );
    const mail = await splitMail(raw);
    expect(mail.messageRef).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(mail.hints).toEqual({});
    expect(mail.files.map((f) => f.name)).toEqual(['piece-jointe-1.pdf']);
    expect(mail.skipped).toEqual([{ name: 'vide.pdf', reason: 'empty' }]);
  });
});
