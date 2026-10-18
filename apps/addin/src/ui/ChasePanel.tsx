// « Relancer » on the fiche (plan §5 screen 4, §6 CollectAgent): the chasing plan with its dates and
// outcomes, the draft to copy or open in the mail app, « Marquer comme envoyée », « Préparer une
// relance maintenant », « Encaissée » and « Promesse de paiement ». And the MonitorAgent's card.
import {
  CHASED_STATES,
  type ChaseDraft,
  type ChaseStep,
  ENDED_STATES,
  frDate,
  frMoney,
  parisToday,
} from '@fi/core';
import { type MessageKey, t } from '@fi/shared';
import {
  Badge,
  Body1,
  Button,
  Caption1,
  Card,
  Field,
  Input,
  Link,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  makeStyles,
  Subtitle2,
  Text,
  tokens,
} from '@fluentui/react-components';
import { type ReactNode, useState } from 'react';
import type { InvoiceDetail, NextStep } from '../api';
import { useFi } from './context';

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: '8px' },
  steps: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '6px' },
  step: { display: 'flex', flexDirection: 'column', gap: '2px' },
  line: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  card: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px' },
  body: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    fontFamily: 'inherit',
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground3,
    padding: '8px',
  },
  actions: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'end' },
  muted: { color: tokens.colorNeutralForeground2 },
});

/** Statuses in which the plan runs, those « Encaissée » accepts, and those that ended it. */
const CHASED: readonly string[] = CHASED_STATES;
const PAYABLE: readonly string[] = ['deposited', ...CHASED_STATES];
const ENDED: readonly string[] = ENDED_STATES;

const STATUS_TONE: Record<ChaseStep['status'], 'informative' | 'warning' | 'success' | 'subtle'> = {
  pending: 'informative',
  drafted: 'warning',
  sending: 'informative',
  sent: 'success',
  skipped: 'subtle',
  cancelled: 'subtle',
};

export const dayLabel = (offset: number) => `J${offset < 0 ? '' : '+'}${offset}`;
export const kindLabel = (kind: string) => t(`chase.kind.${kind}` as MessageKey);
export const stepStatus = (status: string) => t(`addin.chase.status.${status}` as MessageKey);

