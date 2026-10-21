// The pane's side of the chat about a finding (R8): the Chat of `ai`, its messages kept outside React
// like the rest of the pane's state. The agent's two cards (proposeFix, undoEdit) wait here for the
// person's click; the controller answers them with addToolOutput and the agent says what came of it.
import {
  AbstractChat,
  type ChatOnErrorCallback,
  type ChatOnToolCallCallback,
  type ChatState,
  type ChatStatus,
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from 'ai';
import type { ApiClient, ChatMessage } from './api';

export type { ChatStatus };

/** The tools whose call the pane carries out: a card, then the person's click. */
export type CardTool = 'proposeFix' | 'undoEdit';

/** A card the agent asked for and nobody answered yet. */
export interface CardCall {
  tool: CardTool;
  toolCallId: string;
  editId?: string;
}

/** The cards of the last answer still waiting: the pane was closed before the click. */
export function waitingCards(messages: readonly ChatMessage[]): CardCall[] {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return [];
  return last.parts.flatMap((part): CardCall[] => {
    if (part.type === 'tool-proposeFix' && part.state === 'input-available') {
      return [{ tool: 'proposeFix', toolCallId: part.toolCallId }];
    }
    if (part.type === 'tool-undoEdit' && part.state === 'input-available') {
      return [
        {
          tool: 'undoEdit',
          toolCallId: part.toolCallId,
          ...(part.input.editId !== undefined && { editId: part.input.editId }),
        },
      ];
    }
    return [];
  });
}

/**
 * Asks again once the person answered a card, so the agent says what came of it; never after its read
 * tools alone (a model that stopped on them would otherwise be asked again and again).
 */
export function answeredCard({ messages }: { messages: ChatMessage[] }): boolean {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return false;
  const step = last.parts.slice(last.parts.findLastIndex((p) => p.type === 'step-start') + 1);
  const cards = step.some((p) => p.type === 'tool-proposeFix' || p.type === 'tool-undoEdit');
  return cards && lastAssistantMessageIsCompleteWithToolCalls({ messages });
}

/** The messages and status, told to the controller on every change (each streamed word included). */
class PaneChatState implements ChatState<ChatMessage> {
  #status: ChatStatus = 'ready';
  #error: Error | undefined;
  #messages: ChatMessage[];
  readonly #changed: (messages: ChatMessage[], status: ChatStatus) => void;

  constructor(
    messages: ChatMessage[],
    changed: (messages: ChatMessage[], status: ChatStatus) => void,
  ) {
    this.#messages = messages;
    this.#changed = changed;
  }

  #tell(): void {
    this.#changed(this.#messages, this.#status);
  }

  get status() {
    return this.#status;
  }
  set status(status: ChatStatus) {
    this.#status = status;
    this.#tell();
  }
  get error() {
    return this.#error;
  }
  set error(error: Error | undefined) {
    this.#error = error;
  }
  get messages() {
    return this.#messages;
  }
  set messages(messages: ChatMessage[]) {
    this.#messages = [...messages];
    this.#tell();
  }
  pushMessage = (message: ChatMessage) => {
    this.messages = [...this.#messages, message];
  };
  popMessage = () => {
    this.messages = this.#messages.slice(0, -1);
  };
  replaceMessage = (index: number, message: ChatMessage) => {
    this.messages = this.#messages.map((m, i) => (i === index ? this.snapshot(message) : m));
  };
  snapshot = <T>(thing: T): T => structuredClone(thing);
}

export interface PaneChatInit {
  findingId: string;
  messages: ChatMessage[];
  api: ApiClient;
  changed: (messages: ChatMessage[], status: ChatStatus) => void;
  onCard: (call: CardCall) => void;
  onError: ChatOnErrorCallback;
}

export class PaneChat extends AbstractChat<ChatMessage> {
  readonly findingId: string;

  constructor({ findingId, messages, api, changed, onCard, onError }: PaneChatInit) {
    const onToolCall: ChatOnToolCallCallback<ChatMessage> = ({ toolCall }) => {
      // Called for the read tools too, which the server ran; never awaited: the card waits for a click.
      if (toolCall.dynamic) return;
      if (toolCall.toolName === 'proposeFix') {
        onCard({ tool: 'proposeFix', toolCallId: toolCall.toolCallId });
      } else if (toolCall.toolName === 'undoEdit') {
        const { editId } = toolCall.input;
        onCard({
          tool: 'undoEdit',
          toolCallId: toolCall.toolCallId,
          ...(editId !== undefined && { editId }),
        });
      }
    };
    super({
      id: findingId,
      state: new PaneChatState(messages, changed),
      transport: new DefaultChatTransport<ChatMessage>({
        api: '/chat',
        fetch: (_url, init) => api.chatFetch(init),
        // One conversation per finding: the server keeps it with the finding.
        prepareSendMessagesRequest: ({ messages: all }) => ({
          body: { id: findingId, messages: all },
        }),
      }),
      onToolCall,
      onError,
      sendAutomaticallyWhen: answeredCard,
    });
    this.findingId = findingId;
  }
}
