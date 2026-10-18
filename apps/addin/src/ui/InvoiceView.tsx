// Screen 4, Fiche facture (plan §5): what to fix and where, the rehearsal, sending, the XML and PDF,
// the timeline, and in Mode test the scenario panel (plan §3).
import { frDate, frMoney } from '@fi/core';
import { isMessageKey, type MessageKey, t } from '@fi/shared';
import {
  Badge,
  Body1,
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
import { type InvoiceEvent, SCENARIOS, type Scenario } from '../api';
import type { OpenInvoice } from '../controller';
import { parisDateTime, useFi } from './context';
import { TEST_ORANGE } from './theme';

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: '10px' },
  heading: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  facts: { display: 'flex', flexDirection: 'column', gap: '2px' },
  card: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px' },
  steps: { margin: 0, paddingLeft: '20px' },
  actions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  checklist: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '4px' },
  ready: { color: tokens.colorPaletteGreenForeground1, fontWeight: tokens.fontWeightSemibold },
  muted: { color: tokens.colorNeutralForeground2 },
  xml: {
    maxHeight: '260px',
    overflow: 'auto',
    fontSize: '11px',
    backgroundColor: tokens.colorNeutralBackground3,
    padding: '8px',
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  pdf: { width: '100%', height: '480px', border: `1px solid ${tokens.colorNeutralStroke2}` },
  timeline: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '6px' },
  scenarios: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '10px',
    border: `2px solid ${TEST_ORANGE}`,
    borderRadius: tokens.borderRadiusMedium,
  },
});

const SCENARIO_LABEL: Record<Scenario, MessageKey> = {
  pdp_reject: 'addin.scenario.pdp_reject',
  customer_refuse: 'addin.scenario.customer_refuse',
  pay_late: 'addin.scenario.pay_late',
  siren_unknown: 'addin.scenario.siren_unknown',
};

const ACTOR: Record<string, MessageKey> = {
  user: 'addin.actor.user',
  pdp: 'addin.actor.pdp',
  system: 'addin.actor.system',
};

const statusLabel = (status: string | null) => {
  const key = `invoice.status.${status}`;
  return isMessageKey(key) ? t(key) : (status ?? '');
};

