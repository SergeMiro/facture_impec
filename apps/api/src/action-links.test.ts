// BTP stage 3C (docs/plans/phase-3.md): the weekly e-mail lists the requests waiting in « À valider »,
// each with « Envoyer » and « Ignorer » links for the owner it goes to. Plan §12's integration test
// on the e-mail channel: a deadline in its horizon → a draft → the e-mailed link → the job → one
// e-mail; the same link twice, the other link of the same request, a link to an older revision or
// an old link change nothing, and opening a link (a mail scanner does) decides nothing.
import {
  actionLinks,
  actions,
  auditEvents,
  blobs,
  type Database,
  documents,
  eq,
  obligations,
  parties,
  sha256,
  users,
} from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runActionSend } from './actions';
import { runWeeklyReports } from './report';
import { ADMIN_TOKEN, fakeAdapter, newTenant, testApi, testDatabase } from './test-helpers';
import { runWatchers } from './watchers';

let database: Database;
let api: ReturnType<typeof testApi>;
/** Saturday 24 October 2026, 10:00 in Paris: the week's report is due. */
let clock = new Date('2026-10-24T08:00:00Z');

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: fakeAdapter() }, ADMIN_TOKEN, { now: () => clock });
});
afterAll(() => database.close());

const watch = () => runWatchers({ db: database.db, jobs: api.jobs, now: () => clock });
const report = () => runWeeklyReports(api.deps);
const mailsTo = (to: string) => api.mailer.sent.filter((m) => m.to === to);
const actionRow = async (id: string) => {
  const [row] = await database.db.select().from(actions).where(eq(actions.id, id));
  if (!row) throw new Error('no action');
  return row;
};

let seq = 0;

/** A Luhn-valid SIREN of its own for each made-up supplier. */
function sirenOf(n: number): string {
  const body = String(50_000_000 + n);
  for (let d = 0; d < 10; d++) {
    const sum = [...`${body}${d}`]
      .reverse()
      .reduce(
        (acc, c, i) => acc + (i % 2 ? ((x) => (x > 9 ? x - 9 : x))(Number(c) * 2) : Number(c)),
        0,
      );
    if (sum % 10 === 0) return `${body}${d}`;
  }
  throw new Error('no check digit');
}

/** A company whose owner gets the report, a supplier (`email` or none), and its attestation's deadline. */
async function company(owner: string) {
  const tenant = await newTenant(api.request, { ownerEmail: owner });
  const db = database.db;
  const supplier = async (name: string, email: string | null, isTest = false) => {
    const n = ++seq;
    const [party] = await db
      .insert(parties)
      .values({
        tenantId: tenant.id,
        kind: 'supplier',
        legalName: name,
        siren: sirenOf(n),
        email,
        source: 'invoice',
      })
      .returning();
    const sha256 = n.toString(16).padStart(64, '0');
    const storageKey = `${tenant.id}/${sha256}`;
    await db.insert(blobs).values({
      key: storageKey,
      tenantId: tenant.id,
      sha256,
      size: 3,
      mime: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3]),
    });
    const [doc] = await db
      .insert(documents)
      .values({
        tenantId: tenant.id,
        source: 'mail',
        sourceRef: `<${sha256}@example>`,
        name: `attestation-${n}.pdf`,
        mime: 'application/pdf',
        size: 3,
        sha256,
        storageKey,
        kind: 'attestation_vigilance',
        stage: 'done',
        partyId: party?.id ?? null,
        isTest,
        receivedAt: clock,
      })
      .returning();
    await db.insert(obligations).values({
      tenantId: tenant.id,
      kind: 'attestation_vigilance_renouvellement',
      key: `attestation_vigilance_renouvellement:${n}`,
      partyId: party?.id ?? null,
      sourceDocumentId: doc?.id ?? null,
      dueOn: '2026-11-10',
      isTest,
    });
    return party;
  };
  const [user] = await db.select().from(users).where(eq(users.email, owner));
  /** The request drafted for this supplier. */
  const draftOf = async (party: { id: string } | undefined) => {
    const [row] = await db
      .select()
      .from(actions)
      .where(eq(actions.partyId, party?.id ?? ''));
    if (!row) throw new Error('no draft');
    return row;
  };
  return { tenant, supplier, user, draftOf };
}

/** The links of the owner's last report, in their order, as the paths the API serves. */
function linksIn(owner: string) {
  const text = mailsTo(owner).at(-1)?.text ?? '';
  const of = (label: string) =>
    [...text.matchAll(new RegExp(`^ {2}${label} : (\\S+)$`, 'gm'))].map((m) => {
      const url = new URL(m[1] ?? '');
      return `${url.pathname}${url.search}`;
    });
  return { text, send: of('Envoyer'), add: of('Ajouter comme fournisseur'), ignore: of('Ignorer') };
}

