// Checker (R2): rules on the registry's documents together, once the Linker said which order each
// invoice bills. Each finding is a rule in this file, with the cents at stake and the cells that prove
// it; the wording's values are written in French here, the sentences live in fr.json.
import { daysBetween } from '../dates';
import { isDecimal, lineAmount, normalizeDecimal, percentOf } from '../money';
import { partyKey } from '../party';
import { frDate, frDecimal, frMoney, frPrice } from '../pdf/format';
import { isInvoice, itemQuantities, linkDocs, linkId, quantityOf } from './link';
import {
  type CheckDoc,
  type CheckFinding,
  type CheckInput,
  type CheckLine,
  type CheckMessage,
  type CheckOutput,
  type Evidence,
  type Link,
  ruleOf,
  SEVERITY,
} from './types';

/** Cents: under 1 €, a rounding, not money worth a person's look. */
export const NOISE = 100;
/** A delivery note not invoiced after this many days is money waiting (B3). */
export const UNBILLED_DAYS = 30;
/** A rate is an article's usual one from this many earlier lines, nearly all at that rate (A4). */
const USUAL_LINES = 3;
const USUAL_SHARE = 0.8;

const money = (cents: number) => frMoney(cents);
const text = (s: string | null | undefined) => s ?? '';
const rateText = (line: CheckLine) => frDecimal(text(line.vatRate));
const byDate = (a: CheckDoc, b: CheckDoc) =>
  text(a.issueDate).localeCompare(text(b.issueDate)) || (a.id < b.id ? -1 : 1);
const quantityText = (n: number) => frDecimal(String(Math.round(n * 10_000) / 10_000));
/** A unit price in cents, kept with its fractions: 39.995 € is 3999.5. */
const unitCents = (price: string | null) =>
  price !== null && isDecimal(price) ? Number(price) * 100 : null;
const unitText = (cents: number) => frPrice(String(Math.round(cents * 100) / 10_000));
const near = (a: number, b: number, tolerance = 1) => Math.abs(a - b) <= tolerance;
const positiveRate = (rate: string | null) =>
  rate !== null && isDecimal(rate) && Number(rate) > 0 ? rate : null;

function finding(
  message: CheckMessage,
  doc: CheckDoc,
  key: string,
  amount: number | null,
  params: Record<string, string>,
  evidence: Evidence[],
): CheckFinding {
  return {
    rule: ruleOf(message),
    severity: SEVERITY[message],
    message,
    docId: doc.id,
    key: `${ruleOf(message)}:${key}`,
    amount,
    params,
    evidence,
  };
}

const evidenceOf = (
  role: Evidence['role'],
  doc: CheckDoc,
  line?: CheckLine,
  cell: 'priceCell' | 'rateCell' | 'cell' = 'cell',
): Evidence => ({
  role,
  docId: doc.id,
  number: doc.number,
  cell: (line ?? doc.lines[0])?.[cell] ?? line?.cell ?? null,
});

/** Who a finding about several invoices goes on: one that can still change, the latest first. */
function subjectOf(invoices: readonly CheckDoc[]): CheckDoc | undefined {
  const latest = (list: readonly CheckDoc[]) => [...list].sort(byDate).at(-1);
  return latest(invoices.filter((i) => !i.locked)) ?? latest(invoices);
}

const sign = (doc: CheckDoc) => (doc.typeCode === '381' ? -1 : 1);

/**
 * A line's net amount, its VAT taken out when a sheet wrote the TTC in the amount column (A1): the
 * amount equals quantity × price × (1 + rate). Only a sheet's own documents: an invoice's amounts are
 * computed.
 */
