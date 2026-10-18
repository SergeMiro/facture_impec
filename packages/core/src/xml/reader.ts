// Reads CII and UBL files with @xmldom/xmldom, the same DOM in the task pane and in Node
// (docs/research/FORMATS.md §5.1). Lookups go by namespace URI, never by prefix: a file may bind
// any prefix to the CII or UBL namespaces.
import { DOMParser, type Element } from '@xmldom/xmldom';
import { decimalPlaces, isDecimal, parseAmount, roundToCents } from '../money';
import { getRule, type Issue, toIssue } from '../rules';
import { finding } from '../rules/util';

/** The file is not well-formed XML, or not an invoice in a syntax we read. */
export class InvoiceXmlError extends Error {
  constructor(
    readonly reason: 'malformed' | 'unknown',
    detail: string,
  ) {
    super(detail);
    this.name = 'InvoiceXmlError';
  }
}

/** Parses a document; throws InvoiceXmlError on any error, DOCTYPE included (no entity expansion). */
export function parseDocument(xml: string): Element {
  if (/<!DOCTYPE/i.test(xml)) throw new InvoiceXmlError('malformed', 'DOCTYPE is not allowed');
  try {
    const doc = new DOMParser({
      onError: (level, message) => {
        throw new InvoiceXmlError('malformed', `${level}: ${message}`);
      },
    }).parseFromString(xml, 'text/xml');
    const root = doc.documentElement;
    if (!root) throw new InvoiceXmlError('malformed', 'no root element');
    return root;
  } catch (error) {
    if (error instanceof InvoiceXmlError) throw error;
    throw new InvoiceXmlError('malformed', String(error));
  }
}

const isElement = (n: unknown): n is Element =>
  typeof n === 'object' && n !== null && (n as { nodeType?: number }).nodeType === 1;

/**
 * Path lookups on direct children: 'ram:SpecifiedTradeProduct/ram:Name'. Prefixes in paths are
 * the reader's own and map to namespace URIs; the file's prefixes do not matter.
 */
export class Reader {
  readonly issues: Issue[] = [];

  constructor(private readonly ns: Readonly<Record<string, string>>) {}

  private step(parent: Element, qname: string): Element[] {
    const [prefix = '', local = ''] = qname.split(':');
    const uri = this.ns[prefix];
    if (uri === undefined) throw new Error(`Unknown prefix ${prefix}`);
    const out: Element[] = [];
    for (const n of Array.from(parent.childNodes)) {
      if (isElement(n) && n.localName === local && n.namespaceURI === uri) out.push(n);
    }
    return out;
  }

  /** Every element at the end of the path. */
  all(from: Element | undefined, path: string): Element[] {
    if (!from) return [];
    return path
      .split('/')
      .reduce<Element[]>((nodes, qname) => nodes.flatMap((n) => this.step(n, qname)), [from]);
  }

  one(from: Element | undefined, path: string): Element | undefined {
    return this.all(from, path)[0];
  }

  /** Trimmed text of the first match; undefined when absent or empty. */
  text(from: Element | undefined, path: string): string | undefined {
    const node = path === '.' ? from : this.one(from, path);
    const value = node?.textContent?.trim();
    return value === undefined || value === '' ? undefined : value;
  }

  attr(from: Element | undefined, path: string, name: string): string | undefined {
    const node = path === '.' ? from : this.one(from, path);
    const value = node?.getAttribute(name)?.trim();
    return value === undefined || value === '' ? undefined : value;
  }

  /**
   * An amount in cents. More than 2 decimals: rounded, BR-FR-DEC-01. Not a number: left out,
   * FF-FMT-04. Either way the user sees why.
   */
  amount(from: Element | undefined, path: string, modelPath: string): number | undefined {
    return this.cents(this.text(from, path), modelPath);
  }

  cents(value: string | undefined, modelPath: string): number | undefined {
    if (value === undefined) return undefined;
    if (!isDecimal(value)) {
      this.issues.push(toIssue(getRule('FF-FMT-04'), finding(modelPath, { value })));
      return undefined;
    }
    if (decimalPlaces(value) <= 2) return parseAmount(value) ?? undefined;
    this.issues.push(toIssue(getRule('BR-FR-DEC-01'), finding(modelPath)));
    return roundToCents(value) ?? undefined;
  }
}

const hasValue = (v: unknown) => v !== undefined && !(Array.isArray(v) && v.length === 0);

/**
 * The object, or undefined when no field has a value. An empty container element (an empty
 * contact, a delivery party with only an id we do not read) is then read as absent, as the
 * builders, which leave out empty elements, would write it.
 */
export const filled = <T extends object>(o: T): T | undefined =>
  Object.values(o).some(hasValue) ? o : undefined;

/** udt:Indicator and cbc:ChargeIndicator are XSD booleans: "true" / "false", or "1" / "0". */
export const isChargeIndicator = (value: string | undefined) => value === 'true' || value === '1';
