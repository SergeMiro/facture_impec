// A stand-in for the VIES REST API (docs/ONBOARDING.md §4), served at /vies: POST /check-vat-number
// answered as the real one answered on 2026-10-24 — a refusal is HTTP 200 with `actionSucceed: false`.
// Synthetic only: every well-formed number is valid, made-up name and address, except a few numbers
// that play the cases the API must handle. No real company.
import { Hono } from 'hono';
import { z } from 'zod';

/** Numbers that play a case, as country code + number. */
export const VIES_CASES = {
  /** VIES knows the number and says it is not valid. */
  invalid: 'DE999999999',
  /** VIES finds the number malformed: INVALID_INPUT. */
  malformed: 'ES00',
  /** The member state's service is busy: MS_MAX_CONCURRENT_REQ. */
  busy: 'IT00000000000',
  /** The member state's service is down: MS_UNAVAILABLE. */
  down: 'BE0000000000',
  /** As a requester number: INVALID_REQUESTER_INFO. */
  refusedRequester: 'FR00000000000',
} as const;

const Body = z.object({
  countryCode: z.string(),
  vatNumber: z.string(),
  requesterMemberStateCode: z.string().optional(),
  requesterNumber: z.string().optional(),
});

const refusal = (error: string) => ({ actionSucceed: false, errorWrappers: [{ error }] });

export function viesStandIn(now: () => Date = () => new Date()): Hono {
  const app = new Hono();
  let consultations = 0;
  app.post('/check-vat-number', async (c) => {
    const body = Body.parse(await c.req.json());
    const vatId = `${body.countryCode}${body.vatNumber}`;
    const requester = `${body.requesterMemberStateCode ?? ''}${body.requesterNumber ?? ''}`;
    if (requester === VIES_CASES.refusedRequester) return c.json(refusal('INVALID_REQUESTER_INFO'));
    if (vatId === VIES_CASES.busy) return c.json(refusal('MS_MAX_CONCURRENT_REQ'));
    if (vatId === VIES_CASES.down) return c.json(refusal('MS_UNAVAILABLE'));
    if (vatId === VIES_CASES.malformed || !/^[0-9A-Z+*]{2,12}$/.test(body.vatNumber)) {
      return c.json(refusal('INVALID_INPUT'));
    }
    const valid = vatId !== VIES_CASES.invalid;
    // Germany gives neither name nor address, as the real service does.
    const told = valid && body.countryCode !== 'DE';
    return c.json({
      countryCode: body.countryCode,
      vatNumber: body.vatNumber,
      requestDate: now().toISOString(),
      valid,
      requestIdentifier: requester ? `WAPIDEMO${String(++consultations).padStart(8, '0')}` : '',
      name: told ? `SOCIETE DE DEMONSTRATION ${vatId.slice(-4)}` : '---',
      address: told ? '1 RUE DES EXEMPLES\n1000 EXEMPLEVILLE' : '---',
    });
  });
  return app;
}
