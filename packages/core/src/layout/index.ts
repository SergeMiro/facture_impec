// The company's other sheets (R1): orders, delivery notes, purchases, price lists → the registry.
export {
  detectColumns,
  detectKind,
  detectLayout,
  headerSignature,
  headerSignatures,
  kindFromName,
  layoutHeaderScore,
  layoutWarnings,
} from './detect';
export * from './fields';
export * from './read';