function sheetNet(doc: CheckDoc, line: CheckLine): { net: number | null; inclVat: number | null } {
  const rate = positiveRate(line.vatRate);
  if (doc.kind === 'invoice' || line.netAmount === null || !rate || !line.quantity) {
    return { net: line.netAmount, inclVat: null };
  }
  const ht = line.netPrice ? lineAmount(line.quantity, line.netPrice) : null;
  if (ht === null || ht === line.netAmount) return { net: line.netAmount, inclVat: null };
  const vat = percentOf(ht, rate);
  return vat !== null && near(line.netAmount, ht + vat)
    ? { net: ht, inclVat: line.netAmount }
    : { net: line.netAmount, inclVat: null };
}

interface Part {
  doc: CheckDoc;
  line: CheckLine;
  quantity: number;
  net: number;
}

interface Total {
  quantity: number;
  net: number;
  parts: Part[];
}

/** Quantity and net amount of each article over documents, a credit note counted against. */
function totals(docs: readonly CheckDoc[]): Map<string, Total> {
  const found = new Map<string, Total>();
  for (const doc of docs) {
    for (const line of doc.lines) {
      const quantity = quantityOf(line.quantity);
      const { net } = sheetNet(doc, line);
      if (!line.itemId || quantity === null || net === null) continue;
      const t = found.get(line.itemId) ?? { quantity: 0, net: 0, parts: [] };
      t.quantity += sign(doc) * quantity;
      t.net += sign(doc) * net;
      t.parts.push({ doc, line, quantity, net });
      found.set(line.itemId, t);
    }
  }
  return found;
}

/** The invoice's price is the reference's with the VAT on top (A1). */
function vatOnTop(part: Part, reference: number): boolean {
  const price = unitCents(part.line.netPrice);
  const rate = positiveRate(part.line.vatRate);
  return price !== null && rate !== null && near(price, reference * (1 + Number(rate) / 100), 0.5);
}

/** The price already lowered to the reference minus the discount, and the discount taken again (A3). */
function discountTwice(part: Part, reference: number): boolean {
  const price = unitCents(part.line.netPrice);
  const off = part.line.discount;
  if (price === null || !off || price >= reference) return false;
  return near(off, Math.round((reference - price) * part.quantity));
}

class World {
  readonly byId: Map<string, CheckDoc>;
  readonly findings: CheckFinding[] = [];
  /** Invoice lines whose article an order settles: the price list does not judge them (A5). */
  readonly ordered = new Set<string>();
  readonly billedBy = new Map<string, CheckDoc[]>();
  readonly fulfilledBy = new Map<string, CheckDoc[]>();

  constructor(
    readonly docs: readonly CheckDoc[],
    readonly links: readonly Link[],
    readonly today: string,
  ) {
    this.byId = new Map(docs.map((d) => [d.id, d]));
    for (const l of links) {
      if (l.status !== 'auto' && l.status !== 'confirmed') continue;
      const from = this.byId.get(l.fromDocId);
      const to = this.byId.get(l.toDocId);
      if (!from || !to) continue;
      if (l.kind === 'cost') continue;
      const map = l.kind === 'billed_by' ? this.billedBy : this.fulfilledBy;
      const target = l.kind === 'billed_by' ? from.id : to.id;
      const other = l.kind === 'billed_by' ? to : from;
      map.set(target, [...(map.get(target) ?? []), other]);
    }
  }

  run(): CheckFinding[] {
    this.sheetChecks();
    this.sheetDocs();
    for (const d of this.docs) {
      if (d.kind === 'order' || (d.kind === 'delivery' && this.billedBy.has(d.id))) this.source(d);
    }
    this.priceList();
    this.usualRate();
    this.deliveries();
    this.parties();
    return this.findings;
  }

  /** A1–A3 found in the invoice's own sheet. */
  sheetChecks() {
    for (const doc of this.docs.filter(isInvoice)) {
      for (const c of doc.sheetChecks ?? []) {
        this.findings.push(
          finding(c.message, doc, `${doc.id}:${c.cell}:${c.message}`, c.amount, c.params, [
            { role: 'invoice', docId: doc.id, number: doc.number, cell: c.cell },
          ]),
        );
      }
    }
  }

