// « Retrouver une facture » on the Tableau de bord: any invoice of the company, not only the open
// sheet's rows — by a piece of its number or of the customer's name, where it stands and when it was
// issued. A result opens its fiche.
import { frDate, frMoney } from '@fi/core';
import { type MessageKey, t } from '@fi/shared';
import {
  Badge,
  Button,
  Caption1,
  Card,
  Field,
  Input,
  Link,
  makeStyles,
  Select,
  Text,
  tokens,
} from '@fluentui/react-components';
import { useState } from 'react';
import { type InvoiceSummary, SEARCH_STAGES, type SearchStage } from '../api';
import { useFi } from './context';

const useStyles = makeStyles({
  card: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px' },
  form: { display: 'flex', flexDirection: 'column', gap: '6px' },
  dates: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: '2px 8px',
    padding: '6px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  detail: { gridColumn: '1 / -1', color: tokens.colorNeutralForeground2 },
});

const TONE: Partial<Record<string, 'success' | 'warning' | 'danger'>> = {
  paid: 'success',
  overdue: 'warning',
  chasing: 'warning',
  needs_fix: 'danger',
  rejected_by_pdp: 'danger',
  refused_by_customer: 'danger',
  disputed: 'warning',
};

/** One result's second line: kind, who, amount, date, Mode test. */
export function resultLine(i: InvoiceSummary): string {
  return [
    i.typeCode === '381' ? t('addin.search.creditNote') : null,
    i.buyerName || null,
    i.payable !== null ? frMoney(i.payable, i.currency ?? 'EUR') : null,
    i.issueDate ? frDate(i.issueDate) : null,
    i.isTest ? t('addin.search.test') : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

export function InvoiceSearch() {
  const styles = useStyles();
  const [state, fi] = useFi();
  const found = state.search;
  const [text, setText] = useState(found?.query.q ?? '');
  const [stage, setStage] = useState<SearchStage | ''>(found?.query.stage ?? '');
  const [from, setFrom] = useState(found?.query.from ?? '');
  const [to, setTo] = useState(found?.query.to ?? '');
  const busy = state.busy.includes('search');

  return (
    <Card className={styles.card} data-testid="invoice-search">
      <Text weight="semibold">{t('addin.search.title')}</Text>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void fi.searchInvoices({
            q: text.trim() || undefined,
            stage: stage || undefined,
            from: from || undefined,
            to: to || undefined,
          });
        }}
      >
        <Field label={t('addin.search.text')}>
          <Input
            type="search"
            value={text}
            placeholder={t('addin.search.placeholder')}
            onChange={(_, d) => setText(d.value)}
            data-testid="search-text"
          />
        </Field>
        <Field label={t('addin.search.stage')}>
          <Select
            value={stage}
            onChange={(_, d) => {
              const picked = SEARCH_STAGES.find((s) => s === d.value);
              setStage(picked ?? '');
            }}
            data-testid="search-stage"
          >
            <option value="">{t('addin.search.stage.all')}</option>
            {SEARCH_STAGES.map((s) => (
              <option key={s} value={s}>
                {t(`addin.search.stage.${s}` as MessageKey)}
              </option>
            ))}
          </Select>
        </Field>
        <div className={styles.dates}>
          <Field label={t('addin.search.from')}>
            <Input type="date" value={from} onChange={(_, d) => setFrom(d.value)} />
          </Field>
          <Field label={t('addin.search.to')}>
            <Input type="date" value={to} onChange={(_, d) => setTo(d.value)} />
          </Field>
        </div>
        <Button type="submit" appearance="primary" disabled={busy}>
          {t('addin.search.go')}
        </Button>
      </form>

      {found &&
        (found.total === 0 ? (
          <Caption1 data-testid="search-none">{t('addin.search.none')}</Caption1>
        ) : (
          <>
            <Caption1 data-testid="search-count">
              {t('addin.search.count', { count: found.total })}
            </Caption1>
            <ul className={styles.list}>
              {found.invoices.map((i) => (
                <li key={i.id} className={styles.row} data-testid="search-result">
                  <Link onClick={() => void fi.openInvoice(i.id)}>
                    {i.number ?? t('addin.search.noNumber')}
                  </Link>
                  <Badge appearance="tint" color={TONE[i.status] ?? 'informative'}>
                    {i.statusLabel}
                  </Badge>
                  <Caption1 className={styles.detail}>{resultLine(i)}</Caption1>
                </li>
              ))}
            </ul>
            {found.invoices.length < found.total && (
              <Button disabled={busy} onClick={() => void fi.searchInvoices(found.query, true)}>
                {t('addin.search.more')}
              </Button>
            )}
          </>
        ))}
    </Card>
  );
}
