// Connectors (BTP plan §9, stage 4, docs/DECISIONS.md D9): the frame, the shared mapping, and the
// export connector that reads the lists an ERP exports to Excel or CSV.
export {
  CHANTIER_FIELDS,
  EXPORT_LISTS,
  type ExportList,
  fieldOf,
  guessList,
  TIERS_FIELDS,
} from './export/columns';
export {
  type ExportConfig,
  type ExportRow,
  entityOf,
  exportConnector,
  startRow,
} from './export/connector';
export { EXPORT_ERRORS, type ExportFile, type ExportSheet, readExport } from './export/read';
export { dataRows, type Parsed } from './export/rows';
export {
  type Change,
  type ChantierFields,
  chantierChange,
  customerOf,
  type PartyFields,
  type PartySide,
  partyChange,
} from './mapping';
export {
  ChantierRow,
  ErpAddress,
  Siren,
  Siret,
  SKIP_REASONS,
  type Skipped,
  type SkipReason,
  TiersRow,
} from './schemas';
export {
  BATCH_ROWS,
  CONNECTOR_IDS,
  type Connector,
  type ConnectorId,
  type Cursor,
  ERP_ENTITIES,
  type ErpBatch,
  type ErpEntity,
  type Probe,
} from './types';
