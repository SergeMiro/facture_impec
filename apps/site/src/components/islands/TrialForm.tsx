import type { TrialRequest } from '@fi/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  excelOptions,
  messages,
  planOptions,
  type TrialField,
  volumeOptions,
} from '../../content/trial-form';
import { Icon } from '../Icon';

type Profile = TrialRequest['profile'];
type Plan = NonNullable<TrialRequest['plan']>;
type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; firstName: string; email: string }
  | { kind: 'error'; message: string; fields: Partial<Record<TrialField, string>> };

const input =
  'w-full rounded-xl border border-leaf-900/12 bg-white px-3.5 py-3 text-[0.95rem] text-ink shadow-[inset_0_1px_2px_rgb(12_29_22/0.04)] transition placeholder:text-black/30 focus:border-leaf-400 focus:ring-4 focus:ring-leaf-400/15 focus:outline-none aria-[invalid=true]:border-amber-500';

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 flex items-baseline justify-between gap-3 text-sm font-medium text-leaf-950"
      >
        {label}
        {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-[0.82rem] text-amber-700">
          {error}
        </p>
      )}
    </div>
  );
}

export default function TrialForm() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [profile, setProfile] = useState<Profile>('company');
  const [plan, setPlan] = useState<Plan | ''>('');
  const startedAt = useRef(Date.now());

  // A plan comes from a pricing card (fi:plan event) or a deep link such as /?offre=cabinet#essai.
  useEffect(() => {
    const choose = (id: string | null) => {
      const match = planOptions.find((p) => p.value === id);
      if (!match) return;
      setPlan(match.value);
      if (match.value === 'cabinet') setProfile('accountant');
    };
    choose(new URLSearchParams(window.location.search).get('offre'));
    const onPlan = (e: Event) => choose((e as CustomEvent<string>).detail);
    window.addEventListener('fi:plan', onPlan);
    return () => window.removeEventListener('fi:plan', onPlan);
  }, []);

  const fieldError = (f: TrialField) => (state.kind === 'error' ? state.fields[f] : undefined);
  const aria = (f: TrialField) =>
    fieldError(f) ? { 'aria-invalid': true, 'aria-describedby': `trial-${f}-error` } : {};

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const payload = {
      ...data,
      profile,
      plan: plan || undefined,
      consent: data.consent === 'on',
      startedAt: startedAt.current,
    };
    setState({ kind: 'sending' });
    try {
      const res = await fetch('/api/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        fieldErrors?: Partial<Record<TrialField, string>>;
      };
      if (res.ok && body.ok) {
        setState({
          kind: 'sent',
          firstName: String(data.firstName ?? '').trim(),
          email: String(data.email ?? '').trim(),
        });
        return;
      }
      setState({
        kind: 'error',
        message: body.message ?? messages.server,
        fields: body.fieldErrors ?? {},
      });
    } catch {
      setState({ kind: 'error', message: messages.network, fields: {} });
    }
  }

  if (state.kind === 'sent') {
    return (
      <div
        className="flex min-h-[32rem] flex-col items-center justify-center p-8 text-center sm:p-12"
        role="status"
      >
        <span className="flex h-16 w-16 animate-pulse-ring items-center justify-center rounded-full bg-leaf-500 text-white">
          <Icon name="check" size={32} strokeWidth={2.4} />
        </span>
        <h3 className="mt-6 text-3xl text-leaf-950">
          Merci{state.firstName ? `, ${state.firstName}` : ''} !
        </h3>
        <p className="mt-3 max-w-sm leading-relaxed text-muted">
          Votre demande est bien enregistrée. Nous vous écrivons à{' '}
          <strong className="text-leaf-900">{state.email}</strong> avec votre lien d’installation et
          les étapes pour démarrer.
        </p>
        <a href="#demo" className="btn btn-outline mt-8">
          <Icon name="play" size={16} /> Revoir la démo en attendant
        </a>
      </div>
    );
  }

  const sending = state.kind === 'sending';

  return (
    <form onSubmit={onSubmit} className="relative space-y-5 p-6 sm:p-9">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-leaf-950">Vous êtes</legend>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              { value: 'company', label: 'Une entreprise', icon: 'building' },
              { value: 'accountant', label: 'Un cabinet comptable', icon: 'users' },
            ] as const
          ).map((o) => (
            <label
              key={o.value}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-sm font-medium transition ${
                profile === o.value
                  ? 'border-leaf-400 bg-leaf-50 text-leaf-900 ring-4 ring-leaf-400/15'
                  : 'border-leaf-900/12 bg-white text-muted hover:border-leaf-300'
              }`}
            >
              <input
                type="radio"
                name="profile-choice"
                value={o.value}
                checked={profile === o.value}
                onChange={() => setProfile(o.value)}
                className="sr-only"
              />
              <Icon
                name={o.icon}
                size={18}
                className={profile === o.value ? 'text-leaf-600' : ''}
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="trial-firstName" label="Prénom" error={fieldError('firstName')}>
          <input
            id="trial-firstName"
            name="firstName"
            required
            maxLength={80}
            autoComplete="given-name"
            className={input}
            {...aria('firstName')}
          />
        </Field>
        <Field id="trial-lastName" label="Nom" error={fieldError('lastName')}>
          <input
            id="trial-lastName"
            name="lastName"
            required
            maxLength={80}
            autoComplete="family-name"
            className={input}
            {...aria('lastName')}
          />
        </Field>
      </div>

      <Field id="trial-email" label="E-mail professionnel" error={fieldError('email')}>
        <input
          id="trial-email"
          name="email"
          type="email"
          required
          maxLength={200}
          autoComplete="email"
          className={input}
          placeholder="vous@entreprise.fr"
          {...aria('email')}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-[1.3fr_1fr]">
        <Field
          id="trial-company"
          label={profile === 'accountant' ? 'Cabinet' : 'Entreprise'}
          error={fieldError('company')}
        >
          <input
            id="trial-company"
            name="company"
            required
            maxLength={160}
            autoComplete="organization"
            className={input}
            {...aria('company')}
          />
        </Field>
        <Field id="trial-siren" label="SIREN" hint="facultatif" error={fieldError('siren')}>
          <input
            id="trial-siren"
            name="siren"
            inputMode="numeric"
            pattern="[0-9 ]{9,11}"
            maxLength={11}
            className={`${input} tabular-nums`}
            placeholder="123 456 789"
            {...aria('siren')}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="trial-volume"
          label="Factures émises par mois"
          error={fieldError('invoicesPerMonth')}
        >
          <select
            id="trial-volume"
            name="invoicesPerMonth"
            required
            defaultValue=""
            className={input}
            {...aria('invoicesPerMonth')}
          >
            <option value="" disabled>
              Choisir…
            </option>
            {volumeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="trial-excel" label="Votre Excel" error={fieldError('excel')}>
          <select
            id="trial-excel"
            name="excel"
            required
            defaultValue=""
            className={input}
            {...aria('excel')}
          >
            <option value="" disabled>
              Choisir…
            </option>
            {excelOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        id="trial-plan"
        label="Offre qui vous intéresse"
        hint="facultatif"
        error={fieldError('plan')}
      >
        <select
          id="trial-plan"
          value={plan}
          onChange={(e) => setPlan(e.target.value as Plan | '')}
          className={input}
        >
          <option value="">Je ne sais pas encore</option>
          {planOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        id="trial-message"
        label="Un mot sur votre besoin"
        hint="facultatif"
        error={fieldError('message')}
      >
        <textarea
          id="trial-message"
          name="message"
          rows={3}
          maxLength={2000}
          className={`${input} resize-y`}
          placeholder="Par exemple : nous facturons une soixantaine de clients par mois depuis un modèle Excel."
          {...aria('message')}
        />
      </Field>

      {/* Honeypot: hidden from people, filled by bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Site web
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <label className="flex items-start gap-3 text-sm leading-relaxed text-muted">
        <input
          name="consent"
          type="checkbox"
          required
          className="mt-1 h-4 w-4 shrink-0 accent-leaf-500"
          {...aria('consent')}
        />
        <span>
          J’accepte d’être recontacté au sujet de mon essai. Mes informations ne servent qu’à cela
          et ne sont jamais revendues.{' '}
          <a
            href="/confidentialite"
            className="font-medium text-leaf-700 underline underline-offset-2"
          >
            Politique de confidentialité
          </a>
        </span>
      </label>
      {fieldError('consent') && (
        <p className="-mt-3 text-[0.82rem] text-amber-700">{fieldError('consent')}</p>
      )}

      {state.kind === 'error' && (
        <p
          className="flex items-start gap-2.5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200"
          role="alert"
        >
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={sending}
        className="btn btn-primary w-full !py-3.5 text-base disabled:cursor-wait disabled:opacity-70"
      >
        {sending ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />{' '}
            Envoi en cours…
          </>
        ) : (
          <>
            Recevoir mon accès d’essai <Icon name="arrowRight" size={18} />
          </>
        )}
      </button>
      <p className="text-center text-xs text-muted">
        Sans carte bancaire · Réponse par e-mail · Annulable à tout moment
      </p>
    </form>
  );
}
