// Excel sheets (plan §5, §6 MappingAgent): cells with addresses, the field mapping, sheet → drafts.
export * from './build';
export * from './cells';
export * from './company';
export {
  detectGrouping,
  detectMapping,
  headerScore,
  isTotalRow,
  missingFieldWarnings,
  normalizeHeader,
  notAnAmount,
  SYNONYMS,
} from './detect';
export * from './fields';
export * from './file';
export * from './grid';
export * from './values';
