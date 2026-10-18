import { describe, expect, it } from 'vitest';
import {
  advance,
  type ChaseStep,
  chaseKind,
  endSteps,
  nextStepOn,
  planSteps,
  reschedule,
} from './chase';

const DUE = '2026-11-16';
/** 10:00 in Paris (UTC+1 in November). */
const parisAt = (date: string, hour = 10) =>
  new Date(`${date}T${String(hour - 1).padStart(2, '0')}:00:00Z`);

describe('chase plan', () => {
  it('gives the default cadence its tones and dates (plan §6)', () => {
    const steps = planSteps([-3, 1, 8, 15, 30], DUE);
    expect(steps.map((s) => [s.offset, s.kind, s.date])).toEqual([
      [-3, 'courtesy', '2026-11-13'],
      [1, 'reminder', '2026-11-17'],
      [8, 'reminder', '2026-11-24'],
      [15, 'firm', '2026-12-01'],
      [30, 'formal_notice', '2026-12-16'],
    ]);
    expect(steps.every((s) => s.status === 'pending' && s.draft === null)).toBe(true);
  });

  it('keeps the same tone for the same delay in a company cadence, sorted and once each', () => {
    expect([0, 14, 29, 45].map(chaseKind)).toEqual([
      'courtesy',
      'reminder',
      'firm',
      'formal_notice',
    ]);
    expect(planSteps([15, 7, -3, 7], DUE).map((s) => s.offset)).toEqual([-3, 7, 15]);
  });

  it('acts on the step of the day from 9:00 Paris, not before', () => {
    const steps = planSteps([-3, 1], DUE);
    expect(advance(steps, parisAt('2026-11-13', 8)).act).toBeNull();
    expect(advance(steps, parisAt('2026-11-13', 9)).act).toBe(0);
    expect(advance(steps, parisAt('2026-11-12', 23)).act).toBeNull();
  });

  it('skips the steps missed meanwhile and a draft never sent, instead of a burst', () => {
    const steps = planSteps([-3, 1, 8], DUE);
    steps[0] = { ...(steps[0] as ChaseStep), status: 'drafted', reason: 'review' };
    const now = parisAt('2026-11-25', 7); // the day after J+8, early: yesterday's step is due
    const { act, steps: after } = advance(steps, now);
    expect(act).toBe(2);
    expect(after.map((s) => [s.status, s.reason])).toEqual([
      ['skipped', 'superseded'],
      ['skipped', 'superseded'],
      ['pending', null],
    ]);
    expect(after[0]?.at).toBe(now.toISOString());
  });

  it('holds every step while a payment promise runs, then acts on the latest one', () => {
    const steps = planSteps([1, 8, 15], DUE);
    expect(advance(steps, parisAt('2026-11-30'), '2026-11-30').act).toBeNull();
    const { act, steps: after } = advance(steps, parisAt('2026-12-01'), '2026-11-30');
    expect(act).toBe(2);
    expect(after.filter((s) => s.status === 'skipped')).toHaveLength(2);
  });

  it('reschedules what is still pending after a new cadence, keeping what was done', () => {
    const steps = planSteps([-3, 1, 8, 15], DUE);
    steps[0] = { ...(steps[0] as ChaseStep), status: 'sent', by: 'agent' };
    steps[1] = { ...(steps[1] as ChaseStep), status: 'drafted', reason: 'review' };
    const next = reschedule(steps, [-3, 7, 15, 30], '2026-11-20');
    expect(next.map((s) => [s.offset, s.status, s.date])).toEqual([
      [-3, 'sent', '2026-11-13'],
      [1, 'drafted', '2026-11-17'],
      [7, 'pending', '2026-11-27'],
      [15, 'pending', '2026-12-05'],
      [30, 'pending', '2026-12-20'],
    ]);
    expect(nextStepOn(next)).toBe('2026-11-27');
    expect(reschedule([], [1], DUE)).toHaveLength(1);
  });

  it('cancels what is left when the plan ends', () => {
    const steps = planSteps([-3, 1, 8], DUE);
    steps[0] = { ...(steps[0] as ChaseStep), status: 'sent', by: 'agent' };
    steps[1] = { ...(steps[1] as ChaseStep), status: 'drafted', reason: 'review' };
    const ended = endSteps(steps, parisAt('2026-11-20'));
    expect(ended.map((s) => [s.status, s.reason])).toEqual([
      ['sent', null],
      ['cancelled', 'ended'],
      ['cancelled', 'ended'],
    ]);
    expect(nextStepOn(ended)).toBeNull();
  });
});
