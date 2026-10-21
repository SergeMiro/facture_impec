// When the pane asks the agent again on its own: once a card was answered, never after read tools alone.
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './api';
import { answeredCard, waitingCards } from './chat';

const answer = (...parts: ChatMessage['parts']): ChatMessage[] => [
  { id: 'q', role: 'user', parts: [{ type: 'text', text: 'Corrigez-la.' }] },
  { id: 'a', role: 'assistant', parts },
];

const read = {
  type: 'tool-finding',
  toolCallId: 'call-finding',
  state: 'output-available',
  input: {},
  output: {},
} as ChatMessage['parts'][number];

describe('the chat of the pane', () => {
  it('asks again once the card is answered', () => {
    const card = {
      type: 'tool-proposeFix',
      toolCallId: 'call-proposeFix',
      input: {},
    } as const;
    const waiting = answer({ type: 'step-start' }, { ...card, state: 'input-available' });
    expect(answeredCard({ messages: waiting })).toBe(false);
    expect(waitingCards(waiting)).toEqual([{ tool: 'proposeFix', toolCallId: 'call-proposeFix' }]);

    const answered = answer(
      { type: 'step-start' },
      { ...card, state: 'output-available', output: { status: 'applied', editId: 'e1' } },
    );
    expect(answeredCard({ messages: answered })).toBe(true);
    expect(waitingCards(answered)).toEqual([]);
  });

  it('never after the read tools alone, nor after a card of an earlier step', () => {
    expect(answeredCard({ messages: answer({ type: 'step-start' }, read) })).toBe(false);
    const earlier = answer(
      { type: 'step-start' },
      {
        type: 'tool-proposeFix',
        toolCallId: 'call-proposeFix',
        state: 'output-available',
        input: {},
        output: { status: 'declined', editId: 'e1' },
      },
      { type: 'step-start' },
      read,
    );
    expect(answeredCard({ messages: earlier })).toBe(false);
  });
});
