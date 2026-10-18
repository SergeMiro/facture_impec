// « Créer un compte » (plan §11 M7): the SIREN, the company found in the public directory to confirm or
// complete, the owner's e-mail and the terms; then the e-mailed link, and the pane signs in by itself.
import { t } from '@fi/shared';
import {
  Button,
  Caption1,
  Checkbox,
  Field,
  Input,
  Link,
  MessageBar,
  MessageBarBody,
  makeStyles,
  Spinner,
  Subtitle2,
  Text,
} from '@fluentui/react-components';
import { type FormEvent, useState } from 'react';
import type { DirectoryCompany } from '../api';
import { useFi } from './context';

const useStyles = makeStyles({
  form: { display: 'flex', flexDirection: 'column', gap: '10px' },
  row: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  postCode: { maxWidth: '8em' },
});

export function Signup() {
  const styles = useStyles();
  const [state] = useFi();
  const signup = state.signup;
  if (!signup) return null;
  return (
    <section className={styles.form} aria-labelledby="signup-title">
      <Subtitle2 as="h2" id="signup-title">
        {t('addin.signup.title')}
      </Subtitle2>
      {signup.step === 'siren' && <SirenStep initial={signup.siren} />}
      {signup.step === 'company' && <CompanyStep siren={signup.siren} found={signup.found} />}
      {signup.step === 'waiting' && <Waiting email={signup.email ?? ''} />}
    </section>
  );
}

function SirenStep({ initial }: { initial: string }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const [siren, setSiren] = useState(initial);
  const digits = siren.replace(/\s/g, '');
  const busy = state.busy.includes('signup');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (/^\d{9}$/.test(digits)) void fi.lookupCompany(digits);
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <Text>{t('addin.signup.intro')}</Text>
      <Field label={t('addin.signup.siren')} hint={t('addin.signup.sirenHint')}>
        <Input inputMode="numeric" value={siren} onChange={(_, d) => setSiren(d.value)} />
      </Field>
      <span className={styles.row}>
        <Button appearance="primary" type="submit" disabled={busy || !/^\d{9}$/.test(digits)}>
          {busy ? <Spinner size="tiny" /> : t('addin.signup.lookup')}
        </Button>
        <Button appearance="subtle" onClick={fi.cancelSignup}>
          {t('addin.signup.haveAccount')}
        </Button>
      </span>
    </form>
  );
}

function CompanyStep({ siren, found }: { siren: string; found: DirectoryCompany | null }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const offer = state.signupOffer;
  const [name, setName] = useState(found?.name ?? '');
  const [line1, setLine1] = useState(found?.address?.line1 ?? '');
  const [line2, setLine2] = useState(found?.address?.line2 ?? '');
  const [postCode, setPostCode] = useState(found?.address?.postCode ?? '');
  const [city, setCity] = useState(found?.address?.city ?? '');
  const [vatId, setVatId] = useState(found?.vatId ?? '');
  const [email, setEmail] = useState('');
  const [accepted, setAccepted] = useState(false);
  const busy = state.busy.includes('signup');
  const ready = name.trim() && email.trim() && accepted && offer;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    const address = { line1, line2, postCode, city };
    const typed = Object.fromEntries(
      Object.entries(address)
        .map(([k, v]) => [k, v.trim()])
        .filter(([, v]) => v),
    );
    void fi.submitSignup(email, {
      name: name.trim(),
      address: Object.keys(typed).length ? { ...typed, country: 'FR' } : null,
      vatId: vatId.replace(/\s/g, '').toUpperCase() || null,
    });
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <Text>
        {found ? t('addin.signup.check', { siren }) : t('addin.signup.typeIn', { siren })}
      </Text>
      {found?.masked && (
        <MessageBar intent="info">
          <MessageBarBody>{t('addin.signup.masked')}</MessageBarBody>
        </MessageBar>
      )}
      <Field label={t('addin.signup.name')} required>
        <Input value={name} onChange={(_, d) => setName(d.value)} />
      </Field>
      <Field label={t('addin.signup.line1')}>
        <Input value={line1} onChange={(_, d) => setLine1(d.value)} />
      </Field>
      <Field label={t('addin.signup.line2')}>
        <Input value={line2} onChange={(_, d) => setLine2(d.value)} />
      </Field>
      <span className={styles.row}>
        <Field label={t('addin.signup.postCode')} className={styles.postCode}>
          <Input value={postCode} onChange={(_, d) => setPostCode(d.value)} />
        </Field>
        <Field label={t('addin.signup.city')}>
          <Input value={city} onChange={(_, d) => setCity(d.value)} />
        </Field>
      </span>
      <Field
        label={t('addin.signup.vatId')}
        hint={
          found?.vatSource === 'dgfip' && vatId === found.vatId
            ? t('addin.signup.vatListed')
            : t('addin.signup.vatToConfirm')
        }
      >
        <Input value={vatId} onChange={(_, d) => setVatId(d.value)} />
      </Field>
      <Field label={t('addin.signup.email')} hint={t('addin.signup.emailHint')} required>
        <Input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(_, d) => setEmail(d.value)}
        />
      </Field>
      <Caption1>{t('addin.signup.trial')}</Caption1>
      <Checkbox
        checked={accepted}
        onChange={(_, d) => setAccepted(d.checked === true)}
        label={
          <>
            {t('addin.signup.terms')}
            {offer?.termsUrl && (
              <>
                {' '}
                <Link href={offer.termsUrl} target="_blank" rel="noopener noreferrer">
                  {t('addin.signup.readTerms')}
                </Link>
              </>
            )}
          </>
        }
      />
      <span className={styles.row}>
        <Button appearance="primary" type="submit" disabled={busy || !ready}>
          {busy ? <Spinner size="tiny" /> : t('addin.signup.send')}
        </Button>
        <Button appearance="subtle" onClick={fi.signupBack}>
          {t('addin.signup.back')}
        </Button>
      </span>
    </form>
  );
}

function Waiting({ email }: { email: string }) {
  const styles = useStyles();
  const [, fi] = useFi();
  return (
    <div className={styles.form}>
      <MessageBar intent="info" data-testid="signup-waiting">
        <MessageBarBody>
          <Spinner size="tiny" /> {t('addin.signup.waiting', { email })}
        </MessageBarBody>
      </MessageBar>
      <span className={styles.row}>
        <Button onClick={fi.signupBack}>{t('addin.signup.edit')}</Button>
        <Button appearance="subtle" onClick={fi.cancelSignup}>
          {t('addin.login.cancel')}
        </Button>
      </span>
    </div>
  );
}
