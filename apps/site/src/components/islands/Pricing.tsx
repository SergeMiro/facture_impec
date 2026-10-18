import { useState } from 'react';
import type { Plan } from '../../content/site';
import { Icon } from '../Icon';

const price = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export default function Pricing({ plans }: { plans: Plan[] }) {
  const [yearly, setYearly] = useState(true);

  return (
    <div>
      <div className="flex justify-center">
        <fieldset className="relative inline-grid grid-cols-2 rounded-full bg-white p-1 shadow-soft ring-1 ring-leaf-900/10">
          <legend className="sr-only">Périodicité de facturation</legend>
          <span
            aria-hidden="true"
            className={`absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-full bg-leaf-500 shadow transition-transform duration-300 left-1 ${yearly ? 'translate-x-full' : 'translate-x-0'}`}
          />
          {[
            { value: false, label: 'Mensuel' },
            { value: true, label: 'Annuel' },
          ].map((o) => (
            <label
              key={o.label}
              className={`relative z-10 cursor-pointer rounded-full px-5 py-2 text-center text-sm font-semibold transition-colors ${yearly === o.value ? 'text-white' : 'text-muted hover:text-leaf-900'}`}
            >
              <input
                type="radio"
                name="billing"
                className="sr-only"
                checked={yearly === o.value}
                onChange={() => setYearly(o.value)}
              />
              {o.label}
              {o.value && (
                <span className={`ml-1.5 text-xs ${yearly ? 'text-leaf-100' : 'text-leaf-600'}`}>
                  2 mois offerts
                </span>
              )}
            </label>
          ))}
        </fieldset>
      </div>

      <ul className="mt-12 grid items-start gap-6 lg:grid-cols-3">
        {plans.map((plan) => {
          const amount = yearly ? plan.yearlyPerMonth : plan.monthly;
          const dark = plan.highlight === true;
          return (
            <li
              key={plan.id}
              className={`relative flex flex-col rounded-[1.5rem] p-7 sm:p-8 ${
                dark
                  ? 'bg-leaf-950 text-white shadow-[0_30px_60px_-25px_rgb(5_36_26/0.7)] ring-1 ring-leaf-400/30 lg:-mt-4 lg:pb-12'
                  : 'card'
              }`}
            >
              {dark && (
                <span className="absolute -top-3 left-7 rounded-full bg-gold px-3 py-1 text-xs font-semibold text-leaf-950">
                  Recommandé
                </span>
              )}
              <h3 className={`text-2xl ${dark ? 'text-white' : 'text-leaf-950'}`}>{plan.name}</h3>
              <p className={`mt-1.5 text-sm ${dark ? 'text-leaf-100/70' : 'text-muted'}`}>
                {plan.pitch}
              </p>
              <p className="mt-6 flex items-baseline gap-1.5">
                <span
                  className={`font-display text-5xl font-medium tabular-nums ${dark ? 'text-white' : 'text-leaf-950'}`}
                >
                  {price.format(amount)} €
                </span>
                <span className={`text-sm ${dark ? 'text-leaf-100/70' : 'text-muted'}`}>
                  HT {plan.unit}
                </span>
              </p>
              <p className={`mt-1 h-5 text-xs ${dark ? 'text-leaf-200/70' : 'text-muted'}`}>
                {[plan.priceNote, yearly ? 'facturé annuellement' : 'sans engagement']
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p
                className={`mt-5 rounded-xl px-3.5 py-2.5 text-sm font-medium ${dark ? 'bg-white/8 text-leaf-100' : 'bg-leaf-50 text-leaf-800'}`}
              >
                {plan.quota}
              </p>
              <ul className="mt-6 flex-1 space-y-3 text-[0.95rem]">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-3">
                    <Icon
                      name="check"
                      size={18}
                      className={`mt-0.5 shrink-0 ${dark ? 'text-leaf-300' : 'text-leaf-500'}`}
                    />
                    <span className={dark ? 'text-leaf-50/85' : 'text-ink/80'}>{f}</span>
                  </li>
                ))}
              </ul>
              <a
                href={`/?offre=${plan.id}#essai`}
                onClick={(e) => {
                  e.preventDefault();
                  window.dispatchEvent(new CustomEvent('fi:plan', { detail: plan.id }));
                  history.replaceState(null, '', `?offre=${plan.id}#essai`);
                  document.getElementById('essai')?.scrollIntoView({ behavior: 'smooth' });
                }}
                className={`btn mt-8 w-full ${dark ? 'btn-primary' : 'btn-outline'}`}
              >
                {plan.cta} <Icon name="arrowRight" size={17} />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
