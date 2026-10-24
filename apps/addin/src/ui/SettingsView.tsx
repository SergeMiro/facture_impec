// Screen 6, Réglages (plan §5): mode (Review, or the autopilot with its ceiling: chasing, and invoices
// to the customers opted in), chasing cadence, pseudonymization, PDP connection and the company's own
// platform key, Mode test, the lists of the company's ERP (BTP stage 4C), the invoice defaults, the AI
// choice, the subscription, the RGPD export and the account's deletion.
import { isMessageKey, t } from '@fi/shared';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  Field,
  Input,
  makeStyles,
  Radio,
  RadioGroup,
  Select,
  Spinner,
  Subtitle2,
  Switch,
  Text,
} from '@fluentui/react-components';
import { type FormEvent, useEffect, useState } from 'react';
import { AI_PROVIDERS, type AiChoice, type Settings } from '../api';
import { useFi } from './context';
import { ErpPart } from './ErpPart';
import { DeleteAccount, Subscription } from './Subscription';

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: '10px' },
  form: { display: 'flex', flexDirection: 'column', gap: '8px' },
  row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
});

type Provider = (typeof AI_PROVIDERS)[number];
type Category = NonNullable<Settings['invoiceDefaults']['operationCategory']>;
const CATEGORIES: readonly Category[] = ['services', 'goods', 'mixed'];

const label = (key: string, fallback: string) => (isMessageKey(key) ? t(key) : fallback);

/**
 * « -3, 7, 15 » → [-3, 7, 15]: days after the due date (negative: before it). null unless whole days
 * from -30 to 120 in increasing order, at most 8 (the API's rule).
 */
export function parseCadence(text: string): number[] | null {
  const parts = text.split(/[,;\s]+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 8) return null;
  const days = parts.map(Number);
  const valid = days.every(
    (d, i) => Number.isInteger(d) && d >= -30 && d <= 120 && (i === 0 || d > (days[i - 1] ?? d)),
  );
  return valid ? days : null;
}

/** « 15 », « 15 % » → 15; « » → null (no minimum); undefined unless a whole percentage from 1 to 90. */
export function parseMargin(text: string): number | null | undefined {
  const clean = text.replace(/[\s\u00a0\u202f%]/g, '');
  if (clean === '') return null;
  if (!/^\d+$/.test(clean)) return undefined;
  const margin = Number(clean);
  return margin >= 1 && margin <= 90 ? margin : undefined;
}

/** « 2 000 », « 1500,50 » → cents; null unless a positive amount in euros with at most 2 decimals. */
export function parseEuros(text: string): number | null {
  const clean = text.replace(/[\s\u00a0\u202f€]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100);
  return cents > 0 && cents <= 100_000_000 ? cents : null;
}

export function SettingsView() {
  const styles = useStyles();
  const [state] = useFi();
  const settings = state.settings;
  if (!settings) {
    return state.busy.includes('settings') ? <Spinner label={t('addin.loading')} /> : null;
  }
  return (
    <section className={styles.section} aria-labelledby="settings-title">
      <Subtitle2 as="h2" id="settings-title">
        {t('addin.settings.title')}
      </Subtitle2>
      <General settings={settings} />
      <Divider />
      <ErpPart />
      <Divider />
      <Defaults settings={settings} />
      <Divider />
      <Ai settings={settings} />
      <Divider />
      <Subscription />
      {state.billing?.enabled && <Divider />}
      <Account />
      <Divider />
      <DeleteAccount />
    </section>
  );
}

function Mode({ settings }: { settings: Settings }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const [mode, setMode] = useState(settings.mode);
  const [ceiling, setCeiling] = useState(
    settings.autopilotMaxAmount === null ? '' : String(settings.autopilotMaxAmount / 100),
  );
  const [ceilingError, setCeilingError] = useState(false);
  useEffect(() => setMode(settings.mode), [settings.mode]);
  const saving = state.busy.includes('saveSettings');

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'review') {
      void fi.saveSettings({ mode: 'review' });
      return;
    }
    const cents = parseEuros(ceiling);
    setCeilingError(cents === null);
    if (cents !== null) void fi.saveSettings({ mode: 'autopilot', autopilotMaxAmount: cents });
  };

  return (
    <form className={styles.form} onSubmit={save} data-testid="mode">
      <Field
        label={t('addin.settings.mode')}
        hint={
          settings.autopilotAvailable
            ? t('addin.settings.modeHint')
            : t('addin.settings.autopilotUnavailable')
        }
      >
        <RadioGroup value={mode} onChange={(_, d) => setMode(d.value as Settings['mode'])}>
          <Radio value="review" label={t('addin.settings.modeReview')} />
          <Radio
            value="autopilot"
            label={t('addin.settings.modeAutopilot')}
            disabled={!settings.autopilotAvailable}
          />
        </RadioGroup>
      </Field>
      {mode === 'autopilot' && (
        <Field
          label={t('addin.settings.ceiling')}
          hint={t('addin.settings.ceilingHint')}
          validationState={ceilingError ? 'error' : 'none'}
          validationMessage={ceilingError ? t('addin.settings.ceilingInvalid') : undefined}
        >
          <Input inputMode="decimal" value={ceiling} onChange={(_, d) => setCeiling(d.value)} />
        </Field>
      )}
      {(mode !== settings.mode || mode === 'autopilot') && (
        <Button type="submit" disabled={saving}>
          {mode === 'autopilot'
            ? t('addin.settings.autopilotSave')
            : t('addin.settings.reviewSave')}
        </Button>
      )}
    </form>
  );
}

