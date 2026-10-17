import {
  SUPABASE_SECRET_KEY,
  SUPABASE_URL,
  TRIAL_NOTIFY_TELEGRAM_BOT_TOKEN,
  TRIAL_NOTIFY_TELEGRAM_CHAT_ID,
} from 'astro:env/server';
import type { APIRoute } from 'astro';
import { handleTrial } from '../../lib/trial';

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  handleTrial(request, {
    supabaseUrl: SUPABASE_URL,
    supabaseKey: SUPABASE_SECRET_KEY,
    telegramToken: TRIAL_NOTIFY_TELEGRAM_BOT_TOKEN,
    telegramChatId: TRIAL_NOTIFY_TELEGRAM_CHAT_ID,
    dev: import.meta.env.DEV,
  });
