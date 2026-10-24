// Screen 4, Fiche facture (plan §5): what to fix and where, the rehearsal, sending, the XML and PDF,
// « Relancer », the MonitorAgent's next step, the timeline, and in Mode test the scenario panel. An
// invoice the autopilot will send says when, with « Annuler l'envoi automatique ». A blocking finding
// of the checks across documents turns « Envoyer » into « Envoyer quand même ». After the send,
// « Établir un avoir » and « Abandonner la créance », each after a confirmation; a credit note and the
// invoice it cancels link to each other.
import { frDate, frMoney, parisToday } from '@fi/core';
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
import { useState } from 'react';
import {
  balanceOf,
  type InvoiceDetail,
  type InvoiceEvent,
  MONITOR_PROPOSALS,
  SCENARIOS,
  type Scenario,
} from '../api';
import type { OpenInvoice } from '../controller';
import {
  ChasePanel,
  dayLabel,
  kindLabel,
  NextStepCard,
  proposalLabel,
  stepStatus,
} from './ChasePanel';
import { FindingCard } from './ChecksView';
import { parisDateTime, parisTime, useFi } from './context';
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
  invalid: { color: tokens.colorPaletteRedForeground1 },
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

const textOf = (payload: object, key: string): string => {
  const value: unknown = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
};

