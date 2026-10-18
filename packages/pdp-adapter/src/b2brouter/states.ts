// B2Brouter invoice states → our platform statuses (docs/B2BROUTER.md §7; plan §8: "status mapping
// table lives in code with tests"). B2Brouter gives the current state, not a history we can read
// (§11 T11), so each state lists the statuses it proves the invoice went through, oldest first: an
// invoice now `registered` was `sent` before. Each one becomes an event with a stable id, applied once.
import type { PdpStatus } from '../types';

const DEPOSITED = ['deposited'] as const;
const RECEIVED = ['deposited', 'received_by_platform'] as const;

export const B2BROUTER_STATE_PATH = {
  new: [], // imported, not sent
  sending: [],
  sent: DEPOSITED, // 200 Déposée
  registered: RECEIVED, // 202 Reçue
  read: [...RECEIVED, 'delivered'], // 204 Prise en charge: stays « delivered » for us
  accepted: [...RECEIVED, 'accepted'], // 205 Approuvée (206 partielle: TODO(verify) T7/§7)
  refused: [...RECEIVED, 'refused'], // 210 Refusée
  paid: [...RECEIVED, 'payment_received'], // 212 Encaissée
  error: [...DEPOSITED, 'rejected'], // transmission failed after sending (PEPPOL_NO_RECEIVER)
} as const satisfies Record<string, readonly PdpStatus[]>;

export type KnownB2bState = keyof typeof B2BROUTER_STATE_PATH;

/**
 * The statuses a B2Brouter state proves, or null for a state whose meaning is not documented
 * (`annulled`, `allegedly_paid`, `closed`…): TODO(verify) docs/B2BROUTER.md §11 T8. Those are kept
 * raw on the timeline and change nothing.
 */
export function pathOf(state: string): readonly PdpStatus[] | null {
  return Object.hasOwn(B2BROUTER_STATE_PATH, state)
    ? B2BROUTER_STATE_PATH[state as KnownB2bState]
    : null;
}

/** The B2Brouter state each of our statuses stands for, for timestamps found in the events list. */
export const STATE_OF_STATUS: Record<PdpStatus, KnownB2bState> = {
  deposited: 'sent',
  received_by_platform: 'registered',
  delivered: 'read',
  accepted: 'accepted',
  refused: 'refused',
  payment_received: 'paid',
  rejected: 'error',
};

/**
 * A response document announcing a rejection (213 Rejetée). TODO(verify): docs/B2BROUTER.md §11 T7 —
 * how 213 shows on an issued invoice is not documented; any `…rejected` event name counts.
 */
export const isRejectionResponse = (eventName: string) => /reject/i.test(eventName);
