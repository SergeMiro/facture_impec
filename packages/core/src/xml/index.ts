// XML syntaxes: CII (Factur-X) and UBL 2.1, both ways.
import { CII_NS, type ParsedInvoice, readCii } from './cii';
import { InvoiceXmlError, parseDocument } from './reader';
import { readUbl, UBL_NS } from './ubl';

export { CII_NS, fromCii, type ParsedInvoice, toCii } from './cii';
export { InvoiceXmlError } from './reader';
export { fromUbl, toUbl, UBL_CREDIT_NOTE_TYPES, UBL_NS } from './ubl';

/** Reads a CII or UBL invoice, whichever it is. Throws InvoiceXmlError otherwise. */
export function parseInvoiceXml(xml: string): ParsedInvoice {
  const root = parseDocument(xml);
  if (root.namespaceURI === CII_NS.rsm) return readCii(root);
  if (root.namespaceURI === UBL_NS.inv || root.namespaceURI === UBL_NS.cn) return readUbl(root);
  throw new InvoiceXmlError('unknown', `unknown root ${root.namespaceURI ?? ''} ${root.localName}`);
}