function General({ settings }: { settings: Settings }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const [cadence, setCadence] = useState(settings.chaseCadence.join(', '));
  const [cadenceError, setCadenceError] = useState(false);
  useEffect(() => setCadence(settings.chaseCadence.join(', ')), [settings.chaseCadence]);
  const [margin, setMargin] = useState(String(settings.minMarginPercent ?? ''));
  const [marginError, setMarginError] = useState(false);
  useEffect(() => setMargin(String(settings.minMarginPercent ?? '')), [settings.minMarginPercent]);
  const saving = state.busy.includes('saveSettings');

  const saveCadence = (e: FormEvent) => {
    e.preventDefault();
    const days = parseCadence(cadence);
    setCadenceError(days === null);
    if (days) void fi.saveSettings({ chaseCadence: days });
  };

  const saveMargin = (e: FormEvent) => {
    e.preventDefault();
    const percent = parseMargin(margin);
    setMarginError(percent === undefined);
    if (percent !== undefined) void fi.saveSettings({ minMarginPercent: percent });
  };

  return (
    <div className={styles.form}>
      <Mode settings={settings} />

      <Switch
        checked={state.testMode}
        onChange={(_, d) => void fi.setTestMode(d.checked)}
        label={t('addin.settings.workbookTest')}
        data-testid="workbook-test"
      />
      <Switch
        checked={settings.sandboxEnabled}
        disabled={saving}
        onChange={(_, d) => void fi.saveSettings({ sandboxEnabled: d.checked })}
        label={t('addin.settings.sandbox')}
      />
      {!settings.testPlatform && <Caption1>{t('api.error.test_platform_missing')}</Caption1>}

      <form className={styles.form} onSubmit={saveCadence}>
        <Field
          label={t('addin.settings.cadence')}
          hint={t('addin.settings.cadenceHint')}
          validationState={cadenceError ? 'error' : 'none'}
          validationMessage={cadenceError ? t('addin.settings.cadenceInvalid') : undefined}
        >
          <Input value={cadence} onChange={(_, d) => setCadence(d.value)} />
        </Field>
        <Button type="submit" disabled={saving}>
          {t('addin.settings.save')}
        </Button>
      </form>

      <form className={styles.form} onSubmit={saveMargin}>
        <Field
          label={t('addin.settings.margin')}
          hint={t('addin.settings.marginHint')}
          validationState={marginError ? 'error' : 'none'}
          validationMessage={marginError ? t('addin.settings.marginInvalid') : undefined}
        >
          <Input
            value={margin}
            onChange={(_, d) => setMargin(d.value)}
            contentAfter="%"
            inputMode="numeric"
            data-testid="min-margin"
          />
        </Field>
        <Button type="submit" disabled={saving}>
          {t('addin.settings.save')}
        </Button>
      </form>

      <Switch
        checked={settings.btp}
        disabled={saving}
        onChange={(_, d) => void fi.saveSettings({ btp: d.checked })}
        label={t('addin.settings.btp')}
        data-testid="btp"
      />
      <Caption1>{t('addin.settings.btpHint')}</Caption1>

      <Switch
        checked={settings.pseudonymizeLlm}
        disabled
        label={t('addin.settings.pseudonymize')}
      />
      <Caption1>{t('addin.settings.pseudonymizeHint')}</Caption1>

      <Field label={t('addin.settings.pdp')}>
        <span className={styles.row}>
          <Text>{label(`addin.pdp.${settings.pdp.provider}`, settings.pdp.provider)}</Text>
          {settings.pdp.account && <Caption1>{settings.pdp.account}</Caption1>}
          <Badge appearance="tint" color={settings.pdp.connected ? 'success' : 'warning'}>
            {settings.pdp.connected
              ? t('addin.settings.pdpConnected')
              : t('addin.settings.pdpMissing')}
          </Badge>
        </span>
      </Field>
      {settings.pdp.ownKey.available && <PdpKey settings={settings} />}
    </div>
  );
}

