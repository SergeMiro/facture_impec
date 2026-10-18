// Excel sheets (plan §5, §6 MappingAgent): cells with addresses, the field mapping, sheet → drafts.
export * from './build';
export * from './cells';
export {
  detectGrouping,
  detectMapping,
  headerScore,
  isTotalRow,
  missingFieldWarnings,
  normalizeHeader,
  SYNONYMS,
} from './detect';
export * from './fields';
export * from './grid';
export * from './values';
