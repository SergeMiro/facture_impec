// « À valider » (BTP plan stage 3B, `docs/plans/phase-3.md`): the requests the deadline watchers
// drafted, each with what it will send and to whom, and the companies to confirm. Nothing leaves
// before a person clicks « Envoyer »; « Modifier » changes the text and the address, « Plus tard »
// hides it for a while, « Ignorer » drops it.
import { frDate } from '@fi/core';
import { t } from '@fi/shared';
import {
  Button,
  Caption1,
  Card,
  Field,
  Input,
  Link,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  MessageBarBody,
  makeStyles,
  Spinner,
  Text,
  Textarea,
  tokens,
} from '@fluentui/react-components';
import { useState } from 'react';
import type { ActionItem } from '../api';
import { useFi } from './context';
import { daysBetween, when } from './days';

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: '10px' },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  card: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px' },
  line: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  head: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' },
  muted: { color: tokens.colorNeutralForeground3 },
  body: {
    margin: 0,
    padding: '6px 8px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    fontFamily: 'inherit',
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground2,
  },
});

/** « Plus tard »: put aside for this many days (the API takes up to thirty). */
const LATER = [
  { days: 1, label: 'addin.actions.later.tomorrow' },
  { days: 7, label: 'addin.actions.later.week' },
  { days: 14, label: 'addin.actions.later.twoWeeks' },
] as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function EditForm({ item, onDone }: { item: ActionItem; onDone: () => void }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const [to, setTo] = useState(item.email?.to ?? '');
  const [text, setText] = useState(item.email?.body ?? '');
  const toOk = EMAIL.test(to.trim());
  const busy = state.busy.includes(`action:${item.id}`);
  const save = async () => {
    const trimmed = to.trim();
    const ok = await fi.decideAction(item, {
      decision: 'edit',
      comment: text,
      ...(trimmed !== (item.email?.to ?? '') && { to: trimmed }),
    });
    if (ok) onDone();
  };
  return (
    <div className={styles.section}>
      <Field
        label={t('addin.actions.form.to')}
        required
        validationMessage={to !== '' && !toOk ? t('addin.actions.form.toInvalid') : undefined}
      >
        <Input
          type="email"
          value={to}
          onChange={(_, d) => setTo(d.value)}
          data-testid="action-to"
        />
      </Field>
      <Field label={t('addin.actions.form.body')} required>
        <Textarea
          value={text}
          resize="vertical"
          rows={10}
          onChange={(_, d) => setText(d.value)}
          data-testid="action-body"
        />
      </Field>
      <span className={styles.line}>
        <Button
          appearance="primary"
          disabled={!toOk || text.trim() === '' || busy}
          onClick={() => void save()}
        >
          {t('addin.actions.form.save')}
        </Button>
        <Button onClick={onDone} disabled={busy}>
          {t('addin.actions.form.cancel')}
        </Button>
      </span>
    </div>
  );
}

function Request({ item, today }: { item: ActionItem; today: string }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const busy = state.busy.includes(`action:${item.id}`);
  const email = item.email;
  if (!email) return null;
  return (
    <li>
      <Card className={styles.card} data-testid={`action-${item.kind}`}>
        <span className={styles.head}>
          <Text weight="semibold">{t(`addin.actions.kind.${item.kind}`)}</Text>
          {busy && <Spinner size="tiny" />}
        </span>
        {item.party && <Text>{item.party.name}</Text>}
        {item.obligation && (
          <Caption1 className={styles.muted}>
            {t('addin.actions.for', {
              due: t(`addin.documents.due.${item.obligation.kind}`),
              date: frDate(item.obligation.dueOn),
              when: when(daysBetween(today, item.obligation.dueOn)),
            })}
          </Caption1>
        )}
        {item.error === 'send_unknown' && (
          <MessageBar intent="warning">
            <MessageBarBody>{t('addin.actions.sendUnknown')}</MessageBarBody>
          </MessageBar>
        )}
        {editing ? (
          <EditForm item={item} onDone={() => setEditing(false)} />
        ) : (
          <>
            <Text size={200}>
              {email.to ? t('addin.actions.to', { to: email.to }) : t('addin.actions.noRecipient')}
            </Text>
            <Text size={200}>{t('addin.actions.subject', { subject: email.subject })}</Text>
            <Link as="button" onClick={() => setOpen(!open)}>
              {t(open ? 'addin.actions.hideMessage' : 'addin.actions.showMessage')}
            </Link>
            {open && <pre className={styles.body}>{email.body}</pre>}
            <span className={styles.line}>
              <Button
                appearance="primary"
                disabled={!email.to || busy}
                onClick={() => void fi.decideAction(item, { decision: 'approve' })}
              >
                {t('addin.actions.send')}
              </Button>
              <Button disabled={busy} onClick={() => setEditing(true)}>
                {t('addin.actions.edit')}
              </Button>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button disabled={busy}>{t('addin.actions.later')}</Button>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    {LATER.map((l) => (
                      <MenuItem
                        key={l.days}
                        onClick={() =>
                          void fi.decideAction(item, {
                            decision: 'snooze',
                            snoozeUntil: new Date(Date.now() + l.days * 86_400_000).toISOString(),
                          })
                        }
                      >
                        {t(l.label)}
                      </MenuItem>
                    ))}
                  </MenuList>
                </MenuPopover>
              </Menu>
              <Button
                appearance="subtle"
                disabled={busy}
                onClick={() => void fi.decideAction(item, { decision: 'reject' })}
              >
                {t('addin.actions.ignore')}
              </Button>
            </span>
          </>
        )}
      </Card>
    </li>
  );
}

function Confirm({ item }: { item: ActionItem }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const busy = state.busy.includes(`action:${item.id}`);
  return (
    <li>
      <Card className={styles.card} data-testid="action-confirmer_tiers">
        <span className={styles.head}>
          <Text weight="semibold">{t('addin.actions.kind.confirmer_tiers')}</Text>
          {busy && <Spinner size="tiny" />}
        </span>
        <Text>
          {item.document
            ? t('addin.actions.confirm.text', { siren: item.siren ?? '', file: item.document.name })
            : t('addin.actions.confirm.textNoFile', { siren: item.siren ?? '' })}
        </Text>
        <Caption1 className={styles.muted}>{t('addin.actions.confirm.question')}</Caption1>
        <span className={styles.line}>
          <Button
            appearance="primary"
            disabled={busy}
            onClick={() => void fi.decideAction(item, { decision: 'approve' })}
          >
            {t('addin.actions.confirm.add')}
          </Button>
          <Button
            appearance="subtle"
            disabled={busy}
            onClick={() => void fi.decideAction(item, { decision: 'reject' })}
          >
            {t('addin.actions.ignore')}
          </Button>
        </span>
      </Card>
    </li>
  );
}

export function ActionsPart() {
  const styles = useStyles();
  const [state] = useFi();
  const pane = state.documents;
  if (!pane) return null;
  return (
    <div className={styles.section} data-testid="approvals">
      {pane.actions.length === 0 ? (
        <Text>{t(pane.test ? 'addin.actions.noneTest' : 'addin.actions.none')}</Text>
      ) : (
        <ul className={styles.list}>
          {pane.actions.map((a) =>
            a.kind === 'confirmer_tiers' ? (
              <Confirm key={a.id} item={a} />
            ) : (
              <Request key={a.id} item={a} today={pane.today} />
            ),
          )}
        </ul>
      )}
    </div>
  );
}
