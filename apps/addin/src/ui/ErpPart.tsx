// « Votre logiciel de gestion » in Réglages (BTP plan stage 4C, `docs/plans/phase-4.md`): a list
// exported from Batigest, EBP or another ERP is given here; each list's last import says what it
// did and which rows it left out, by reason. What comes from the ERP is real, « Mode test » or not.
import { EXPORT_LISTS } from '@fi/domain';
import { isMessageKey, t } from '@fi/shared';
import {
  Badge,
  Button,
  Caption1,
  Card,
  Field,
  Link,
  makeStyles,
  Select,
  Spinner,
  Subtitle2,
  Text,
  tokens,
} from '@fluentui/react-components';
import { useRef, useState } from 'react';
import type { ErpImport, ErpList } from '../api';
import { parisDateTime, useFi } from './context';

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: '8px' },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  card: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '10px' },
  line: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  head: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' },
  muted: { color: tokens.colorNeutralForeground3 },
  error: { color: tokens.colorPaletteRedForeground1 },
  reasons: { margin: 0, paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '2px' },
});

/** The files the browser lets the person choose: what the API reads. */
const ACCEPT = '.xlsx,.csv';

const STATUS_COLOR = { running: 'informative', done: 'success', failed: 'danger' } as const;

/** How a list words what it did: companies and chantiers, invoices, or payments. */
const COUNTS = {
  customers: 'addin.erp.counts.tiers',
  suppliers: 'addin.erp.counts.tiers',
  chantiers: 'addin.erp.counts.tiers',
  invoices: 'addin.erp.counts.invoices',
  payments: 'addin.erp.counts.payments',
} as const;

/** The reasons rows were left out, the most frequent first, each with its first rows. */
export function skippedOf(item: Pick<ErpImport, 'skipped' | 'examples'>) {
  return Object.entries(item.skipped)
    .filter(([, count]) => count > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([reason, count]) => {
      const key = `erp.skip.${reason}`;
      return {
        reason,
        label: isMessageKey(key) ? t(key) : t('addin.erp.otherReason'),
        count,
        rows: item.examples.filter((e) => e.reason === reason),
      };
    });
}

function Imported({ list, item }: { list: ErpList; item: ErpImport }) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const skipped = skippedOf(item);
  const left = skipped.reduce((n, s) => n + s.count, 0);
  const without =
    item.withoutCustomer > 0 && (list === 'chantiers' || list === 'invoices')
      ? t(`addin.erp.withoutCustomer.${list}`, { count: item.withoutCustomer })
      : null;
  return (
    <li>
      <Card className={styles.card} data-testid={`erp-${list}`}>
        <span className={styles.head}>
          <Text weight="semibold">{t(`erp.list.${list}`)}</Text>
          <Badge appearance="tint" color={STATUS_COLOR[item.status]}>
            {t(`addin.erp.status.${item.status}`)}
          </Badge>
        </span>
        {item.file && (
          <Caption1 className={styles.muted}>
            {t('addin.erp.file', { file: item.file.name, date: parisDateTime(item.startedAt) })}
          </Caption1>
        )}
        {item.error && <Text className={styles.error}>{item.error.message}</Text>}
        <Text size={200}>
          {t(COUNTS[list], { added: item.added, updated: item.updated, unchanged: item.unchanged })}
        </Text>
        {without && <Text size={200}>{without}</Text>}
        {left > 0 && (
          <>
            <span className={styles.line}>
              <Text size={200}>{t('addin.erp.skipped', { count: left })}</Text>
              {item.examples.length > 0 && (
                <Link as="button" onClick={() => setOpen(!open)}>
                  {t(open ? 'addin.erp.hideRows' : 'addin.erp.showRows')}
                </Link>
              )}
            </span>
            <ul className={styles.reasons}>
              {skipped.map((s) => (
                <li key={s.reason}>
                  <Caption1>{t('addin.erp.reason', { reason: s.label, count: s.count })}</Caption1>
                  {open &&
                    s.rows.map((r) => (
                      <Caption1 key={r.row} block className={styles.muted}>
                        {r.name
                          ? t('addin.erp.row', { row: r.row, name: r.name })
                          : t('addin.erp.rowNoName', { row: r.row })}
                      </Caption1>
                    ))}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </li>
  );
}

export function ErpPart() {
  const styles = useStyles();
  const [state, fi] = useFi();
  const [list, setList] = useState<ErpList | ''>('');
  const input = useRef<HTMLInputElement>(null);
  const giving = state.busy.includes('erpImport');
  const erp = state.erp;
  const given = erp ? EXPORT_LISTS.filter((l) => erp[l]) : [];

  return (
    <div className={styles.section} data-testid="erp">
      <Subtitle2 as="h3">{t('addin.erp.title')}</Subtitle2>
      <Caption1>{t('addin.erp.intro')}</Caption1>
      <Caption1>{t('addin.erp.how')}</Caption1>
      {state.testMode && <Caption1>{t('addin.erp.testNote')}</Caption1>}
      <Field label={t('addin.erp.list')}>
        <Select
          value={list}
          onChange={(_, d) => setList(d.value as ErpList | '')}
          data-testid="erp-list"
        >
          <option value="">{t('addin.erp.guess')}</option>
          {EXPORT_LISTS.map((l) => (
            <option key={l} value={l}>
              {t(`erp.list.${l}`)}
            </option>
          ))}
        </Select>
      </Field>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        data-testid="erp-input"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          // The same file chosen twice must fire again.
          e.currentTarget.value = '';
          if (file) void fi.importErp(file, file.name, list || undefined);
        }}
      />
      <span className={styles.line}>
        <Button onClick={() => input.current?.click()} disabled={giving}>
          {t('addin.erp.give')}
        </Button>
        {giving && <Spinner size="tiny" />}
        <Button
          appearance="subtle"
          size="small"
          disabled={state.busy.includes('erp')}
          onClick={() => void fi.loadErp()}
        >
          {t('addin.erp.refresh')}
        </Button>
      </span>
      {erp &&
        (given.length === 0 ? (
          <Text>{t('addin.erp.none')}</Text>
        ) : (
          <ul className={styles.list}>
            {given.map((l) => {
              const item = erp[l];
              return item && <Imported key={l} list={l} item={item} />;
            })}
          </ul>
        ))}
    </div>
  );
}
