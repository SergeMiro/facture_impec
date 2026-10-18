// Platform events → our state machine (plan §8: "status mapping table lives in code with tests").
// The French lifecycle behind each line is in docs/B2BROUTER.md §7.
import type { InvoiceEvent } from '@fi/core';
import type { PdpStatus } from './types';

export const PDP_STATUS_EVENTS = {
  deposited: 'deposited', // 200 Déposée
  received_by_platform: 'delivered', // 202 Reçue: B2Brouter has no separate « mise à disposition »
  delivered: 'delivered', // 203 Mise à disposition
  accepted: 'accepted', // 205 Approuvée
  refused: 'refused_by_customer', // 210 Refusée
  payment_received: 'paid', // 212 Encaissée
  rejected: 'rejected_by_pdp', // 213 Rejetée
} as const satisfies Record<PdpStatus, InvoiceEvent>;

/** The state-machine event a platform status triggers; null for a status we do not know. */
export function eventFor(status: PdpStatus | 'unknown'): InvoiceEvent | null {
  return status === 'unknown' ? null : PDP_STATUS_EVENTS[status];
}
