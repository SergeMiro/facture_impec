# Telegram Bot API: what the relay relies on

Read on 2026-10-25 from <https://core.telegram.org/bots/api> (Bot API 10.3, 24 August 2026) and
<https://core.telegram.org/bots/features#deep-linking>. The relay (`apps/relay`, memory M4) uses
nothing else. Telegram stays paused (`docs/DECISIONS.md` D3): no bot token and no public address
yet, so every test runs against the stand-in bot (`apps/mock-pdp/src/telegram.ts`).

| What | The documentation says | Where the code relies on it |
|---|---|---|
| Requests | `https://api.telegram.org/bot<token>/METHOD_NAME`, HTTPS; the answer is JSON with `ok`, then `result`, or `description` on failure | `apps/relay/src/telegram.ts` |
| Webhook secret | `setWebhook`'s `secret_token`, 1–256 characters of `A-Z a-z 0-9 _ -`, comes back in the header `X-Telegram-Bot-Api-Secret-Token` of every webhook request; a request answered other than 2XX is sent again « after a reasonable amount of attempts » | `TELEGRAM_WEBHOOK_SECRET`; the relay answers 200 to every update it read |
| Update | `update_id`, and optionally `message`, `callback_query` (among others) | the relay reads these two |
| Message to a chat | `sendMessage`: `chat_id` (integer or string), `text` 1–4096 characters after entities parsing, `reply_markup` | `RelayMessage` (`@fi/shared/relay`) |
| Buttons | `InlineKeyboardMarkup.inline_keyboard`: rows of `InlineKeyboardButton`; `callback_data` 1–64 bytes | a button carries the runner's one-time token (43 ASCII characters) |
| A press | `CallbackQuery`: `id`, `from` (User), optional `message` (the bot's message the button was on), `data` | the chat is `message.chat.id` |
| Answering a press | `answerCallbackQuery`: `callback_query_id`, optional `text` (a notice at the top of the chat) | the relay says the answer was received |
| Kind of chat | `Chat.type`: « private », « group », « supergroup » or « channel » | a chat is bound only from a private chat: in a group, any member could press |
| Ids | A user's or chat's id may have more than 32 significant bits, at most 52 | kept as text |
| Deep link | `https://t.me/<bot_username>?start=<parameter>`; the parameter is `A-Z a-z 0-9 _ -`, up to 64 characters; in a private chat the bot receives `/start <parameter>` | the binding code (`/start <code>`) |

Not in these pages: the error a chat that blocked the bot gives. The stand-in answers 403 « Forbidden:
bot was blocked by the user », as bots commonly report it; the code relies only on the call failing.

TODO(verify) once the owner has a bot (D3): `setWebhook` with the secret on the relay's public
address, a real press round trip, and the error of a blocked chat; the stand-in answers as these
pages say, not as Telegram was seen to.
