import fr from '../i18n/fr.json' with { type: 'json' };

// UI strings live only in i18n/fr.json (CLAUDE.md rule 6); keys are checked at compile time.
export type MessageKey = keyof typeof fr;
export type MessageParams = Readonly<Record<string, string | number>>;

const messages: Readonly<Record<string, string>> = fr;

/** For keys built at run time (rule ids, field names); `t` stays the checked path. */
export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(messages, key);
}

/** Replaces `{name}` with params.name; a placeholder without a value stays visible so a test catches it. */
export function t(key: MessageKey, params?: MessageParams): string {
  const text = fr[key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );
}