function eventText(e: InvoiceEvent): string {
  const payload = (typeof e.payload === 'object' && e.payload) || {};
  const simulated = 'simulated' in payload && payload.simulated === true;
  let text: string;
  if (e.type === 'note' && e.event === 'rehearsal') {
    const ready = 'ready' in payload && payload.ready === true;
    text = t(ready ? 'addin.invoice.event.rehearsalOk' : 'addin.invoice.event.rehearsalKo');
  } else if (e.type === 'note' && e.event === 'scenario') {
    const scenario = 'scenario' in payload ? payload.scenario : null;
    const label = SCENARIOS.find((s) => s === scenario);
    text = t('addin.invoice.event.scenario', { scenario: label ? t(SCENARIO_LABEL[label]) : '' });
  } else if (e.type === 'note' && e.event === 'scenario_planned') {
    const status = 'status' in payload && typeof payload.status === 'string' ? payload.status : '';
    text = t('addin.invoice.event.planned', { status: statusLabel(status) });
  } else if (e.toStatus) {
    text = statusLabel(e.toStatus);
  } else {
    text = t('addin.invoice.event.platform');
  }
  const reason =
    'reason' in payload &&
    typeof payload.reason === 'object' &&
    payload.reason &&
    'message' in payload.reason &&
    typeof payload.reason.message === 'string'
      ? payload.reason.message
      : null;
  const actorKey = ACTOR[e.actor] ?? (e.actor.startsWith('agent:') ? 'addin.actor.agent' : null);
  return [
    text,
    simulated ? t('addin.invoice.simulated') : '',
    reason ? `— ${reason}` : '',
    actorKey ? t('addin.invoice.by', { actor: t(actorKey) }) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function InvoiceView() {
  const styles = useStyles();
  const [state, fi] = useFi();
  const open = state.invoice;
  const screen = state.screen;
  if (!open || screen.name !== 'invoice') {
    return state.busy.includes('invoice') ? <Spinner label={t('addin.loading')} /> : null;
  }
  const d = open.detail;
  const errors = d.issues.filter((i) => i.severity === 'error');
  const number = d.number ?? '';
  const amount = d.payable !== null ? frMoney(d.payable, d.currency ?? 'EUR') : '';
  const sendable = d.status === 'validated' && errors.length === 0;

  return (
    <section className={styles.section} aria-labelledby="invoice-title">
      <Link onClick={() => fi.navigate({ name: 'dashboard' })}>{t('addin.invoice.back')}</Link>
      <div className={styles.heading}>
        <Subtitle2 as="h2" id="invoice-title">
          {d.number ? t('addin.invoice.title', { number }) : t('addin.invoice.noNumber')}
        </Subtitle2>
        <Badge appearance="tint" data-testid="invoice-status">
          {d.statusLabel}
        </Badge>
        {d.isTest && (
          <Badge appearance="filled" style={{ backgroundColor: TEST_ORANGE, color: '#1f1300' }}>
            {t('addin.invoice.test')}
          </Badge>
        )}
      </div>
      <div className={styles.facts}>
        {d.buyerName && <Text>{t('addin.invoice.buyer', { name: d.buyerName })}</Text>}
        {amount && <Text>{t('addin.invoice.amount', { amount })}</Text>}
        {d.dueDate && <Text>{t('addin.invoice.due', { date: frDate(d.dueDate) })}</Text>}
      </div>

      <Issues open={open} />

      <Subtitle2 as="h3">{t('addin.invoice.rehearsal')}</Subtitle2>
      <Caption1 className={styles.muted}>{t('addin.invoice.rehearsalIntro')}</Caption1>
      <div className={styles.actions}>
        <Button onClick={() => void fi.rehearse()} disabled={state.busy.includes('rehearse')}>
          {t('addin.invoice.rehearse')}
        </Button>
        {state.busy.includes('rehearse') && <Spinner size="tiny" />}
      </div>
      {open.rehearsal && (
        <Card className={styles.card} data-testid="rehearsal">
          <Text className={open.rehearsal.ready ? styles.ready : undefined} size={400}>
            {open.rehearsal.summary}
          </Text>
          <ul className={styles.checklist}>
            {open.rehearsal.checklist.map((c) => (
              <li key={c.item}>
                <Text>
                  {c.ok ? '✓' : '✗'} {c.label}
                </Text>
                {c.detail && <Caption1 className={styles.muted}> — {c.detail}</Caption1>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {screen.confirmSend ? (
        <MessageBar intent="warning" layout="multiline" data-testid="confirm-send">
          <MessageBarBody>
            {d.isTest
              ? t('addin.invoice.confirmSendTest', { number })
              : t('addin.invoice.confirmSend', { number, amount, buyer: d.buyerName ?? '' })}
            {!sendable && <div>{t('addin.invoice.sendBlocked')}</div>}
          </MessageBarBody>
          <MessageBarActions>
            <Button appearance="primary" disabled={!sendable} onClick={() => void fi.send()}>
              {t('addin.invoice.confirm')}
            </Button>
            <Button onClick={fi.cancelSend}>{t('addin.invoice.cancel')}</Button>
          </MessageBarActions>
        </MessageBar>
      ) : (
        <div className={styles.actions}>
          <Button
            appearance="primary"
            disabled={!sendable || state.busy.includes('send')}
            onClick={fi.askSend}
          >
            {d.isTest ? t('addin.invoice.sendTest') : t('addin.invoice.send')}
          </Button>
          <Button disabled title={t('addin.invoice.chaseSoon')}>
            {t('addin.invoice.chase')}
          </Button>
          <Button onClick={() => void fi.viewXml()} disabled={state.busy.includes('xml')}>
            {open.xml ? t('addin.invoice.hideXml') : t('addin.invoice.xml')}
          </Button>
          <Button onClick={() => void fi.viewPdf()} disabled={state.busy.includes('pdf')}>
            {open.pdfUrl ? t('addin.invoice.hidePdf') : t('addin.invoice.pdf')}
          </Button>
        </div>
      )}
      {!sendable && !screen.confirmSend && errors.length > 0 && (
        <Caption1 className={styles.muted}>{t('addin.invoice.sendBlocked')}</Caption1>
      )}

      {open.xml && (
        <pre className={styles.xml} data-testid="xml">
          {open.xml}
        </pre>
      )}
      {open.pdfUrl && (
        <>
          <iframe className={styles.pdf} src={open.pdfUrl} title={t('addin.invoice.pdf')} />
          <Link href={open.pdfUrl} download={`${number || 'facture'}.pdf`}>
            {t('addin.invoice.download')}
          </Link>
        </>
      )}

      {state.testMode && <ScenarioPanel isTest={d.isTest} />}

      <Subtitle2 as="h3">{t('addin.invoice.timeline')}</Subtitle2>
      <ol className={styles.timeline} data-testid="timeline">
        {[...d.events].reverse().map((e, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: events have no id and the list only grows.
          <li key={`${e.at}-${d.events.length - i}`}>
            <Caption1 className={styles.muted}>{parisDateTime(e.at)}</Caption1>
            <Body1> {eventText(e)}</Body1>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Issues({ open }: { open: OpenInvoice }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const issues = open.detail.issues;
  if (issues.length === 0) {
    return <Text data-testid="no-issues">{t('addin.invoice.noIssues')}</Text>;
  }
  const explained = open.explained;
  return (
    <>
      <Subtitle2 as="h3">{t('addin.invoice.issues')}</Subtitle2>
      {explained?.note && <Caption1 className={styles.muted}>{explained.note}</Caption1>}
      {!explained && state.busy.includes('explain') && (
        <Spinner size="tiny" label={t('addin.invoice.explaining')} />
      )}
      {explained
        ? explained.explanations.map((x) => (
            <Card key={`${x.ruleId}:${x.path}`} className={styles.card} data-testid="explanation">
              <span className={styles.heading}>
                <Badge appearance="tint" color={x.severity === 'error' ? 'danger' : 'warning'}>
                  {x.severity === 'error' ? t('addin.invoice.issues') : t('addin.invoice.warnings')}
                </Badge>
                <Text weight="semibold">{x.message_fr}</Text>
              </span>
              <Caption1 className={styles.muted}>
                {t('addin.invoice.why', { why: x.why_it_matters })}
              </Caption1>
              {x.fix_steps.length > 0 && (
                <ol className={styles.steps}>
                  {x.fix_steps.map((s) => (
                    <li key={s}>
                      <Text size={200}>{s}</Text>
                    </li>
                  ))}
                </ol>
              )}
              {x.cell && (
                <div className={styles.actions}>
                  <Button
                    size="small"
                    appearance="primary"
                    onClick={() => x.cell && void fi.fixInSheet(x.cell)}
                  >
                    {t('addin.invoice.fix')}
                  </Button>
                  <Caption1 className={styles.muted}>
                    {t('addin.invoice.fixCell', { cell: x.cell })}
                  </Caption1>
                </div>
              )}
            </Card>
          ))
        : issues.map((issue) => (
            <Card key={`${issue.ruleId}:${issue.path}`} className={styles.card}>
              <Text weight="semibold">{issue.messageFr}</Text>
              <Caption1 className={styles.muted}>{issue.fixHintFr}</Caption1>
            </Card>
          ))}
    </>
  );
}

function ScenarioPanel({ isTest }: { isTest: boolean }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  return (
    <div className={styles.scenarios} data-testid="scenario-panel">
      <Subtitle2 as="h3">{t('addin.scenario.title')}</Subtitle2>
      <Caption1>{isTest ? t('addin.scenario.intro') : t('addin.scenario.needsTest')}</Caption1>
      <div className={styles.actions}>
        {SCENARIOS.map((s) => (
          <Button
            key={s}
            size="small"
            disabled={!isTest || state.busy.includes('scenario')}
            onClick={() => void fi.playScenario(s)}
          >
            {t(SCENARIO_LABEL[s])}
          </Button>
        ))}
      </div>
    </div>
  );
}
