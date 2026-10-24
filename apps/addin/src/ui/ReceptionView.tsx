// Screen 5, Réception (plan §3, §6 InboundAgent): the supplier invoices the platform received, each
// with what the agent noticed, « Bon pour paiement » or « Contester », then « Exporter vers le
// comptable » (FEC + CSV). In « Mode test », fake supplier invoices to try it all on.
import { frDate, frMoney } from '@fi/core';
import { t } from '@fi/shared';
import {
  Badge,
  Button,
  Caption1,
  Card,
  Checkbox,
  Field,
  Input,
  Link,
  MessageBar,
  MessageBarBody,
  makeStyles,
  mergeClasses,
  Spinner,
  Subtitle2,
  Switch,
  Text,
  tokens,
} from '@fluentui/react-components';
import { useEffect, useRef, useState } from 'react';
import {
  type ExportFile,
  type Inbound,
  type InboundExport,
  type InboundFlag,
  TEST_INBOUND_KINDS,
} from '../api';
import { parisDateTime, useFi } from './context';

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
  focused: { outline: `2px solid ${tokens.colorBrandStroke1}` },
  line: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  head: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' },
  muted: { color: tokens.colorNeutralForeground3 },
  details: { margin: '4px 0 0', paddingLeft: '18px' },
});

const INTENT = { block: 'error', alert: 'warning', warn: 'warning', info: 'info' } as const;
const STATUS_COLOR = {
  new: 'informative',
  approved: 'success',
  disputed: 'danger',
  exported: 'subtle',
} as const;

function Flag({ flag }: { flag: InboundFlag }) {
  const styles = useStyles();
  return (
    <MessageBar intent={INTENT[flag.level]} layout="multiline" data-testid={`flag-${flag.code}`}>
      <MessageBarBody>
        {flag.message}
        {flag.details.length > 0 && (
          <ul className={styles.details}>
            {flag.details.map((d) => (
              <li key={d}>
                <Caption1>{d}</Caption1>
              </li>
            ))}
          </ul>
        )}
      </MessageBarBody>
    </MessageBar>
  );
}

function Received({ row, focused = false }: { row: Inbound; focused?: boolean }) {
  const styles = useStyles();
  const card = useRef<HTMLDivElement>(null);
  // « Voir la facture du fournisseur » (Contrôles) comes to this one.
  useEffect(() => {
    if (focused) card.current?.scrollIntoView?.({ block: 'center' });
  }, [focused]);
  const [state, fi] = useFi();
  const [ibanChecked, setIbanChecked] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState('');
  const approving = state.busy.includes(`approve:${row.id}`);
  const sending = state.busy.includes(`dispute:${row.id}`);
  const number = row.number ?? '—';
  const date = row.issueDate ? frDate(row.issueDate) : '—';
  const subcontractors = state.reception?.subcontractors ?? null;

  return (
    <li>
      <Card
        ref={card}
        className={mergeClasses(styles.card, focused && styles.focused)}
        data-testid="inbound"
        data-status={row.status}
        data-focused={focused || undefined}
      >
        <div className={styles.head}>
          <Text weight="semibold">{row.supplierName}</Text>
          <span className={styles.line}>
            {row.isTest && (
              <Badge color="warning" appearance="tint">
                {t('addin.reception.testBadge')}
              </Badge>
            )}
            <Badge color={STATUS_COLOR[row.status]} appearance="tint">
              {row.statusLabel}
            </Badge>
          </span>
        </div>
        <Text>
          {t(row.creditNote ? 'addin.reception.creditNote' : 'addin.reception.invoice', {
            number,
            date,
          })}
        </Text>
        {row.amount !== null && (
          <Text weight="semibold">
            {t('addin.reception.amount', { amount: frMoney(row.amount, row.currency ?? 'EUR') })}
          </Text>
        )}
        <Caption1 className={styles.muted}>
          {row.dueDate && `${t('addin.reception.due', { date: frDate(row.dueDate) })} · `}
          {t('addin.reception.received', { date: parisDateTime(row.receivedAt) })}
        </Caption1>
        {row.flags.map((f) => (
          <Flag key={f.code} flag={f} />
        ))}
        {subcontractors && row.supplierSiren && (
          <Switch
            checked={subcontractors.includes(row.supplierSiren)}
            disabled={state.busy.includes(`supplier:${row.supplierSiren}`)}
            onChange={(_, d) => {
              if (row.supplierSiren) void fi.setSubcontractor(row.supplierSiren, d.checked);
            }}
            label={t('addin.reception.subcontractor')}
            data-testid="supplier-subcontracting"
          />
        )}
        {row.status === 'disputed' && row.disputeReason && (
          <Caption1>{t('addin.reception.disputed', { reason: row.disputeReason })}</Caption1>
        )}

        {row.canApprove && row.needsIbanCheck && (
          <Checkbox
            checked={ibanChecked}
            onChange={(_, data) => setIbanChecked(data.checked === true)}
            label={t('addin.reception.ibanCheck')}
          />
        )}
        {disputing ? (
          <div className={styles.section}>
            <Field label={t('addin.reception.disputeReason')} required>
              <Input value={reason} onChange={(_, data) => setReason(data.value)} maxLength={500} />
            </Field>
            <span className={styles.line}>
              <Button
                appearance="primary"
                disabled={reason.trim() === '' || sending}
                onClick={async () => {
                  if (await fi.disputeInbound(row.id, reason.trim())) setDisputing(false);
                }}
              >
                {t('addin.reception.disputeConfirm')}
              </Button>
              <Button appearance="subtle" onClick={() => setDisputing(false)}>
                {t('addin.reception.disputeCancel')}
              </Button>
            </span>
          </div>
        ) : (
          (row.canApprove || row.canDispute) && (
            <span className={styles.line}>
              {row.canApprove && (
                <Button
                  appearance="primary"
                  disabled={approving || (row.needsIbanCheck && !ibanChecked)}
                  onClick={() => void fi.approveInbound(row.id, ibanChecked)}
                >
                  {t('addin.reception.approve')}
                </Button>
              )}
              {row.canDispute && (
                <Button onClick={() => setDisputing(true)}>{t('addin.reception.dispute')}</Button>
              )}
            </span>
          )
        )}
      </Card>
    </li>
  );
}

