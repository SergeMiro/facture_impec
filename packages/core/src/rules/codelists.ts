// BR-CL: values must come from the code lists of the CEN artefacts (src/codelists/generated.ts).
// Code lists that only apply to attributes the model does not have (BR-CL-05 amount currency,
// BR-CL-06 BT-8 code, BR-CL-07 object identifier, BR-CL-13 item classification, BR-CL-24 MIME,
// BR-CL-26 delivery location) are listed in docs/RULES.md as not applicable.
import {
  allowanceReasonCodes,
  chargeReasonCodes,
  countryCodes,
  currencyCodes,
  easCodes,
  icdCodes,
  invoiceTypeCodes,
  noteSubjectCodes,
  paymentMeansCodes,
  unitCodes,
  vatCategoryCodes,
  vatexCodes,
} from '../codelists/generated';
import type { Invoice } from '../model';
import type { Finding, Rule } from './types';
import { docAllowanceCharges, finding, lineAllowanceCharges, parties, present, rule } from './util';

type Value = { path: string; value: string | undefined };

const base = {
  severity: 'error',
  source: 'EN16931',
  autoFixable: false,
  messageKey: 'BR-CL',
} as const;

/** One finding per present value that is not in the list. */
const outside =
  (list: ReadonlySet<string>, values: (inv: Invoice) => Value[]) =>
  (inv: Invoice): Finding[] =>
    values(inv)
      .filter((v): v is { path: string; value: string } => present(v.value) && !list.has(v.value))
      .map((v) => finding(v.path, { value: v.value }));

const addressCountries = (inv: Invoice): Value[] => [
  { path: 'seller.address.country', value: inv.seller.address?.country },
  { path: 'buyer.address.country', value: inv.buyer.address?.country },
  { path: 'delivery.address.country', value: inv.delivery?.address?.country },
];

