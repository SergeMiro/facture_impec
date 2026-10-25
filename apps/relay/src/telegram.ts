// The two Bot API methods the relay calls (docs/TELEGRAM.md): a message with buttons in a chat, and
// the notice that answers a press. The token is part of every request's address: never log one.
import { z } from 'zod';

export interface TelegramButton {
  text: string;
  /** `callback_data`, 1–64 bytes. */
  data: string;
}

export interface TelegramApi {
  sendMessage(chatId: string, text: string, buttons?: TelegramButton[][]): Promise<void>;
  answerCallbackQuery(queryId: string, text: string): Promise<void>;
}

/** Telegram said no: its error code and description, never the request's address. */
export class TelegramError extends Error {
  constructor(
    readonly status: number,
    description: string,
  ) {
    super(`telegram: ${status} ${description}`);
  }
}

const Answer = z.object({
  ok: z.boolean(),
  error_code: z.number().optional(),
  description: z.string().optional(),
});

export function telegramApi(options: {
  /** TELEGRAM_API_URL: Telegram's host, or the stand-in's. */
  url: string;
  token: string;
  fetcher?: typeof fetch;
}): TelegramApi {
  const fetcher = options.fetcher ?? fetch;
  const call = async (method: string, body: Record<string, unknown>) => {
    const response = await fetcher(
      new URL(
        `bot${options.token}/${method}`,
        options.url.endsWith('/') ? options.url : `${options.url}/`,
      ),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const answer = Answer.safeParse(await response.json().catch(() => null));
    if (!answer.success) throw new TelegramError(response.status, 'unreadable answer');
    if (!answer.data.ok) {
      throw new TelegramError(
        answer.data.error_code ?? response.status,
        answer.data.description ?? 'no description',
      );
    }
  };
  return {
    sendMessage: (chatId, text, buttons = []) =>
      call('sendMessage', {
        chat_id: chatId,
        text,
        ...(buttons.length > 0 && {
          reply_markup: {
            inline_keyboard: buttons.map((row) =>
              row.map((b) => ({ text: b.text, callback_data: b.data })),
            ),
          },
        }),
      }),
    answerCallbackQuery: (queryId, text) =>
      call('answerCallbackQuery', { callback_query_id: queryId, text }),
  };
}
