// OASIS UBL 2.1 (Invoice and CreditNote) ⇄ invoice model, following the EN 16931 UBL binding.
// Element order follows the UBL 2.1 XSD sequences. Notes carry their subject code as "#CODE#text".
// VATEX codes are written and read in upper case, as in cii.ts.
import type { Element } from '@xmldom/xmldom';
import {
  type Address,
  type AllowanceCharge,
  type Contact,
  type Identifier,
  Invoice,
  type InvoiceInput,
  type Line,
  type Party,
  type Period,
  VAT_DUE_CODES,
  type VatDueOn,
} from '../model';
import { formatAmount } from '../money';
import type { ParsedInvoice } from './cii';
import { filled, InvoiceXmlError, isChargeIndicator, parseDocument, Reader } from './reader';
import { el, req, serialize } from './writer';

export const UBL_NS = {
  inv: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  cn: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
} as const;

/**
 * Type codes written as a CreditNote: the CEN UBL code list for cbc:CreditNoteTypeCode, minus 81,
 * which is in the cbc:InvoiceTypeCode list too.
 */
export const UBL_CREDIT_NOTE_TYPES: ReadonlySet<string> = new Set(
  '83 261 262 296 308 381 396 420 458 502 503 532'.split(' '),
);

/** BT-32 goes in a cac:PartyTaxScheme whose scheme is not VAT; the CEN examples use LOC. */
const LOCAL_TAX_SCHEME = 'LOC';
/** BT-11 in a credit note: cac:AdditionalDocumentReference with this document type (CEN UBL). */
const PROJECT_DOCUMENT_TYPE = '50';
/** cac:OrderReference/cbc:ID is mandatory; with BT-14 and no BT-13 the binding writes "NA". */
const NO_ORDER = 'NA';

// ── Writing ────────────────────────────────────────────────────────────────────────────────────

const text = (name: string, value: string | undefined, attrs = {}) => el(name, attrs, value);
const taxScheme = (id: string) => el('cac:TaxScheme', {}, text('cbc:ID', id));

function address(name: string, a: Address | undefined) {
  if (!a) return undefined;
  return el(
    name,
    {},
    text('cbc:StreetName', a.line1),
    text('cbc:AdditionalStreetName', a.line2),
    text('cbc:CityName', a.city),
    text('cbc:PostalZone', a.postCode),
    text('cbc:CountrySubentity', a.subdivision),
    el('cac:AddressLine', {}, text('cbc:Line', a.line3)),
    el('cac:Country', {}, text('cbc:IdentificationCode', a.country)),
  );
}

const contact = (c: Contact | undefined) =>
  c &&
  el(
    'cac:Contact',
    {},
    text('cbc:Name', c.name),
    text('cbc:Telephone', c.phone),
    text('cbc:ElectronicMail', c.email),
  );

const partyTax = (id: string | undefined, scheme: string) =>
  id !== undefined && el('cac:PartyTaxScheme', {}, text('cbc:CompanyID', id), taxScheme(scheme));

function party(p: Party) {
  return req(
    'cac:Party',
    {},
    text('cbc:EndpointID', p.electronicAddress?.id, { schemeID: p.electronicAddress?.scheme }),
    p.ids.map((i) =>
      el('cac:PartyIdentification', {}, text('cbc:ID', i.id, { schemeID: i.scheme })),
    ),
    el('cac:PartyName', {}, text('cbc:Name', p.tradingName)),
    address('cac:PostalAddress', p.address),
    partyTax(p.vatId, 'VAT'),
    partyTax(p.taxRegistrationId, LOCAL_TAX_SCHEME),
    el(
      'cac:PartyLegalEntity',
      {},
      text('cbc:RegistrationName', p.name),
      text('cbc:CompanyID', p.legalId?.id, { schemeID: p.legalId?.scheme }),
      text('cbc:CompanyLegalForm', p.legalInfo),
    ),
    contact(p.contact),
  );
}