  /** A1 on an order sheet: its amounts hold the VAT, the checks below use quantity × price. */
  sheetDocs() {
    for (const doc of this.docs.filter((d) => d.kind === 'order')) {
      for (const line of doc.lines) {
        const { net, inclVat } = sheetNet(doc, line);
        if (inclVat === null || net === null) continue;
        this.findings.push(
          finding(
            'A1.order',
            doc,
            `${doc.id}:${line.position}`,
            inclVat - net,
            {
              order: text(doc.number),
              item: text(line.name),
              sheet: money(inclVat),
              computed: money(net),
              rate: rateText(line),
            },
            [evidenceOf('order', doc, line)],
          ),
        );
      }
    }
  }

  /**
   * B1, B4, B5 (A1, A3 when the invoice's own price explains it): what an order, or a delivery note
   * billed directly, announced against what its invoices bill.
   */
  source(source: CheckDoc) {
    const linked = (this.billedBy.get(source.id) ?? []).filter(isInvoice);
    if (linked.length === 0) return;
    const role = source.kind === 'order' ? 'order' : 'delivery';
    const sourceText =
      `${role === 'order' ? 'la commande' : 'le bon de livraison'} ${text(source.number)}`.trim();
    const ordered = totals([source]);
    const billed = totals(linked.filter((i) => i.typeCode !== '386'));
    let found = false;
    for (const [item, o] of ordered) {
      for (const inv of linked) this.ordered.add(`${inv.id}:${item}`);
      const b = billed.get(item);
      const orderPart = o.parts[0];
      if (!b || !orderPart || o.quantity <= 0 || b.quantity <= 0) continue;
      const invoices = [...new Set(b.parts.filter((p) => sign(p.doc) > 0).map((p) => p.doc))];
      const subject = subjectOf(invoices);
      const part = b.parts.find((p) => p.doc === subject);
      if (!subject || !part) continue;
      const reference = o.net / o.quantity;
      const expected = Math.round(reference * b.quantity);
      const alone = invoices.length === 1;
      const params = {
        invoice: text(subject.number),
        invoices: invoices.map((i) => text(i.number)).join(', '),
        order: text(source.number),
        source: sourceText,
        item: text(part.line.name ?? orderPart.line.name),
        quantity: quantityText(b.quantity),
        ordered: quantityText(o.quantity),
        invoiced: money(b.net),
        expected: money(expected),
        price: unitText(unitCents(part.line.netPrice) ?? b.net / b.quantity),
        reference: unitText(reference),
        rate: rateText(part.line),
        discount: money(Number(part.line.discount)),
      };
      const evidence = [
        ...invoices.filter((i) => i !== subject).map((i) => evidenceOf('invoice', i)),
        evidenceOf('invoice', subject, part.line, 'priceCell'),
        evidenceOf(role, source, orderPart.line),
      ];
      const report = (message: CheckMessage, amount: number) => {
        found = true;
        this.findings.push(
          finding(
            message,
            subject,
            `${source.id}:${item}`,
            amount,
            { ...params, amount: money(amount) },
            evidence,
          ),
        );
      };
      if (b.quantity > o.quantity + 1e-9) {
        const over = Math.round((b.net * (b.quantity - o.quantity)) / b.quantity);
        if (over >= NOISE) report(alone ? 'B4.quantity' : 'B5.lines', over);
      } else if (expected - b.net >= NOISE) {
        if (alone && discountTwice(part, reference))
          report('A3.reference', Number(part.line.discount));
        else report(alone ? 'B1.under' : 'B1.several', expected - b.net);
      } else if (b.net - expected >= NOISE) {
        if (alone && vatOnTop(part, reference)) report('A1.price', b.net - expected);
        else report(alone ? 'B4.price' : 'B4.several', b.net - expected);
      }
    }
    if (!found) this.advances(source, linked, sourceText);
  }

