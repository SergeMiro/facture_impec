// Excel sheets (plan §5, §6 MappingAgent): cells with addresses, the field mapping, sheet → drafts.
export * from './build';
export * from './cells';
export { detectMapping, headerScore, isTotalRow, normalizeHeader, SYNONYMS } from './detect';
export * from './fields';
export * from './values';
