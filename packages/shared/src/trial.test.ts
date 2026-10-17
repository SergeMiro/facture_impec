import { describe, expect, it } from 'vitest';
import { TrialRequestSchema } from './trial';

const valid = {
  firstName: ' Claire ',
  lastName: 'Martin',
  email: ' Claire.Martin@Example.FR ',
  company: 'Boulangerie Martin',
  siren: '812 345 676',
  profile: 'company',
  invoicesPerMonth: '20to100',
  excel: 'windows',
  message: '',
  consent: true,
};

describe('TrialRequestSchema', () => {
  it('normalises a valid request', () => {
    expect(TrialRequestSchema.parse(valid)).toEqual({
      firstName: 'Claire',
      lastName: 'Martin',
      email: 'claire.martin@example.fr',
      company: 'Boulangerie Martin',
      siren: '812345676',
      profile: 'company',
      invoicesPerMonth: '20to100',
      excel: 'windows',
      message: undefined,
      consent: true,
    });
  });

  it('accepts an empty SIREN and a chosen plan', () => {
    const parsed = TrialRequestSchema.parse({ ...valid, siren: '', plan: 'cabinet' });
    expect(parsed.siren).toBeUndefined();
    expect(parsed.plan).toBe('cabinet');
  });

  it.each([
    ['siren', '81234567'],
    ['email', 'claire@'],
    ['firstName', '   '],
    ['profile', 'freelance'],
    ['plan', 'gratuit'],
    ['consent', false],
  ])('rejects an invalid %s', (field, value) => {
    const result = TrialRequestSchema.safeParse({ ...valid, [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path[0]).toBe(field);
  });
});
