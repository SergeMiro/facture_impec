// The dialog's first page in Excel on the web (src/pages.ts): forwards to the Stripe page, and only there.
import { t } from '@fi/shared';
import { allowedPage } from './pages';

const to = new URLSearchParams(window.location.search).get('to');
if (to && allowedPage(to, import.meta.env.DEV)) window.location.replace(to);
else document.body.textContent = t('addin.redirect.refused');
