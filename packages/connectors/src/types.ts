// The connector frame (BTP plan §9, stage 4, docs/DECISIONS.md D9): a connector reads an ERP and
// gives its rows in batches, each with the cursor it reached; the shared mapping (src/mapping.ts)
// turns the rows into companies and chantiers, the API writes them. Read-only: a connector never
// writes to the ERP.

/** What an ERP lists (BTP plan §9 `ErpBatch.entity`). */
export const ERP_ENTITIES = ['tiers', 'chantier', 'facture', 'situation', 'reglement'] as const;
export type ErpEntity = (typeof ERP_ENTITIES)[number];

/** The connectors of the plan; `export` reads the lists an ERP exports to Excel or CSV (D5). */
export const CONNECTOR_IDS = ['export', 'ebp', 'batigest', 'onaya', 'pdp'] as const;
export type ConnectorId = (typeof CONNECTOR_IDS)[number];

/** Where a connector stopped, as JSON (`connector_syncs.cursor_json`); the next pull starts there. */
export type Cursor = Readonly<Record<string, string | number | boolean | null>>;

/** Rows of one entity, at most `BATCH_ROWS`, and the cursor once they are written. */
export interface ErpBatch<Row = unknown> {
  entity: ErpEntity;
  rows: readonly Row[];
  nextCursor: Cursor;
}

export const BATCH_ROWS = 500;

export interface Probe {
  ok: boolean;
  /** The ERP's version, when it says. */
  version?: string;
  detail?: string;
}

export interface Connector<Config, Row = unknown> {
  readonly id: ConnectorId;
  probe(cfg: Config): Promise<Probe>;
  /** From `cursor`, or everything when it is null. */
  pull(cfg: Config, cursor: Cursor | null): AsyncIterable<ErpBatch<Row>>;
}
