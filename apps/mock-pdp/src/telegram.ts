// A stand-in for the part of Telegram's Bot API the relay uses (memory M4, docs/TELEGRAM.md):
// `sendMessage` with an inline keyboard and `answerCallbackQuery`, at /bot<token>/<method>, answering
// `{ ok, result }` or `{ ok: false, error_code, description }`. Tests play the person: `start` sends
// `/start <code>` and `press` a button, as updates posted to the relay's webhook with the secret
// setWebhook would have set. Shapes follow core.telegram.org as read on 2026-10-25, not a real bot:
// Telegram stays paused (docs/DECISIONS.md D3).
import { Hono } from 'hono';
import { z } from 'zod';

export interface TelegramStandInOptions {
  /** The bot's token: a request for another bot is refused (401). */
  token: string;
  /** The relay's webhook (its /telegram) and the secret it expects in the header. */
  webhook: { url: string; secret: string };
  /** Default: global fetch (tests hand the relay's app). */
  fetcher?: typeof fetch;
}

export interface SentMessage {
  chatId: string;
  messageId: number;
  text: string;
  buttons: { text: string; data: string }[][];
}

const SendMessage = z.object({
  chat_id: z.union([z.number().int(), z.string()]),
  // 1–4096 characters after entities parsing; no entities here.
  text: z.string().min(1).max(4096),
  reply_markup: z
    .object({
      inline_keyboard: z.array(
        z.array(
          z.object({
            text: z.string().min(1),
            callback_data: z
              .string()
              .refine((d) => Buffer.byteLength(d) >= 1 && Buffer.byteLength(d) <= 64),
          }),
        ),
      ),
    })
    .optional(),
});
const AnswerCallbackQuery = z.object({
  callback_query_id: z.string().min(1),
  text: z.string().max(200).optional(),
});

export class TelegramStandIn {
  readonly app = new Hono();
  /** Every message the bot put in a chat, in order. */
  readonly sent: SentMessage[] = [];
  /** Every press answered: its id and the notice shown. */
  readonly answered: { id: string; text: string | undefined }[] = [];
  private lastUpdate = 0;
  private lastMessage = 0;
  private readonly blocked = new Set<string>();

  constructor(private readonly options: TelegramStandInOptions) {
    const fail = (status: 400 | 401 | 403 | 404, description: string) =>
      Response.json({ ok: false, error_code: status, description }, { status });

    this.app.post('/:bot/:method', async (c) => {
      if (c.req.param('bot') !== `bot${options.token}`) return fail(401, 'Unauthorized');
      const body: unknown = await c.req.json().catch(() => null);
      switch (c.req.param('method')) {
        case 'sendMessage': {
          const input = SendMessage.safeParse(body);
          if (!input.success) return fail(400, 'Bad Request: message is invalid');
          const chatId = String(input.data.chat_id);
          if (this.blocked.has(chatId)) return fail(403, 'Forbidden: bot was blocked by the user');
          const message: SentMessage = {
            chatId,
            messageId: ++this.lastMessage,
            text: input.data.text,
            buttons: (input.data.reply_markup?.inline_keyboard ?? []).map((row) =>
              row.map((b) => ({ text: b.text, data: b.callback_data })),
            ),
          };
          this.sent.push(message);
          return c.json({
            ok: true,
            result: {
              message_id: message.messageId,
              date: Math.floor(Date.now() / 1000),
              chat: { id: Number(chatId), type: 'private' },
              text: message.text,
            },
          });
        }
        case 'answerCallbackQuery': {
          const input = AnswerCallbackQuery.safeParse(body);
          if (!input.success) return fail(400, 'Bad Request: query is invalid');
          this.answered.push({ id: input.data.callback_query_id, text: input.data.text });
          return c.json({ ok: true, result: true });
        }
        default:
          return fail(404, 'Not Found');
      }
    });
  }

  /** The person blocks the bot (or unblocks it): Telegram refuses to write to their chat. */
  block(chatId: string, blocked = true): void {
    if (blocked) this.blocked.add(chatId);
    else this.blocked.delete(chatId);
  }

  /** The messages a chat received. */
  inChat(chatId: string): SentMessage[] {
    return this.sent.filter((m) => m.chatId === chatId);
  }

  /** The person opens the deep link: Telegram sends `/start <code>` from their private chat. */
  start(chatId: string, code: string, type: 'private' | 'group' = 'private'): Promise<Response> {
    return this.deliver({
      message: {
        message_id: ++this.lastMessage,
        from: { id: Number(chatId), is_bot: false, first_name: 'Test' },
        chat: { id: Number(chatId), type },
        date: Math.floor(Date.now() / 1000),
        text: `/start ${code}`,
      },
    });
  }

  /** The person presses a button of a message the bot sent (or any data, to play a forger). */
  press(message: SentMessage, data: string): Promise<Response> {
    return this.deliver({
      callback_query: {
        id: `q${this.lastUpdate + 1}`,
        from: { id: Number(message.chatId), is_bot: false, first_name: 'Test' },
        message: {
          message_id: message.messageId,
          chat: { id: Number(message.chatId), type: 'private' },
          date: Math.floor(Date.now() / 1000),
          text: message.text,
        },
        chat_instance: `i${message.chatId}`,
        data,
      },
    });
  }

  private deliver(update: Record<string, unknown>): Promise<Response> {
    const fetcher = this.options.fetcher ?? fetch;
    return fetcher(this.options.webhook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': this.options.webhook.secret,
      },
      body: JSON.stringify({ update_id: ++this.lastUpdate, ...update }),
    });
  }
}
