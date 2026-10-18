// The human-readable side of a Factur-X invoice: one A4 layout, drawn top to bottom, a new page
// whenever the next row does not fit. Plain on purpose: the product design of the PDF is M3
// (docs/DEFERRED.md). Every label comes from fr.json.
import { type Color, type PDFDocument, type PDFFont, type PDFPage, rgb } from '@cantoo/pdf-lib';
import { isMessageKey, type MessageKey, t } from '@fi/shared';
import type { Address, AllowanceCharge, Invoice, Line, Party, Period } from '../model';
import { frDate, frDecimal, frMoney, frPrice, frRate, groupIban } from './format';

export interface PdfFonts {
  regular: PDFFont;
  bold: PDFFont;
}

const PAGE: [number, number] = [595.28, 841.89]; // A4
const MARGIN = 48;
const WIDTH = PAGE[0] - 2 * MARGIN;
const FOOTER = 36;

const INK = rgb(0.11, 0.13, 0.12);
const MUTED = rgb(0.38, 0.42, 0.4);
const GREEN = rgb(0.04, 0.4, 0.26);
const TINT = rgb(0.9, 0.96, 0.92);
const RULE = rgb(0.8, 0.85, 0.82);

interface Run {
  text: string;
  size?: number;
  bold?: boolean;
  color?: Color;
}
type Align = 'left' | 'right';
interface Column {
  width: number;
  align: Align;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to match control characters
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F]/g;
const label = (key: string, fallback: string) => (isMessageKey(key) ? t(key) : fallback);
const lineHeight = (size: number) => size * 1.4;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

class Layout {
  readonly pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  /** Drawn at the top of each new page, after the margin (the lines table repeats its header). */
  onNewPage: (() => void) | undefined;

  constructor(
    private readonly doc: PDFDocument,
    readonly fonts: PdfFonts,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage(PAGE);
    this.pages.push(this.page);
    this.y = PAGE[1] - MARGIN;
    this.onNewPage?.();
  }

  /** Starts a new page unless `height` still fits above the footer. */
  ensure(height: number) {
    if (this.y - height < MARGIN + FOOTER) this.newPage();
  }

  font(run: Run) {
    return run.bold ? this.fonts.bold : this.fonts.regular;
  }

