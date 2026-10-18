// XSD validation with xmllint-wasm; every imported schema is preloaded, so nothing goes online.
import { readdirSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { validateXML, type XMLFileInfo } from 'xmllint-wasm';
import { CACHE, VENDOR } from './paths';

function files(dir: string, root: string): XMLFileInfo[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.xsd'))
    .map((f) => ({ fileName: relative(root, `${dir}${f}`), contents: readFileSync(`${dir}${f}`) }));
}

const SCHEMAS = {
  'cii-d16b': {
    root: `${VENDOR}cii-d16b/`,
    main: 'uncefact/data/standard/CrossIndustryInvoice_100pD16B.xsd',
  },
  facturx: { root: `${CACHE}facturx-1.09.2-en16931/`, main: 'Factur-X_EN16931.xsd' },
  'ubl-invoice': { root: `${CACHE}ubl-2.1/`, main: 'maindoc/UBL-Invoice-2.1.xsd' },
  'ubl-creditnote': { root: `${CACHE}ubl-2.1/`, main: 'maindoc/UBL-CreditNote-2.1.xsd' },
} as const;
export type Schema = keyof typeof SCHEMAS;

const cache = new Map<Schema, { main: XMLFileInfo; others: XMLFileInfo[] }>();

function load(name: Schema) {
  let loaded = cache.get(name);
  if (!loaded) {
    const { root, main } = SCHEMAS[name];
    const all = files(root, root);
    const mainFile = all.find((f) => f.fileName === main);
    if (!mainFile) throw new Error(`${main} not found in ${root}`);
    loaded = { main: mainFile, others: all.filter((f) => f !== mainFile) };
    cache.set(name, loaded);
  }
  return loaded;
}

/** XSD errors, empty when the document is valid. */
export async function xsdErrors(name: Schema, xml: string): Promise<string[]> {
  const { main, others } = load(name);
  const result = await validateXML({
    xml: [{ fileName: 'invoice.xml', contents: xml }],
    schema: [main],
    preload: others,
    maxMemoryPages: 16 * 1024,
  });
  return result.errors.map((e) => e.message);
}
