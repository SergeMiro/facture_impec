// R8: the conversation about one finding. It opens on the finding's own wording, already there; the
// answers stream in; a correction the agent proposes appears as the « Avant → Après » card, and
// nothing is written before the person's click.
import { type MessageKey, t } from '@fi/shared';
import {
  Button,
  Caption1,
  MessageBar,
  MessageBarBody,
  makeStyles,
  Spinner,
  Subtitle2,
  Text,
  Textarea,
  tokens,
} from '@fluentui/react-components';
import { useState } from 'react';
import type { ChatMessage } from '../api';
import { useFi } from './context';
import { EditCardView } from './EditCard';

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
  bubble: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '8px 10px',
    borderRadius: tokens.borderRadiusLarge,
    whiteSpace: 'pre-wrap',
    maxWidth: '92%',
  },
  assistant: { backgroundColor: tokens.colorNeutralBackground3, alignSelf: 'flex-start' },
  user: {
    backgroundColor: tokens.colorBrandBackground2,
    alignSelf: 'flex-end',
  },
  item: { display: 'flex', flexDirection: 'column' },
  line: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  muted: { color: tokens.colorNeutralForeground3 },
});

const CARD_STATUS: Record<string, MessageKey> = {
  applied: 'addin.chat.card.applied',
  declined: 'addin.chat.card.declined',
  conflict: 'addin.chat.card.conflict',
  refused: 'addin.chat.card.refused',
  reverted: 'addin.chat.card.reverted',
};

/** What the person reads of a message: its text, and what came of each card. */
function shown(message: ChatMessage): { text: string; cards: MessageKey[] } {
  const text = message.parts
    .flatMap((p) => (p.type === 'text' ? [p.text] : []))
    .join('\n\n')
    .trim();
  const cards = message.parts.flatMap((p) => {
    if (
      (p.type === 'tool-proposeFix' || p.type === 'tool-undoEdit') &&
      p.state === 'output-available'
    ) {
      const key = CARD_STATUS[p.output.status];
      return key ? [key] : [];
    }
    return [];
  });
  return { text, cards };
}

export function ChatView() {
  const styles = useStyles();
  const [state, fi] = useFi();
  const [question, setQuestion] = useState('');
  const chat = state.chat;
  if (!chat) return state.busy.includes('chat') ? <Spinner label={t('addin.loading')} /> : null;

  const answering = chat.status === 'submitted' || chat.status === 'streaming';
  const card = state.card?.findingId === chat.findingId ? state.card : null;
  // The agent waits for the card's answer: a question now would leave its call unanswered.
  const waiting = card?.toolCallId != null;
  const send = () => {
    if (!question.trim()) return;
    void fi.ask(question);
    setQuestion('');
  };

  return (
    <section className={styles.section} aria-labelledby="chat-title">
      <span className={styles.line}>
        <Subtitle2 as="h2" id="chat-title">
          {t('addin.chat.title')}
        </Subtitle2>
        <Button size="small" appearance="subtle" onClick={() => fi.navigate({ name: 'checks' })}>
          {t('addin.chat.back')}
        </Button>
      </span>
      <Caption1 className={styles.muted}>{t('addin.chat.intro')}</Caption1>

      <ul className={styles.list} aria-live="polite" data-testid="chat-messages">
        {chat.messages.map((m) => {
          const { text, cards } = shown(m);
          if (!text && cards.length === 0) return null;
          return (
            <li key={m.id} className={styles.item}>
              <div
                className={`${styles.bubble} ${m.role === 'user' ? styles.user : styles.assistant}`}
                data-testid={`chat-${m.role}`}
              >
                <Caption1 className={styles.muted}>
                  {m.role === 'user' ? t('addin.chat.you') : t('addin.chat.title')}
                </Caption1>
                {text && <Text>{text}</Text>}
                {cards.map((key, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: one caption per card, in order.
                  <Caption1 key={i} className={styles.muted}>
                    {t(key)}
                  </Caption1>
                ))}
              </div>
            </li>
          );
        })}
      </ul>

      {answering && (
        <span className={styles.line}>
          <Spinner size="tiny" label={t('addin.chat.writing')} />
          <Button size="small" appearance="subtle" onClick={() => void fi.stopAnswer()}>
            {t('addin.chat.stop')}
          </Button>
        </span>
      )}

      {card && <EditCardView card={card} />}

      {chat.available ? (
        <>
          <Textarea
            aria-label={t('addin.chat.question')}
            placeholder={t('addin.chat.placeholder')}
            value={question}
            resize="vertical"
            disabled={waiting}
            onChange={(_, data) => setQuestion(data.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !answering && !waiting) {
                e.preventDefault();
                send();
              }
            }}
          />
          <span className={styles.line}>
            <Button
              appearance="primary"
              disabled={answering || waiting || !question.trim()}
              onClick={send}
            >
              {t('addin.chat.send')}
            </Button>
            {waiting && <Caption1 className={styles.muted}>{t('addin.chat.cardFirst')}</Caption1>}
          </span>
        </>
      ) : (
        <MessageBar intent="info" layout="multiline" data-testid="chat-unavailable">
          <MessageBarBody>{t('addin.chat.unavailable')}</MessageBarBody>
        </MessageBar>
      )}
    </section>
  );
}
