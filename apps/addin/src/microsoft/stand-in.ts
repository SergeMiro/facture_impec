// The MicrosoftPort of the harness page and the E2E run: the stand-in in apps/mock-pdp (/microsoft)
// signs in one of its two accounts and « picks » every file of its OneDrive, as a person would in
// Microsoft's window and picker.
import { z } from 'zod';
import { type MicrosoftPort, MicrosoftPortError } from './port';

const Files = z.array(z.object({ driveId: z.string(), itemId: z.string(), name: z.string() }));

export function standInMicrosoftPort(options: {
  /** The stand-in's address, e.g. `/microsoft` behind the dev server's proxy. */
  base: string;
  /** `msa-camille` (personal) or `aad-camille` (work). */
  account: string;
  fetch?: typeof fetch;
}): MicrosoftPort {
  const call = options.fetch ?? ((input, init) => fetch(input, init));
  const at = (path: string) => `${options.base}${path}/${encodeURIComponent(options.account)}`;
  return {
    async signIn() {
      const res = await call(at('/control/sign-in'), { method: 'POST' });
      if (!res.ok) throw new MicrosoftPortError('failed', `stand-in ${res.status}`);
      return z.object({ token: z.string() }).parse(await res.json()).token;
    },
    async pick() {
      const res = await call(at('/control/files'));
      if (!res.ok) throw new MicrosoftPortError('failed', `stand-in ${res.status}`);
      return Files.parse(await res.json()).map(({ driveId, itemId }) => ({ driveId, itemId }));
    },
  };
}