export function mailto(draft: ChaseDraft): string {
  const query = `subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
  return `mailto:${draft.to ? encodeURIComponent(draft.to) : ''}?${query}`;
}

export function ChasePanel({ detail }: { detail: InvoiceDetail }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const plan = detail.chase;
  const chased = CHASED.includes(detail.status);
  const drafted = plan?.steps.findLast((s) => s.status === 'drafted' && s.draft);

  return (
    <section className={styles.section} data-testid="chase-panel">
      <Subtitle2 as="h3">{t('addin.chase.title')}</Subtitle2>
      {!plan && (
        <Caption1 className={styles.muted}>
          {ENDED.includes(detail.status) ? t('addin.chase.ended') : t('addin.chase.none')}
        </Caption1>
      )}
      {plan?.paused && <Text>{t('addin.chase.paused')}</Text>}
      {plan?.promisedUntil && (
        <Text>{t('addin.chase.promised', { date: frDate(plan.promisedUntil) })}</Text>
      )}
      {plan &&
        !plan.paused &&
        (plan.nextStepOn ? (
          <Caption1>{t('addin.chase.next', { date: frDate(plan.nextStepOn) })}</Caption1>
        ) : (
          <Caption1 className={styles.muted}>{t('addin.chase.ended')}</Caption1>
        ))}
      {plan && (
        <ol className={styles.steps}>
          {plan.steps.map((s) => (
            <li key={s.offset} className={styles.step} data-testid={`chase-step-${s.offset}`}>
              <span className={styles.line}>
                <Text weight="semibold">
                  {t('addin.chase.step', { kind: kindLabel(s.kind), date: frDate(s.date) })}
                </Text>
                <Badge appearance="tint" color={STATUS_TONE[s.status]}>
                  {stepStatus(s.status)}
                  {s.by ? ` ${t(`addin.chase.by.${s.by}`)}` : ''}
                </Badge>
              </span>
              {s.reason && s.status !== 'sent' && (
                <Caption1 className={styles.muted}>
                  {t(`chase.reason.${s.reason}` as MessageKey)}
                </Caption1>
              )}
            </li>
          ))}
        </ol>
      )}

      {drafted?.draft && (
        <DraftCard
          title={t('addin.chase.draft', { kind: kindLabel(drafted.kind) })}
          draft={drafted.draft}
          advice={drafted.kind === 'formal_notice' ? t('chase.formalNoticeAdvice') : null}
        >
          <Button
            appearance="primary"
            disabled={state.busy.includes('chaseSent')}
            onClick={() => void fi.markChaseSent(drafted.offset)}
          >
            {t('addin.chase.markSent')}
          </Button>
        </DraftCard>
      )}

      {plan && chased && !plan.paused && (
        <div className={styles.actions}>
          <Button disabled={state.busy.includes('chase')} onClick={() => void fi.prepareChase()}>
            {t('addin.chase.prepare')}
          </Button>
        </div>
      )}
      {plan && chased && <PaymentPromise promisedUntil={plan.promisedUntil} />}
      {PAYABLE.includes(detail.status) && <Paid detail={detail} />}
    </section>
  );
}

function DraftCard({
  title,
  draft,
  advice,
  children,
}: {
  title: string;
  draft: ChaseDraft;
  advice: string | null;
  children?: ReactNode;
}) {
  const styles = useStyles();
  const [, fi] = useFi();
  const copy = () => {
    const text = `${t('addin.chase.subject', { subject: draft.subject })}\n\n${draft.body}`;
    navigator.clipboard
      .writeText(text)
      .then(() => fi.notify('success', t('addin.chase.copied')))
      .catch(() => fi.notify('warning', t('addin.chase.copyFailed')));
  };
  return (
    <Card className={styles.card} data-testid="chase-draft">
      <Text weight="semibold">{title}</Text>
      {advice && <Text>{advice}</Text>}
      <Caption1>
        {draft.to ? t('addin.chase.to', { to: draft.to }) : t('addin.chase.noTo')}
      </Caption1>
      <Caption1>{t('addin.chase.subject', { subject: draft.subject })}</Caption1>
      <pre className={styles.body}>{draft.body}</pre>
      <div className={styles.actions}>
        <Button onClick={copy}>{t('addin.chase.copy')}</Button>
        <Link href={mailto(draft)} target="_blank">
          {t('addin.chase.mail')}
        </Link>
        {children}
      </div>
    </Card>
  );
}

function PaymentPromise({ promisedUntil }: { promisedUntil: string | null }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const [until, setUntil] = useState(promisedUntil ?? '');
  const busy = state.busy.includes('promise');
  return (
    <div className={styles.actions}>
      <Field label={t('addin.chase.promiseUntil')}>
        <Input
          type="date"
          min={parisToday()}
          value={until}
          onChange={(_, d) => setUntil(d.value)}
        />
      </Field>
      <Button disabled={busy || !until} onClick={() => void fi.promisePayment(until)}>
        {t('addin.chase.promiseSave')}
      </Button>
      {promisedUntil && (
        <Button disabled={busy} onClick={() => void fi.promisePayment(null)}>
          {t('addin.chase.promiseRemove')}
        </Button>
      )}
    </div>
  );
}

function Paid({ detail }: { detail: InvoiceDetail }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const [asking, setAsking] = useState(false);
  const [paidOn, setPaidOn] = useState(parisToday());
  const amount = detail.payable !== null ? frMoney(detail.payable, detail.currency ?? 'EUR') : '';
  if (!asking) {
    return (
      <div className={styles.actions}>
        <Button appearance="primary" onClick={() => setAsking(true)}>
          {t('addin.chase.paid')}
        </Button>
      </div>
    );
  }
  return (
    <MessageBar intent="warning" layout="multiline" data-testid="confirm-paid">
      <MessageBarBody>
        {t('addin.chase.confirmPaid', { number: detail.number ?? '', amount })}
        <Field label={t('addin.chase.paidOn')}>
          <Input
            type="date"
            max={parisToday()}
            value={paidOn}
            onChange={(_, d) => setPaidOn(d.value)}
          />
        </Field>
      </MessageBarBody>
      <MessageBarActions>
        <Button
          appearance="primary"
          disabled={state.busy.includes('payment') || !paidOn}
          onClick={() => {
            setAsking(false);
            void fi.recordPayment(paidOn);
          }}
        >
          {t('addin.chase.confirm')}
        </Button>
        <Button onClick={() => setAsking(false)}>{t('addin.invoice.cancel')}</Button>
      </MessageBarActions>
    </MessageBar>
  );
}

/** The MonitorAgent's advice while a rejection or refusal waits for the user. */
export function NextStepCard({ next }: { next: NextStep }) {
  const styles = useStyles();
  return (
    <Card className={styles.card} data-testid="next-step">
      <Subtitle2 as="h3">{t('addin.next.title')}</Subtitle2>
      {next.proposal && <Text weight="semibold">{t(`monitor.proposal.${next.proposal}`)}</Text>}
      <Body1>{next.why}</Body1>
      {next.rules.length > 0 && (
        <Caption1 className={styles.muted}>
          {t('addin.next.rules', { rules: next.rules.join(', ') })}
        </Caption1>
      )}
      {next.draft && <DraftCard title={t('addin.next.draft')} draft={next.draft} advice={null} />}
    </Card>
  );
}