/** « Votre propre clé B2Brouter »: the server tries it on the account before saving it. */
function PdpKey({ settings }: { settings: Settings }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const [apiKey, setApiKey] = useState('');
  const [account, setAccount] = useState('');
  const hint = settings.pdp.ownKey.hint;
  const busy = state.busy.includes('pdpKey');
  const owner = !state.me?.user || state.me.user.role === 'owner';

  const save = (e: FormEvent) => {
    e.preventDefault();
    void fi.savePdpKey(apiKey.trim(), account.trim() || undefined).then((ok) => {
      if (ok) {
        setApiKey('');
        setAccount('');
      }
    });
  };

  return (
    <form className={styles.form} onSubmit={save} data-testid="pdp-key">
      <Field
        label={t('addin.settings.pdpKey')}
        hint={hint ? t('addin.settings.pdpKeySavedHint', { hint }) : t('addin.settings.pdpKeyHint')}
      >
        <Input
          type="password"
          value={apiKey}
          disabled={!owner}
          onChange={(_, d) => setApiKey(d.value)}
        />
      </Field>
      <Field label={t('addin.settings.pdpAccount')} hint={t('addin.settings.pdpAccountHint')}>
        <Input value={account} disabled={!owner} onChange={(_, d) => setAccount(d.value)} />
      </Field>
      {!owner && <Caption1>{t('api.error.owner_only')}</Caption1>}
      <span className={styles.row}>
        <Button type="submit" disabled={!owner || busy || apiKey.trim().length < 8}>
          {t('addin.settings.pdpKeySave')}
        </Button>
        {hint && (
          <Button
            appearance="subtle"
            disabled={!owner || busy}
            onClick={() => void fi.removePdpKey()}
          >
            {t('addin.settings.pdpKeyRemove')}
          </Button>
        )}
        {busy && <Spinner size="tiny" />}
      </span>
    </form>
  );
}

