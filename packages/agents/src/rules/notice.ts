// What a firing says, in French (CLAUDE.md rule 6): `rules.<id>.title` and `rules.<id>.notice` in
// fr.json, filled with the facts the rule found. Amounts and dates are written the French way here,
// so a rule's facts stay cents and ISO days in the database.
import { frDate, frMoney } from '@fi/core';
import { isMessageKey, type MessageParams, t } from '@fi/shared';
import type { Found } from './context';

/** The facts that are amounts in cents. */
const MONEY = new Set([
  'ht',
  'cumulHt',
  'before',
  'after',
  'sales',
  'costs',
  'margin',
  'collected',
  'deductible',
  'net',
  'in30',
  'in60',
  'in90',
  'out30',
  'out60',
  'out90',
  'lateIn',
]);
const DATES = new Set(['date', 'lastDate']);

const monthName = new Intl.DateTimeFormat('fr-FR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function word(key: string, value: Found['facts'][string]): string | number {
  if (value === null) return t('rules.unknown');
  if (typeof value === 'boolean') return t(value ? 'rules.yes' : 'rules.no');
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : t('rules.none');
  if (typeof value === 'number') {
    if (MONEY.has(key)) return frMoney(value);
    return Number.isInteger(value) ? value : String(value).replace('.', ',');
  }
  if (DATES.has(key)) return frDate(value as string);
  if (key === 'month') return monthName.format(new Date(`${value}-01T00:00:00Z`));
  const named = `rules.word.${value}`;
  return isMessageKey(named) ? t(named) : (value as string);
}

export function noticeParams(facts: Found['facts']): MessageParams {
  return Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, word(k, v)]));
}

/** The title and the sentence of a rule's firing; a rule without its text says so plainly. */
export function noticeOf(rule: string, facts: Found['facts']): { title: string; text: string } {
  const title = `rules.${rule}.title`;
  const text = `rules.${rule}.notice`;
  const params = noticeParams(facts);
  return {
    title: isMessageKey(title) ? t(title) : rule,
    text: isMessageKey(text) ? t(text, params) : t('rules.noText', { rule }),
  };
}
