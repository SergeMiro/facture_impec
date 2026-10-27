// The pane's shared blocks: a screen is a column of groups, each a white card on the pane's grey,
// its title, one line saying what it is for, then its controls.
import { makeStyles, tokens } from '@fluentui/react-components';

export const useLayout = makeStyles({
  page: { display: 'flex', flexDirection: 'column', gap: '12px' },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px',
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    boxShadow: tokens.shadow2,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  hint: { color: tokens.colorNeutralForeground3 },
  /** An input and its « Enregistrer » on one line. */
  inline: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '6px',
    '& > :first-child': { flexGrow: 1 },
  },
  /** A button that keeps its width in a column form. */
  action: { alignSelf: 'flex-start' },
  danger: { border: `1px solid ${tokens.colorPaletteRedBorder1}` },
});
