// Screen 3, Tableau de bord (plan §5): the week in a few lines (ReportAgent), « Retrouver une
// facture » for any invoice of the company, then one line per invoice of the sheet, coloured like its
// FI_Statut cell, with « Voir » to open its fiche.
import { t } from '@fi/shared';
import {
  Badge,
  Button,
  Caption1,
  Card,
  Link,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  makeStyles,
  Spinner,
  Subtitle2,
  Text,
  tokens,
} from '@fluentui/react-components';
import type { RowStatus, WeeklyReport } from '../api';
import { namedLikeSource } from '../controller';
import { parisTime, useFi } from './context';
import { InvoiceSearch } from './InvoiceSearch';

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: '10px' },
  bar: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: '4px 8px',
    padding: '8px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  detail: { gridColumn: '1 / -1', color: tokens.colorNeutralForeground2 },
  muted: { color: tokens.colorNeutralForeground3 },
  card: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '10px' },
  todo: { margin: 0, paddingLeft: '20px' },
});

function Week({ report }: { report: WeeklyReport }) {
  const styles = useStyles();
  return (
    <Card className={styles.card} data-testid="weekly">
      <Text weight="semibold">{report.title}</Text>
      {report.numbers.map((n) => (
        <Caption1 key={n}>{n}</Caption1>
      ))}
      {report.actions.length > 0 ? (
        <>
          <Text weight="semibold">{t('report.todo')}</Text>
          <ul className={styles.todo}>
            {report.actions.map((a) => (
              <li key={a}>
                <Caption1>{a}</Caption1>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <Caption1>{t('report.nothing')}</Caption1>
      )}
    </Card>
  );
}

export const BADGE: Record<
  RowStatus['tone'],
  'success' | 'warning' | 'danger' | 'brand' | 'informative'
> = {
  ok: 'success',
  warning: 'warning',
  error: 'danger',
  progress: 'brand',
  neutral: 'informative',
};

export function Dashboard() {
  const styles = useStyles();
  const [state, fi] = useFi();
  const sync = state.sync;
  const busy = state.busy.includes('sync');
  const rows = sync?.result.rows ?? [];
  const errors = rows.filter((r) => r.tone === 'error').length;
  const ready = rows.filter((r) => r.status === 'validated').length;
  // Sheets whose name says orders, delivery notes, purchases or prices, not included yet.
  const suggested = state.otherSheets.filter(namedLikeSource);

  return (
    <section className={styles.section} aria-labelledby="dash-title">
      <Subtitle2 as="h2" id="dash-title">
        {t('addin.dash.sheet', { sheet: state.sheet ?? '' })}
      </Subtitle2>
      <div className={styles.bar}>
        <Button appearance="primary" onClick={() => void fi.sync()} disabled={busy}>
          {t('addin.dash.verify')}
        </Button>
        {busy ? (
          <Spinner size="tiny" label={t('addin.dash.waiting')} />
        ) : (
          sync && <Caption1>{t('addin.dash.lastSync', { time: parisTime(sync.at) })}</Caption1>
        )}
      </div>

      {suggested.length > 0 && (
        <MessageBar intent="info" layout="multiline" data-testid="registry-hint">
          <MessageBarBody>
            {t('addin.registry.hint', {
              sheets: suggested.slice(0, 3).join(', ') + (suggested.length > 3 ? '…' : ''),
            })}
          </MessageBarBody>
          <MessageBarActions>
            <Button size="small" onClick={() => fi.navigate({ name: 'registry' })}>
              {t('addin.registry.open')}
            </Button>
          </MessageBarActions>
        </MessageBar>
      )}

      {state.onedriveHint && (
        <MessageBar intent="info" layout="multiline" data-testid="onedrive-hint">
          <MessageBarBody>{t(`addin.connector.scout.${state.onedriveHint}`)}</MessageBarBody>
          <MessageBarActions>
            <Button size="small" onClick={() => void fi.answerOnedriveHint(true)}>
              {t('addin.connector.scout.open')}
            </Button>
            <Button
              size="small"
              appearance="subtle"
              onClick={() => void fi.answerOnedriveHint(false)}
            >
              {t('addin.connector.scout.later')}
            </Button>
          </MessageBarActions>
        </MessageBar>
      )}

      {state.report ? (
        <Week report={state.report} />
      ) : (
        state.busy.includes('report') && <Spinner size="tiny" label={t('addin.report.loading')} />
      )}

      <InvoiceSearch />

      {sync && (
        <Text weight="semibold" data-testid="counts">
          {t('addin.dash.counts', { total: rows.length, errors, ready })}
        </Text>
      )}
      {sync && rows.length === 0 && <Text>{t('addin.dash.empty')}</Text>}

      <ul className={styles.list}>
        {rows.map((r) => (
          <li key={r.rowKey} className={styles.row} data-testid={`row-${r.rowKey}`}>
            <Text weight="semibold">
              {r.number ?? t('addin.dash.noNumber', { row: r.rows[0] ?? 0 })}
            </Text>
            <Badge appearance="tint" color={BADGE[r.tone]} data-testid="row-status">
              {r.isTest ? t('addin.sheet.testLabel', { label: r.label }) : r.label}
            </Badge>
            <Caption1 className={styles.detail}>{r.detail}</Caption1>
            <Caption1 className={styles.muted}>
              {t('addin.dash.rows', { rows: r.rows.join(', ') })}
            </Caption1>
            {r.invoiceId && (
              <Link onClick={() => r.invoiceId && void fi.openInvoice(r.invoiceId)}>
                {t('addin.dash.view')}
              </Link>
            )}
          </li>
        ))}
      </ul>

      {sync && sync.result.ignoredRows.length > 0 && (
        <Caption1 className={styles.muted}>
          {t('addin.dash.ignored', { count: sync.result.ignoredRows.length })}
        </Caption1>
      )}
      <Caption1 className={styles.muted}>{t('addin.dash.columns')}</Caption1>
    </section>
  );
}
