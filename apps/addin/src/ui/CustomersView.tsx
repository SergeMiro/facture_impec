// Clients (plan §4 parties, §6 PartyAgent): « Chercher dans l'annuaire » by name or SIREN, « C'est ce
// client » to save one, then per customer its e-mail and « Envoi automatique » (plan §0.2). A sync
// fills what the sheet leaves empty from here.
import { t } from '@fi/shared';
import {
  Badge,
  Button,
  Caption1,
  Card,
  Field,
  Input,
  makeStyles,
  Spinner,
  Subtitle2,
  Switch,
  Text,
  tokens,
} from '@fluentui/react-components';
import { type FormEvent, useEffect, useState } from 'react';
import type { Party, PartyCandidate, PostalAddress } from '../api';
import { useFi } from './context';

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: '10px' },
  form: { display: 'flex', flexDirection: 'column', gap: '8px' },
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
  muted: { color: tokens.colorNeutralForeground3 },
});

const addressText = (a: PostalAddress | null) =>
  a
    ? [a.line1, a.line2, [a.postCode, a.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    : '';

/** What the platform's directory said: can the invoice reach this customer? */
function Reach({ found }: { found: boolean | null }) {
  if (found === null) return <Caption1>{t('addin.customers.reachUnknown')}</Caption1>;
  return (
    <Badge appearance="tint" color={found ? 'success' : 'warning'}>
      {found ? t('addin.customers.reachable') : t('addin.customers.unreachable')}
    </Badge>
  );
}

function Candidate({ c, typedName }: { c: PartyCandidate; typedName: string }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const name = c.name ?? '';
  // The sheet's name for it, from « Trouver ce client »; for a company whose name is withheld, the
  // name typed in the search.
  const given = state.customers?.sheetName ?? (name ? undefined : typedName || undefined);
  return (
    <li>
      <Card className={styles.card} data-testid="candidate">
        <Text weight="semibold">{name || t('addin.customers.nameWithheld')}</Text>
        <Caption1 className={styles.muted}>
          {t('addin.customers.siren', { siren: c.siren })}
          {c.address && ` · ${addressText(c.address)}`}
        </Caption1>
        <span className={styles.line}>
          <Reach found={c.routing} />
        </span>
        {c.refusal === 'closed' && <Caption1>{t('addin.customers.closed')}</Caption1>}
        {c.refusal === 'duplicate' && (
          <Caption1>{t('addin.customers.duplicate', { siren: c.keptSiren ?? '' })}</Caption1>
        )}
        {c.partyId ? (
          <Caption1>{t('addin.customers.already')}</Caption1>
        ) : (
          !c.refusal && (
            <span className={styles.line}>
              <Button
                appearance="primary"
                size="small"
                disabled={state.busy.includes(`party:${c.siren}`)}
                onClick={() => void fi.confirmCustomer(c.siren, given)}
              >
                {t('addin.customers.confirm')}
              </Button>
            </span>
          )
        )}
      </Card>
    </li>
  );
}

function Search() {
  const styles = useStyles();
  const [state, fi] = useFi();
  const asked = state.customers?.query;
  const [text, setText] = useState(asked?.name ?? asked?.siren ?? '');
  const [postCode, setPostCode] = useState(asked?.postCode ?? '');
  // « Trouver ce client » fills the search from the fiche.
  useEffect(() => {
    if (asked?.name || asked?.siren) setText(asked.name ?? asked.siren ?? '');
  }, [asked?.name, asked?.siren]);
  const finding = state.customers?.finding ?? null;
  const searching = state.busy.includes('partySearch');

  const search = (e: FormEvent) => {
    e.preventDefault();
    const typed = text.trim();
    const siren = typed.replace(/\s/g, '');
    const code = postCode.trim();
    void fi.searchCustomers(
      /^\d{9}$/.test(siren) ? { siren } : { name: typed, ...(code && { postCode: code }) },
    );
  };

  return (
    <div className={styles.section}>
      <form className={styles.form} onSubmit={search} data-testid="party-search">
        <Field label={t('addin.customers.searchLabel')} hint={t('addin.customers.searchHint')}>
          <Input value={text} onChange={(_, d) => setText(d.value)} />
        </Field>
        <Field label={t('addin.customers.postCode')}>
          <Input value={postCode} onChange={(_, d) => setPostCode(d.value)} inputMode="numeric" />
        </Field>
        <span className={styles.line}>
          <Button type="submit" disabled={searching || text.trim().length === 0}>
            {t('addin.customers.search')}
          </Button>
          {searching && <Spinner size="tiny" />}
        </span>
      </form>
      {finding && (
        <>
          <Text data-testid="party-question">{finding.question}</Text>
          <ul className={styles.list}>
            {finding.candidates.map((c) => (
              <Candidate key={c.siren} c={c} typedName={asked?.name ?? ''} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Customer({ party }: { party: Party }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const [email, setEmail] = useState(party.email ?? '');
  useEffect(() => setEmail(party.email ?? ''), [party.email]);
  const busy = state.busy.includes(`party:${party.id}`);
  const autopilotMode = state.settings?.mode === 'autopilot';

  const saveEmail = (e: FormEvent) => {
    e.preventDefault();
    void fi.updateCustomer(party.id, { email: email.trim() || null });
  };

  return (
    <li>
      <Card className={styles.card} data-testid="customer">
        <Text weight="semibold">{party.legalName}</Text>
        <Caption1 className={styles.muted}>
          {t('addin.customers.siren', { siren: party.siren })}
          {party.address && ` · ${addressText(party.address)}`}
        </Caption1>
        {party.routing && (
          <span className={styles.line}>
            <Reach found={party.routing.found} />
          </span>
        )}
        <form className={styles.line} onSubmit={saveEmail}>
          <Field label={t('addin.customers.email')}>
            <Input type="email" value={email} onChange={(_, d) => setEmail(d.value)} />
          </Field>
          {email.trim() !== (party.email ?? '') && (
            <Button type="submit" size="small" disabled={busy}>
              {t('addin.settings.save')}
            </Button>
          )}
        </form>
        <Switch
          checked={party.autopilot}
          disabled={busy}
          onChange={(_, d) => void fi.updateCustomer(party.id, { autopilot: d.checked })}
          label={t('addin.customers.autopilot')}
        />
        {party.autopilot && !autopilotMode && (
          <Caption1>{t('addin.customers.autopilotNeedsMode')}</Caption1>
        )}
        <Switch
          checked={party.requiresPurchaseOrder}
          disabled={busy}
          onChange={(_, d) =>
            void fi.updateCustomer(party.id, { requiresPurchaseOrder: d.checked })
          }
          label={t('addin.customers.requiresPurchaseOrder')}
        />
        <Switch
          checked={party.publicEntity}
          disabled={busy}
          onChange={(_, d) => void fi.updateCustomer(party.id, { publicEntity: d.checked })}
          label={t('addin.customers.publicEntity')}
        />
        <span className={styles.line}>
          <Button
            size="small"
            appearance="subtle"
            disabled={busy}
            onClick={() => void fi.removeCustomer(party.id)}
          >
            {t('addin.customers.remove')}
          </Button>
        </span>
      </Card>
    </li>
  );
}

export function CustomersView() {
  const styles = useStyles();
  const [state, fi] = useFi();
  // The switch's warning reads the mode from Réglages.
  useEffect(() => {
    if (!state.settings) void fi.loadSettings();
  }, [state.settings, fi]);
  const parties = state.customers?.parties ?? [];
  return (
    <section className={styles.section} aria-labelledby="customers-title">
      <Subtitle2 as="h2" id="customers-title">
        {t('addin.customers.title')}
      </Subtitle2>
      <Caption1>{t('addin.customers.intro')}</Caption1>
      <Search />
      <Subtitle2 as="h3">{t('addin.customers.list', { count: parties.length })}</Subtitle2>
      {state.busy.includes('customers') && !state.customers && (
        <Spinner label={t('addin.loading')} />
      )}
      {state.customers && parties.length === 0 && (
        <Caption1 className={styles.muted}>{t('addin.customers.none')}</Caption1>
      )}
      <ul className={styles.list}>
        {parties.map((p) => (
          <Customer key={p.id} party={p} />
        ))}
      </ul>
    </section>
  );
}
