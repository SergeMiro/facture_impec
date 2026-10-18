// Runs a compiled schematron (CEN EN 16931 or Factur-X) on one XML string and lists what fired.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import SaxonJS from 'saxon-js';
import { STYLESHEETS, type Stylesheet } from './paths';
import { sefPath } from './sef';

const SVRL = 'http://purl.oclc.org/dsdl/svrl';

export interface OracleHit {
  id: string;
  flag: 'fatal' | 'warning';
  location: string;
  text: string;
}

const loaded = new Map<Stylesheet, object>();

function sef(name: Stylesheet): object {
  let compiled = loaded.get(name);
  if (!compiled) {
    compiled = JSON.parse(readFileSync(sefPath(name), 'utf8')) as object;
    loaded.set(name, compiled);
  }
  return compiled;
}

export async function runSchematron(name: Stylesheet, xml: string): Promise<OracleHit[]> {
  const source = await SaxonJS.getResource({ text: xml, type: 'xml' });
  const { principalResult } = await SaxonJS.transform(
    {
      stylesheetInternal: sef(name),
      // The Factur-X stylesheet loads its codedb next to itself (XTDE1162 without a base URI).
      stylesheetBaseURI: pathToFileURL(STYLESHEETS[name]).href,
      sourceNode: source,
      destination: 'document',
    },
    'async',
  );
  const ns = { namespaceContext: { svrl: SVRL } };
  const nodes = SaxonJS.XPath.evaluate(
    '//svrl:failed-assert | //svrl:successful-report',
    principalResult,
    { ...ns, resultForm: 'array' },
  ) as { getAttribute(name: string): string | null }[];
  return nodes.map((n) => ({
    id: n.getAttribute('id') ?? '',
    flag: n.getAttribute('flag') === 'warning' ? 'warning' : 'fatal',
    location: n.getAttribute('location') ?? '',
    text: String(SaxonJS.XPath.evaluate('normalize-space(svrl:text)', n, ns)),
  }));
}

export const fatal = (hits: readonly OracleHit[]) => hits.filter((h) => h.flag === 'fatal');
