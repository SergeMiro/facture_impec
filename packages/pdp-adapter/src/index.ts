// PdpAdapter (plan §8) and its implementations: the mock platform and B2Brouter (docs/B2BROUTER.md).
// Business code imports from here and never calls a platform directly.
export {
  B2BROUTER_RULES,
  type B2BrouterAdapterOptions,
  createB2BrouterAdapter,
  history as b2brouterHistory,
} from './b2brouter/adapter';
export * from './b2brouter/protocol';
export * from './b2brouter/states';
export { eventFor, PDP_STATUS_EVENTS } from './mapping';
export { createMockPdpAdapter, type MockAdapterOptions } from './mock/adapter';
export * from './mock/protocol';
export * from './mock/scenarios';
export { SIGNATURE_TOLERANCE_SECONDS, signWebhook, verifyWebhookSignature } from './signature';
export * from './types';