  /** B5: the order's invoices and advances together bill more than the order. */
  advances(order: CheckDoc, linked: readonly CheckDoc[], source: string) {
    // An invoice that bills several orders says nothing about this one alone.
    const only = linked.filter(
      (i) => [...this.billedBy.entries()].filter(([, invs]) => invs.includes(i)).length === 1,
    );
    const advance = only.some((i) => i.typeCode === '386');
    const invoices = only.filter((i) => i.typeCode !== '386' && i.typeCode !== '381');
    if (!advance && invoices.length < 2) return;
    const nets = order.lines.map((l) => sheetNet(order, l).net);
    // Every amount known, or nothing to say.
    if (nets.length === 0 || nets.includes(null) || only.some((i) => i.netTotal === null)) return;
    const ordered = nets.reduce<number>((s, n) => s + Number(n), 0);
    const billed = only.reduce((s, i) => {
      const net = Number(i.netTotal);
      if (i.typeCode === '381') return s - net;
      return s + (i.typeCode === '386' ? net : net - Number(i.prepaid));
    }, 0);
    const over = billed - ordered;
    const subject = subjectOf(only);
    if (over < NOISE || !subject) return;
    this.findings.push(
      finding(
        'B5.total',
        subject,
        `${order.id}:total`,
        over,
        {
          order: text(order.number),
          source,
          invoices: only.map((i) => text(i.number)).join(', '),
          billed: money(billed),
          ordered: money(ordered),
          amount: money(over),
        },
        [
          ...only.map((i) => evidenceOf('invoice', i)),
          evidenceOf(order.kind === 'order' ? 'order' : 'delivery', order),
        ],
      ),
    );
  }

  /** A5 (A1, A3 when the price explains it): an invoice line no order settles, against « Tarifs ». */
  priceList() {
    const prices = new Map<string, { doc: CheckDoc; line: CheckLine; unit: number }>();
    const lists = this.docs.filter((d) => d.kind === 'price_list').sort(byDate);
    for (const doc of lists) {
      for (const line of doc.lines) {
        const unit = unitCents(line.netPrice);
        if (line.itemId && unit !== null) prices.set(line.itemId, { doc, line, unit });
      }
    }
    if (prices.size === 0) return;
    for (const inv of this.docs.filter(isInvoice)) {
      if (inv.typeCode === '381' || inv.typeCode === '386') continue;
      for (const line of inv.lines) {
        const list = prices.get(text(line.itemId));
        const price = unitCents(line.netPrice);
        const quantity = quantityOf(line.quantity);
        if (!list || price === null || quantity === null || quantity <= 0) continue;
        if (this.ordered.has(`${inv.id}:${line.itemId}`) || near(price, list.unit, 0.5)) continue;
        const part = { doc: inv, line, quantity, net: Number(line.netAmount) };
        const params = {
          invoice: text(inv.number),
          item: text(line.name ?? list.line.name),
          price: unitText(price),
          reference: unitText(list.unit),
          quantity: quantityText(quantity),
          source: `la feuille « ${text(list.doc.sheet)} »`,
          rate: rateText(line),
          discount: money(Number(line.discount)),
        };
        const evidence = [
          evidenceOf('invoice', inv, line, 'priceCell'),
          evidenceOf('price_list', list.doc, list.line),
        ];
        const key = `${inv.id}:${line.position}`;
        let message: CheckMessage = 'A5.price';
        let amount = Math.round(Math.abs(list.unit - price) * quantity);
        if (vatOnTop(part, list.unit)) {
          message = 'A1.price';
          amount = Math.round((price - list.unit) * quantity);
        } else if (discountTwice(part, list.unit)) {
          message = 'A3.reference';
          amount = Number(line.discount);
        } else if (amount < NOISE) {
          continue;
        }
        this.findings.push(
          finding(message, inv, key, amount, { ...params, amount: money(amount) }, evidence),
        );
      }
    }
  }

