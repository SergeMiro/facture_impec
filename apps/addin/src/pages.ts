// Pages the pane may open outside Excel (docs/APPSOURCE.md §4): Stripe's Checkout and customer portal,
// and the first page of Google's window (R5), on our own API, which goes on to Google. The local
// stand-ins (apps/mock-pdp) answer on localhost, allowed in development only.
const STRIPE = ['https://checkout.stripe.com', 'https://billing.stripe.com'];
const LOCAL = new Set(['localhost', '127.0.0.1']);

const GOOGLE_BEGIN = '/connectors/google/begin';

/** `api`: our API's address (`__API_URL__`, resolved against the pane's own). */
export function allowedPage(url: string, dev: boolean, api?: string): boolean {
  let page: URL;
  try {
    page = new URL(url);
  } catch {
    return false;
  }
  if (STRIPE.includes(page.origin)) return true;
  if (api && page.pathname.endsWith(GOOGLE_BEGIN) && page.origin === new URL(api).origin) {
    return page.protocol === 'https:' || dev;
  }
  return (
    dev && (page.protocol === 'http:' || page.protocol === 'https:') && LOCAL.has(page.hostname)
  );
}

/** Our API's address as the pane reaches it. */
export const apiAddress = () => new URL(__API_URL__, window.location.href).toString();

/**
 * A Stripe page (or Google's window) after a click: Office's own browser window on Windows and Mac;
 * Excel on the web lacks OpenBrowserWindowApi, so there a dialog whose first page is ours (it must be on
 * the add-in's domain) forwards to it. Never window.open in Office: webviews and pop-up blockers drop it.
 */
export function officeOpenUrl(url: string): Promise<boolean> {
  if (!allowedPage(url, import.meta.env.DEV, apiAddress())) return Promise.resolve(false);
  if (Office.context.requirements.isSetSupported('OpenBrowserWindowApi', '1.1')) {
    Office.context.ui.openBrowserWindow(url);
    return Promise.resolve(true);
  }
  const first = new URL(`redirect.html?to=${encodeURIComponent(url)}`, window.location.href);
  return new Promise((resolve) => {
    Office.context.ui.displayDialogAsync(first.toString(), { height: 80, width: 40 }, (result) =>
      resolve(result.status === Office.AsyncResultStatus.Succeeded),
    );
  });
}
