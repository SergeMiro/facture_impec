// How far a deadline is, in the words « Documents » and « À valider » share.
import { t } from '@fi/shared';

const DAY_MS = 86_400_000;

/** Whole days from one ISO day to another. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/** « dans 12 jours », « demain », « depuis hier »… next to the date. */
export function when(days: number): string {
  if (days === 0) return t('addin.documents.dueToday');
  if (days === 1) return t('addin.documents.dueTomorrow');
  if (days === -1) return t('addin.documents.overdueYesterday');
  return days > 0
    ? t('addin.documents.dueIn', { count: days })
    : t('addin.documents.overdueSince', { count: -days });
}
