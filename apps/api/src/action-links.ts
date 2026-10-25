// « Envoyer » and « Ignorer » in the weekly e-mail (BTP plan stage 3C, docs/plans/phase-3.md): each
// request waiting in « À valider » gets one link per decision for each owner the report goes to.
// The link opens a page that says what will happen; only its button decides (a mail scanner opens
// links), as that person, through the pane's `decideAction`, with `channel: 'email'`. A link serves
// once, for 7 days, and only for the revision the e-mail showed: a text edited since, or a request
// someone already decided, is not touched. The same links are the buttons of a request in the
// person's Telegram (memory M4, src/telegram.ts), with `channel: 'telegram'`: a link serves only on
// the channel it was given on, and a press decides (nothing in Telegram presses a button for you).
import { randomBytes } from 'node:crypto';
import { type ApprovalItem, approvalSummary } from '@fi/agents';
import {
  actionLinks,
  actions,
  and,
  type Db,
  eq,
  isNull,
  parties,
  sha256,
  type TenantRow,
  tenants,
  users,
} from '@fi/db';
import type { LinkChannel, LinkDecision } from '@fi/domain';
import { type MessageKey, t } from '@fi/shared';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { actionView, type Decider, decideAction, listActions } from './actions';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { page } from './page';

export const LINK_DAYS = 7;
/** The requests one e-mail lists, the nearest deadline first; the others wait in the pane. */
export const LISTED = 10;

const secret = () => randomBytes(32).toString('base64url');

const urlOf = (base: string, token: string) => {
  const url = new URL('/decide', base);
  url.searchParams.set('token', token);
  return url.toString();
};

/**
 * The real requests waiting for this person's decision, each with its fresh links (stored as
 * SHA-256; the secrets live only in the e-mail). A request without an address has no « Envoyer ».
 */
export async function approvalItems(
  /** `base`: API_PUBLIC_URL, where the links point. */
  deps: { db: Db; base: string },
  tenant: Pick<TenantRow, 'id'>,
  userId: string,
  now: Date,
): Promise<{ items: ApprovalItem[]; more: number }> {
  const { actions: waiting } = await listActions(deps.db, tenant, { test: false, status: 'draft' });
  const listed = waiting.slice(0, LISTED);
  const expiresAt = new Date(now.getTime() + LINK_DAYS * 86_400_000);
  const rows: (typeof actionLinks.$inferInsert)[] = [];
  const link = (a: (typeof listed)[number], decision: LinkDecision) => {
    const token = secret();
    rows.push({
      tenantId: tenant.id,
      actionId: a.id,
      userId,
      decision,
      revision: a.revision,
      linkHash: sha256(token),
      expiresAt,
      createdAt: now,
    });
    return urlOf(deps.base, token);
  };
  const items = listed.map(
    (a): ApprovalItem => ({
      kind: a.kind,
      company: a.party?.name ?? null,
      siren: a.siren,
      dueOn: a.obligation?.dueOn ?? null,
      to: a.email?.to ?? null,
      approveUrl: a.kind === 'confirmer_tiers' || a.email?.to ? link(a, 'approve') : null,
      rejectUrl: link(a, 'reject'),
    }),
  );
  if (rows.length > 0) await deps.db.insert(actionLinks).values(rows);
  return { items, more: waiting.length - listed.length };
}

/** A request as Telegram shows it: its text, and its buttons, each a fresh one-time link. */
export interface TelegramRequest {
  text: string;
  buttons: { text: string; data: string }[][];
  /** The links made for it: removed again when the message could not be sent. */
  linkIds: string[];
}

/**
 * The buttons of one request waiting for this person, in their Telegram: « Envoyer » (« Ajouter comme
 * fournisseur »), unless the address is missing, and « Ignorer ». Each carries a link's secret (43
 * characters: Telegram's callback data takes 64 bytes), stored as SHA-256 like the e-mail's.
 */
export async function telegramRequest(
  db: Db,
  tenant: Pick<TenantRow, 'id'>,
  userId: string,
  action: Awaited<ReturnType<typeof listActions>>['actions'][number],
  now: Date,
): Promise<TelegramRequest> {
  const item = {
    kind: action.kind,
    company: action.party?.name ?? null,
    siren: action.siren,
    dueOn: action.obligation?.dueOn ?? null,
    to: action.email?.to ?? null,
  };
  const unknown = action.kind === 'confirmer_tiers';
  const decisions: LinkDecision[] = unknown || item.to ? ['approve', 'reject'] : ['reject'];
  const tokens = decisions.map(() => secret());
  const links = await db
    .insert(actionLinks)
    .values(
      decisions.map((decision, i) => ({
        tenantId: tenant.id,
        actionId: action.id,
        userId,
        decision,
        revision: action.revision,
        channel: 'telegram' as const,
        linkHash: sha256(tokens[i] ?? ''),
        expiresAt: new Date(now.getTime() + LINK_DAYS * 86_400_000),
        createdAt: now,
      })),
    )
    .returning({ id: actionLinks.id });
  const label = (decision: LinkDecision) =>
    decision === 'reject'
      ? t('decide.button.reject')
      : t(unknown ? 'decide.button.add' : 'decide.button.send');
  return {
    text: [...approvalSummary(item), '', t('telegram.request.note')].join('\n'),
    buttons: [decisions.map((d, i) => ({ text: label(d), data: tokens[i] ?? '' }))],
    linkIds: links.map((l) => l.id),
  };
}

type Found = NonNullable<Awaited<ReturnType<typeof find>>>;

