// The few pages the API serves to a browser (sign-in and sign-up links, the return from Stripe): one
// message, at most one button. secureHeaders (src/app.ts) keeps them out of frames.
import { html, raw } from 'hono/html';

export const page = (title: string, message: string, form?: { action: string; button: string }) =>
  html`<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${title}</title>
    <style>
      body { font: 16px/1.5 'Segoe UI', system-ui, sans-serif; max-width: 32rem; margin: 4rem auto;
        padding: 0 1rem; color: #1b1b1b; background: #fff; }
      button { font: inherit; padding: .6rem 1.2rem; border: 0; border-radius: 4px;
        background: #0f6b3a; color: #fff; cursor: pointer; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p>${message}</p>
    ${form ? html`<form method="post" action="${form.action}"><button type="submit">${form.button}</button></form>` : raw('')}
  </body>
</html>`;
