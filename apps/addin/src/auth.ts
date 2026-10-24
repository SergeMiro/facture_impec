// Excel on the web signs in with the browser's own flow, not Office's (docs/MICROSOFT365.md), and the
// pane there is a frame of Office's page, so Microsoft's window cannot hand the answer to the pane
// directly. MSAL opens this page first (`popupRelayUri`): on a click it opens Microsoft's window, which
// comes back to this page too (`redirectUri`), and the answer goes on to the pane. Office's own sign-in
// (Excel for Windows and Mac) never opens it.
import { runPopupRelay } from '@azure/msal-browser/popup-relay';
import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';
import { t } from '@fi/shared';
import { AUTHORITY } from './microsoft/office';

function say(text: string): void {
  const p = document.createElement('p');
  p.textContent = text;
  document.body.append(p);
}

function refused(): void {
  document.body.replaceChildren();
  say(t('addin.connector.relay.refused'));
}

const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const query = new URLSearchParams(window.location.search);

if (hash.has('req')) {
  // The relay. Microsoft's window opens on a click, or the browser would block it.
  say(t('addin.connector.relay.intro'));
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = t('addin.connector.relay.continue');
  button.style.cssText = 'font: inherit; padding: 6px 16px';
  button.addEventListener('click', () => {
    button.disabled = true;
    try {
      runPopupRelay({ allowedAuthorityOrigins: [new URL(AUTHORITY).origin] });
    } catch {
      refused();
    }
  });
  document.body.append(button);
} else if (hash.has('state') || query.has('state')) {
  // Microsoft's answer, passed to the relay above (or to the pane, for a silent sign-in).
  broadcastResponseToMainFrame().catch(refused);
} else {
  refused();
}
