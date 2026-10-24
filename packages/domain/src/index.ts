// The vocabulary of the BTP back end (docs/DECISIONS.md): the kinds, statuses and messages every
// package shares. It imports nothing from the monorepo, so any package may import it.
export {
  APPROVAL_CHANNELS,
  ApprovalChannel,
  ApprovalDecision,
  DECISIONS,
  Decision,
  MAX_SNOOZE_DAYS,
} from './approval';
export {
  DOCUMENT_MIMES,
  DocumentEnvelope,
  DocumentMime,
  EnvelopeHints,
  MAX_DOCUMENT_BYTES,
  Sha256,
  StructuredPayload,
} from './envelope';
export { FatalError, isFatal, RetryableError } from './errors';
export {
  ACTION_KINDS,
  ACTION_STATUSES,
  ActionKind,
  ActionStatus,
  DOCUMENT_KINDS,
  DOCUMENT_SOURCES,
  DOCUMENT_STAGES,
  DocumentKind,
  DocumentSource,
  DocumentStage,
  INVOICE_KINDS,
  OBLIGATION_KINDS,
  OBLIGATION_STATUSES,
  ObligationKind,
  ObligationStatus,
} from './kinds';
