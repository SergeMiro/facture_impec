// « Envoyer » and « Ignorer » in the weekly e-mail (BTP plan stage 3C, docs/plans/phase-3.md): each
// request waiting in « À valider » gets one link per decision for each owner the report goes to.
// The link opens a page that says what will happen; only its button decides (a mail scanner opens
// links), as that person, through the pane's `decideAction`, with `channel: 'email'`. A link serves
// once, for 7 days, and only for the revision the e-mail showed: a text edited since, or a request
// someone already decided, is not touched.
import { randomBytes } from 'node:crypto';
import type { ApprovalItem } from '@fi/agents';
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
import type { LinkDecision } from '@fi/domain';
import { type MessageKey, t } from '@fi/shared';
import { Hono } from 'hono';
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

type Found = NonNullable<Awaited<ReturnType<typeof find>>>;

/** A link still usable: unused, not expired, its company and person still there. */
async function find(deps: Pick<ApiDeps, 'db' | 'now'>, token: string | undefined) {
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
  if (!row || row.link.usedAt || row.link.expiresAt <= deps.now() || row.tenant.deletedAt) {
    return undefined;
  }
  return row;
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
  const stale = ({ link, action }: Found) =>
    action.status !== 'draft' || action.revision !== link.revision;

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
    const found = await find(deps, c.req.query('token'));
    if (!found) return c.html(expired(), 410);
    if (stale(found)) return c.html(page(title, t('decide.page.changed')));
    const now = deps.now();
    // Claimed first: the same link posted twice decides once.
    const [claimed] = await deps.db
      .update(actionLinks)
      .set({ usedAt: now })
      .where(and(eq(actionLinks.id, found.link.id), isNull(actionLinks.usedAt)))
      .returning({ id: actionLinks.id });
    if (!claimed) return c.html(expired(), 410);
    const decider: Decider = {
      actor: `user:${found.user.id}`,
      by: found.user.id,
      email: found.user.email,
      channel: 'email',
    };
    try {
      const decided = await decideAction(deps, found.tenant, decider, {
        actionId: found.action.id,
        revision: found.link.revision,
        decision: found.link.decision,
        channel: 'email',
      });
      const done =
        found.link.decision === 'reject'
          ? t('decide.done.rejected')
          : found.action.kind === 'confirmer_tiers'
            ? t('decide.done.added')
            : t('decide.done.sent', { to: decided.email?.to ?? '' });
      return c.html(page(title, done));
    } catch (e) {
      // The directory or the database was out: nothing was decided, the link serves again.
      if (!(e instanceof ApiError) || e.status >= 500) {
        await deps.db
          .update(actionLinks)
          .set({ usedAt: null })
          .where(eq(actionLinks.id, claimed.id));
      }
      if (!(e instanceof ApiError)) throw e;
      return c.html(page(title, e.body.error.message), e.status);
    }
  });

  return app;
}
