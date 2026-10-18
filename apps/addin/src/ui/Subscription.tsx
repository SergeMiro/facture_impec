// Réglages → Abonnement and « Supprimer le compte » (plan §11 M7). Prices live in Stripe and show on
// its secure page; the pane shows the plan, the month's count and what to click next.
import { frDate } from '@fi/core';
import { t } from '@fi/shared';
import {
  Button,
  Caption1,
  Field,
  Input,
  Link,
  MessageBar,
  MessageBarBody,
  makeStyles,
  Subtitle2,
  Text,
} from '@fluentui/react-components';
import { useState } from 'react';
import type { BillingView, Offer } from '../api';
import { useFi } from './context';

const useStyles = makeStyles({
  form: { display: 'flex', flexDirection: 'column', gap: '8px' },
  row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  offer: { display: 'flex', flexDirection: 'column', gap: '2px' },
});

const day = (iso: string | null) => (iso ? frDate(iso.slice(0, 10)) : '');
const planName = (plan: Offer['plan']) => t(`addin.billing.plan.${plan}`);
const intervalName = (interval: Offer['interval']) => t(`addin.billing.interval.${interval}`);

/** Signed in with the company's key, or as the person who owns the account. */
export function useOwner(): boolean {
  const [state] = useFi();
  const user = state.me?.user;
  return user === null || user?.role === 'owner';
}

function Status({ billing }: { billing: BillingView }) {
  switch (billing.status) {
    case 'trial':
      return (
        <Text>
          {t('addin.billing.trial', {
            date: day(billing.trialEndsAt),
            left: billing.trial?.left ?? 0,
            sends: billing.trial?.sends ?? 0,
          })}
        </Text>
      );
    case 'active':
    case 'past_due':
      return (
        <>
          {billing.status === 'past_due' && (
            <MessageBar intent="warning">
              <MessageBarBody>{t('addin.billing.pastDue')}</MessageBarBody>
            </MessageBar>
          )}
          <Text>
            {billing.plan && billing.interval
              ? t('addin.billing.active', {
                  plan: planName(billing.plan),
                  interval: intervalName(billing.interval),
                })
              : null}
          </Text>
          <Text>
            {t('addin.billing.month', {
              sent: billing.month.sent,
              included: billing.month.included ?? 0,
            })}
          </Text>
          {billing.month.overage && <Caption1>{t('addin.billing.overage')}</Caption1>}
          {billing.periodEnd && (
            <Caption1>{t('addin.billing.periodEnd', { date: day(billing.periodEnd) })}</Caption1>
          )}
        </>
      );
    case 'ended':
      return (
        <MessageBar intent="warning">
          <MessageBarBody>{t('addin.billing.ended')}</MessageBarBody>
        </MessageBar>
      );
    case 'pilot':
      return <Text>{t('addin.billing.pilot')}</Text>;
  }
}

export function Subscription() {
  const styles = useStyles();
  const [state, fi] = useFi();
  const owner = useOwner();
  const billing = state.billing;
  if (!billing?.enabled) return null;
  const busy = state.busy.includes('billing');
  const canBuy =
    state.commerce && owner && (billing.status === 'trial' || billing.status === 'ended');

  return (
    <div className={styles.form}>
      <Subtitle2 as="h3">{t('addin.billing.title')}</Subtitle2>
      <Status billing={billing} />
      {canBuy && billing.offers.length > 0 && (
        <>
          <Caption1>{t('addin.billing.choose')}</Caption1>
          {billing.offers.map((offer) => (
            <span className={styles.offer} key={`${offer.plan}:${offer.interval}`}>
              <Button disabled={busy} onClick={() => void fi.openCheckout(offer)}>
                {t('addin.billing.offer', {
                  plan: planName(offer.plan),
                  interval: intervalName(offer.interval),
                })}
              </Button>
              <Caption1>
                {t(offer.overage ? 'addin.billing.includedOverage' : 'addin.billing.included', {
                  count: offer.included,
                })}
              </Caption1>
            </span>
          ))}
        </>
      )}
      {state.commerce && owner && billing.portal && (
        <Button disabled={busy} onClick={() => void fi.openPortal()}>
          {t('addin.billing.portal')}
        </Button>
      )}
      {!owner && billing.status !== 'pilot' && <Caption1>{t('addin.billing.ownerOnly')}</Caption1>}
      {state.pageLink && (
        <Link href={state.pageLink} target="_blank" rel="noopener noreferrer">
          {t('addin.billing.link')}
        </Link>
      )}
      <span className={styles.row}>
        <Button appearance="subtle" disabled={busy} onClick={() => void fi.loadBilling()}>
          {t('addin.billing.refresh')}
        </Button>
      </span>
    </div>
  );
}

/** RGPD erasure: the owner types the SIREN again; the pane signs out once it is done. */
export function DeleteAccount() {
  const styles = useStyles();
  const [state, fi] = useFi();
  const owner = useOwner();
  const [typed, setTyped] = useState('');
  const siren = state.me?.tenant.siren ?? '';
  if (!owner || !siren) return null;
  const matches = typed.replace(/\s/g, '') === siren;
  return (
    <div className={styles.form}>
      <Subtitle2 as="h3">{t('addin.account.delete')}</Subtitle2>
      <Caption1>{t('addin.account.deleteHint')}</Caption1>
      <Field label={t('addin.account.confirm', { siren })}>
        <Input inputMode="numeric" value={typed} onChange={(_, d) => setTyped(d.value)} />
      </Field>
      <span className={styles.row}>
        <Button
          appearance="primary"
          disabled={!matches || state.busy.includes('delete')}
          onClick={() => void fi.deleteAccount(typed)}
          data-testid="delete-account"
        >
          {t('addin.account.deleteButton')}
        </Button>
      </span>
    </div>
  );
}