  /** A4: an article's VAT rate other than the one nearly all its earlier invoices use. */
  usualRate() {
    const invoices = this.docs.filter((d) => isInvoice(d) && d.typeCode !== '386');
    const counts = new Map<
      string,
      Map<string, { count: number; doc: CheckDoc; line: CheckLine }>
    >();
    const rateOf = (line: CheckLine) =>
      line.vatRate !== null && isDecimal(line.vatRate) ? normalizeDecimal(line.vatRate) : null;
    for (const doc of invoices) {
      for (const line of doc.lines) {
        const rate = rateOf(line);
        if (!line.itemId || rate === null) continue;
        const per = counts.get(line.itemId) ?? new Map();
        const c = per.get(rate) ?? { count: 0, doc, line };
        per.set(rate, { count: c.count + 1, doc, line });
        counts.set(line.itemId, per);
      }
    }
    for (const doc of invoices) {
      if (doc.typeCode === '381') continue;
      const own = new Map<string, Map<string, number>>();
      for (const line of doc.lines) {
        const rate = rateOf(line);
        if (!line.itemId || rate === null) continue;
        const per = own.get(line.itemId) ?? new Map<string, number>();
        per.set(rate, (per.get(rate) ?? 0) + 1);
        own.set(line.itemId, per);
      }
      for (const line of doc.lines) {
        const rate = rateOf(line);
        const item = text(line.itemId);
        const per = counts.get(item);
        if (!per || rate === null) continue;
        const others = [...per.entries()]
          .map(([r, c]) => ({
            rate: r,
            ...c,
            count: c.count - (own.get(item)?.get(r) ?? 0),
          }))
          .filter((c) => c.count > 0)
          .sort((a, b) => b.count - a.count);
        const total = others.reduce((s, c) => s + c.count, 0);
        const usual = others[0];
        if (!usual || total < USUAL_LINES || usual.count / total < USUAL_SHARE) continue;
        if (usual.rate === rate || line.netAmount === null) continue;
        const amount = Math.abs(
          Math.round((line.netAmount * (Number(usual.rate) - Number(rate))) / 100),
        );
        this.findings.push(
          finding(
            'A4.rate',
            doc,
            `${doc.id}:${line.position}`,
            amount,
            {
              invoice: text(doc.number),
              item: text(line.name),
              rate: frDecimal(rate),
              usual: frDecimal(usual.rate),
              count: String(usual.count),
              amount: money(amount),
            },
            [
              evidenceOf('invoice', doc, line, 'rateCell'),
              evidenceOf('history', usual.doc, usual.line),
            ],
          ),
        );
      }
    }
  }

  /** B3: what delivery notes delivered and no invoice billed, once it waited 30 days. */
  deliveries() {
    const deliveries = this.docs.filter((d) => d.kind === 'delivery');
    const orderOf = new Map<string, CheckDoc>();
    for (const [orderId, notes] of this.fulfilledBy) {
      const order = this.byId.get(orderId);
      for (const n of notes) if (order) orderOf.set(n.id, order);
    }
    const byOrder = new Map<string, CheckDoc[]>();
    for (const d of deliveries) {
      const order = orderOf.get(d.id);
      const k = order ? order.id : `alone:${d.id}`;
      byOrder.set(k, [...(byOrder.get(k) ?? []), d]);
    }
    for (const [k, notes] of byOrder) {
      const order = this.byId.get(k);
      // The order's invoices, and those that bill one of its delivery notes directly.
      const billers = new Set(
        [order?.id, ...notes.map((n) => n.id)].flatMap((id) => (id && this.billedBy.get(id)) || []),
      );
      const invoiced = totals([...billers].filter((i) => isInvoice(i) && i.typeCode !== '386'));
      const orderTotals = order ? totals([order]) : new Map<string, Total>();
      const left = new Map<string, number>();
      for (const [item, t] of invoiced) left.set(item, t.quantity);
      for (const note of [...notes].sort(byDate)) {
        let amount = 0;
        let unknown = false;
        let open = 0;
        for (const [item, q] of itemQuantities(note)) {
          if (q === null || q <= 0) continue;
          const covered = Math.min(q, Math.max(0, left.get(item) ?? 0));
          left.set(item, (left.get(item) ?? 0) - covered);
          const missing = q - covered;
          if (missing <= 1e-9) continue;
          open++;
          const line = note.lines.find((l) => l.itemId === item && l.netPrice !== null);
          const o = orderTotals.get(item);
          const unit =
            unitCents(text(line?.netPrice)) ?? (o && o.quantity > 0 ? o.net / o.quantity : null);
          if (unit === null) unknown = true;
          else amount += Math.round(unit * missing);
        }
        if (open === 0 || !note.issueDate) continue;
        const days = daysBetween(note.issueDate, this.today);
        if (days < UNBILLED_DAYS) continue;
        const known = !unknown || amount > 0;
        this.findings.push(
          finding(
            known ? 'B3.unbilled' : 'B3.unbilledNoAmount',
            note,
            note.id,
            known ? amount : null,
            {
              delivery: text(note.number),
              date: frDate(note.issueDate),
              days: String(days),
              amount: money(amount),
              order: text(order?.number),
            },
            [evidenceOf('delivery', note), ...(order ? [evidenceOf('order', order)] : [])],
          ),
        );
      }
    }
  }

