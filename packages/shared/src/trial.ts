import { z } from 'zod';

// Trial-access request sent by the marketing site's form (apps/site → /api/trial).

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? undefined : s))
    .optional();

export const TrialPlan = z.enum(['essentiel', 'croissance', 'cabinet']);
export type TrialPlan = z.infer<typeof TrialPlan>;

export const TrialRequestSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().pipe(z.email().max(200)),
  company: z.string().trim().min(1).max(160),
  // Format only here; the Luhn check belongs to packages/core (M1).
  siren: z
    .string()
    .transform((s) => s.replace(/\s/g, ''))
    .pipe(z.union([z.literal(''), z.string().regex(/^\d{9}$/)]))
    .transform((s) => (s === '' ? undefined : s))
    .optional(),
  profile: z.enum(['company', 'accountant']),
  invoicesPerMonth: z.enum(['lt20', '20to100', '100to500', 'gt500']),
  excel: z.enum(['windows', 'mac', 'web', 'unknown']),
  plan: TrialPlan.optional(),
  message: optionalText(2000),
  consent: z.literal(true),
});

export type TrialRequest = z.infer<typeof TrialRequestSchema>;
