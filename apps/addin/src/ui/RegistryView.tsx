// Registre (R1): the workbook's other sheets — orders, delivery notes, purchases, price lists. The
// company says what a sheet holds once (« Inclure cette feuille »); then every change to it is read
// into the registry next to the invoices, and « Retirer » takes it out again.
import {
  fieldAllowed,
  frDate,
  frMoney,
  isDocKind,
  LAYOUT_FIELDS,
  LAYOUT_KINDS,
  type LayoutField,
  type LayoutKind,
  type LayoutMapping,
} from '@fi/core';
import { type MessageKey, t } from '@fi/shared';
import {
  Badge,
  Button,
  Caption1,
  Card,
  Field,
  Link,
  MessageBar,
  MessageBarBody,
  makeStyles,
  Select,
  SpinButton,
  Spinner,
  Subtitle2,
  Text,
  tokens,
} from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import type { Source } from '../api';
import type { Header, Inclusion } from '../controller';
import { parisDateTime, parisTime, useFi } from './context';

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: '10px' },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  card: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px' },
  line: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  field: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', alignItems: 'center' },
  label: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' },
  doc: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: '2px 8px',
    padding: '6px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  muted: { color: tokens.colorNeutralForeground3 },
});

const KIND: Record<LayoutKind, MessageKey> = {
  order: 'layout.kind.order',
  delivery: 'layout.kind.delivery',
  purchase: 'layout.kind.purchase',
  price_list: 'layout.kind.price_list',
  invoice: 'layout.kind.invoice',
  other: 'layout.kind.other',
};

const FIELD: Record<LayoutField, MessageKey> = {
  docNumber: 'layout.field.docNumber',
  docDate: 'layout.field.docDate',
  partyName: 'layout.field.partyName',
  partySiren: 'layout.field.partySiren',
  orderRef: 'layout.field.orderRef',
  itemRef: 'layout.field.itemRef',
  itemName: 'layout.field.itemName',
  quantity: 'layout.field.quantity',
  unit: 'layout.field.unit',
  unitPrice: 'layout.field.unitPrice',
  lineNet: 'layout.field.lineNet',
  vatRate: 'layout.field.vatRate',
};

/** Below it the pane asks the company to look at the kind (as for a doubtful column). */
const SURE = 0.8;

const columnLabel = (h: Header) =>
  h.text ? t('addin.detect.column', { col: h.col, header: h.text }) : h.col;