const period = (p: Period | undefined, dueOn?: VatDueOn) =>
  el(
    'cac:InvoicePeriod',
    {},
    text('cbc:StartDate', p?.start),
    text('cbc:EndDate', p?.end),
    text('cbc:DescriptionCode', dueOn && VAT_DUE_CODES[dueOn].ubl),
  );

function allowanceCharge(
  a: AllowanceCharge,
  charge: boolean,
  currency: string | undefined,
  documentLevel: boolean,
) {
  const money = (name: string, cents: number | undefined) =>
    cents === undefined ? undefined : el(name, { currencyID: currency }, formatAmount(cents));
  return req(
    'cac:AllowanceCharge',
    {},
    text('cbc:ChargeIndicator', String(charge)),
    text('cbc:AllowanceChargeReasonCode', a.reasonCode),
    text('cbc:AllowanceChargeReason', a.reason),
    text('cbc:MultiplierFactorNumeric', a.percentage),
    money('cbc:Amount', a.amount),
    money('cbc:BaseAmount', a.baseAmount),
    documentLevel &&
      (a.vatCategory !== undefined || a.vatRate !== undefined) &&
      el(
        'cac:TaxCategory',
        {},
        text('cbc:ID', a.vatCategory),
        text('cbc:Percent', a.vatRate),
        taxScheme('VAT'),
      ),
  );
}

/** Writes the UBL XML (Invoice, or CreditNote for credit-note type codes) of a computed invoice. */
/**
 * UBL requires cbc:TaxAmount in cac:TaxTotal and CII does not: an invoice read from CII without
 * BT-110 gets Σ BT-117, the only value BR-CO-14 accepts.
 */
function vatSum(inv: Invoice): number | undefined {
  const amounts = inv.vatBreakdown.map((b) => b.taxAmount);
  if (amounts.length === 0 || amounts.some((a) => a === undefined)) return undefined;
  return amounts.reduce<number>((total, a) => total + (a ?? 0), 0);
}

