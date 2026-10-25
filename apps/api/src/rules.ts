// The proactive rules and the memory's lint on the runner (memory doc §8–9, M5). Once a day the rules
// read the company's pages as the index holds them; what they find is one row per rule and entity,
// open while the situation lasts, raised again only after the rule's cooldown, gone when it is no
// longer found. Each rule's pass is a `rule_runs` row (pages checked, fired, cooled, its error): the
// weekly report says from it what ran. The nightly lint reads the vault; its findings wait for a
// person, who approves a fix or dismisses it (both audited), and its questions go to
// `open-questions.md`. Nothing here sends anything: the hits show in the pane and the report.
import { createHash } from 'node:crypto';
import {
  DEFAULT_RULE_OPTIONS,
  evaluateRules,
  type Found,
  MEMORY_RULES,
  type MemoryRule,
  noticeOf,
  RuleContext,
  type RuleOptions,
  type RulePage,
} from '@fi/agents';
import { daysBetween, parisToday } from '@fi/core';
import {
  and,
  audit,
  type Db,
  desc,
  eq,
  gte,
  type MemoryFindingRow,
  memoryFindings,
  memoryPages,
  memoryRecalls,
  obligations,
  ruleHits,
  ruleRuns,
  type TenantRow,
  tenants,
} from '@fi/db';
import { Frontmatter, type LinkKind, type MemoryFinding, type MemoryVault } from '@fi/memory';
import { z } from 'zod';
import type { Principal } from './auth';
import { ApiError } from './errors';

/** The rules run once a day after this hour (Paris): before the day's work, after the night's lint. */
export const RULES_HOUR = 6;
/** The lint runs once a day after this hour (Paris), when nobody edits the vault. */
export const LINT_HOUR = 2;
/** How far back lint reads what recall found. */
export const RECALL_DAYS = 30;

const ENTRY = new Map(MEMORY_RULES.map((r) => [r.entry.id, r.entry]));

/** The company's pages as the rules read them; a page the schema no longer reads is left out. */
export async function rulePages(db: Db, tenantId: string): Promise<RulePage[]> {
  const rows = await db
    .select({ path: memoryPages.path, facts: memoryPages.facts })
    .from(memoryPages)
    .where(eq(memoryPages.tenantId, tenantId));
  return rows.flatMap((row) => {
    const read = Frontmatter.safeParse(row.facts);
    return read.success ? [{ path: row.path, frontmatter: read.data }] : [];
  });
}

export interface RulesRun {
  /** Situations found, raised now, kept quiet by their cooldown, no longer found. */
  fired: number;
  raised: number;
  cooled: number;
  gone: number;
  /** Rules that threw: their hits stay as they were. */
  failed: string[];
}

const hitKey = (rule: string, entity: string) => `${rule}\n${entity}`;

/**
 * The company's own settings (Réglages): the margin it wants (the defaults' 15 % when it set none)
 * and its option for VAT on invoices (débits).
 */
export async function ruleOptionsOf(db: Db, tenantId: string): Promise<RuleOptions> {
  const [row] = await db
    .select({ margin: tenants.minMarginPercent, debits: tenants.vatOnDebits })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return {
    marginPct: row?.margin ?? DEFAULT_RULE_OPTIONS.marginPct,
    vatOnDebits: row?.debits ?? DEFAULT_RULE_OPTIONS.vatOnDebits,
  };
}

