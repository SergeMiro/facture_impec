// A tenant's own endpoint (BYOK) is called from our server, so it must not reach our network:
// https only, and no loopback, private, link-local or metadata address written in the URL.
// TODO(verify): a public name can still resolve to a private address (DNS rebinding); see DEFERRED.md.

const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i;

function privateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a = 0, b = 0] = m.slice(1, 3).map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function privateIpv6(host: string): boolean {
  if (!host.startsWith('[')) return false;
  const ip = host.slice(1, -1).toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped?.[1]) return privateIpv4(mapped[1]);
  return (
    ip === '::' ||
    ip === '::1' ||
    /^f[cd]/.test(ip) ||
    /^fe[89ab]/.test(ip) ||
    ip.startsWith('::ffff:')
  );
}

/** Null when the URL may be called for a tenant; otherwise why not, in English for logs. */
export function byokUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'not a URL';
  }
  if (url.protocol !== 'https:') return 'https required';
  if (url.username || url.password) return 'credentials in URL';
  const host = url.hostname;
  if (BLOCKED_NAMES.test(host) || (!host.includes('.') && !host.startsWith('[')))
    return 'private host';
  if (privateIpv4(host) || privateIpv6(host)) return 'private address';
  return null;
}