export function toUbl(inv: Invoice): string {
  const credit = UBL_CREDIT_NOTE_TYPES.has(inv.typeCode ?? '');
  const cur = inv.currency;
  const money = (name: string, cents: number | undefined, currency = cur) =>
    cents === undefined ? undefined : el(name, { currencyID: currency }, formatAmount(cents));
  const t = inv.totals;
  const foreignVat = inv.vatCurrency !== undefined && inv.vatCurrency !== inv.currency;
  const p = inv.payment;
  // BT-82 and the credit note's BT-9 go in the first cac:PaymentMeans only (UBL-SR-45, UBL-SR-46).
  const paymentMeans = (
    account: { iban?: string; name?: string; bic?: string } | undefined,
    i: number,
  ) =>
    el(
      'cac:PaymentMeans',
      {},
      text('cbc:PaymentMeansCode', p?.meansCode, { name: i === 0 ? p?.meansText : undefined }),
      credit && i === 0 && text('cbc:PaymentDueDate', inv.dueDate),
      text('cbc:PaymentID', p?.remittanceInfo),
      account &&
        el(
          'cac:PayeeFinancialAccount',
          {},
          text('cbc:ID', account.iban),
          text('cbc:Name', account.name),
          el('cac:FinancialInstitutionBranch', {}, text('cbc:ID', account.bic)),
        ),
    );
  const line = (l: Line) =>
    req(
      credit ? 'cac:CreditNoteLine' : 'cac:InvoiceLine',
      {},
      text('cbc:ID', l.id),
      text('cbc:Note', l.note),
      text(credit ? 'cbc:CreditedQuantity' : 'cbc:InvoicedQuantity', l.quantity, {
        unitCode: l.unitCode,
      }),
      money('cbc:LineExtensionAmount', l.netAmount),
      l.period && period(l.period),
      el('cac:OrderLineReference', {}, text('cbc:LineID', l.orderLineRef)),
      l.allowances.map((a) => allowanceCharge(a, false, cur, false)),
      l.charges.map((c) => allowanceCharge(c, true, cur, false)),
      req(
        'cac:Item',
        {},
        text('cbc:Description', l.item.description),
        text('cbc:Name', l.item.name),
        el('cac:BuyersItemIdentification', {}, text('cbc:ID', l.item.buyerId)),
        el('cac:SellersItemIdentification', {}, text('cbc:ID', l.item.sellerId)),
        el(
          'cac:StandardItemIdentification',
          {},
          text('cbc:ID', l.item.standardId?.id, { schemeID: l.item.standardId?.scheme }),
        ),
        el('cac:OriginCountry', {}, text('cbc:IdentificationCode', l.item.originCountry)),
        req(
          'cac:ClassifiedTaxCategory',
          {},
          text('cbc:ID', l.vat.category),
          text('cbc:Percent', l.vat.rate),
          taxScheme('VAT'),
        ),
      ),
      req(
        'cac:Price',
        {},
        text('cbc:PriceAmount', l.price.net, { currencyID: cur }),
        text('cbc:BaseQuantity', l.price.baseQuantity, { unitCode: l.price.baseUnitCode }),
        (l.price.gross !== undefined || l.price.discount !== undefined) &&
          el(
            'cac:AllowanceCharge',
            {},
            text('cbc:ChargeIndicator', 'false'),
            // cbc:Amount is mandatory here: a gross price without discount means a discount of 0.
            text('cbc:Amount', l.price.discount ?? '0', { currencyID: cur }),
            text('cbc:BaseAmount', l.price.gross, { currencyID: cur }),
          ),
      ),
    );

  const root = req(
    credit ? 'CreditNote' : 'Invoice',
    {
      xmlns: credit ? UBL_NS.cn : UBL_NS.inv,
      'xmlns:cac': UBL_NS.cac,
      'xmlns:cbc': UBL_NS.cbc,
    },
    text('cbc:CustomizationID', inv.specificationId),
    text('cbc:ProfileID', inv.processType),
    text('cbc:ID', inv.number),
    text('cbc:IssueDate', inv.issueDate),
    !credit && text('cbc:DueDate', inv.dueDate),
    credit && text('cbc:TaxPointDate', inv.taxPointDate),
    text(credit ? 'cbc:CreditNoteTypeCode' : 'cbc:InvoiceTypeCode', inv.typeCode),
    inv.notes.map((n) => text('cbc:Note', n.subjectCode ? `#${n.subjectCode}#${n.text}` : n.text)),
    !credit && text('cbc:TaxPointDate', inv.taxPointDate),
    text('cbc:DocumentCurrencyCode', inv.currency),
    text('cbc:TaxCurrencyCode', inv.vatCurrency),
    text('cbc:BuyerReference', inv.buyerReference),
    period(inv.invoicePeriod, inv.vatDueOn),
    (inv.purchaseOrderReference !== undefined || inv.salesOrderReference !== undefined) &&
      el(
        'cac:OrderReference',
        {},
        text('cbc:ID', inv.purchaseOrderReference ?? NO_ORDER),
        text('cbc:SalesOrderID', inv.salesOrderReference),
      ),
    inv.precedingInvoices.map((pi) =>
      el(
        'cac:BillingReference',
        {},
        el(
          'cac:InvoiceDocumentReference',
          {},
          text('cbc:ID', pi.number),
          text('cbc:IssueDate', pi.issueDate),
        ),
      ),
    ),
    el('cac:ContractDocumentReference', {}, text('cbc:ID', inv.contractReference)),
    credit &&
      inv.projectReference !== undefined &&
      el(
        'cac:AdditionalDocumentReference',
        {},
        text('cbc:ID', inv.projectReference),
        text('cbc:DocumentTypeCode', PROJECT_DOCUMENT_TYPE),
      ),
    !credit && el('cac:ProjectReference', {}, text('cbc:ID', inv.projectReference)),
    req('cac:AccountingSupplierParty', {}, party(inv.seller)),
    req('cac:AccountingCustomerParty', {}, party(inv.buyer)),
    inv.delivery &&
      el(
        'cac:Delivery',
        {},
        text('cbc:ActualDeliveryDate', inv.delivery.date),
        el('cac:DeliveryLocation', {}, address('cac:Address', inv.delivery.address)),
        el('cac:DeliveryParty', {}, el('cac:PartyName', {}, text('cbc:Name', inv.delivery.name))),
      ),
    p
      ? p.accounts.length > 0
        ? p.accounts.map(paymentMeans)
        : paymentMeans(undefined, 0)
      : undefined,
    el('cac:PaymentTerms', {}, text('cbc:Note', inv.paymentTerms)),
    inv.allowances.map((a) => allowanceCharge(a, false, cur, true)),
    inv.charges.map((c) => allowanceCharge(c, true, cur, true)),
    el(
      'cac:TaxTotal',
      {},
      money('cbc:TaxAmount', t.taxTotal ?? vatSum(inv)),
      inv.vatBreakdown.map((b) =>
        req(
          'cac:TaxSubtotal',
          {},
          money('cbc:TaxableAmount', b.taxableAmount),
          money('cbc:TaxAmount', b.taxAmount),
          req(
            'cac:TaxCategory',
            {},
            text('cbc:ID', b.category),
            text('cbc:Percent', b.rate),
            text('cbc:TaxExemptionReasonCode', b.exemptionCode?.toUpperCase()),
            text('cbc:TaxExemptionReason', b.exemptionReason),
            taxScheme('VAT'),
          ),
        ),
      ),
    ),
    foreignVat &&
      el('cac:TaxTotal', {}, money('cbc:TaxAmount', t.taxTotalAccountingCurrency, inv.vatCurrency)),
    req(
      'cac:LegalMonetaryTotal',
      {},
      money('cbc:LineExtensionAmount', t.lineTotal),
      money('cbc:TaxExclusiveAmount', t.taxExclusive),
      money('cbc:TaxInclusiveAmount', t.taxInclusive),
      money('cbc:AllowanceTotalAmount', t.allowanceTotal),
      money('cbc:ChargeTotalAmount', t.chargeTotal),
      money('cbc:PrepaidAmount', t.prepaid),
      money('cbc:PayableRoundingAmount', t.rounding),
      money('cbc:PayableAmount', t.payable),
    ),
    inv.lines.map(line),
  );
  return serialize(root);
}

