// The ribbon's function commands. Each id must equal a <FunctionName> of manifest.xml, and each
// needs an Office.actions.associate call (docs/OFFICE.md §2); commands.test.ts checks both lists.
export const COMMANDS = ['verifier', 'envoyer', 'modeTest'] as const;
export type Command = (typeof COMMANDS)[number];