const centsIn = (payload: object, key: string): number => {
  const value: unknown = (payload as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : 0;
};

export function eventText(e: InvoiceEvent): string {
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
  } else if (e.type === 'note' && e.event === 'chase') {
    const offset = 'offset' in payload && typeof payload.offset === 'number' ? payload.offset : 0;
    const kind = 'kind' in payload && typeof payload.kind === 'string' ? payload.kind : 'reminder';
    const status = 'status' in payload && typeof payload.status === 'string' ? payload.status : '';
    text = t('addin.invoice.event.chase', {
      kind: kindLabel(kind),
      day: dayLabel(offset),
      status: stepStatus(status),
    });
  } else if (e.type === 'note' && e.event === 'promise') {
    const until = 'until' in payload && typeof payload.until === 'string' ? payload.until : null;
    text = until
      ? t('addin.invoice.event.promise', { date: frDate(until) })
      : t('addin.invoice.event.promiseRemoved');
  } else if (e.type === 'note' && e.event === 'monitor') {
    const proposal = MONITOR_PROPOSALS.find((p) => 'proposal' in payload && payload.proposal === p);
    const kind = 'kind' in payload && typeof payload.kind === 'string' ? payload.kind : undefined;
    text = proposal
      ? t('addin.invoice.event.monitor', { proposal: proposalLabel(kind, proposal) })
      : t('addin.invoice.event.monitorOpen');
  } else if (e.type === 'note' && e.event === 'scenario_planned') {
    const status = 'status' in payload && typeof payload.status === 'string' ? payload.status : '';
    text = t('addin.invoice.event.planned', { status: statusLabel(status) });
  } else if (e.type === 'note' && e.event === 'autopilot_cancelled') {
    text = t('addin.invoice.event.autopilotCancelled');
  } else if (e.type === 'note' && e.event === 'autopilot_held') {
    text = t('addin.invoice.event.autopilotHeld');
  } else if (e.type === 'note' && e.event === 'vat_check') {
    const vatId = 'vatId' in payload && typeof payload.vatId === 'string' ? payload.vatId : '';
    const valid = 'valid' in payload && payload.valid === true;
    const id = 'requestIdentifier' in payload ? payload.requestIdentifier : null;
    text = t(valid ? 'addin.invoice.event.vatValid' : 'addin.invoice.event.vatInvalid', { vatId });
    if (typeof id === 'string' && id) text = `${text} ${t('addin.invoice.event.vatProof', { id })}`;
  } else if (e.type === 'note' && e.event === 'credit_note_drafted') {
    text = t('addin.invoice.event.creditDrafted', { number: textOf(payload, 'number') });
  } else if (e.type === 'note' && e.event === 'credit_note_of') {
    text = t('addin.invoice.event.creditOf', { number: textOf(payload, 'number') });
  } else if (e.type === 'note' && e.event === 'credit_note_not_applied') {
    const paid = centsIn(payload, 'paid');
    text =
      paid > 0
        ? t('addin.invoice.event.creditNotAppliedPaid', {
            number: textOf(payload, 'number'),
            paid: frMoney(paid, 'EUR'),
          })
        : t('addin.invoice.event.creditNotApplied', {
            number: textOf(payload, 'number'),
            status: statusLabel(textOf(payload, 'status')),
          });
  } else if (e.type === 'note' && e.event === 'payment_partial') {
    text = t('addin.invoice.event.paymentPartial', {
      amount: frMoney(centsIn(payload, 'amount'), 'EUR'),
      left: frMoney(centsIn(payload, 'left'), 'EUR'),
    });
  } else if (e.type === 'note' && e.event === 'sent_despite_findings') {
    const found = 'findings' in payload && Array.isArray(payload.findings) ? payload.findings : [];
    text = t('addin.invoice.event.sentDespite', { count: found.length });
  } else if (e.toStatus) {
    const auto = 'autopilot' in payload && payload.autopilot === true;
    text = auto
      ? t('addin.invoice.event.autopilot', { status: statusLabel(e.toStatus) })
      : statusLabel(e.toStatus);
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

/** Who VIES has at the number, on one line: its name, then its address (VIES breaks it in lines). */
export function viesHolder(answer: { name: string | null; address: string | null }): string {
  return [answer.name, answer.address?.trim().replace(/\s*\n\s*/g, ', ')]
    .filter(Boolean)
    .join(', ');
}

/**
 * The customer's EU VAT number and VIES' last answer on it, with who VIES has at that number: a valid
 * number of another company shows here. « Vérifier dans VIES » asks now, once a day.
 */
function ViesFacts({ vies }: { vies: NonNullable<InvoiceDetail['vies']> }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const answer = vies.answer;
  const holder = answer ? viesHolder(answer) : '';
  return (
    <div data-testid="invoice-vies">
      <Text>{t('addin.invoice.buyerVat', { vatId: vies.vatId })}</Text>
      <div>
        <Caption1 className={answer?.valid === false ? styles.invalid : styles.muted}>
          {!answer
            ? t('addin.invoice.viesNever')
            : t(answer.valid ? 'addin.invoice.viesValid' : 'addin.invoice.viesInvalid', {
                date: frDate(answer.checkedOn),
              })}
          {answer?.requestIdentifier &&
            ` ${t('addin.invoice.event.vatProof', { id: answer.requestIdentifier })}`}
        </Caption1>
      </div>
      {holder && (
        <Caption1 className={styles.muted}>{t('addin.invoice.viesHolder', { holder })}</Caption1>
      )}
      {answer?.checkedOn !== parisToday() && (
        <div>
          <Link
            disabled={state.busy.includes('vies')}
            onClick={() => void fi.checkVies()}
            data-testid="vies-check"
          >
            {t('addin.invoice.viesCheck')}
          </Link>
        </div>
      )}
    </div>
  );
}

/** The fiche opens on the chasing when there is something to do there. */
const CHASE_FIRST = ['overdue', 'chasing'];

export function InvoiceView() {
  const styles = useStyles();
  const [state, fi] = useFi();
  const open = state.invoice;
  const screen = state.screen;
  const [chaseShown, showChase] = useState<boolean | null>(null);
  if (!open || screen.name !== 'invoice') {
    return state.busy.includes('invoice') ? <Spinner label={t('addin.loading')} /> : null;
  }
  const d = open.detail;
  const errors = d.issues.filter((i) => i.severity === 'error');
  const number = d.number ?? '';
  const amount = d.payable !== null ? frMoney(d.payable, d.currency ?? 'EUR') : '';
  const sendable = d.status === 'validated' && errors.length === 0;
  const blocking = d.findings.filter((f) => f.severity === 'blocking');
  const atStake = blocking.reduce((sum, f) => sum + (f.amount ?? 0), 0);
  const chaseOpen =
    chaseShown ??
    (CHASE_FIRST.includes(d.status) || Boolean(d.chase?.steps.some((s) => s.status === 'drafted')));

  return (
    <section className={styles.section} aria-labelledby="invoice-title">
      <Link onClick={() => fi.navigate({ name: 'dashboard' })}>{t('addin.invoice.back')}</Link>
      <div className={styles.heading}>
        <Subtitle2 as="h2" id="invoice-title">
          {!d.number
            ? t('addin.invoice.noNumber')
            : d.typeCode === '381'
              ? t('addin.invoice.creditTitle', { number })
              : t('addin.invoice.title', { number })}
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
        {d.buyerName && !d.partyId && (
          <Link onClick={() => void fi.findCustomer()} data-testid="find-customer">
            {t('addin.invoice.findCustomer')}
          </Link>
        )}
        {d.vies && <ViesFacts vies={d.vies} />}
        {amount && <Text>{t('addin.invoice.amount', { amount })}</Text>}
        {d.dueDate && <Text>{t('addin.invoice.due', { date: frDate(d.dueDate) })}</Text>}
      </div>

      {d.autopilot.at && (
        <MessageBar intent="info" layout="multiline" data-testid="autopilot-banner">
          <MessageBarBody>
            {t('addin.autopilot.planned', { time: parisTime(d.autopilot.at) })}
          </MessageBarBody>
          <MessageBarActions>
            <Button
              size="small"
              disabled={state.busy.includes('autopilot')}
              onClick={() => void fi.cancelAutopilot()}
            >
              {t('addin.autopilot.cancel')}
            </Button>
          </MessageBarActions>
        </MessageBar>
      )}
      {d.autopilot.held && d.status === 'validated' && (
        <Caption1 className={styles.muted}>{t('addin.autopilot.heldHint')}</Caption1>
      )}

      {d.nextStep && <NextStepCard next={d.nextStep} />}

      <AfterSend key={d.id} detail={d} />

      <Issues open={open} />

      {d.findings.length > 0 && (
        <>
          <Subtitle2 as="h3">{t('addin.invoice.checks')}</Subtitle2>
          {d.findings.map((f) => (
            <FindingCard key={f.id} finding={f} onFiche />
          ))}
        </>
      )}

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
            {blocking.length > 0 && (
              <div data-testid="confirm-despite">
                {t('addin.invoice.confirmSendDespite', {
                  count: blocking.length,
                  amount: frMoney(atStake, 'EUR'),
                })}
              </div>
            )}
            {!sendable && <div>{t('addin.invoice.sendBlocked')}</div>}
          </MessageBarBody>
          <MessageBarActions>
            <Button appearance="primary" disabled={!sendable} onClick={() => void fi.send()}>
              {blocking.length > 0 ? t('addin.invoice.sendDespite') : t('addin.invoice.confirm')}
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
            {blocking.length > 0
              ? t('addin.invoice.sendDespite')
              : d.isTest
                ? t('addin.invoice.sendTest')
                : t('addin.invoice.send')}
          </Button>
          <Button onClick={() => showChase(!chaseOpen)} aria-expanded={chaseOpen}>
            {chaseOpen ? t('addin.invoice.chaseHide') : t('addin.invoice.chase')}
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

      {chaseOpen && <ChasePanel detail={d} />}

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

/** The platform has it, unpaid, not cancelled: a credit note can cancel it (API src/credits.ts). */
const CREDITABLE = [
  'deposited',
  'delivered',
  'accepted',
  'refused_by_customer',
  'disputed',
  'overdue',
  'chasing',
];
const REFUSED = ['refused_by_customer', 'disputed'];
const WRITABLE_OFF = ['overdue', 'chasing'];
/** A credit note still on its way: it cancels its invoice « une fois transmis ». */
const NOT_SENT = ['draft', 'needs_fix', 'validated', 'ready_to_send', 'sending', 'rejected_by_pdp'];

/** After the send: the credit note and its invoice, « Établir un avoir », « Abandonner la créance ». */
function AfterSend({ detail: d }: { detail: InvoiceDetail }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const [asking, ask] = useState<'credit' | 'writeOff' | null>(null);
  const number = d.number ?? '';
  const amount = d.payable !== null ? frMoney(d.payable, d.currency ?? 'EUR') : '';
  // Abandoned: what is left after the payments received.
  const owed = frMoney(balanceOf(d), d.currency ?? 'EUR');
  const { of, by } = d.credit;

  if (of) {
    if (d.status === 'cancelled') return null;
    const params = { number: of.number ?? '', date: of.issueDate ? frDate(of.issueDate) : '' };
    return (
      <MessageBar intent="info" layout="multiline" data-testid="credit-of">
        <MessageBarBody>
          {t(NOT_SENT.includes(d.status) ? 'addin.credit.of' : 'addin.credit.ofSent', params)}
        </MessageBarBody>
        <MessageBarActions>
          <Button size="small" onClick={() => void fi.openInvoice(of.id)}>
            {t('addin.credit.openOriginal', { number: of.number ?? '' })}
          </Button>
        </MessageBarActions>
      </MessageBar>
    );
  }
  if (by) {
    const done = d.status === 'credited';
    return (
      <MessageBar intent={done ? 'success' : 'info'} layout="multiline" data-testid="credit-by">
        <MessageBarBody>
          {done
            ? t('addin.credit.byDone', { number: by.number ?? '' })
            : t('addin.credit.by', { number: by.number ?? '', status: by.statusLabel })}
        </MessageBarBody>
        <MessageBarActions>
          <Button size="small" onClick={() => void fi.openInvoice(by.id)}>
            {t('addin.credit.openCredit', { number: by.number ?? '' })}
          </Button>
        </MessageBarActions>
      </MessageBar>
    );
  }
  if (!CREDITABLE.includes(d.status) || d.typeCode === '381') return null;
  const writable = WRITABLE_OFF.includes(d.status);

  return (
    <div className={styles.section} data-testid="after-send">
      <Subtitle2 as="h3">{t('addin.credit.title')}</Subtitle2>
      {REFUSED.includes(d.status) && (
        <Caption1 className={styles.muted}>{t('addin.credit.refused')}</Caption1>
      )}
      {asking === 'credit' && (
        <MessageBar intent="warning" layout="multiline" data-testid="confirm-credit">
          <MessageBarBody>{t('addin.credit.confirm', { number, amount })}</MessageBarBody>
          <MessageBarActions>
            <Button
              appearance="primary"
              disabled={state.busy.includes('credit')}
              onClick={() => void fi.creditNote()}
            >
              {t('addin.credit.confirmYes')}
            </Button>
            <Button onClick={() => ask(null)}>{t('addin.invoice.cancel')}</Button>
          </MessageBarActions>
        </MessageBar>
      )}
      {asking === 'writeOff' && (
        <MessageBar intent="warning" layout="multiline" data-testid="confirm-write-off">
          <MessageBarBody>{t('addin.writeOff.confirm', { number, amount: owed })}</MessageBarBody>
          <MessageBarActions>
            <Button
              appearance="primary"
              disabled={state.busy.includes('writeOff')}
              onClick={() => void fi.writeOff().then(() => ask(null))}
            >
              {t('addin.writeOff.confirmYes')}
            </Button>
            <Button onClick={() => ask(null)}>{t('addin.invoice.cancel')}</Button>
          </MessageBarActions>
        </MessageBar>
      )}
      {asking === null && (
        <div className={styles.actions}>
          <Button onClick={() => ask('credit')}>{t('addin.credit.make')}</Button>
          {writable && <Button onClick={() => ask('writeOff')}>{t('addin.writeOff.make')}</Button>}
        </div>
      )}
    </div>
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
            // BR-FR-05/06 find one per mention, all on `notes`: their text tells them apart.
            <Card
              key={`${x.ruleId}:${x.path}:${x.message_fr}`}
              className={styles.card}
              data-testid="explanation"
            >
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
            <Card key={`${issue.ruleId}:${issue.path}:${issue.messageFr}`} className={styles.card}>
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
