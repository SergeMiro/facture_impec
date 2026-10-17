import fr from '../i18n/fr.json' with { type: 'json' };

// UI strings live only in i18n/fr.json (CLAUDE.md rule 6); keys are checked at compile time.
export type MessageKey = keyof typeof fr;

export function t(key: MessageKey): string {
  return fr[key];
}