/** One pass of the memory rules over a company's pages at `now`, with its settings by default. */
export async function runRules(
  db: Db,
  tenantId: string,
  now: Date,
  options?: RuleOptions,
  rules: readonly MemoryRule[] = MEMORY_RULES,
): Promise<RulesRun> {
  const today = parisToday(now);
  const settings = options ?? (await ruleOptionsOf(db, tenantId));
  const ctx = new RuleContext(await rulePages(db, tenantId), today, settings);
  const results = evaluateRules(ctx, rules);
  const cooldowns = new Map(rules.map((r) => [r.entry.id, r.entry.cooldownDays]));
  return db.transaction(async (tx) => {
    const known = new Map(
      (await tx.select().from(ruleHits).where(eq(ruleHits.tenantId, tenantId))).map((h) => [
        hitKey(h.rule, h.entity),
        h,
      ]),
    );
    const run: RulesRun = { fired: 0, raised: 0, cooled: 0, gone: 0, failed: [] };
    for (const result of results) {
      const cooldown = cooldowns.get(result.rule) ?? 0;
      let cooled = 0;
      const seen = new Set<string>();
      for (const found of result.found) {
        seen.add(found.entity);
        const before = known.get(hitKey(result.rule, found.entity));
        // A situation that went away and came back is a new one: raised again, cooldown or not.
        const due =
          !before ||
          before.status === 'gone' ||
          daysBetween(parisToday(before.raisedAt), today) >= cooldown;
        if (due) run.raised++;
        else cooled++;
        const facts = found.facts as Record<string, unknown>;
        const raisedAt = due ? now : (before?.raisedAt ?? now);
        await tx
          .insert(ruleHits)
          .values({
            tenantId,
            rule: result.rule,
            entity: found.entity,
            status: 'open',
            facts,
            cites: found.cites,
            firstAt: now,
            lastAt: now,
            raisedAt,
          })
          .onConflictDoUpdate({
            target: [ruleHits.tenantId, ruleHits.rule, ruleHits.entity],
            set: {
              status: 'open',
              facts,
              cites: found.cites,
              lastAt: now,
              raisedAt,
              closedAt: null,
            },
          });
      }
      run.fired += result.found.length;
      run.cooled += cooled;
      if (result.error) run.failed.push(result.rule);
      else {
        for (const hit of known.values()) {
          if (hit.rule !== result.rule || hit.status !== 'open' || seen.has(hit.entity)) continue;
          await tx
            .update(ruleHits)
            .set({ status: 'gone', closedAt: now })
            .where(
              and(
                eq(ruleHits.tenantId, tenantId),
                eq(ruleHits.rule, hit.rule),
                eq(ruleHits.entity, hit.entity),
              ),
            );
          run.gone++;
        }
      }
      await tx.insert(ruleRuns).values({
        tenantId,
        rule: result.rule,
        ranAt: now,
        checked: result.checked,
        fired: result.found.length,
        cooled,
        error: result.error ?? null,
      });
    }
    return run;
  });
}

/** What the pane shows: the open situations, in French, the latest raised first. */
export async function openRuleHits(db: Db, tenantId: string) {
  const rows = await db
    .select()
    .from(ruleHits)
    .where(and(eq(ruleHits.tenantId, tenantId), eq(ruleHits.status, 'open')))
    .orderBy(desc(ruleHits.raisedAt));
  return rows.map((row) => {
    const entry = ENTRY.get(row.rule);
    return {
      rule: row.rule,
      entity: row.entity,
      category: entry?.category ?? null,
      legal: entry?.legal ?? null,
      ...noticeOf(row.rule, row.facts as Found['facts']),
      cites: row.cites,
      firstAt: row.firstAt.toISOString(),
      raisedAt: row.raisedAt.toISOString(),
    };
  });
}

// ── The lint ─────────────────────────────────────────────────────────────────────────────────────

/** A finding's id: the same defect, the same row from one night to the next. */
export const findingId = (f: Pick<MemoryFinding, 'code' | 'page' | 'detail'>) =>
  createHash('sha256').update(`${f.code}\n${f.page}\n${f.detail}`).digest('hex');

export interface LintRun {
  found: number;
  /** New, or back after it was gone or mended. */
  opened: number;
  gone: number;
  /** Questions written in `open-questions.md`. */
  asked: number;
}

/**
 * The vault's lint with what only the database knows: the deadlines the company follows (any status:
 * one closed by a person is followed) and what recall found in the last 30 days.
 */
