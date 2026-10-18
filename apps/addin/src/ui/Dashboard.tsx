// Screen 3, Tableau de bord (plan §5): one line per invoice of the sheet, coloured like its
// FI_Statut cell, with « Voir » to open its fiche.
import { t } from '@fi/shared';
import {
  Badge,
  Button,
  Caption1,
  Link,
  makeStyles,
  Spinner,
  Subtitle2,
  Text,
  tokens,
} from '@fluentui/react-components';
import type { RowStatus } from '../api';
import { parisTime, useFi } from './context';

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
});

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
