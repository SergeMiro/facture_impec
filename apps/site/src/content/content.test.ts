import { TrialRequestSchema } from '@fi/shared';
import { describe, expect, it } from 'vitest';
import { faqs, offer } from './site';
import { fieldErrors } from './trial-form';

describe('the offer', () => {
  it('is the price the owner set, and the FAQ quotes the same one', () => {
    expect(offer.price).toBe(2.99);
    const quoted = faqs.filter((f) => f.a.includes('€ HT par mois'));
    expect(quoted.length).toBeGreaterThan(0);
    for (const f of quoted) expect(f.a).toContain('2,99 € HT par mois');
  });

  it('no longer names the old plans', () => {
    const copy = JSON.stringify({ offer, faqs });
    expect(copy).not.toMatch(/Essentiel|Croissance|offre Cabinet|IA est incluse/);
  });
});

describe('trial form copy', () => {
  it('has a French error message for every field of the request', () => {
    expect(Object.keys(fieldErrors).sort()).toEqual(Object.keys(TrialRequestSchema.shape).sort());
  });
});
