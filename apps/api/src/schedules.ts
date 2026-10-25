// Each periodic task's last run, kept in the database (memory doc §5): after a stop, a task that
// missed its time runs once at start, however many times it was missed. The interval tasks (the
// sweep, chasing and the watchers) run at every start anyway; their row says when they last did.
// A daily task (the runner's dump) is due once its hour has passed since its last run.
import { addDays, parisHour, parisToday } from '@fi/core';
import { type Db, eq, scheduleRuns, sql } from '@fi/db';

export interface ScheduleRun {
  name: string;
  lastRunAt: Date;
  runs: number;
}

/** Writes down that `name` ran at `at`. */
export async function ran(db: Db, name: string, at: Date): Promise<void> {
  await db
    .insert(scheduleRuns)
    .values({ name, lastRunAt: at, runs: 1 })
    .onConflictDoUpdate({
      target: scheduleRuns.name,
      set: { lastRunAt: at, runs: sql`${scheduleRuns.runs} + 1` },
    });
}

export async function lastRun(db: Db, name: string): Promise<ScheduleRun | undefined> {
  const [row] = await db.select().from(scheduleRuns).where(eq(scheduleRuns.name, name));
  return row;
}

export const scheduleRunsNow = (db: Db): Promise<ScheduleRun[]> =>
  db.select().from(scheduleRuns).orderBy(scheduleRuns.name);

/** Paris day and hour, sortable as text: « 2026-10-27 03 ». */
const parisSlot = (day: string, hour: number) => `${day} ${String(hour).padStart(2, '0')}`;

/**
 * Whether a task run every day at `hour` (Paris) is due at `now`: never run, or last run before the
 * latest `hour` that has passed. Two missed days make it due once, not twice.
 */
export function dailyDue(last: Date | undefined, now: Date, hour: number): boolean {
  if (!last) return true;
  const today = parisToday(now);
  const slot = parisSlot(parisHour(now) >= hour ? today : addDays(today, -1), hour);
  return parisSlot(parisToday(last), parisHour(last)) < slot;
}