  /** Splits a run into lines no wider than `width`, on spaces, or inside a word too long for a line. */
  wrap(run: Run, width: number): Run[] {
    const size = run.size ?? 9;
    const font = this.font(run);
    const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
    const lines: string[] = [];
    for (const paragraph of run.text.replace(CONTROL, ' ').split('\n')) {
      let line = '';
      for (const word of paragraph.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (fits(next)) {
          line = next;
          continue;
        }
        if (line) lines.push(line);
        line = word;
        while (!fits(line) && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && !fits(line.slice(0, cut))) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
      lines.push(line);
    }
    return lines.map((text) => ({ ...run, text }));
  }

  wrapAll(runs: readonly Run[], width: number): Run[] {
    return runs.flatMap((r) => this.wrap(r, width));
  }

  static height(lines: readonly Run[]) {
    return lines.reduce((h, r) => h + lineHeight(r.size ?? 9), 0);
  }

  /** Draws wrapped lines from `top` down; returns the height used. */
  draw(lines: readonly Run[], x: number, top: number, width: number, align: Align = 'left') {
    let y = top;
    for (const r of lines) {
      const size = r.size ?? 9;
      y -= lineHeight(size);
      const font = this.font(r);
      const dx = align === 'right' ? width - font.widthOfTextAtSize(r.text, size) : 0;
      this.page.drawText(r.text, {
        x: x + dx,
        y: y + size * 0.3,
        size,
        font,
        color: r.color ?? INK,
      });
    }
    return top - y;
  }

  rect(x: number, top: number, width: number, height: number, color: Color) {
    this.page.drawRectangle({ x, y: top - height, width, height, color });
  }

  rule(top: number, x = MARGIN, width = WIDTH) {
    this.page.drawLine({
      start: { x, y: top },
      end: { x: x + width, y: top },
      thickness: 0.5,
      color: RULE,
    });
  }

  /** One table row: cells side by side from `x`, each wrapped to its column. Returns its height. */
  row(cells: readonly (readonly Run[])[], columns: readonly Column[], x = MARGIN, pad = 4) {
    const wrapped = cells.map((runs, i) => this.wrapAll(runs, (columns[i]?.width ?? 0) - 2 * pad));
    const height = Math.max(...wrapped.map(Layout.height), lineHeight(9)) + 2 * pad;
    return {
      height,
      draw: (top: number) => {
        let left = x;
        wrapped.forEach((lines, i) => {
          const col = columns[i] ?? { width: 0, align: 'left' };
          this.draw(lines, left + pad, top - pad, col.width - 2 * pad, col.align);
          left += col.width;
        });
      },
    };
  }
}

const muted = (text: string, size = 8): Run => ({ text, size, color: MUTED });
const present = <T>(v: T | undefined | false | ''): v is T =>
  v !== undefined && v !== false && v !== '';

function addressLines(a: Address | undefined): Run[] {
  if (!a) return [];
  const city = [a.postCode, a.city].filter(present).join(' ');
  return [a.line1, a.line2, a.line3, city, a.country !== 'FR' && a.country]
    .filter(present)
    .map((text) => ({ text }));
}

function partyLines(p: Party, seller: boolean): Run[] {
  const siren = p.legalId && (p.legalId.scheme ?? '0002') === '0002' ? p.legalId.id : undefined;
  const siret = p.ids.find((i) => i.scheme === '0009')?.id;
  return [
    { text: p.name ?? '', bold: true, size: seller ? 12 : 10 },
    ...addressLines(p.address),
    ...[
      siret ? t('pdf.siret', { id: siret }) : siren && t('pdf.siren', { id: siren }),
      p.vatId && t('pdf.vatId', { id: p.vatId }),
      seller && p.legalInfo,
    ]
      .filter(present)
      .map((text) => muted(text)),
  ];
}

const period = (p: Period | undefined) =>
  p?.start && p.end ? t('pdf.period', { start: frDate(p.start), end: frDate(p.end) }) : undefined;

/** "Remise : fidélité", or "Remise" alone. */
function allowanceText(a: AllowanceCharge, charge: boolean) {
  const kind = t(charge ? 'pdf.charge' : 'pdf.allowance');
  const reason = a.reason ?? a.reasonCode;
  return reason ? t('pdf.labelled', { label: kind, value: reason }) : kind;
}

/** An allowance counts against the invoice: it is shown negative. */
const signed = (a: AllowanceCharge, charge: boolean) =>
  a.amount === undefined ? undefined : charge ? a.amount : -a.amount;

const vatCell = (category: string | undefined, rate: string | undefined) =>
  rate !== undefined && (category === 'S' || Number(rate) !== 0) ? frRate(rate) : (category ?? '');

function header(l: Layout, inv: Invoice) {
  const half = WIDTH / 2 - 8;
  const seller = l.wrapAll(partyLines(inv.seller, true), half);
  const title = label(`pdf.title.${inv.typeCode}`, t('pdf.title.other'));
  const dates = [
    inv.issueDate && t('pdf.issueDate', { date: frDate(inv.issueDate) }),
    inv.dueDate && t('pdf.dueDate', { date: frDate(inv.dueDate) }),
    inv.delivery?.date && t('pdf.deliveryDate', { date: frDate(inv.delivery.date) }),
    period(inv.invoicePeriod),
  ].filter(present);
  const right = l.wrapAll(
    [
      { text: title, size: 22, bold: true, color: GREEN },
      { text: t('pdf.number', { number: inv.number ?? '' }), size: 11, bold: true },
      ...dates.map((d) => muted(d, 8.5)),
    ],
    half,
  );
  const top = l.y;
  const h = Math.max(
    l.draw(seller, MARGIN, top, half),
    l.draw(right, MARGIN + WIDTH - half, top, half, 'right'),
  );
  l.y = top - h - 18;
}

function parties(l: Layout, inv: Invoice) {
  const half = WIDTH / 2 - 8;
  const pad = 10;
  const buyer = l.wrapAll(
    [muted(t('pdf.buyer').toUpperCase(), 7.5), ...partyLines(inv.buyer, false)],
    half - 2 * pad,
  );
  const delivery = inv.delivery?.address
    ? [
        muted(t('pdf.deliverTo').toUpperCase(), 7.5),
        ...(inv.delivery.name ? [{ text: inv.delivery.name, bold: true }] : []),
        ...addressLines(inv.delivery.address),
      ]
    : [];
  const references = [
    inv.buyerReference && t('pdf.reference.buyer', { ref: inv.buyerReference }),
    inv.purchaseOrderReference && t('pdf.reference.order', { ref: inv.purchaseOrderReference }),
    inv.contractReference && t('pdf.reference.contract', { ref: inv.contractReference }),
    inv.projectReference && t('pdf.reference.project', { ref: inv.projectReference }),
    ...inv.precedingInvoices.map((p) => {
      const number = p.number ?? '';
      const date = p.issueDate && frDate(p.issueDate);
      return t('pdf.preceding', { ref: date ? t('pdf.numberDated', { number, date }) : number });
    }),
  ]
    .filter(present)
    .map((text) => muted(text, 8.5));
  const gap = delivery.length > 0 && references.length > 0 ? [muted('', 4)] : [];
  const left = l.wrapAll([...delivery, ...gap, ...references], half);

  const top = l.y;
  const boxHeight = Layout.height(buyer) + 2 * pad;
  const x = MARGIN + WIDTH - half;
  l.rect(x, top, half, boxHeight, TINT);
  l.draw(buyer, x + pad, top - pad, half - 2 * pad);
  const h = Math.max(boxHeight, l.draw(left, MARGIN, top - pad, half) + pad);
  l.y = top - h - 20;
}

const LINE_COLUMNS: Column[] = [
  { width: WIDTH - 285, align: 'left' },
  { width: 70, align: 'right' },
  { width: 85, align: 'right' },
  { width: 50, align: 'right' },
  { width: 80, align: 'right' },
];

function lineCells(line: Line, currency: string): Run[][] {
  const unit = line.unitCode ? label(`unit.${line.unitCode}`, line.unitCode) : '';
  const base = line.price.baseQuantity;
  const price =
    line.price.net === undefined
      ? ''
      : `${frPrice(line.price.net, currency)}${base && base !== '1' ? ` / ${frDecimal(base)}` : ''}`;
  const adjustment = (a: AllowanceCharge, charge: boolean) => {
    const amount = signed(a, charge);
    const text = allowanceText(a, charge);
    return amount === undefined ? text : `${text} (${frMoney(amount, currency)})`;
  };
  const details = [
    line.item.description,
    line.note,
    period(line.period),
    ...line.allowances.map((a) => adjustment(a, false)),
    ...line.charges.map((c) => adjustment(c, true)),
  ].filter(present);
  return [
    [{ text: line.item.name ?? '' }, ...details.map((d) => muted(d, 7.5))],
    [{ text: line.quantity === undefined ? '' : `${frDecimal(line.quantity)} ${unit}`.trim() }],
    [{ text: price }],
    [{ text: vatCell(line.vat.category, line.vat.rate) }],
    [{ text: line.netAmount === undefined ? '' : frMoney(line.netAmount, currency) }],
  ];
}

function lines(l: Layout, inv: Invoice) {
  const currency = inv.currency ?? 'EUR';
  const head = () => {
    const keys: MessageKey[] = [
      'pdf.col.description',
      'pdf.col.quantity',
      'pdf.col.unitPrice',
      'pdf.col.vat',
      'pdf.col.total',
    ];
    const row = l.row(
      keys.map((k) => [{ text: t(k), size: 7.5, bold: true, color: GREEN }]),
      LINE_COLUMNS,
    );
    l.rect(MARGIN, l.y, WIDTH, row.height, TINT);
    row.draw(l.y);
    l.y -= row.height;
  };
  const rows = [
    ...inv.lines.map((line) => lineCells(line, currency)),
    ...[
      ...inv.allowances.map((a) => [a, false] as const),
      ...inv.charges.map((c) => [c, true] as const),
    ].map(([a, charge]) => {
      const amount = signed(a, charge);
      return [
        [{ text: allowanceText(a, charge) }],
        [],
        [],
        [{ text: vatCell(a.vatCategory, a.vatRate) }],
        [{ text: amount === undefined ? '' : frMoney(amount, currency) }],
      ];
    }),
  ];

  head();
  l.onNewPage = head;
  for (const cells of rows) {
    const row = l.row(cells, LINE_COLUMNS);
    l.ensure(row.height);
    row.draw(l.y);
    l.y -= row.height;
    l.rule(l.y);
  }
  l.onNewPage = undefined;
  l.y -= 16;
}

function vatAndTotals(l: Layout, inv: Invoice) {
  const currency = inv.currency ?? 'EUR';
  const money = (c: number) => frMoney(c, currency);
  const totalsWidth = 200;
  const vatWidth = WIDTH - totalsWidth - 24;
  const vatColumns: Column[] = [
    { width: vatWidth - 160, align: 'left' },
    { width: 80, align: 'right' },
    { width: 80, align: 'right' },
  ];
  // The exemption (BT-120, BT-121) runs under its row across the table; no rule in between.
  const vatRows = [
    {
      ...l.row(
        [t('pdf.vat.title'), t('pdf.vat.base'), t('pdf.vat.amount')].map((text) => [
          { text, size: 7.5, bold: true, color: GREEN },
        ]),
        vatColumns,
      ),
      ruled: true,
    },
    ...inv.vatBreakdown.flatMap((b) => {
      // "20 %" for standard rated VAT; otherwise the category says why: "Autoliquidation".
      const category =
        b.category === 'S' && b.rate !== undefined
          ? frRate(b.rate)
          : capitalize(b.category ? label(`vatCategory.${b.category}`, b.category) : '');
      const exemption = [b.exemptionReason, b.exemptionCode && `(${b.exemptionCode})`]
        .filter(present)
        .join(' ');
      const row = l.row(
        [
          [{ text: category }],
          [{ text: b.taxableAmount === undefined ? '' : money(b.taxableAmount) }],
          [{ text: b.taxAmount === undefined ? '' : money(b.taxAmount) }],
        ],
        vatColumns,
      );
      if (!exemption) return [{ ...row, ruled: true }];
      const under = l.row(
        [[muted(exemption, 7.5)]],
        [{ width: vatWidth, align: 'left' }],
        MARGIN,
        3,
      );
      return [
        { ...row, ruled: false },
        { ...under, ruled: true },
      ];
    }),
  ];

  const tt = inv.totals;
  const hasAdjustments = tt.allowanceTotal !== undefined || tt.chargeTotal !== undefined;
  const totalColumns: Column[] = [
    { width: totalsWidth - 90, align: 'left' },
    { width: 90, align: 'right' },
  ];
  const vatCurrency = inv.vatCurrency !== currency ? inv.vatCurrency : undefined;
  const entries: [string, number | undefined, string?][] = [
    [t('pdf.totals.lines'), hasAdjustments ? tt.lineTotal : undefined],
    [t('pdf.totals.allowances'), tt.allowanceTotal === undefined ? undefined : -tt.allowanceTotal],
    [t('pdf.totals.charges'), tt.chargeTotal],
    [t('pdf.totals.taxExclusive'), tt.taxExclusive],
    [t('pdf.totals.tax'), tt.taxTotal],
    ...(vatCurrency
      ? [
          [
            t('pdf.totals.taxAccounting', { currency: vatCurrency }),
            tt.taxTotalAccountingCurrency,
            vatCurrency,
          ] as [string, number | undefined, string],
        ]
      : []),
    [t('pdf.totals.taxInclusive'), tt.taxInclusive],
    [t('pdf.totals.prepaid'), tt.prepaid],
    [t('pdf.totals.rounding'), tt.rounding],
  ];
  const totalRows = entries.flatMap(([text, cents, other]) =>
    cents === undefined
      ? []
      : [
          l.row(
            [[{ text }], [{ text: other ? frMoney(cents, other) : money(cents) }]],
            totalColumns,
            MARGIN + WIDTH - totalsWidth,
            3,
          ),
        ],
  );
  const payable =
    tt.payable === undefined
      ? undefined
      : l.row(
          [
            [{ text: t('pdf.totals.payable'), bold: true, size: 10.5, color: GREEN }],
            [{ text: money(tt.payable), bold: true, size: 10.5, color: GREEN }],
          ],
          totalColumns,
          MARGIN + WIDTH - totalsWidth,
          6,
        );

  const sum = (rows: { height: number }[]) => rows.reduce((h, r) => h + r.height, 0);
  const vatHeight = sum(vatRows);
  const totalsHeight = sum(totalRows) + (payable ? payable.height + 4 : 0);
  l.ensure(Math.max(vatHeight, totalsHeight));

  const top = l.y;
  let y = top;
  vatRows.forEach((r, i) => {
    if (i === 0) l.rect(MARGIN, y, vatWidth, r.height, TINT);
    r.draw(y);
    y -= r.height;
    if (r.ruled) l.rule(y, MARGIN, vatWidth);
  });
  y = top;
  for (const r of totalRows) {
    r.draw(y);
    y -= r.height;
  }
  if (payable) {
    y -= 4;
    l.rect(MARGIN + WIDTH - totalsWidth, y, totalsWidth, payable.height, TINT);
    payable.draw(y);
  }
  l.y = top - Math.max(vatHeight, totalsHeight) - 20;
}

/** A titled block of free lines, kept together on one page when it fits. */
function section(l: Layout, title: string, runs: Run[]) {
  if (runs.length === 0) return;
  const lines = l.wrapAll([{ text: title, bold: true, size: 9.5, color: GREEN }, ...runs], WIDTH);
  for (const [i, line] of lines.entries()) {
    // The title never ends a page alone.
    l.ensure(lineHeight(line.size ?? 9) * (i === 0 ? 3 : 1));
    l.y -= l.draw([line], MARGIN, l.y, WIDTH);
  }
  l.y -= 12;
}

function payment(l: Layout, inv: Invoice) {
  const p = inv.payment;
  const means = p?.meansCode ? label(`meansCode.${p.meansCode}`, p.meansText ?? '') : p?.meansText;
  section(
    l,
    t('pdf.payment.title'),
    [
      means,
      ...(p?.accounts ?? []).flatMap((a) => [
        a.iban && t('pdf.payment.iban', { iban: groupIban(a.iban) }),
        a.bic && t('pdf.payment.bic', { bic: a.bic }),
        a.name && t('pdf.payment.accountName', { name: a.name }),
      ]),
      p?.remittanceInfo && t('pdf.payment.reference', { ref: p.remittanceInfo }),
      inv.paymentTerms,
    ]
      .filter(present)
      .map((text) => ({ text, size: 8.5 })),
  );
}

function footer(l: Layout) {
  const total = l.pages.length;
  const pageWidth = 60;
  l.pages.forEach((page, i) => {
    l.page = page;
    const top = MARGIN + FOOTER - 12;
    l.rule(top);
    const note = l.wrap(muted(t('pdf.footer'), 7), WIDTH - pageWidth - 12);
    l.draw(note, MARGIN, top - 2, WIDTH - pageWidth - 12);
    l.draw(
      [muted(t('pdf.page', { page: i + 1, pages: total }), 7)],
      MARGIN + WIDTH - pageWidth,
      top - 2,
      pageWidth,
      'right',
    );
  });
}

/** Draws the invoice on new pages of `doc`. */
export function renderInvoice(doc: PDFDocument, fonts: PdfFonts, inv: Invoice): void {
  const l = new Layout(doc, fonts);
  header(l, inv);
  parties(l, inv);
  lines(l, inv);
  vatAndTotals(l, inv);
  payment(l, inv);
  section(
    l,
    t('pdf.notes'),
    inv.notes.map((n) => ({ text: n.text, size: 8 })),
  );
  footer(l);
}