/** The page as a person reads it: the template escapes apostrophes and quotes. */
const read = async (res: Response) => ({
  status: res.status,
  html: (await res.text()).replaceAll('&#39;', "'").replaceAll('&quot;', '"'),
});
const open = async (path: string) => read(await api.request(path));
const click = async (path: string) => read(await api.request(path, { method: 'POST' }));
/** The request a link decides, from the hash of its secret. */
const actionOf = async (path: string) => {
  const token = new URLSearchParams(path.split('?')[1]).get('token') ?? '';
  const [link] = await database.db
    .select()
    .from(actionLinks)
    .where(eq(actionLinks.linkHash, sha256(token)));
  return link?.actionId;
};

describe('the weekly e-mail’s links', () => {
  it('list the waiting requests; a link decides once, as its person, and the request is sent once', async () => {
    const owner = 'gerant@liens-une.test';
    const c = await company(owner);
    const dumas = await c.supplier('Plâtrerie Dumas', 'contact@platrerie-dumas.test');
    const roux = await c.supplier('Menuiserie Roux', null);
    await c.supplier('Essai Test', 'essai@test.test', true);
    await watch();
    await report();
    const mail = linksIn(owner);
    expect(mail.text).toContain('Validez 2 demande(s) préparée(s)');
    expect(mail.text).toContain('À valider (2) :');
    expect(mail.text).toContain(
      "• Demander l'attestation de vigilance : Plâtrerie Dumas, échéance le 10/11/2026",
    );
    expect(mail.text).toContain('  À : contact@platrerie-dumas.test');
    expect(mail.text).toContain('  Adresse e-mail manquante');
    expect(mail.text).not.toContain('Essai Test');
    // « Envoyer » only where an address is known; « Ignorer » for both.
    expect(mail.send).toHaveLength(1);
    expect(mail.ignore).toHaveLength(2);
    const stored = await database.db
      .select()
      .from(actionLinks)
      .where(eq(actionLinks.tenantId, c.tenant.id));
    expect(stored).toHaveLength(3);
    expect(stored.every((l) => l.userId === c.user?.id && l.revision === 0)).toBe(true);
    // Only the hash is kept: the secret is in the e-mail alone.
    expect(stored.map((l) => l.linkHash).join()).not.toContain(
      new URLSearchParams(mail.send[0]?.split('?')[1]).get('token'),
    );

    const id = (await c.draftOf(dumas)).id;
    const send = mail.send[0] ?? '';
    // Two deadlines on the same day: the e-mail lists them in no fixed order.
    const ignoreOf = async (actionId: string) => {
      for (const path of mail.ignore) if ((await actionOf(path)) === actionId) return path;
      throw new Error('no « Ignorer » link for this request');
    };
    // Opened (a scanner would): a page and a button, nothing decided.
    const page = await open(send);
    expect(page.status).toBe(200);
    expect(page.html).toContain('partira à contact@platrerie-dumas.test');
    expect(page.html).toContain('<form method="post"');
    expect(await actionRow(id)).toMatchObject({ status: 'draft', revision: 0 });

    const done = await click(send);
    expect(done.status).toBe(200);
    expect(done.html).toContain("C'est validé : la demande part à contact@platrerie-dumas.test");
    expect(await actionRow(id)).toMatchObject({
      status: 'approved',
      channel: 'email',
      decidedBy: c.user?.id,
      revision: 1,
    });
    const events = await database.db.select().from(auditEvents).where(eq(auditEvents.objectId, id));
    expect(events.find((e) => e.action === 'action.decide')?.actor).toBe(`user:${c.user?.id}`);
    expect(api.jobs.actions).toContain(id);
    for (const _ of [1, 2]) await runActionSend(api.deps, id);
    const sent = mailsTo('contact@platrerie-dumas.test');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.replyTo).toBe(owner);

    // The same link again, then the other link of the same request: nothing more.
    expect((await click(send)).status).toBe(410);
    expect((await open(send)).html).toContain("Ce lien n'est plus valable");
    const other = await ignoreOf(id);
    expect((await open(other)).html).toContain('a changé ou a déjà été décidée');
    expect((await click(other)).html).toContain('a changé ou a déjà été décidée');
    expect(await actionRow(id)).toMatchObject({ status: 'sent', revision: 1 });

    // « Ignorer » on the request without an address.
    const ignore = await ignoreOf((await c.draftOf(roux)).id);
    expect((await open(ignore)).html).toContain('sera ignorée : rien ne sera envoyé');
    expect((await click(ignore)).html).toContain("C'est noté : rien n'a été envoyé.");
    expect(await c.draftOf(roux)).toMatchObject({ status: 'rejected', channel: 'email' });
    expect(mailsTo('contact@platrerie-dumas.test')).toHaveLength(1);
  });

  it('decide nothing for a text edited since the e-mail, nor after seven days', async () => {
    const owner = 'gerant@liens-deux.test';
    const c = await company(owner);
    const dumas = await c.supplier('Plâtrerie Dumas', 'contact@platrerie-dumas.test');
    const petit = await c.supplier('Carrelage Petit', 'contact@carrelage-petit.test');
    await watch();
    await report();
    const mail = linksIn(owner);
    expect(mail.send).toHaveLength(2);
    const first = await c.draftOf(dumas);
    const second = await c.draftOf(petit);
    const [toFirst, toSecond] =
      (await actionOf(mail.send[0] ?? '')) === first.id
        ? [mail.send[0], mail.send[1]]
        : [mail.send[1], mail.send[0]];
    expect(await actionOf(toSecond ?? '')).toBe(second.id);
    // Someone changes the first one's text in the pane after the e-mail left.
    const edited = await api.request(`/actions/${first.id}/decide`, {
      method: 'POST',
      token: c.tenant.apiKey,
      body: { revision: 0, decision: 'edit', comment: 'Bonjour, pouvez-vous nous envoyer…' },
    });
    expect(edited.status).toBe(200);
    expect((await click(toFirst ?? '')).html).toContain('a changé ou a déjà été décidée');
    expect(await actionRow(first.id)).toMatchObject({ status: 'draft', revision: 1 });

    const now = clock;
    try {
      clock = new Date(now.getTime() + 8 * 86_400_000);
      const late = await open(toSecond ?? '');
      expect(late.status).toBe(410);
      expect(late.html).toContain('il a plus de 7 jours');
      expect((await click(toSecond ?? '')).status).toBe(410);
    } finally {
      clock = now;
    }
    expect(await actionRow(second.id)).toMatchObject({ status: 'draft', revision: 0 });
    // A made-up token: the same page, no clue whether it ever existed.
    expect((await open('/decide?token=nope')).status).toBe(410);
    expect((await click('/decide')).status).toBe(410);
  });

  it('add a new company from « Ajouter comme fournisseur »', async () => {
    const owner = 'gerant@liens-trois.test';
    const c = await company(owner);
    const siren = '400000006';
    await database.db.insert(actions).values({
      tenantId: c.tenant.id,
      kind: 'confirmer_tiers',
      key: `confirmer_tiers:${siren}`,
      payload: { siren, documentKind: 'attestation_vigilance' },
      isTest: false,
    });
    await report();
    const mail = linksIn(owner);
    expect(mail.text).toContain(`• Une entreprise inconnue : le SIREN ${siren}`);
    expect(mail.add).toHaveLength(1);
    expect((await open(mail.add[0] ?? '')).html).toContain(
      `L'entreprise au SIREN ${siren} sera ajoutée à vos fournisseurs`,
    );
    expect((await click(mail.add[0] ?? '')).html).toContain('Fournisseur ajouté.');
    const [added] = await database.db
      .select()
      .from(parties)
      .where(eq(parties.tenantId, c.tenant.id));
    expect(added).toMatchObject({ siren, kind: 'supplier', source: 'sirene' });
  });

  it('leave Mode test out, and say nothing of them when none waits', async () => {
    const owner = 'gerant@liens-quatre.test';
    const c = await company(owner);
    await c.supplier('Essai Test', 'essai@test.test', true);
    await watch();
    await report();
    const { text, ignore } = linksIn(owner);
    expect(text).not.toContain('À valider');
    expect(ignore).toHaveLength(0);
  });

  it('go with the account, and a link mailed before serves no more', async () => {
    const owner = 'gerant@liens-cinq.test';
    const c = await company(owner);
    await c.supplier('Partie Bientôt', 'contact@partie.test');
    await watch();
    await report();
    const { ignore } = linksIn(owner);
    expect(ignore).toHaveLength(1);
    const deleted = await api.request('/tenant', {
      method: 'DELETE',
      token: c.tenant.apiKey,
      body: { confirmSiren: '100000009' },
    });
    expect(deleted.status).toBe(200);
    const left = await database.db
      .select()
      .from(actionLinks)
      .where(eq(actionLinks.tenantId, c.tenant.id));
    expect(left).toEqual([]);
    expect((await open(ignore[0] ?? '')).status).toBe(410);
  });
});
