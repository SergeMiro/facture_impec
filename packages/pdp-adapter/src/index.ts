// PdpAdapter (plan §8) and its implementations: the mock now, B2Brouter in M4 (docs/B2BROUTER.md).
// Business code imports from here and never calls a platform directly.
export { eventFor, PDP_STATUS_EVENTS } from './mapping';
export { createMockPdpAdapter, type MockAdapterOptions } from './mock/adapter';
export * from './mock/protocol';
export * from './mock/scenarios';
export { SIGNATURE_TOLERANCE_SECONDS, signWebhook, verifyWebhookSignature } from './signature';
export * from './types';