function Defaults({ settings }: { settings: Settings }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const d = settings.invoiceDefaults;
  const [siret, setSiret] = useState(d.siret ?? '');
  const [iban, setIban] = useState(d.iban ?? '');
  const [bic, setBic] = useState(d.bic ?? '');
  const [days, setDays] = useState(d.paymentDays?.toString() ?? '');
  const [category, setCategory] = useState<Category | ''>(d.operationCategory ?? '');
  const [daysError, setDaysError] = useState(false);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const paymentDays = days.trim() === '' ? undefined : Number(days);
    const badDays =
      paymentDays !== undefined &&
      (!Number.isInteger(paymentDays) || paymentDays < 0 || paymentDays > 365);
    setDaysError(badDays);
    if (badDays) return;
    // PATCH replaces the whole object: keep what this form does not show, drop what was emptied.
    const { siret: _s, iban: _i, bic: _b, paymentDays: _p, operationCategory: _c, ...kept } = d;
    void fi.saveSettings({
      invoiceDefaults: {
        ...kept,
        ...(siret.trim() && { siret: siret.replace(/\s/g, '') }),
        ...(iban.trim() && { iban: iban.replace(/\s/g, '').toUpperCase() }),
        ...(bic.trim() && { bic: bic.trim().toUpperCase() }),
        ...(paymentDays !== undefined && { paymentDays }),
        ...(category && { operationCategory: category }),
      },
    });
  };

  return (
    <form className={styles.form} onSubmit={save}>
      <Subtitle2 as="h3">{t('addin.settings.defaults')}</Subtitle2>
      <Caption1>{t('addin.settings.defaultsHint')}</Caption1>
      <Field label={t('addin.settings.siret')}>
        <Input value={siret} onChange={(_, v) => setSiret(v.value)} inputMode="numeric" />
      </Field>
      <Field label={t('addin.settings.iban')}>
        <Input value={iban} onChange={(_, v) => setIban(v.value)} />
      </Field>
      <Field label={t('addin.settings.bic')}>
        <Input value={bic} onChange={(_, v) => setBic(v.value)} />
      </Field>
      <Field
        label={t('addin.settings.paymentDays')}
        validationState={daysError ? 'error' : 'none'}
        validationMessage={daysError ? t('addin.settings.paymentDaysInvalid') : undefined}
      >
        <Input value={days} onChange={(_, v) => setDays(v.value)} inputMode="numeric" />
      </Field>
      <Field label={t('addin.settings.category')}>
        <Select value={category} onChange={(_, v) => setCategory(v.value as Category | '')}>
          <option value="">{t('addin.detect.none')}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`addin.settings.category.${c}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" disabled={state.busy.includes('saveSettings')}>
        {t('addin.settings.save')}
      </Button>
    </form>
  );
}

function Ai({ settings }: { settings: Settings }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const ai = settings.ai;
  const [mode, setMode] = useState(ai.mode);
  const [provider, setProvider] = useState<Provider>(
    AI_PROVIDERS.find((p) => p === ai.provider) ?? 'mistral',
  );
  const [agentModel, setAgentModel] = useState(ai.models?.agent ?? '');
  const [classifyModel, setClassifyModel] = useState(ai.models?.classify ?? '');
  const [baseUrl, setBaseUrl] = useState(ai.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');

  const save = (e: FormEvent) => {
    e.preventDefault();
    let choice: AiChoice;
    if (mode === 'byok') {
      choice = {
        mode,
        provider,
        models: { agent: agentModel.trim(), classify: (classifyModel || agentModel).trim() },
        ...(baseUrl.trim() && { baseUrl: baseUrl.trim() }),
        ...(apiKey && { apiKey }),
      };
    } else {
      choice = { mode };
    }
    void fi.saveAi(choice).then((ok) => ok && setApiKey(''));
  };

  return (
    <form className={styles.form} onSubmit={save}>
      <Subtitle2 as="h3">{t('addin.settings.ai')}</Subtitle2>
      <Caption1>{t('addin.settings.aiHint')}</Caption1>
      <RadioGroup value={mode} onChange={(_, d) => setMode(d.value as typeof mode)}>
        <Radio
          value="included"
          disabled={!ai.includedProvider}
          label={
            ai.includedProvider
              ? t('addin.settings.aiIncluded', {
                  provider: label(`addin.provider.${ai.includedProvider}`, ai.includedProvider),
                })
              : t('addin.settings.aiIncludedNone')
          }
        />
        <Radio value="off" label={t('addin.settings.aiOff')} />
        <Radio value="byok" disabled={!ai.byokAvailable} label={t('addin.settings.aiByok')} />
      </RadioGroup>
      {mode === 'byok' && (
        <>
          <Field label={t('addin.settings.aiProvider')}>
            <Select value={provider} onChange={(_, d) => setProvider(d.value as Provider)}>
              {AI_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {label(`addin.provider.${p}`, p)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('addin.settings.aiModel')} required>
            <Input value={agentModel} onChange={(_, d) => setAgentModel(d.value)} />
          </Field>
          <Field label={t('addin.settings.aiClassify')} hint={t('addin.settings.aiClassifyHint')}>
            <Input value={classifyModel} onChange={(_, d) => setClassifyModel(d.value)} />
          </Field>
          {(provider === 'azure' || provider === 'openai-compatible') && (
            <Field label={t('addin.settings.aiBaseUrl')} required>
              <Input type="url" value={baseUrl} onChange={(_, d) => setBaseUrl(d.value)} />
            </Field>
          )}
          <Field
            label={t('addin.settings.aiKey')}
            hint={
              ai.keyHint
                ? t('addin.settings.aiKeySaved', { hint: ai.keyHint })
                : t('addin.settings.aiKeyHint')
            }
          >
            <Input type="password" value={apiKey} onChange={(_, d) => setApiKey(d.value)} />
          </Field>
        </>
      )}
      <Button
        type="submit"
        disabled={state.busy.includes('saveAi') || (mode === 'byok' && !agentModel.trim())}
      >
        {t('addin.settings.save')}
      </Button>
    </form>
  );
}

function Account() {
  const styles = useStyles();
  const [state, fi] = useFi();
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  useEffect(() => () => void (exportUrl && URL.revokeObjectURL(exportUrl)), [exportUrl]);

  const exportData = async () => {
    const blob = await fi.exportData();
    if (blob) setExportUrl(URL.createObjectURL(blob));
  };

  return (
    <div className={styles.form}>
      <Subtitle2 as="h3">{t('addin.settings.account')}</Subtitle2>
      {state.me?.user && (
        <Text>{t('addin.settings.signedInAs', { email: state.me.user.email })}</Text>
      )}
      <Caption1>{t('addin.settings.exportHint')}</Caption1>
      <span className={styles.row}>
        <Button onClick={() => void exportData()} disabled={state.busy.includes('export')}>
          {t('addin.settings.export')}
        </Button>
        {exportUrl && (
          <a href={exportUrl} download="facture-impec-export.json">
            {t('addin.settings.exportReady')}
          </a>
        )}
      </span>
      <Button appearance="subtle" onClick={() => void fi.signOut()}>
        {t('addin.settings.signOut')}
      </Button>
    </div>
  );
}
