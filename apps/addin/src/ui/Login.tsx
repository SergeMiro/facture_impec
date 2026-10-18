// Screen 1, Connexion (plan §5): a link by e-mail, or the company's access key; « Créer un compte »
// where the server offers sign-up (M7).
import { t } from '@fi/shared';
import {
  Button,
  Divider,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  makeStyles,
  Spinner,
  Subtitle2,
  Text,
} from '@fluentui/react-components';
import { type FormEvent, useState } from 'react';
import { useFi } from './context';

const useStyles = makeStyles({
  form: { display: 'flex', flexDirection: 'column', gap: '10px' },
});

export function Login() {
  const styles = useStyles();
  const [state, fi] = useFi();
  const [email, setEmail] = useState('');
  const [key, setKey] = useState('');
  const busy = state.busy.includes('login');

  const sendLink = (e: FormEvent) => {
    e.preventDefault();
    if (email.trim()) void fi.requestLink(email);
  };
  const useKey = (e: FormEvent) => {
    e.preventDefault();
    if (key.trim()) void fi.signInWithKey(key);
  };

  return (
    <section className={styles.form} aria-labelledby="login-title">
      <Subtitle2 as="h2" id="login-title">
        {t('addin.login.title')}
      </Subtitle2>
      <Text>{t('addin.login.intro')}</Text>

      {state.link ? (
        <MessageBar intent="info" data-testid="link-waiting">
          <MessageBarBody>
            <Spinner size="tiny" /> {t('addin.login.waiting', { email: state.link.email })}{' '}
            <Button size="small" appearance="transparent" onClick={fi.cancelLink}>
              {t('addin.login.cancel')}
            </Button>
          </MessageBarBody>
        </MessageBar>
      ) : state.magicLink ? (
        <form className={styles.form} onSubmit={sendLink}>
          <Field label={t('addin.login.email')}>
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(_, d) => setEmail(d.value)}
            />
          </Field>
          <Button appearance="primary" type="submit" disabled={busy || !email.trim()}>
            {t('addin.login.sendLink')}
          </Button>
        </form>
      ) : (
        <Text size={200}>{t('addin.login.noLink')}</Text>
      )}

      {state.signupOffer && !state.link && (
        <>
          <Divider>{t('addin.login.new')}</Divider>
          <Button onClick={fi.startSignup} data-testid="start-signup">
            {t('addin.login.signup')}
          </Button>
        </>
      )}

      <Divider>{t('addin.login.or')}</Divider>

      <form className={styles.form} onSubmit={useKey}>
        <Field label={t('addin.login.key')} hint={t('addin.login.keyHint')}>
          <Input type="password" value={key} onChange={(_, d) => setKey(d.value)} />
        </Field>
        <Button type="submit" disabled={busy || !key.trim()}>
          {t('addin.login.withKey')}
        </Button>
      </form>
    </section>
  );
}