export function RegistryView() {
  const styles = useStyles();
  const [state, fi] = useFi();
  const { registry, inclusion, sources, otherSheets } = state;

  return (
    <section className={styles.section} aria-labelledby="registry-title">
      <Subtitle2 as="h2" id="registry-title">
        {t('addin.registry.title')}
      </Subtitle2>
      <Text>{t('addin.registry.intro')}</Text>

      {inclusion && <Confirm key={inclusion.sheet} inclusion={inclusion} />}

      <Text weight="semibold">{t('addin.registry.sources')}</Text>
      {state.sheet && state.mapping && <InvoiceCard sheet={state.sheet} />}
      {sources.length === 0 ? (
        <Caption1 className={styles.muted}>{t('addin.registry.noSources')}</Caption1>
      ) : (
        <ul className={styles.list}>
          {sources.map((s) => (
            <li key={s.id}>
              <SourceCard source={s} />
            </li>
          ))}
        </ul>
      )}

      {otherSheets.length > 0 && (
        <>
          <Text weight="semibold">{t('addin.registry.others')}</Text>
          <ul className={styles.list}>
            {otherSheets.map((sheet) => (
              <li key={sheet} className={styles.line} data-testid={`other-${sheet}`}>
                <Text>{sheet}</Text>
                <Button
                  size="small"
                  onClick={() => void fi.includeSheet(sheet)}
                  disabled={state.busy.includes(`include:${sheet}`)}
                >
                  {t('addin.registry.include')}
                </Button>
                {state.busy.includes(`include:${sheet}`) && <Spinner size="tiny" />}
              </li>
            ))}
          </ul>
        </>
      )}

      <Text weight="semibold">{t('addin.registry.totals')}</Text>
      {!registry ? (
        state.busy.includes('registry') && (
          <Spinner size="tiny" label={t('addin.registry.loading')} />
        )
      ) : (
        <>
          <Caption1>{t('addin.registry.invoices', registry.invoices)}</Caption1>
          {registry.suppliers > 0 && (
            <Caption1>{t('addin.registry.suppliers', { count: registry.suppliers })}</Caption1>
          )}
          <Text weight="semibold">{t('addin.registry.recent')}</Text>
          {registry.recent.length === 0 ? (
            <Caption1 className={styles.muted}>{t('addin.registry.noDocs')}</Caption1>
          ) : (
            <ul className={styles.list}>
              {registry.recent.map((d) => (
                <li key={d.id} className={styles.doc} data-testid={`doc-${d.id}`}>
                  <Text weight="semibold">{d.number ?? t('addin.registry.noNumber')}</Text>
                  <Badge appearance="tint" color="informative">
                    {t(KIND[d.kind])}
                  </Badge>
                  <Caption1>
                    {[d.partyName, d.issueDate && frDate(d.issueDate)].filter(Boolean).join(' · ')}
                  </Caption1>
                  <Caption1>
                    {d.netTotal !== null &&
                      t('addin.registry.amount', { amount: frMoney(d.netTotal, 'EUR') })}
                  </Caption1>
                  {d.sheet && (
                    <Caption1 className={styles.muted}>
                      {t('addin.registry.fromSheet', { sheet: d.sheet })}
                    </Caption1>
                  )}
                  {d.cell && (
                    <Link onClick={() => d.cell && void fi.fixInSheet(d.cell)}>
                      {t('addin.registry.showDoc')}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** The invoice sheet, checked on the Tableau de bord: its card leads there. */
function InvoiceCard({ sheet }: { sheet: string }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const sync = state.sync;
  return (
    <Card className={styles.card} data-testid="invoice-sheet">
      <span className={styles.line}>
        <Text weight="semibold">{sheet}</Text>
        <Badge appearance="tint" color="brand">
          {t(KIND.invoice)}
        </Badge>
      </span>
      {sync && (
        <>
          <Caption1>
            {t('addin.registry.invoiceStats', { count: sync.result.rows.length })}
          </Caption1>
          <Caption1 className={styles.muted}>
            {t('addin.dash.lastSync', { time: parisTime(sync.at) })}
          </Caption1>
        </>
      )}
      <span className={styles.line}>
        <Button size="small" onClick={() => fi.navigate({ name: 'dashboard' })}>
          {t('addin.registry.openInvoices')}
        </Button>
      </span>
    </Card>
  );
}

function SourceCard({ source: s }: { source: Source }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const busy = state.busy.includes(`source:${s.sheet}`);
  const missing = state.sheets.length > 0 && !state.sheets.includes(s.sheet);
  const stats = s.stats;
  return (
    <Card className={styles.card} data-testid={`source-${s.sheet}`}>
      <span className={styles.line}>
        <Text weight="semibold">{s.sheet}</Text>
        <Badge appearance="tint" color="brand">
          {t(KIND[s.kind])}
        </Badge>
        {busy && <Spinner size="tiny" />}
      </span>
      {stats && (
        <Caption1>
          {t('addin.registry.stats', { rows: stats.rows, docs: stats.docs, lines: stats.lines })}
        </Caption1>
      )}
      <Caption1 className={styles.muted}>
        {s.readAt
          ? t('addin.registry.readAt', { time: parisDateTime(s.readAt) })
          : t('addin.registry.notRead')}
      </Caption1>
      {s.changedAt && (
        <Caption1 className={styles.muted}>
          {t('addin.registry.changedAt', { time: parisDateTime(s.changedAt) })}
        </Caption1>
      )}
      {stats && stats.unreadRows > 0 && (
        <Caption1>{t('addin.registry.unread', { count: stats.unreadRows })}</Caption1>
      )}
      {missing ? (
        <MessageBar intent="warning" layout="multiline">
          <MessageBarBody>{t('addin.registry.missing')}</MessageBarBody>
        </MessageBar>
      ) : (
        stats?.headerFound === false && (
          <MessageBar intent="warning" layout="multiline">
            <MessageBarBody>{t('addin.registry.headerMissing')}</MessageBarBody>
          </MessageBar>
        )
      )}
      <span className={styles.line}>
        {!missing && (
          <>
            <Button size="small" onClick={() => void fi.syncSource(s.sheet)} disabled={busy}>
              {t('addin.registry.readNow')}
            </Button>
            <Button size="small" appearance="subtle" onClick={() => void fi.showSheet(s.sheet)}>
              {t('addin.registry.show')}
            </Button>
            <Button
              size="small"
              appearance="subtle"
              onClick={() => void fi.includeSheet(s.sheet)}
              disabled={state.busy.includes(`include:${s.sheet}`)}
            >
              {t('addin.registry.review')}
            </Button>
          </>
        )}
        <Button
          size="small"
          appearance="subtle"
          onClick={() => void fi.removeSource(s.sheet)}
          disabled={busy}
        >
          {t('addin.registry.remove')}
        </Button>
      </span>
    </Card>
  );
}

/** What the sheet holds, as proposed: the company checks the kind and the columns, then says yes. */
function Confirm({ inclusion }: { inclusion: Inclusion }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const proposal = inclusion.detection;
  const [draft, setDraft] = useState<LayoutMapping>(proposal.layout);
  const [headers, setHeaders] = useState<Header[]>(inclusion.headers);

  useEffect(() => {
    setDraft(proposal.layout);
    setHeaders(inclusion.headers);
  }, [proposal, inclusion.headers]);

  const update = (patch: Partial<LayoutMapping>) =>
    setDraft({ ...draft, ...patch, source: 'user' });
  const setKind = (kind: LayoutKind) => {
    // A column of a field the new kind does not read is dropped (a price list has no customer).
    const mapping = Object.fromEntries(
      Object.entries(draft.mapping).filter(([f]) => fieldAllowed(kind, f as LayoutField)),
    );
    update({ kind, kindConfidence: 1, mapping });
  };
  const setColumn = (field: LayoutField, col: string) => {
    const mapping = { ...draft.mapping };
    if (col) mapping[field] = { column: col, confidence: 1, needsConfirmation: false };
    else delete mapping[field];
    update({ mapping });
  };
  const fields = LAYOUT_FIELDS.filter((f) => fieldAllowed(draft.kind, f));
  const toConfirm = Object.values(draft.mapping).filter((m) => m?.needsConfirmation).length;
  const readable = isDocKind(draft.kind);

  const confirm = () => {
    // Confirming is the company's decision on every column, including the doubtful ones.
    const mapping = Object.fromEntries(
      Object.entries(draft.mapping).map(([f, m]) => [f, m && { ...m, needsConfirmation: false }]),
    );
    void fi.confirmLayout({ ...draft, mapping, kindConfidence: 1 });
  };

  return (
    <Card className={styles.card} data-testid="inclusion">
      <Text weight="semibold">{t('addin.registry.confirmTitle', { sheet: inclusion.sheet })}</Text>
      <Caption1>{t('addin.registry.confirmIntro')}</Caption1>
      {proposal.profile && (
        <MessageBar intent="success" layout="multiline">
          <MessageBarBody>{t('addin.registry.profile')}</MessageBarBody>
        </MessageBar>
      )}
      {draft.warnings.length > 0 && (
        <MessageBar intent="warning" layout="multiline">
          <MessageBarBody>
            {draft.warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </MessageBarBody>
        </MessageBar>
      )}

      <Field
        label={
          <span className={styles.label}>
            {t('addin.registry.kind')}
            {draft.kindConfidence < SURE && (
              <Badge appearance="tint" color="warning">
                {t('addin.detect.toConfirm')}
              </Badge>
            )}
          </span>
        }
      >
        <Select value={draft.kind} onChange={(_, d) => setKind(d.value as LayoutKind)}>
          {LAYOUT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(KIND[k])}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t('addin.detect.headerRow')}>
        <SpinButton
          min={1}
          value={draft.headerRow}
          onChange={(_, d) => {
            const row = d.value ?? Number(d.displayValue);
            if (Number.isInteger(row) && row > 0) {
              update({ headerRow: row });
              setHeaders(fi.inclusionHeaders(row));
            }
          }}
        />
      </Field>

      {readable &&
        fields.map((field) => {
          const current = draft.mapping[field];
          return (
            <div key={field} className={styles.field} data-testid={`layout-${field}`}>
              <span className={styles.label}>
                <Text>{t(FIELD[field])}</Text>
                {current?.needsConfirmation && (
                  <Badge appearance="tint" color="warning">
                    {t('addin.detect.toConfirm')}
                  </Badge>
                )}
              </span>
              <Select
                aria-label={t(FIELD[field])}
                value={current?.column ?? ''}
                onChange={(_, d) => setColumn(field, d.value)}
              >
                <option value="">{t('addin.detect.none')}</option>
                {headers.map((h) => (
                  <option key={h.col} value={h.col}>
                    {columnLabel(h)}
                  </option>
                ))}
              </Select>
            </div>
          );
        })}

      {!readable && (
        <MessageBar intent="info" layout="multiline">
          <MessageBarBody>{t('addin.registry.notReadable')}</MessageBarBody>
        </MessageBar>
      )}
      {readable && toConfirm > 0 && (
        <MessageBar intent="info">
          <MessageBarBody>{t('addin.detect.needsConfirm', { count: toConfirm })}</MessageBarBody>
        </MessageBar>
      )}
      {readable && <Caption1 className={styles.muted}>{t('addin.registry.consent')}</Caption1>}

      <span className={styles.line}>
        <Button
          appearance="primary"
          onClick={confirm}
          disabled={!readable || state.busy.includes('include')}
        >
          {t('addin.registry.confirm')}
        </Button>
        <Button appearance="subtle" onClick={fi.cancelInclusion}>
          {t('addin.registry.cancel')}
        </Button>
      </span>
    </Card>
  );
}