export const CODELIST_RULES: Rule[] = [
  rule({
    ...base,
    id: 'BR-CL-01',
    scope: 'document',
    bt: ['BT-3'],
    summary: 'The invoice type code is in UNTDID 1001.',
    check: outside(invoiceTypeCodes, (inv) => [{ path: 'typeCode', value: inv.typeCode }]),
  }),
  rule({
    ...base,
    id: 'BR-CL-03',
    scope: 'document',
    bt: ['BT-5'],
    summary: 'The invoice currency is an ISO 4217 code.',
    check: outside(currencyCodes, (inv) => [{ path: 'currency', value: inv.currency }]),
  }),
  rule({
    ...base,
    id: 'BR-CL-04',
    scope: 'document',
    bt: ['BT-6'],
    summary: 'The VAT accounting currency is an ISO 4217 code.',
    check: outside(currencyCodes, (inv) => [{ path: 'vatCurrency', value: inv.vatCurrency }]),
  }),
  rule({
    ...base,
    id: 'BR-CL-08',
    scope: 'notes',
    bt: ['BT-21'],
    summary: 'Note subject codes are in UNTDID 4451.',
    check: outside(noteSubjectCodes, (inv) =>
      inv.notes.map((n, i) => ({ path: `notes[${i}].subjectCode`, value: n.subjectCode })),
    ),
  }),
  rule({
    ...base,
    id: 'BR-CL-10',
    scope: 'document',
    bt: ['BT-29-1', 'BT-46-1'],
    summary: 'Party identifier schemes are in the ISO 6523 ICD list.',
    check: outside(icdCodes, (inv) =>
      parties(inv).flatMap(({ key, party }) =>
        party.ids.map((id, i) => ({ path: `${key}.ids[${i}].scheme`, value: id.scheme })),
      ),
    ),
  }),
  rule({
    ...base,
    id: 'BR-CL-11',
    scope: 'document',
    bt: ['BT-30-1', 'BT-47-1'],
    summary: 'Legal registration identifier schemes are in the ISO 6523 ICD list.',
    check: outside(icdCodes, (inv) =>
      parties(inv).map(({ key, party }) => ({
        path: `${key}.legalId.scheme`,
        value: party.legalId?.scheme,
      })),
    ),
  }),
  rule({
    ...base,
    id: 'BR-CL-14',
    scope: 'document',
    bt: ['BT-40', 'BT-55', 'BT-80'],
    summary: 'Address country codes are ISO 3166-1 alpha-2.',
    check: outside(countryCodes, addressCountries),
  }),
  rule({
    ...base,
    id: 'BR-CL-15',
    scope: 'lines',
    bt: ['BT-159'],
    summary: 'Item country of origin codes are ISO 3166-1 alpha-2.',
    check: outside(countryCodes, (inv) =>
      inv.lines.map((l, i) => ({
        path: `lines[${i}].item.originCountry`,
        value: l.item.originCountry,
      })),
    ),
  }),
  rule({
    ...base,
    id: 'BR-CL-16',
    scope: 'payment',
    bt: ['BT-81'],
    summary: 'The payment means code is in UNTDID 4461.',
    check: outside(paymentMeansCodes, (inv) => [
      { path: 'payment.meansCode', value: inv.payment?.meansCode },
    ]),
  }),
  rule({
    ...base,
    id: 'BR-CL-17',
    scope: 'vat',
    bt: ['BT-95', 'BT-102'],
    summary: 'Document level allowance and charge VAT categories are in UNTDID 5305 (CEN subset).',
    check: outside(vatCategoryCodes, (inv) =>
      docAllowanceCharges(inv).map((a) => ({
        path: `${a.path}.vatCategory`,
        value: a.item.vatCategory,
      })),
    ),
  }),
  rule({
    ...base,
    id: 'BR-CL-18',
    scope: 'vat',
    bt: ['BT-151', 'BT-118'],
    summary: 'Line and VAT breakdown categories are in UNTDID 5305 (CEN subset).',
    check: outside(vatCategoryCodes, (inv) => [
      ...inv.lines.map((l, i) => ({ path: `lines[${i}].vat.category`, value: l.vat.category })),
      ...inv.vatBreakdown.map((b, i) => ({
        path: `vatBreakdown[${i}].category`,
        value: b.category,
      })),
    ]),
  }),
  rule({
    ...base,
    id: 'BR-CL-19',
    scope: 'totals',
    bt: ['BT-98', 'BT-140'],
    summary: 'Allowance reason codes are in UNTDID 5189.',
    check: outside(allowanceReasonCodes, (inv) =>
      [...docAllowanceCharges(inv), ...lineAllowanceCharges(inv)]
        .filter((a) => a.kind === 'allowance')
        .map((a) => ({ path: `${a.path}.reasonCode`, value: a.item.reasonCode })),
    ),
  }),
  rule({
    ...base,
    id: 'BR-CL-20',
    scope: 'totals',
    bt: ['BT-105', 'BT-145'],
    summary: 'Charge reason codes are in UNTDID 7161.',
    check: outside(chargeReasonCodes, (inv) =>
      [...docAllowanceCharges(inv), ...lineAllowanceCharges(inv)]
        .filter((a) => a.kind === 'charge')
        .map((a) => ({ path: `${a.path}.reasonCode`, value: a.item.reasonCode })),
    ),
  }),
  rule({
    ...base,
    id: 'BR-CL-21',
    scope: 'lines',
    bt: ['BT-157-1'],
    summary: 'Item standard identifier schemes are in the ISO 6523 ICD list.',
    check: outside(icdCodes, (inv) =>
      inv.lines.map((l, i) => ({
        path: `lines[${i}].item.standardId.scheme`,
        value: l.item.standardId?.scheme,
      })),
    ),
  }),
  rule({
    ...base,
    id: 'BR-CL-22',
    scope: 'vat',
    bt: ['BT-121'],
    summary: 'VAT exemption reason codes are in the CEF VATEX list.',
    check: outside(vatexCodes, (inv) =>
      inv.vatBreakdown.map((b, i) => ({
        path: `vatBreakdown[${i}].exemptionCode`,
        value: b.exemptionCode,
      })),
    ),
  }),
  rule({
    ...base,
    id: 'BR-CL-23',
    scope: 'lines',
    bt: ['BT-130', 'BT-150'],
    summary: 'Unit codes are in UN/ECE Recommendations 20 and 21.',
    check: outside(unitCodes, (inv) =>
      inv.lines.flatMap((l, i) => [
        { path: `lines[${i}].unitCode`, value: l.unitCode },
        { path: `lines[${i}].price.baseUnitCode`, value: l.price.baseUnitCode },
      ]),
    ),
  }),
  rule({
    ...base,
    id: 'BR-CL-25',
    scope: 'document',
    bt: ['BT-34-1', 'BT-49-1'],
    summary: 'Electronic address schemes are in the CEF EAS list.',
    check: outside(easCodes, (inv) =>
      parties(inv).map(({ key, party }) => ({
        path: `${key}.electronicAddress.scheme`,
        value: party.electronicAddress?.scheme,
      })),
    ),
  }),
];
