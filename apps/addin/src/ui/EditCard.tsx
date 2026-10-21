// R8: the « Avant → Après » card of a correction, or of its undo. Nothing is written before the click;
// an undo that finds the cell changed since asks again, and only « Remettre quand même » writes.
import { t } from '@fi/shared';
import {
  Button,
  Caption1,
  Card,
  MessageBar,
  MessageBarBody,
  makeStyles,
  Text,
  tokens,
} from '@fluentui/react-components';
import type { Edit } from '../api';
import { decimalFr, type EditCard } from '../controller';
import { useFi } from './context';

const useStyles = makeStyles({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '10px',
    border: `1px solid ${tokens.colorBrandStroke1}`,
  },
  change: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
  value: { display: 'flex', flexDirection: 'column' },
  after: { fontWeight: tokens.fontWeightSemibold, color: tokens.colorBrandForeground1 },
  line: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function EditCardView({ card }: { card: EditCard }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const { edit } = card;
  const cell = `${edit.sheet}!${edit.cell}`;
  const [from, to] = card.kind === 'fix' ? [edit.before, edit.after] : [edit.after, edit.before];
  const busy = state.busy.includes('edit');
  return (
    <Card className={styles.card} data-testid="edit-card">
      <Text weight="semibold">
        {t(card.kind === 'fix' ? 'addin.edit.title.fix' : 'addin.edit.title.undo', { cell })}
      </Text>
      <Caption1 className={styles.muted}>{t('addin.edit.field.price')}</Caption1>
      <span className={styles.change}>
        <span className={styles.value}>
          <Caption1 className={styles.muted}>{t('addin.edit.before')}</Caption1>
          <Text data-testid="edit-before">{decimalFr(from)}</Text>
        </span>
        <Text aria-hidden>→</Text>
        <span className={styles.value}>
          <Caption1 className={styles.muted}>{t('addin.edit.after')}</Caption1>
          <Text className={styles.after} data-testid="edit-after">
            {decimalFr(to)}
          </Text>
        </span>
      </span>
      {card.conflict ? (
        <>
          <MessageBar intent="warning" layout="multiline">
            <MessageBarBody>
              {t('addin.edit.conflict.undo', {
                cell,
                found: card.conflict.found,
                expected: decimalFr(from),
                value: decimalFr(to),
              })}
            </MessageBarBody>
          </MessageBar>
          <span className={styles.line}>
            <Button appearance="primary" disabled={busy} onClick={() => void fi.overwrite()}>
              {t('addin.edit.overwrite')}
            </Button>
            <Button disabled={busy} onClick={() => void fi.declineCard()}>
              {t('addin.edit.leave')}
            </Button>
          </span>
        </>
      ) : (
        <>
          <Caption1 className={styles.muted}>{t('addin.edit.safe')}</Caption1>
          <span className={styles.line}>
            <Button appearance="primary" disabled={busy} onClick={() => void fi.applyCard()}>
              {t(card.kind === 'fix' ? 'addin.edit.apply' : 'addin.edit.applyUndo')}
            </Button>
            <Button disabled={busy} onClick={() => void fi.declineCard()}>
              {t(card.kind === 'fix' ? 'addin.edit.decline' : 'addin.edit.keep')}
            </Button>
          </span>
        </>
      )}
    </Card>
  );
}

/** The correction last applied from this pane, with « Annuler la correction ». */
export function CorrectedCard({ edit }: { edit: Edit }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  return (
    <Card className={styles.card} data-testid="corrected">
      <Text>
        {t('addin.edit.corrected', {
          cell: `${edit.sheet}!${edit.cell}`,
          before: decimalFr(edit.before),
          after: decimalFr(edit.after),
        })}
      </Text>
      <span className={styles.line}>
        <Button
          size="small"
          disabled={state.busy.includes(`fix:${edit.findingId}`) || state.card !== null}
          onClick={() => void fi.undoCorrection(edit)}
        >
          {t('addin.edit.undo')}
        </Button>
      </span>
    </Card>
  );
}
