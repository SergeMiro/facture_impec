// UN/CEFACT CII (Factur-X 1.09.2 profile EN 16931) ⇄ invoice model.
// Element order follows the XSD sequences. The output is valid against both the CEN D16B XSD and the
// Factur-X EN16931 XSD, with one exception: D16B allows one ram:InvoiceReferencedDocument and Factur-X
// (D22B) several, so an invoice correcting several invoices is valid for Factur-X only.
// Choices from docs/research/FORMATS.md §1.6: one ram:IncludedNote per note (D2), BT-13 always
// written (D1), BT-23 written as given (D3). BT-6 equal to BT-5 is not written: it says nothing
// BT-5 does not, and CEN CII BR-53 rejects it (CEN UBL accepts it). VATEX codes are written and
// read in upper case: CEN compares them in any case, the Factur-X schematron does not.
import type { Element } from '@xmldom/xmldom';
import { fromCiiDate, toCiiDate } from '../dates';
import {
  type Address,
  type AllowanceCharge,
  type Contact,
  type Identifier,
  Invoice,
  type InvoiceInput,
  type Line,
  type Party,
  VAT_DUE_CODES,
  type VatBreakdown,
  type VatDueOn,
} from '../model';
import { formatAmount } from '../money';
import type { Issue } from '../rules';
import { filled, InvoiceXmlError, isChargeIndicator, parseDocument, Reader } from './reader';
import { type Child, el, req, serialize } from './writer';

export const CII_NS = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  qdt: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
} as const;

/** BT-11 needs ram:Name in CII; the CEN examples write this text. */
const PROJECT_NAME = 'Project reference';

// ── Writing ────────────────────────────────────────────────────────────────────────────────────

const text = (name: string, value: string | undefined, attrs = {}) => el(name, attrs, value);
const amount = (name: string, cents: number | undefined, currency?: string) =>
  cents === undefined ? undefined : el(name, { currencyID: currency }, formatAmount(cents));
const dateTime = (name: string, iso: string | undefined) =>
  iso === undefined
    ? undefined
    : el(name, {}, el('udt:DateTimeString', { format: '102' }, toCiiDate(iso)));
const indicator = (charge: boolean) =>
  el('ram:ChargeIndicator', {}, el('udt:Indicator', {}, String(charge)));

function address(a: Address | undefined) {
  if (!a) return undefined;
  return el(
    'ram:PostalTradeAddress',
    {},
    text('ram:PostcodeCode', a.postCode),
    text('ram:LineOne', a.line1),
    text('ram:LineTwo', a.line2),
    text('ram:LineThree', a.line3),
    text('ram:CityName', a.city),
    text('ram:CountryID', a.country),
    text('ram:CountrySubDivisionName', a.subdivision),
  );
}

const contact = (c: Contact | undefined) =>
  c &&
  el(
    'ram:DefinedTradeContact',
    {},
    text('ram:PersonName', c.name),
    el('ram:TelephoneUniversalCommunication', {}, text('ram:CompleteNumber', c.phone)),
    el('ram:EmailURIUniversalCommunication', {}, text('ram:URIID', c.email)),
  );

const taxRegistration = (id: string | undefined, scheme: 'VA' | 'FC') =>
  el('ram:SpecifiedTaxRegistration', {}, text('ram:ID', id, { schemeID: scheme }));

function party(p: Party): Child[] {
  return [
    p.ids.filter((i) => !i.scheme).map((i) => text('ram:ID', i.id)),
    p.ids.filter((i) => i.scheme).map((i) => text('ram:GlobalID', i.id, { schemeID: i.scheme })),
    text('ram:Name', p.name),
    text('ram:Description', p.legalInfo),
    el(
      'ram:SpecifiedLegalOrganization',
      {},
      text('ram:ID', p.legalId?.id, { schemeID: p.legalId?.scheme }),
      text('ram:TradingBusinessName', p.tradingName),
    ),
    contact(p.contact),
    address(p.address),
    el(
      'ram:URIUniversalCommunication',
      {},
      text('ram:URIID', p.electronicAddress?.id, { schemeID: p.electronicAddress?.scheme }),
    ),
    taxRegistration(p.vatId, 'VA'),
    taxRegistration(p.taxRegistrationId, 'FC'),
  ];
}

