// The vocabulary of the BTP back end (docs/DECISIONS.md): the kinds, statuses and messages every
// package shares. It imports nothing from the monorepo, so any package may import it.
export {
  APPROVAL_CHANNELS,
  ApprovalChannel,
  ApprovalDecision,
  DECISIONS,
  Decision,
  LINK_DECISIONS,
  type LinkDecision,
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
export { EXPORT_LISTS, type ExportList, SKIP_REASONS, type SkipReason } from './erp';
export { FatalError, isFatal, RetryableError } from './errors';
export {
  ACTION_KINDS,
  ACTION_STATUSES,
  ActionKind,
  ActionStatus,
  DEADLINE_DATE,
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
  STANDING_KINDS,
} from './kinds';
