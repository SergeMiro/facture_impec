import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { Controller } from '../controller';
import { allowedPage, apiAddress } from '../pages';
import { tokenStore } from '../storage';
import { App } from '../ui/App';
import { allowedSheetsParent, createSheetsBridge } from './bridge';
import { googleSheetsPort } from './port';

const query = new URLSearchParams(window.location.search);
const origin = query.get('fi_parent') ?? '';
const channel = query.get('fi_channel') ?? '';
const inside =
  window.parent !== window &&
  allowedSheetsParent(origin, import.meta.env.DEV) &&
  z.uuid().safeParse(channel).success;
const bridge = inside
  ? createSheetsBridge({
      parent: window.parent,
      origin,
      channel,
      listen(handler) {
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
      },
    })
  : null;
const port = googleSheetsPort(
  (request) =>
    bridge ? bridge.call(request) : Promise.resolve({ ok: false, code: 'Unavailable' }),
  { onError: (error) => controller.notify('warning', error.message) },
);
const controller = new Controller({
  port,
  tokens: tokenStore(),
  apiBase: __API_URL__,
  openUrl: async (url) => {
    if (!allowedPage(url, import.meta.env.DEV, apiAddress())) return false;
    const opened = window.open('about:blank', '_blank');
    if (!opened) return false;
    opened.opener = null;
    opened.location.href = url;
    return true;
  },
  objectUrl: {
    create: (blob) => URL.createObjectURL(blob),
    revoke: (url) => URL.revokeObjectURL(url),
  },
});
const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from google-sheets.html');
createRoot(root).render(
  <StrictMode>
    <App controller={controller} host="sheets" />
  </StrictMode>,
);
if (inside) void controller.start();
else controller.outside();
window.addEventListener('online', controller.online);
window.addEventListener('pagehide', () => {
  port.close();
  bridge?.close();
});