const period = (name: string, p: { start?: string; end?: string } | undefined) =>
  p && el(name, {}, dateTime('ram:StartDateTime', p.start), dateTime('ram:EndDateTime', p.end));

/** BG-20 / BG-21 (with their VAT category) and BG-27 / BG-28 (without). */
function allowanceCharge(a: AllowanceCharge, charge: boolean, documentLevel: boolean) {
  return req(
    'ram:SpecifiedTradeAllowanceCharge',
    {},
    indicator(charge),
    text('ram:CalculationPercent', a.percentage),
    amount('ram:BasisAmount', a.baseAmount),
    amount('ram:ActualAmount', a.amount),
    text('ram:ReasonCode', a.reasonCode),
    text('ram:Reason', a.reason),
    documentLevel &&
      (a.vatCategory !== undefined || a.vatRate !== undefined) &&
      el(
        'ram:CategoryTradeTax',
        {},
        text('ram:TypeCode', 'VAT'),
        text('ram:CategoryCode', a.vatCategory),
        text('ram:RateApplicablePercent', a.vatRate),
      ),
  );
}

function line(l: Line) {
  const { price, item } = l;
  return req(
    'ram:IncludedSupplyChainTradeLineItem',
    {},
    req(
      'ram:AssociatedDocumentLineDocument',
      {},
      text('ram:LineID', l.id),
      el('ram:IncludedNote', {}, text('ram:Content', l.note)),
    ),
    req(
      'ram:SpecifiedTradeProduct',
      {},
      text('ram:GlobalID', item.standardId?.id, { schemeID: item.standardId?.scheme }),
      text('ram:SellerAssignedID', item.sellerId),
      text('ram:BuyerAssignedID', item.buyerId),
      text('ram:Name', item.name),
      text('ram:Description', item.description),
      el('ram:OriginTradeCountry', {}, text('ram:ID', item.originCountry)),
    ),
    req(
      'ram:SpecifiedLineTradeAgreement',
      {},
      el('ram:BuyerOrderReferencedDocument', {}, text('ram:LineID', l.orderLineRef)),
      price.gross !== undefined &&
        el(
          'ram:GrossPriceProductTradePrice',
          {},
          text('ram:ChargeAmount', price.gross),
          price.discount !== undefined &&
            el(
              'ram:AppliedTradeAllowanceCharge',
              {},
              indicator(false),
              text('ram:ActualAmount', price.discount),
            ),
        ),
      req(
        'ram:NetPriceProductTradePrice',
        {},
        text('ram:ChargeAmount', price.net),
        text('ram:BasisQuantity', price.baseQuantity, { unitCode: price.baseUnitCode }),
      ),
    ),
    req(
      'ram:SpecifiedLineTradeDelivery',
      {},
      text('ram:BilledQuantity', l.quantity, { unitCode: l.unitCode }),
    ),
    req(
      'ram:SpecifiedLineTradeSettlement',
      {},
      req(
        'ram:ApplicableTradeTax',
        {},
        text('ram:TypeCode', 'VAT'),
        text('ram:CategoryCode', l.vat.category),
        text('ram:RateApplicablePercent', l.vat.rate),
      ),
      period('ram:BillingSpecifiedPeriod', l.period),
      l.allowances.map((a) => allowanceCharge(a, false, false)),
      l.charges.map((c) => allowanceCharge(c, true, false)),
      req(
        'ram:SpecifiedTradeSettlementLineMonetarySummation',
        {},
        amount('ram:LineTotalAmount', l.netAmount),
      ),
    ),
  );
}

/** BT-7 and BT-8 go in the first BG-23 only (CII-SR-461, CII-SR-462). */
function vatBreakdown(inv: Invoice, b: VatBreakdown, first: boolean) {
  return req(
    'ram:ApplicableTradeTax',
    {},
    amount('ram:CalculatedAmount', b.taxAmount),
    text('ram:TypeCode', 'VAT'),
    text('ram:ExemptionReason', b.exemptionReason),
    amount('ram:BasisAmount', b.taxableAmount),
    text('ram:CategoryCode', b.category),
    text('ram:ExemptionReasonCode', b.exemptionCode?.toUpperCase()),
    first &&
      inv.taxPointDate !== undefined &&
      el(
        'ram:TaxPointDate',
        {},
        el('udt:DateString', { format: '102' }, toCiiDate(inv.taxPointDate)),
      ),
    first && text('ram:DueDateTypeCode', inv.vatDueOn && VAT_DUE_CODES[inv.vatDueOn].cii),
    text('ram:RateApplicablePercent', b.rate),
  );
}

