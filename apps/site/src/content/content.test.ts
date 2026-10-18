import { TrialRequestSchema } from '@fi/shared';
import { describe, expect, it } from 'vitest';
import { plans } from './site';
import { fieldErrors, planOptions } from './trial-form';

describe('plans', () => {
  it('gives two months free on the yearly price, give or take rounding', () => {
    for (const plan of plans) {
      expect(plan.yearlyPerMonth).toBeLessThan(plan.monthly);
      expect(Math.abs(plan.yearlyPerMonth * 12 - plan.monthly * 10)).toBeLessThanOrEqual(12);
    }
  });

  it('offers exactly the plans the trial form accepts', () => {
    expect(plans.map((p) => p.id)).toEqual(planOptions.map((o) => o.value));
  });
});

describe('trial form copy', () => {
  it('has a French error message for every field of the request', () => {
    expect(Object.keys(fieldErrors).sort()).toEqual(Object.keys(TrialRequestSchema.shape).sort());
  });
});