/** A file of an export: fetched on the first click, then offered as a download link. */
function ExportFiles({ item }: { item: InboundExport }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const [urls, setUrls] = useState<Partial<Record<ExportFile, string>>>({});
  useEffect(
    () => () => {
      for (const url of Object.values(urls)) URL.revokeObjectURL(url);
    },
    [urls],
  );
  const file = (kind: ExportFile, name: string, label: string) => {
    const url = urls[kind];
    if (url) {
      return (
        <Link href={url} download={name}>
          {name}
        </Link>
      );
    }
    return (
      <Button
        size="small"
        disabled={state.busy.includes(`file:${item.id}:${kind}`)}
        onClick={async () => {
          const blob = await fi.exportFile(item.id, kind);
          if (blob) setUrls((u) => ({ ...u, [kind]: URL.createObjectURL(blob) }));
        }}
      >
        {label}
      </Button>
    );
  };
  return (
    <li className={styles.section} data-testid="export">
      <Caption1>
        {t('addin.reception.exportLine', {
          date: parisDateTime(item.createdAt),
          count: item.count,
        })}
      </Caption1>
      <span className={styles.line}>
        {file('fec', item.fecName, t('addin.reception.downloadFec'))}
        {file('csv', item.csvName, t('addin.reception.downloadCsv'))}
      </span>
    </li>
  );
}

export function ReceptionView() {
  const styles = useStyles();
  const [state, fi] = useFi();
  const reception = state.reception;
  if (!reception) return <Spinner label={t('addin.reception.loading')} />;
  const ready = reception.inbound.filter((r) => r.status === 'approved').length;

  return (
    <div className={styles.section}>
      <Subtitle2 as="h2">
        {t(reception.test ? 'addin.reception.testTitle' : 'addin.reception.title')}
      </Subtitle2>

      {reception.inbound.length === 0 ? (
        <Text>{t(reception.test ? 'addin.reception.emptyTest' : 'addin.reception.empty')}</Text>
      ) : (
        <ul className={styles.list}>
          {reception.inbound.map((row) => (
            <Received
              key={row.id}
              row={row}
              focused={state.screen.name === 'reception' && state.screen.focus === row.id}
            />
          ))}
        </ul>
      )}

      <Subtitle2 as="h3">{t('addin.reception.exportTitle')}</Subtitle2>
      <Caption1>{t('addin.reception.exportHint', { count: ready })}</Caption1>
      <span className={styles.line}>
        <Button
          appearance="primary"
          disabled={ready === 0 || state.busy.includes('exportInbound')}
          onClick={() => void fi.exportInbound()}
        >
          {t('addin.reception.export')}
        </Button>
      </span>
      {reception.exports.length > 0 && (
        <>
          <Text weight="semibold">{t('addin.reception.exports')}</Text>
          <ul className={styles.list}>
            {reception.exports.map((item) => (
              <ExportFiles key={item.id} item={item} />
            ))}
          </ul>
        </>
      )}

      {state.testMode && (
        <>
          <Subtitle2 as="h3">{t('addin.reception.test')}</Subtitle2>
          <Caption1>{t('addin.reception.testHint')}</Caption1>
          <span className={styles.line}>
            {TEST_INBOUND_KINDS.map((kind) => (
              <Button
                key={kind}
                disabled={state.busy.includes('testInbound')}
                onClick={() => void fi.receiveTestInbound(kind)}
              >
                {t(`addin.reception.test.${kind}`)}
              </Button>
            ))}
          </span>
        </>
      )}
    </div>
  );
}