// ── Reading ────────────────────────────────────────────────────────────────────────────────────

const DUE_FROM_UBL = new Map<string, VatDueOn>(
  Object.entries(VAT_DUE_CODES).map(([meaning, codes]) => [codes.ubl, meaning as VatDueOn]),
);
/** UNTDID 4451 codes have 3 characters; CEN reads anything else between # as free text. */
const NOTE = /^#([A-Za-z0-9]{3})#([\s\S]*)$/;

/** Reads a UBL Invoice or CreditNote. Throws InvoiceXmlError when it is neither. */
export const fromUbl = (xml: string): ParsedInvoice => readUbl(parseDocument(xml));

export function readUbl(root: Element): ParsedInvoice {
  const credit = root.namespaceURI === UBL_NS.cn && root.localName === 'CreditNote';
  if (!credit && !(root.namespaceURI === UBL_NS.inv && root.localName === 'Invoice')) {
    throw new InvoiceXmlError('unknown', `not a UBL invoice: ${root.localName}`);
  }
  const r = new Reader(UBL_NS);
  const currency = r.text(root, 'cbc:DocumentCurrencyCode');
  const vatCurrency = r.text(root, 'cbc:TaxCurrencyCode');

  const identifier = (from: Element | undefined, path: string): Identifier | undefined => {
    const id = r.text(from, path);
    return id === undefined ? undefined : { id, scheme: r.attr(from, path, 'schemeID') };
  };
  const readAddress = (a: Element | undefined): Address | undefined =>
    a &&
    filled({
      line1: r.text(a, 'cbc:StreetName'),
      line2: r.text(a, 'cbc:AdditionalStreetName'),
      line3: r.text(a, 'cac:AddressLine/cbc:Line'),
      city: r.text(a, 'cbc:CityName'),
      postCode: r.text(a, 'cbc:PostalZone'),
      subdivision: r.text(a, 'cbc:CountrySubentity'),
      country: r.text(a, 'cac:Country/cbc:IdentificationCode'),
    });
  const readParty = (p: Element | undefined): Party => {
    const schemes = r.all(p, 'cac:PartyTaxScheme');
    const isVat = (n: Element) => r.text(n, 'cac:TaxScheme/cbc:ID')?.toUpperCase() === 'VAT';
    const contactNode = r.one(p, 'cac:Contact');
    return {
      ids: r.all(p, 'cac:PartyIdentification/cbc:ID').map((n) => ({
        id: r.text(n, '.') ?? '',
        scheme: r.attr(n, '.', 'schemeID'),
      })),
      name: r.text(p, 'cac:PartyLegalEntity/cbc:RegistrationName'),
      tradingName: r.text(p, 'cac:PartyName/cbc:Name'),
      legalId: identifier(p, 'cac:PartyLegalEntity/cbc:CompanyID'),
      legalInfo: r.text(p, 'cac:PartyLegalEntity/cbc:CompanyLegalForm'),
      vatId: r.text(schemes.find(isVat), 'cbc:CompanyID'),
      taxRegistrationId: r.text(
        schemes.find((n) => !isVat(n)),
        'cbc:CompanyID',
      ),
      electronicAddress: identifier(p, 'cbc:EndpointID'),
      address: readAddress(r.one(p, 'cac:PostalAddress')),
      contact:
        contactNode &&
        filled({
          name: r.text(contactNode, 'cbc:Name'),
          phone: r.text(contactNode, 'cbc:Telephone'),
          email: r.text(contactNode, 'cbc:ElectronicMail'),
        }),
    };
  };
  const readPeriod = (p: Element | undefined): Period | undefined => {
    return filled({ start: r.text(p, 'cbc:StartDate'), end: r.text(p, 'cbc:EndDate') });
  };
  const readAllowanceCharges = (from: Element | undefined, at: string, charge: boolean) =>
    r
      .all(from, 'cac:AllowanceCharge')
      .filter((n) => isChargeIndicator(r.text(n, 'cbc:ChargeIndicator')) === charge)
      .map(
        (n, i): AllowanceCharge => ({
          amount: r.amount(n, 'cbc:Amount', `${at}[${i}].amount`),
          baseAmount: r.amount(n, 'cbc:BaseAmount', `${at}[${i}].baseAmount`),
          percentage: r.text(n, 'cbc:MultiplierFactorNumeric'),
          vatCategory: r.text(n, 'cac:TaxCategory/cbc:ID'),
          vatRate: r.text(n, 'cac:TaxCategory/cbc:Percent'),
          reason: r.text(n, 'cbc:AllowanceChargeReason'),
          reasonCode: r.text(n, 'cbc:AllowanceChargeReasonCode'),
        }),
      );

  const lines = r.all(root, credit ? 'cac:CreditNoteLine' : 'cac:InvoiceLine').map((n, i): Line => {
    const item = r.one(n, 'cac:Item');
    const price = r.one(n, 'cac:Price');
    const priceDiscount = r.one(price, 'cac:AllowanceCharge');
    const quantity = credit ? 'cbc:CreditedQuantity' : 'cbc:InvoicedQuantity';
    return {
      id: r.text(n, 'cbc:ID'),
      note: r.text(n, 'cbc:Note'),
      quantity: r.text(n, quantity),
      unitCode: r.attr(n, quantity, 'unitCode'),
      netAmount: r.amount(n, 'cbc:LineExtensionAmount', `lines[${i}].netAmount`),
      orderLineRef: r.text(n, 'cac:OrderLineReference/cbc:LineID'),
      period: readPeriod(r.one(n, 'cac:InvoicePeriod')),
      allowances: readAllowanceCharges(n, `lines[${i}].allowances`, false),
      charges: readAllowanceCharges(n, `lines[${i}].charges`, true),
      price: {
        net: r.text(price, 'cbc:PriceAmount'),
        discount: r.text(priceDiscount, 'cbc:Amount'),
        gross: r.text(priceDiscount, 'cbc:BaseAmount'),
        baseQuantity: r.text(price, 'cbc:BaseQuantity'),
        baseUnitCode: r.attr(price, 'cbc:BaseQuantity', 'unitCode'),
      },
      vat: {
        category: r.text(item, 'cac:ClassifiedTaxCategory/cbc:ID'),
        rate: r.text(item, 'cac:ClassifiedTaxCategory/cbc:Percent'),
      },
      item: {
        name: r.text(item, 'cbc:Name'),
        description: r.text(item, 'cbc:Description'),
        sellerId: r.text(item, 'cac:SellersItemIdentification/cbc:ID'),
        buyerId: r.text(item, 'cac:BuyersItemIdentification/cbc:ID'),
        standardId: identifier(item, 'cac:StandardItemIdentification/cbc:ID'),
        originCountry: r.text(item, 'cac:OriginCountry/cbc:IdentificationCode'),
      },
    };
  });

  const inVatCurrency = (n: Element) =>
    vatCurrency !== undefined &&
    vatCurrency !== currency &&
    r.attr(n, 'cbc:TaxAmount', 'currencyID') === vatCurrency;
  const taxTotals = r.all(root, 'cac:TaxTotal');
  const mainTax = taxTotals.find((n) => !inVatCurrency(n));
  const total = r.one(root, 'cac:LegalMonetaryTotal');
  const sum = (path: string, field: string) => r.amount(total, path, `totals.${field}`);
  const means = r.all(root, 'cac:PaymentMeans');
  const firstMeans = means[0];
  const invoicePeriod = r.one(root, 'cac:InvoicePeriod');
  const dueCode = r.text(invoicePeriod, 'cbc:DescriptionCode');
  const order = r.one(root, 'cac:OrderReference');
  const salesOrder = r.text(order, 'cbc:SalesOrderID');
  const orderId = r.text(order, 'cbc:ID');
  const delivery = r.one(root, 'cac:Delivery');

  const input: InvoiceInput = {
    specificationId: r.text(root, 'cbc:CustomizationID'),
    processType: r.text(root, 'cbc:ProfileID'),
    number: r.text(root, 'cbc:ID'),
    issueDate: r.text(root, 'cbc:IssueDate'),
    typeCode: r.text(root, credit ? 'cbc:CreditNoteTypeCode' : 'cbc:InvoiceTypeCode'),
    currency,
    vatCurrency,
    taxPointDate: r.text(root, 'cbc:TaxPointDate'),
    vatDueOn: dueCode === undefined ? undefined : DUE_FROM_UBL.get(dueCode),
    dueDate: credit
      ? r
          .all(root, 'cac:PaymentMeans/cbc:PaymentDueDate')
          .map((d) => r.text(d, '.'))
          .find((d) => d !== undefined)
      : r.text(root, 'cbc:DueDate'),
    buyerReference: r.text(root, 'cbc:BuyerReference'),
    projectReference: credit
      ? r.text(
          r
            .all(root, 'cac:AdditionalDocumentReference')
            .find((d) => r.text(d, 'cbc:DocumentTypeCode') === PROJECT_DOCUMENT_TYPE),
          'cbc:ID',
        )
      : r.text(root, 'cac:ProjectReference/cbc:ID'),
    contractReference: r.text(root, 'cac:ContractDocumentReference/cbc:ID'),
    purchaseOrderReference: salesOrder !== undefined && orderId === NO_ORDER ? undefined : orderId,
    salesOrderReference: salesOrder,
    paymentTerms: r.text(root, 'cac:PaymentTerms/cbc:Note'),
    notes: r.all(root, 'cbc:Note').map((n) => {
      const value = r.text(n, '.') ?? '';
      const m = NOTE.exec(value);
      return m ? { subjectCode: m[1], text: (m[2] ?? '').trim() } : { text: value };
    }),
    precedingInvoices: r
      .all(root, 'cac:BillingReference/cac:InvoiceDocumentReference')
      .map((d) => ({
        number: r.text(d, 'cbc:ID'),
        issueDate: r.text(d, 'cbc:IssueDate'),
      })),
    seller: readParty(r.one(root, 'cac:AccountingSupplierParty/cac:Party')),
    buyer: readParty(r.one(root, 'cac:AccountingCustomerParty/cac:Party')),
    delivery:
      delivery &&
      filled({
        name: r.text(delivery, 'cac:DeliveryParty/cac:PartyName/cbc:Name'),
        date: r.text(delivery, 'cbc:ActualDeliveryDate'),
        address: readAddress(r.one(delivery, 'cac:DeliveryLocation/cac:Address')),
      }),
    invoicePeriod: readPeriod(invoicePeriod),
    payment:
      firstMeans &&
      filled({
        meansCode: r.text(firstMeans, 'cbc:PaymentMeansCode'),
        meansText: r.attr(firstMeans, 'cbc:PaymentMeansCode', 'name'),
        remittanceInfo: r.text(firstMeans, 'cbc:PaymentID'),
        accounts: means
          .map((m) => r.one(m, 'cac:PayeeFinancialAccount'))
          .filter((a) => a !== undefined)
          .flatMap(
            (a) =>
              filled({
                iban: r.text(a, 'cbc:ID'),
                name: r.text(a, 'cbc:Name'),
                bic: r.text(a, 'cac:FinancialInstitutionBranch/cbc:ID'),
              }) ?? [],
          ),
      }),
    allowances: readAllowanceCharges(root, 'allowances', false),
    charges: readAllowanceCharges(root, 'charges', true),
    totals: {
      lineTotal: sum('cbc:LineExtensionAmount', 'lineTotal'),
      taxExclusive: sum('cbc:TaxExclusiveAmount', 'taxExclusive'),
      taxInclusive: sum('cbc:TaxInclusiveAmount', 'taxInclusive'),
      allowanceTotal: sum('cbc:AllowanceTotalAmount', 'allowanceTotal'),
      chargeTotal: sum('cbc:ChargeTotalAmount', 'chargeTotal'),
      prepaid: sum('cbc:PrepaidAmount', 'prepaid'),
      rounding: sum('cbc:PayableRoundingAmount', 'rounding'),
      payable: sum('cbc:PayableAmount', 'payable'),
      taxTotal: r.amount(mainTax, 'cbc:TaxAmount', 'totals.taxTotal'),
      taxTotalAccountingCurrency: r.amount(
        taxTotals.find(inVatCurrency),
        'cbc:TaxAmount',
        'totals.taxTotalAccountingCurrency',
      ),
    },
    vatBreakdown: r.all(mainTax, 'cac:TaxSubtotal').map((s, i) => ({
      category: r.text(s, 'cac:TaxCategory/cbc:ID'),
      rate: r.text(s, 'cac:TaxCategory/cbc:Percent'),
      taxableAmount: r.amount(s, 'cbc:TaxableAmount', `vatBreakdown[${i}].taxableAmount`),
      taxAmount: r.amount(s, 'cbc:TaxAmount', `vatBreakdown[${i}].taxAmount`),
      exemptionReason: r.text(s, 'cac:TaxCategory/cbc:TaxExemptionReason'),
      exemptionCode: r.text(s, 'cac:TaxCategory/cbc:TaxExemptionReasonCode')?.toUpperCase(),
    })),
    lines,
  };
  return { syntax: 'ubl', invoice: Invoice.parse(input), issues: r.issues };
}