function paymentMeans(inv: Invoice): Child[] {
  const p = inv.payment;
  if (!p) return [];
  const means = (account?: { iban?: string; name?: string; bic?: string }) =>
    el(
      'ram:SpecifiedTradeSettlementPaymentMeans',
      {},
      text('ram:TypeCode', p.meansCode),
      text('ram:Information', p.meansText),
      account &&
        el(
          'ram:PayeePartyCreditorFinancialAccount',
          {},
          text('ram:IBANID', account.iban),
          text('ram:AccountName', account.name),
        ),
      account &&
        el('ram:PayeeSpecifiedCreditorFinancialInstitution', {}, text('ram:BICID', account.bic)),
    );
  // BG-17 repeats inside the payment means in CII: one ram:SpecifiedTradeSettlementPaymentMeans per account.
  return p.accounts.length > 0 ? p.accounts.map(means) : [means()];
}

function settlement(inv: Invoice) {
  const t = inv.totals;
  const foreignVat = inv.vatCurrency !== undefined && inv.vatCurrency !== inv.currency;
  return req(
    'ram:ApplicableHeaderTradeSettlement',
    {},
    text('ram:PaymentReference', inv.payment?.remittanceInfo),
    inv.vatCurrency !== inv.currency && text('ram:TaxCurrencyCode', inv.vatCurrency),
    text('ram:InvoiceCurrencyCode', inv.currency),
    paymentMeans(inv),
    inv.vatBreakdown.map((b, i) => vatBreakdown(inv, b, i === 0)),
    period('ram:BillingSpecifiedPeriod', inv.invoicePeriod),
    inv.allowances.map((a) => allowanceCharge(a, false, true)),
    inv.charges.map((c) => allowanceCharge(c, true, true)),
    el(
      'ram:SpecifiedTradePaymentTerms',
      {},
      text('ram:Description', inv.paymentTerms),
      dateTime('ram:DueDateDateTime', inv.dueDate),
    ),
    req(
      'ram:SpecifiedTradeSettlementHeaderMonetarySummation',
      {},
      amount('ram:LineTotalAmount', t.lineTotal),
      amount('ram:ChargeTotalAmount', t.chargeTotal),
      amount('ram:AllowanceTotalAmount', t.allowanceTotal),
      amount('ram:TaxBasisTotalAmount', t.taxExclusive),
      amount('ram:TaxTotalAmount', t.taxTotal, inv.currency),
      foreignVat && amount('ram:TaxTotalAmount', t.taxTotalAccountingCurrency, inv.vatCurrency),
      amount('ram:RoundingAmount', t.rounding),
      amount('ram:GrandTotalAmount', t.taxInclusive),
      amount('ram:TotalPrepaidAmount', t.prepaid),
      amount('ram:DuePayableAmount', t.payable),
    ),
    inv.precedingInvoices.map((p) =>
      el(
        'ram:InvoiceReferencedDocument',
        {},
        text('ram:IssuerAssignedID', p.number),
        p.issueDate !== undefined &&
          el(
            'ram:FormattedIssueDateTime',
            {},
            el('qdt:DateTimeString', { format: '102' }, toCiiDate(p.issueDate)),
          ),
      ),
    ),
  );
}

