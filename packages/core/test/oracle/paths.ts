// Where the oracle files live: vendored CEN artefacts, and the cache filled by oracle:fetch.
import { fileURLToPath } from 'node:url';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const VENDOR = here('../../vendor/cen-1.3.17/');
export const CACHE = here('../../.oracle-cache/');

export const STYLESHEETS = {
  'cen-cii': `${VENDOR}xslt/EN16931-CII-validation.xslt`,
  'cen-ubl': `${VENDOR}xslt/EN16931-UBL-validation.xslt`,
  facturx: `${CACHE}facturx-1.09.2-en16931/FACTUR-X_EN16931.xslt`,
} as const;
export type Stylesheet = keyof typeof STYLESHEETS;
