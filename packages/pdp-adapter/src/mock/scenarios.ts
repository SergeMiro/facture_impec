// « Mode test » scenarios on the mock platform (plan §3): POST /scenarios/:id plays a lifecycle event
// now or after a business delay. Only test platforms offer this; the API's ScenarioInjector fakes
// the events where a platform cannot (B2Brouter's sandbox, M4).
import { type PdpReason, PdpRequestError, type PdpStatus, PdpUnavailableError } from '../types';

export interface ScenarioInput {
  account: string;
  pdpRef: string;
  status: Exclude<PdpStatus, 'deposited'>;
  reason?: PdpReason;
  /** ISO 8601 business delay, e.g. "P75D". */
  after?: string;
}

export interface ScenarioPort {
  force(input: ScenarioInput): Promise<void>;
}

/** The platform refused the scenario: the invoice already reached a final status. */
export class ScenarioConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioConflict';
  }
}

export function createMockScenarioPort(options: {
  baseUrl: string;
  fetch?: typeof fetch;
}): ScenarioPort {
  const fetchFn = options.fetch ?? fetch;
  return {
    async force({ pdpRef, status, reason, after }) {
      let res: Response;
      try {
        res = await fetchFn(new URL(`/scenarios/${encodeURIComponent(pdpRef)}`, options.baseUrl), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status, reason, after }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (e) {
        throw new PdpUnavailableError(`mock PDP unreachable: ${String(e)}`, { cause: e });
      }
      if (res.status === 409) throw new ScenarioConflict(await res.text());
      if (res.status >= 500) throw new PdpUnavailableError(`mock PDP answered ${res.status}`);
      if (res.status !== 200) {
        throw new PdpRequestError(`mock PDP answered ${res.status} to a scenario`, res.status);
      }
    },
  };
}
