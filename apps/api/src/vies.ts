// VIES (plan §6 PartyAgent `vies.check`): the European Commission's public service that says whether
// another member state's VAT number is valid there. REST API read 2026-10-24 (docs/ONBOARDING.md §5):
// POST {VIES_URL}/check-vat-number, no key. A refusal comes back as HTTP 200 with
// `actionSucceed: false` and an error code; a body it cannot read as HTTP 500 `VOW-ERR-1`.
import type { ViesNumber, ViesVerdict } from '@fi/core';
import { type DbOrTx, desc, eq, vatChecks } from '@fi/db';
import { z } from 'zod';

/** What VIES answered about one number. */
export interface ViesAnswer {
  valid: boolean;
  /** Null when VIES gives none: Germany, for one, never does. */
  name: string | null;
  address: string | null;
  /**
   * Its consultation number, given when our requester number is accepted. TODO(verify): its format
   * with a real French requester (the test service returns ""), docs/ONBOARDING.md §5.1.
   */
  requestIdentifier: string | null;
  requestDate: Date;
}

export interface Vies {
  /**
   * `requester`: the company's own VAT number, so VIES can give a consultation number. Throws
   * ViesUnavailable when VIES could not answer: nothing is known about the number.
   */
  check(number: ViesNumber, requester: string | null): Promise<ViesAnswer>;
}

/** VIES answered nothing about the number: busy, a member state down, a timeout, a blocked number. */
export class ViesUnavailable extends Error {
  constructor(readonly code: string) {
    super(`VIES could not answer: ${code}`);
    this.name = 'ViesUnavailable';
  }
}

const USER_AGENT = 'FactureImpec/1.0 (verification TVA; +https://facture-impec.vercel.app)';

/** "---" stands for « nothing to say » in VIES' answers. */
const text = z
  .string()
  .nullish()
  .transform((v) => {
    const s = v?.trim();
    return s && s !== '---' ? s : null;
  });

const Answer = z.object({
  valid: z.boolean(),
  requestDate: z.iso.datetime({ offset: true }),
  requestIdentifier: text,
  name: text,
  address: text,
});

const Refusal = z.object({
  actionSucceed: z.literal(false),
  errorWrappers: z.array(z.object({ error: z.string() })).default([]),
});

export class ViesClient implements Vies {
  readonly #endpoint: URL;

  constructor(
    baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.#endpoint = new URL('check-vat-number', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  }

  async check(number: ViesNumber, requester: string | null): Promise<ViesAnswer> {
    const answer = await this.#ask(number, requester);
    if (answer !== 'requester') return answer;
    // Our own number refused as requester: VIES still answers, only with no consultation number.
    const again = await this.#ask(number, null);
    if (again === 'requester') throw new ViesUnavailable('INVALID_REQUESTER_INFO');
    return again;
  }

  async #ask(number: ViesNumber, requester: string | null): Promise<ViesAnswer | 'requester'> {
    const body = {
      countryCode: number.country,
      vatNumber: number.number,
      ...(requester && {
        requesterMemberStateCode: requester.slice(0, 2),
        requesterNumber: requester.slice(2),
      }),
    };
    let res: Response;
    let json: unknown;
    try {
      res = await this.fetcher(this.#endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      json = await res.json();
    } catch {
      throw new ViesUnavailable('network');
    }
    const refusal = Refusal.safeParse(json);
    if (refusal.success) {
      const code = refusal.data.errorWrappers[0]?.error ?? 'unknown';
      if (code === 'INVALID_REQUESTER_INFO') return 'requester';
      // The country code is checked before asking, so the number itself is malformed for VIES.
      if (code === 'INVALID_INPUT') {
        return {
          valid: false,
          name: null,
          address: null,
          requestIdentifier: null,
          requestDate: this.now(),
        };
      }
      throw new ViesUnavailable(code);
    }
    const answer = Answer.safeParse(json);
    if (!res.ok || !answer.success) throw new ViesUnavailable(`http_${res.status}`);
    const { requestDate, ...rest } = answer.data;
    return { ...rest, requestDate: new Date(requestDate) };
  }
}

/** VIES' last answer on each number a company's customers use (core RuleContext.buyer.vat). */
export type ViesBook = ReadonlyMap<string, ViesVerdict>;

export async function loadViesBook(db: DbOrTx, tenantId: string): Promise<ViesBook> {
  const rows = await db
    .selectDistinctOn([vatChecks.vatId], { vatId: vatChecks.vatId, valid: vatChecks.valid })
    .from(vatChecks)
    .where(eq(vatChecks.tenantId, tenantId))
    .orderBy(vatChecks.vatId, desc(vatChecks.checkedAt));
  return new Map(rows.map((r) => [r.vatId, r]));
}