export async function runLint(
  db: Db,
  vault: MemoryVault,
  tenantId: string,
  now: Date,
): Promise<LintRun> {
  const [tenant] = await db
    .select({ siren: tenants.siren })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  const keys = await db
    .select({ key: obligations.key })
    .from(obligations)
    .where(eq(obligations.tenantId, tenantId));
  const since = new Date(now.getTime() - RECALL_DAYS * 86_400_000);
  const recalls = await db
    .select({ level: memoryRecalls.level, found: memoryRecalls.found })
    .from(memoryRecalls)
    .where(and(eq(memoryRecalls.tenantId, tenantId), gte(memoryRecalls.at, since)));
  const findings = await vault.lint({
    ...(tenant && {
      deadlines: { own: tenant.siren, keys: new Set(keys.map((k) => k.key.replace(/^test:/, ''))) },
    }),
    recalls,
  });

  const ask: MemoryFinding[] = [];
  const run = await db.transaction(async (tx) => {
    const known = new Map(
      (await tx.select().from(memoryFindings).where(eq(memoryFindings.tenantId, tenantId))).map(
        (f) => [f.id, f],
      ),
    );
    const out: LintRun = { found: findings.length, opened: 0, gone: 0, asked: 0 };
    const seen = new Set<string>();
    for (const finding of findings) {
      const id = findingId(finding);
      if (seen.has(id)) continue;
      seen.add(id);
      const before = known.get(id);
      // A dismissed defect stays dismissed; one mended or gone that is found again is open again.
      const reopens = !before || before.status === 'fixed' || before.status === 'gone';
      if (reopens) {
        out.opened++;
        if (finding.fix === 'question') ask.push(finding);
      }
      const row = {
        code: finding.code,
        page: finding.page,
        detail: finding.detail,
        fix: finding.fix,
        link: finding.link ?? null,
        text: finding.text,
        lastSeenAt: now,
      };
      await tx
        .insert(memoryFindings)
        .values({ tenantId, id, ...row, status: 'open', foundAt: now })
        .onConflictDoUpdate({
          target: [memoryFindings.tenantId, memoryFindings.id],
          set: reopens
            ? { ...row, status: 'open', foundAt: now, decidedBy: null, decidedAt: null }
            : row,
        });
    }
    for (const before of known.values()) {
      if (before.status !== 'open' || seen.has(before.id)) continue;
      await tx
        .update(memoryFindings)
        .set({ status: 'gone' })
        .where(and(eq(memoryFindings.tenantId, tenantId), eq(memoryFindings.id, before.id)));
      out.gone++;
    }
    return out;
  });
  if (ask.length > 0) {
    const asked = await vault.ask(ask);
    if (asked.ok) run.asked = ask.length;
  }
  return run;
}

/** What waits for a person: the open findings, by page. */
export async function openFindings(db: Db, tenantId: string) {
  const rows = await db
    .select()
    .from(memoryFindings)
    .where(and(eq(memoryFindings.tenantId, tenantId), eq(memoryFindings.status, 'open')))
    .orderBy(memoryFindings.page, memoryFindings.code);
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    page: row.page,
    fix: row.fix,
    text: row.text,
    foundAt: row.foundAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  }));
}

export const FindingDecision = z.enum(['fix', 'dismiss']);
export type FindingDecision = z.infer<typeof FindingDecision>;

const asFinding = (row: MemoryFindingRow): MemoryFinding => ({
  code: row.code as MemoryFinding['code'],
  page: row.page,
  detail: row.detail,
  fix: row.fix,
  ...(row.link && { link: { kind: row.link.kind as LinkKind, to: row.link.to } }),
  text: row.text,
});

/**
 * A person approves a finding's fix (the vault mends it) or dismisses it. Only a person signed in:
 * the memory takes no fix from a key. `done` is false when there was nothing left to mend.
 */
export async function decideFinding(
  deps: { db: Db; memory?: MemoryVault | null | undefined; now: () => Date },
  tenant: TenantRow,
  principal: Principal,
  id: string,
  decision: FindingDecision,
): Promise<{ status: 'fixed' | 'dismissed'; done: boolean }> {
  if (principal.kind !== 'session') throw new ApiError(403, 'memory_person');
  const [row] = await deps.db
    .select()
    .from(memoryFindings)
    .where(and(eq(memoryFindings.tenantId, tenant.id), eq(memoryFindings.id, id)));
  if (!row) throw new ApiError(404, 'memory_finding_not_found');
  if (row.status !== 'open') throw new ApiError(409, 'memory_finding_decided');
  const actor = `user:${principal.userId}`;
  let done = false;
  if (decision === 'fix') {
    if (!deps.memory) throw new ApiError(503, 'memory_unavailable');
    done = await deps.memory.fix(asFinding(row), actor);
  }
  const status = decision === 'fix' ? 'fixed' : 'dismissed';
  await deps.db.transaction(async (tx) => {
    await tx
      .update(memoryFindings)
      .set({ status, decidedBy: principal.userId, decidedAt: deps.now() })
      .where(and(eq(memoryFindings.tenantId, tenant.id), eq(memoryFindings.id, id)));
    await audit(tx, {
      tenantId: tenant.id,
      actor,
      action: `memory.${decision}`,
      objectType: 'memory_finding',
      objectId: id,
      before: { status: row.status },
      after: { status, code: row.code, page: row.page, detail: row.detail, done },
    });
  });
  return { status, done };
}