/** Writes the CII XML of a computed invoice. Validate first: the builder does not check anything. */
export function toCii(inv: Invoice): string {
  const reference = (name: string, id: string | undefined) =>
    el(name, {}, text('ram:IssuerAssignedID', id));
  const root = req(
    'rsm:CrossIndustryInvoice',
    {
      'xmlns:rsm': CII_NS.rsm,
      'xmlns:qdt': CII_NS.qdt,
      'xmlns:ram': CII_NS.ram,
      'xmlns:udt': CII_NS.udt,
    },
    req(
      'rsm:ExchangedDocumentContext',
      {},
      el(
        'ram:BusinessProcessSpecifiedDocumentContextParameter',
        {},
        text('ram:ID', inv.processType),
      ),
      req(
        'ram:GuidelineSpecifiedDocumentContextParameter',
        {},
        text('ram:ID', inv.specificationId),
      ),
    ),
    req(
      'rsm:ExchangedDocument',
      {},
      text('ram:ID', inv.number),
      text('ram:TypeCode', inv.typeCode),
      dateTime('ram:IssueDateTime', inv.issueDate),
      inv.notes.map((n) =>
        el(
          'ram:IncludedNote',
          {},
          text('ram:Content', n.text),
          text('ram:SubjectCode', n.subjectCode),
        ),
      ),
    ),
    req(
      'rsm:SupplyChainTradeTransaction',
      {},
      inv.lines.map(line),
      req(
        'ram:ApplicableHeaderTradeAgreement',
        {},
        text('ram:BuyerReference', inv.buyerReference),
        req('ram:SellerTradeParty', {}, party(inv.seller)),
        req('ram:BuyerTradeParty', {}, party(inv.buyer)),
        reference('ram:SellerOrderReferencedDocument', inv.salesOrderReference),
        reference('ram:BuyerOrderReferencedDocument', inv.purchaseOrderReference),
        reference('ram:ContractReferencedDocument', inv.contractReference),
        inv.projectReference !== undefined &&
          el(
            'ram:SpecifiedProcuringProject',
            {},
            text('ram:ID', inv.projectReference),
            text('ram:Name', PROJECT_NAME),
          ),
      ),
      req(
        'ram:ApplicableHeaderTradeDelivery',
        {},
        inv.delivery &&
          el(
            'ram:ShipToTradeParty',
            {},
            text('ram:Name', inv.delivery.name),
            address(inv.delivery.address),
          ),
        el(
          'ram:ActualDeliverySupplyChainEvent',
          {},
          dateTime('ram:OccurrenceDateTime', inv.delivery?.date),
        ),
      ),
      settlement(inv),
    ),
  );
  return serialize(root);
}

// ── Reading ────────────────────────────────────────────────────────────────────────────────────

export interface ParsedInvoice {
  syntax: 'cii' | 'ubl';
  invoice: Invoice;
  /** Problems found while reading (BR-FR-DEC-01, FF-FMT-04 on amounts). Run validate() for the rest. */
  issues: Issue[];
}

const DUE_FROM_CII = new Map<string, VatDueOn>(
  Object.entries(VAT_DUE_CODES).map(([meaning, codes]) => [codes.cii, meaning as VatDueOn]),
);

/** Reads a CII invoice. Throws InvoiceXmlError when the file is not well-formed or not CII. */
export const fromCii = (xml: string): ParsedInvoice => readCii(parseDocument(xml));