  /** B6: the invoice's customer is not the order's, when the order number tied them. */
  parties() {
    for (const l of this.links) {
      if (l.kind !== 'billed_by' || (l.method !== 'number' && l.method !== 'human')) continue;
      if (l.status !== 'auto' && l.status !== 'confirmed') continue;
      const order = this.byId.get(l.fromDocId);
      const inv = this.byId.get(l.toDocId);
      if (!order || !inv || order.kind !== 'order' || !isInvoice(inv)) continue;
      const params = {
        invoice: text(inv.number),
        order: text(order.number),
        invoiceSiren: text(inv.partySiren),
        orderSiren: text(order.partySiren),
        invoiceName: text(inv.partyName),
        orderName: text(order.partyName),
        amount: money(Number(inv.netTotal)),
      };
      const evidence = [evidenceOf('invoice', inv), evidenceOf('order', order)];
      const a = partyKey(text(inv.partyName));
      const b = partyKey(text(order.partyName));
      let message: CheckMessage | null = null;
      if (inv.partySiren && order.partySiren) {
        if (inv.partySiren !== order.partySiren) message = 'B6.siren';
      } else if (a && b && !a.includes(b) && !b.includes(a)) {
        message = 'B6.name';
      }
      if (message) {
        this.findings.push(
          finding(message, inv, `${inv.id}:${order.id}`, inv.netTotal, params, evidence),
        );
      }
    }
  }
}

const bySize = (a: CheckFinding, b: CheckFinding) =>
  (b.amount ?? -1) - (a.amount ?? -1) ||
  (a.severity === b.severity ? 0 : a.severity === 'blocking' ? -1 : 1) ||
  a.key.localeCompare(b.key);

/**
 * Links and findings of a company. Test invoices are checked against the sheets like real ones, in
 * their own pass: a test invoice never bills an order alongside the real ones.
 */
export function checkRegistry(input: CheckInput): CheckOutput {
  const links = new Map<string, Link>();
  const findings: CheckFinding[] = [];
  for (const isTest of [false, true]) {
    const docs = input.docs.filter((d) => d.kind !== 'invoice' || d.isTest === isTest);
    if (isTest && !docs.some((d) => d.kind === 'invoice')) continue;
    const found = linkDocs(docs, input.decisions);
    for (const l of found) links.set(linkId(l), l);
    const world = new World(docs, found, input.today).run();
    if (!isTest) {
      findings.push(...world);
      continue;
    }
    // The sheets' own findings belong to the real pass; a test invoice's keep a key of their own.
    const tests = new Set(docs.filter((d) => d.isTest).map((d) => d.id));
    for (const f of world) if (tests.has(f.docId)) findings.push({ ...f, key: `test:${f.key}` });
  }
  return { links: [...links.values()], findings: findings.sort(bySize) };
}