/** Where a link is used: the channel it was given on, and for Telegram the chat's person and time. */
export interface LinkUse {
  channel: LinkChannel;
  /** The person the chat is bound to: another person's button decides nothing there. */
  userId?: string;
  /** When it was pressed (the relay kept the press while the runner was off); default now. */
  at?: Date;
}

/**
 * A link still usable: unused, not expired when used, its company and person still there, used on
 * the channel it was given on (and in Telegram, by the person it was given to).
 */
async function find(
  deps: Pick<ApiDeps, 'db' | 'now'>,
  token: string | undefined,
  use: LinkUse = { channel: 'email' },
) {
  if (!token || token.length > 100) return undefined;
  const [row] = await deps.db
    .select({
      link: actionLinks,
      action: actions,
      tenant: tenants,
      user: users,
      company: parties.legalName,
    })
    .from(actionLinks)
    .innerJoin(actions, eq(actions.id, actionLinks.actionId))
    .leftJoin(parties, eq(parties.id, actions.partyId))
    .innerJoin(tenants, eq(tenants.id, actionLinks.tenantId))
    .innerJoin(users, and(eq(users.id, actionLinks.userId), eq(users.tenantId, tenants.id)))
    .where(eq(actionLinks.linkHash, sha256(token)));
  const at = use.at ?? deps.now();
  if (!row || row.link.usedAt || row.link.expiresAt <= at || row.tenant.deletedAt) return undefined;
  if (row.link.channel !== use.channel) return undefined;
  if (use.userId !== undefined && row.link.userId !== use.userId) return undefined;
  return row;
}

const stale = ({ link, action }: Found) =>
  action.status !== 'draft' || action.revision !== link.revision;

/** What a link did: nothing (gone, or the request changed), or the decision, or why it failed. */
export type LinkOutcome =
  | { kind: 'expired' }
  | { kind: 'changed' }
  | { kind: 'decided'; decision: LinkDecision; unknown: boolean; to: string }
  | { kind: 'failed'; status: ContentfulStatusCode; message: string };

/**
 * Decides through a link, once: as the person it was given to, on its channel, for the revision it
 * showed. The link is claimed first (the same link used twice decides once) and given back when the
 * directory or the database was out, so it serves again.
 */
export async function decideByLink(
  deps: ApiDeps,
  token: string | undefined,
  use: LinkUse,
): Promise<LinkOutcome> {
  const found = await find(deps, token, use);
  if (!found) return { kind: 'expired' };
  if (stale(found)) return { kind: 'changed' };
  const [claimed] = await deps.db
    .update(actionLinks)
    .set({ usedAt: deps.now() })
    .where(and(eq(actionLinks.id, found.link.id), isNull(actionLinks.usedAt)))
    .returning({ id: actionLinks.id });
  if (!claimed) return { kind: 'expired' };
  const decider: Decider = {
    actor: `user:${found.user.id}`,
    by: found.user.id,
    email: found.user.email,
    channel: use.channel,
  };
  try {
    const decided = await decideAction(deps, found.tenant, decider, {
      actionId: found.action.id,
      revision: found.link.revision,
      decision: found.link.decision,
      channel: use.channel,
    });
    return {
      kind: 'decided',
      decision: found.link.decision,
      unknown: found.action.kind === 'confirmer_tiers',
      to: decided.email?.to ?? '',
    };
  } catch (e) {
    if (!(e instanceof ApiError) || e.status >= 500) {
      await deps.db.update(actionLinks).set({ usedAt: null }).where(eq(actionLinks.id, claimed.id));
    }
    if (!(e instanceof ApiError)) throw e;
    return { kind: 'failed', status: e.status, message: e.body.error.message };
  }
}

/** What the page says the button will do, and the button. */
function proposal({ link, action, company }: Found) {
  const view = actionView(action);
  const unknown = action.kind === 'confirmer_tiers';
  const params = {
    kind: t(`action.kind.${action.kind}` as MessageKey),
    company: company ?? '',
    to: view.email?.to ?? '',
    siren: view.siren ?? '',
  };
  if (link.decision === 'approve') {
    return unknown
      ? { message: t('decide.page.add', params), button: t('decide.button.add') }
      : { message: t('decide.page.send', params), button: t('decide.button.send') };
  }
  return {
    message: t(unknown ? 'decide.page.rejectUnknown' : 'decide.page.reject', params),
    button: t('decide.button.reject'),
  };
}

export function actionLinkRoutes(deps: ApiDeps) {
  const app = new Hono();
  const title = t('decide.page.title');
  const expired = () => page(title, t('decide.page.expired'));

  app.get('/', async (c) => {
    const token = c.req.query('token');
    const found = await find(deps, token);
    if (!found || !token) return c.html(expired(), 410);
    if (stale(found)) return c.html(page(title, t('decide.page.changed')));
    const { message, button } = proposal(found);
    return c.html(
      page(title, message, { action: `/decide?token=${encodeURIComponent(token)}`, button }),
    );
  });

  app.post('/', async (c) => {
    const outcome = await decideByLink(deps, c.req.query('token'), { channel: 'email' });
    switch (outcome.kind) {
      case 'expired':
        return c.html(expired(), 410);
      case 'changed':
        return c.html(page(title, t('decide.page.changed')));
      case 'failed':
        return c.html(page(title, outcome.message), outcome.status);
      case 'decided': {
        const done =
          outcome.decision === 'reject'
            ? t('decide.done.rejected')
            : outcome.unknown
              ? t('decide.done.added')
              : t('decide.done.sent', { to: outcome.to });
        return c.html(page(title, done));
      }
    }
  });

  return app;
}