export function readCii(root: Element): ParsedInvoice {
  if (root.namespaceURI !== CII_NS.rsm || root.localName !== 'CrossIndustryInvoice') {
    throw new InvoiceXmlError('unknown', `not a CII invoice: ${root.localName}`);
  }
  const r = new Reader(CII_NS);
  const date = (from: Element | undefined, path: string) => {
    const value = r.text(from, path);
    return value === undefined ? undefined : fromCiiDate(value);
  };
  const tx = r.one(root, 'rsm:SupplyChainTradeTransaction');
  const agreement = r.one(tx, 'ram:ApplicableHeaderTradeAgreement');
  const delivery = r.one(tx, 'ram:ApplicableHeaderTradeDelivery');
  const settlement = r.one(tx, 'ram:ApplicableHeaderTradeSettlement');
  const doc = r.one(root, 'rsm:ExchangedDocument');

  const readAddress = (from: Element | undefined): Address | undefined => {
    const a = r.one(from, 'ram:PostalTradeAddress');
    return (
      a &&
      filled({
        postCode: r.text(a, 'ram:PostcodeCode'),
        line1: r.text(a, 'ram:LineOne'),
        line2: r.text(a, 'ram:LineTwo'),
        line3: r.text(a, 'ram:LineThree'),
        city: r.text(a, 'ram:CityName'),
        country: r.text(a, 'ram:CountryID'),
        subdivision: r.text(a, 'ram:CountrySubDivisionName'),
      })
    );
  };
  const identifier = (from: Element | undefined, path: string): Identifier | undefined => {
    const id = r.text(from, path);
    return id === undefined ? undefined : { id, scheme: r.attr(from, path, 'schemeID') };
  };
  const taxId = (p: Element | undefined, scheme: string) =>
    r
      .all(p, 'ram:SpecifiedTaxRegistration/ram:ID')
      .find((n) => n.getAttribute('schemeID')?.trim() === scheme)
      ?.textContent?.trim() || undefined;
  const readParty = (p: Element | undefined): Party => {
    const contactNode = r.one(p, 'ram:DefinedTradeContact');
    return {
      ids: [
        ...r.all(p, 'ram:ID').map((n) => ({ id: r.text(n, '.') ?? '' })),
        ...r.all(p, 'ram:GlobalID').map((n) => ({
          id: r.text(n, '.') ?? '',
          scheme: r.attr(n, '.', 'schemeID'),
        })),
      ],
      name: r.text(p, 'ram:Name'),
      legalInfo: r.text(p, 'ram:Description'),
      legalId: identifier(p, 'ram:SpecifiedLegalOrganization/ram:ID'),
      tradingName: r.text(p, 'ram:SpecifiedLegalOrganization/ram:TradingBusinessName'),
      contact:
        contactNode &&
        filled({
          name: r.text(contactNode, 'ram:PersonName'),
          phone: r.text(contactNode, 'ram:TelephoneUniversalCommunication/ram:CompleteNumber'),
          email: r.text(contactNode, 'ram:EmailURIUniversalCommunication/ram:URIID'),
        }),
      address: readAddress(p),
      electronicAddress: identifier(p, 'ram:URIUniversalCommunication/ram:URIID'),
      vatId: taxId(p, 'VA'),
      taxRegistrationId: taxId(p, 'FC'),
    };
  };
  const readPeriod = (from: Element | undefined, path: string) => {
    const p = r.one(from, path);
    return (
      p &&
      filled({
        start: date(p, 'ram:StartDateTime/udt:DateTimeString'),
        end: date(p, 'ram:EndDateTime/udt:DateTimeString'),
      })
    );
  };
  const readAllowanceCharges = (from: Element | undefined, at: string, charge: boolean) =>
    r
      .all(from, 'ram:SpecifiedTradeAllowanceCharge')
      .filter((n) => isChargeIndicator(r.text(n, 'ram:ChargeIndicator/udt:Indicator')) === charge)
      .map(
        (n, i): AllowanceCharge => ({
          amount: r.amount(n, 'ram:ActualAmount', `${at}[${i}].amount`),
          baseAmount: r.amount(n, 'ram:BasisAmount', `${at}[${i}].baseAmount`),
          percentage: r.text(n, 'ram:CalculationPercent'),
          vatCategory: r.text(n, 'ram:CategoryTradeTax/ram:CategoryCode'),
          vatRate: r.text(n, 'ram:CategoryTradeTax/ram:RateApplicablePercent'),
          reason: r.text(n, 'ram:Reason'),
          reasonCode: r.text(n, 'ram:ReasonCode'),
        }),
      );

  const lines = r.all(tx, 'ram:IncludedSupplyChainTradeLineItem').map((n, i): Line => {
    const product = r.one(n, 'ram:SpecifiedTradeProduct');
    const lineAgreement = r.one(n, 'ram:SpecifiedLineTradeAgreement');
    const gross = r.one(lineAgreement, 'ram:GrossPriceProductTradePrice');
    const net = r.one(lineAgreement, 'ram:NetPriceProductTradePrice');
    const lineSettlement = r.one(n, 'ram:SpecifiedLineTradeSettlement');
    const at = `lines[${i}]`;
    return {
      id: r.text(n, 'ram:AssociatedDocumentLineDocument/ram:LineID'),
      note: r.text(n, 'ram:AssociatedDocumentLineDocument/ram:IncludedNote/ram:Content'),
      quantity: r.text(n, 'ram:SpecifiedLineTradeDelivery/ram:BilledQuantity'),
      unitCode: r.attr(n, 'ram:SpecifiedLineTradeDelivery/ram:BilledQuantity', 'unitCode'),
      netAmount: r.amount(
        lineSettlement,
        'ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount',
        `${at}.netAmount`,
      ),
      orderLineRef: r.text(lineAgreement, 'ram:BuyerOrderReferencedDocument/ram:LineID'),
      period: readPeriod(lineSettlement, 'ram:BillingSpecifiedPeriod'),
      allowances: readAllowanceCharges(lineSettlement, `${at}.allowances`, false),
      charges: readAllowanceCharges(lineSettlement, `${at}.charges`, true),
      price: {
        net: r.text(net, 'ram:ChargeAmount'),
        discount: r.text(gross, 'ram:AppliedTradeAllowanceCharge/ram:ActualAmount'),
        gross: r.text(gross, 'ram:ChargeAmount'),
        baseQuantity: r.text(net, 'ram:BasisQuantity') ?? r.text(gross, 'ram:BasisQuantity'),
        baseUnitCode:
          r.attr(net, 'ram:BasisQuantity', 'unitCode') ??
          r.attr(gross, 'ram:BasisQuantity', 'unitCode'),
      },
      vat: {
        category: r.text(lineSettlement, 'ram:ApplicableTradeTax/ram:CategoryCode'),
        rate: r.text(lineSettlement, 'ram:ApplicableTradeTax/ram:RateApplicablePercent'),
      },
      item: {
        name: r.text(product, 'ram:Name'),
        description: r.text(product, 'ram:Description'),
        sellerId: r.text(product, 'ram:SellerAssignedID'),
        buyerId: r.text(product, 'ram:BuyerAssignedID'),
        standardId: identifier(product, 'ram:GlobalID'),
        originCountry: r.text(product, 'ram:OriginTradeCountry/ram:ID'),
      },
    };
  });

  const currency = r.text(settlement, 'ram:InvoiceCurrencyCode');
  const vatCurrency = r.text(settlement, 'ram:TaxCurrencyCode');
  const taxes = r.all(settlement, 'ram:ApplicableTradeTax');
  const summation = r.one(settlement, 'ram:SpecifiedTradeSettlementHeaderMonetarySummation');
  const taxTotals = r.all(summation, 'ram:TaxTotalAmount');
  const inVatCurrency = (n: Element) =>
    vatCurrency !== undefined &&
    vatCurrency !== currency &&
    n.getAttribute('currencyID')?.trim() === vatCurrency;
  const sum = (path: string, field: string) => r.amount(summation, path, `totals.${field}`);
  const meansNodes = r.all(settlement, 'ram:SpecifiedTradeSettlementPaymentMeans');
  const remittanceInfo = r.text(settlement, 'ram:PaymentReference');
  const firstMeans = meansNodes[0];
  const deliveryParty = r.one(delivery, 'ram:ShipToTradeParty');
  const deliveryDate = date(
    delivery,
    'ram:ActualDeliverySupplyChainEvent/ram:OccurrenceDateTime/udt:DateTimeString',
  );
  const dueCode = taxes.map((n) => r.text(n, 'ram:DueDateTypeCode')).find((c) => c !== undefined);
  const project = r.text(agreement, 'ram:SpecifiedProcuringProject/ram:ID');

  const input: InvoiceInput = {
    specificationId: r.text(
      root,
      'rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID',
    ),
    processType: r.text(
      root,
      'rsm:ExchangedDocumentContext/ram:BusinessProcessSpecifiedDocumentContextParameter/ram:ID',
    ),
    number: r.text(doc, 'ram:ID'),
    issueDate: date(doc, 'ram:IssueDateTime/udt:DateTimeString'),
    typeCode: r.text(doc, 'ram:TypeCode'),
    currency,
    vatCurrency,
    taxPointDate: taxes
      .map((n) => date(n, 'ram:TaxPointDate/udt:DateString'))
      .find((d) => d !== undefined),
    vatDueOn: dueCode === undefined ? undefined : DUE_FROM_CII.get(dueCode),
    dueDate: date(
      settlement,
      'ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime/udt:DateTimeString',
    ),
    buyerReference: r.text(agreement, 'ram:BuyerReference'),
    projectReference: project,
    contractReference: r.text(agreement, 'ram:ContractReferencedDocument/ram:IssuerAssignedID'),
    purchaseOrderReference: r.text(
      agreement,
      'ram:BuyerOrderReferencedDocument/ram:IssuerAssignedID',
    ),
    salesOrderReference: r.text(
      agreement,
      'ram:SellerOrderReferencedDocument/ram:IssuerAssignedID',
    ),
    paymentTerms: r.text(settlement, 'ram:SpecifiedTradePaymentTerms/ram:Description'),
    notes: r.all(doc, 'ram:IncludedNote').map((n) => ({
      subjectCode: r.text(n, 'ram:SubjectCode'),
      text: r.text(n, 'ram:Content') ?? '',
    })),
    precedingInvoices: r.all(settlement, 'ram:InvoiceReferencedDocument').map((n) => ({
      number: r.text(n, 'ram:IssuerAssignedID'),
      issueDate: date(n, 'ram:FormattedIssueDateTime/qdt:DateTimeString'),
    })),
    seller: readParty(r.one(agreement, 'ram:SellerTradeParty')),
    buyer: readParty(r.one(agreement, 'ram:BuyerTradeParty')),
    delivery: filled({
      name: r.text(deliveryParty, 'ram:Name'),
      date: deliveryDate,
      address: readAddress(deliveryParty),
    }),
    invoicePeriod: readPeriod(settlement, 'ram:BillingSpecifiedPeriod'),
    payment: filled({
      meansCode: r.text(firstMeans, 'ram:TypeCode'),
      meansText: r.text(firstMeans, 'ram:Information'),
      remittanceInfo,
      accounts: meansNodes
        .filter(
          (n) =>
            r.one(n, 'ram:PayeePartyCreditorFinancialAccount') ||
            r.one(n, 'ram:PayeeSpecifiedCreditorFinancialInstitution'),
        )
        .flatMap(
          (n) =>
            filled({
              iban: r.text(n, 'ram:PayeePartyCreditorFinancialAccount/ram:IBANID'),
              name: r.text(n, 'ram:PayeePartyCreditorFinancialAccount/ram:AccountName'),
              bic: r.text(n, 'ram:PayeeSpecifiedCreditorFinancialInstitution/ram:BICID'),
            }) ?? [],
        ),
    }),
    allowances: readAllowanceCharges(settlement, 'allowances', false),
    charges: readAllowanceCharges(settlement, 'charges', true),
    totals: {
      lineTotal: sum('ram:LineTotalAmount', 'lineTotal'),
      chargeTotal: sum('ram:ChargeTotalAmount', 'chargeTotal'),
      allowanceTotal: sum('ram:AllowanceTotalAmount', 'allowanceTotal'),
      taxExclusive: sum('ram:TaxBasisTotalAmount', 'taxExclusive'),
      taxTotal: r.cents(
        r.text(
          taxTotals.find((n) => !inVatCurrency(n)),
          '.',
        ),
        'totals.taxTotal',
      ),
      taxTotalAccountingCurrency: r.cents(
        r.text(taxTotals.find(inVatCurrency), '.'),
        'totals.taxTotalAccountingCurrency',
      ),
      rounding: sum('ram:RoundingAmount', 'rounding'),
      taxInclusive: sum('ram:GrandTotalAmount', 'taxInclusive'),
      prepaid: sum('ram:TotalPrepaidAmount', 'prepaid'),
      payable: sum('ram:DuePayableAmount', 'payable'),
    },
    vatBreakdown: taxes.map((n, i) => ({
      category: r.text(n, 'ram:CategoryCode'),
      rate: r.text(n, 'ram:RateApplicablePercent'),
      taxableAmount: r.amount(n, 'ram:BasisAmount', `vatBreakdown[${i}].taxableAmount`),
      taxAmount: r.amount(n, 'ram:CalculatedAmount', `vatBreakdown[${i}].taxAmount`),
      exemptionReason: r.text(n, 'ram:ExemptionReason'),
      exemptionCode: r.text(n, 'ram:ExemptionReasonCode')?.toUpperCase(),
    })),
    lines,
  };
  return { syntax: 'cii', invoice: Invoice.parse(input), issues: r.issues };
}
