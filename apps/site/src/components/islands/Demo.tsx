import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../Icon';

// Interactive, fully simulated walkthrough of the add-in: check → fix → rehearse in test mode.
// Nothing leaves the browser. The checks here are a tiny demo subset; the product runs packages/core.

type Status = 'none' | 'ok' | 'fix' | 'deposited' | 'received' | 'delivered' | 'accepted' | 'paid';
type Phase = 'idle' | 'checking' | 'review' | 'ready' | 'rehearsing' | 'done';

interface Row {
  id: string;
  number: string;
  date: string;
  client: string;
  siren: string;
  ht: number;
  vatRate: number;
  penalties: boolean;
  status: Status;
}

interface Issue {
  rowId: string;
  column: 'D' | 'F';
  title: string;
  detail: string;
  fixLabel: string;
  apply: (row: Row) => Row;
}

const initialRows: Row[] = [
  {
    id: 'r1',
    number: 'F-2027-041',
    date: '02/03/2027',
    client: 'Boulangerie Martin',
    siren: '812345676',
    ht: 1250,
    vatRate: 20,
    penalties: true,
    status: 'none',
  },
  {
    id: 'r2',
    number: 'F-2027-042',
    date: '03/03/2027',
    client: 'Atelier Dubois',
    siren: '908765413',
    ht: 3480,
    vatRate: 20,
    penalties: true,
    status: 'none',
  },
  {
    id: 'r3',
    number: 'F-2027-043',
    date: '05/03/2027',
    client: 'Garage des Lilas',
    siren: '472158930',
    ht: 860.4,
    vatRate: 20,
    penalties: true,
    status: 'none',
  },
  {
    id: 'r4',
    number: 'F-2027-044',
    date: '08/03/2027',
    client: 'Studio Lumen',
    siren: '533119087',
    ht: 2100,
    vatRate: 20,
    penalties: false,
    status: 'none',
  },
  {
    id: 'r5',
    number: 'F-2027-045',
    date: '09/03/2027',
    client: 'Cave Bonnard',
    siren: '882640519',
    ht: 415.9,
    vatRate: 5.5,
    penalties: true,
    status: 'none',
  },
];

// Spreadsheet chrome: column letters and row numbers, so "cellule D3" points somewhere real.
const rowHead =
  'w-8 border-r border-black/5 bg-[#f3f5f4] text-center text-[0.62rem] font-medium text-black/35';
const columns = [
  { letter: 'A', className: '' },
  { letter: 'B', className: 'hidden md:table-cell' },
  { letter: 'C', className: 'hidden sm:table-cell' },
  { letter: 'D', className: '' },
  { letter: 'E', className: 'hidden sm:table-cell' },
  { letter: 'F', className: 'hidden sm:table-cell' },
  { letter: 'G', className: '' },
];

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function check(rows: Row[]): Issue[] {
  const issues: Issue[] = [];
  for (const row of rows) {
    if (!/^\d{9}$/.test(row.siren) || !luhn(row.siren)) {
      issues.push({
        rowId: row.id,
        column: 'D',
        title: 'Le SIREN de votre client semble incorrect',
        detail: `« ${row.siren} » ne passe pas le contrôle de clé. Deux chiffres sont probablement inversés : la plateforme refuserait cette facture.`,
        fixLabel: 'Corriger avec 908 765 431',
        apply: (r) => ({ ...r, siren: '908765431' }),
      });
    }
    if (!row.penalties) {
      issues.push({
        rowId: row.id,
        column: 'F',
        title: 'Mention obligatoire manquante',
        detail:
          'Le taux des pénalités de retard et l’indemnité forfaitaire de 40 € doivent figurer sur la facture.',
        fixLabel: 'Ajouter la mention standard',
        apply: (r) => ({ ...r, penalties: true }),
      });
    }
  }
  return issues;
}

const statusLabel: Record<Status, string> = {
  none: '',
  ok: 'Conforme',
  fix: 'À corriger',
  deposited: 'Déposée',
  received: 'Reçue',
  delivered: 'Mise à disposition',
  accepted: 'Approuvée',
  paid: 'Encaissée',
};

const statusTone: Record<Status, string> = {
  none: '',
  ok: 'bg-leaf-100 text-leaf-800',
  fix: 'bg-amber-100 text-amber-800',
  deposited: 'bg-sky-100 text-sky-800',
  received: 'bg-sky-100 text-sky-800',
  delivered: 'bg-indigo-100 text-indigo-800',
  accepted: 'bg-leaf-200 text-leaf-900',
  paid: 'bg-leaf-500 text-white',
};

const lifecycle: Status[] = ['deposited', 'received', 'delivered', 'accepted', 'paid'];
const eventText: Partial<Record<Status, string>> = {
  deposited: 'Facture déposée sur la plateforme agréée',
  received: 'Reçue par la plateforme du client',
  delivered: 'Mise à disposition de votre client',
  accepted: 'Approuvée par votre client',
  paid: 'Paiement reçu',
};

interface Event {
  rowId: string;
  status: Status;
  at: string;
}

export default function Demo() {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [phase, setPhase] = useState<Phase>('idle');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [selected, setSelected] = useState<string>('r2');
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current.length = 0;
  };
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending) window.clearTimeout(t);
    };
  }, []);

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const runCheck = () => {
    setPhase('checking');
    later(1100, () => {
      const found = check(rows);
      setIssues(found);
      setRows((rs) =>
        rs.map((r) => ({ ...r, status: found.some((i) => i.rowId === r.id) ? 'fix' : 'ok' })),
      );
      setPhase(found.length ? 'review' : 'ready');
    });
  };

  const applyFix = (issue: Issue) => {
    const cellKey = `${issue.rowId}-${issue.column}`;
    setFlash(cellKey);
    later(900, () => setFlash(null));
    const nextRows = rows.map((r) => (r.id === issue.rowId ? issue.apply(r) : r));
    const remaining = check(nextRows);
    setRows(
      nextRows.map((r) => ({
        ...r,
        status: remaining.some((i) => i.rowId === r.id) ? 'fix' : 'ok',
      })),
    );
    setIssues(remaining);
    if (remaining.length === 0) setPhase('ready');
  };

  const rehearse = () => {
    setPhase('rehearsing');
    setEvents([]);
    const start = new Date();
    rows.forEach((row, ri) => {
      // The last invoice stops at "Approuvée": not every client pays on day one.
      const steps = ri === rows.length - 1 ? lifecycle.slice(0, 4) : lifecycle;
      steps.forEach((status, si) => {
        later(450 + ri * 260 + si * 900, () => {
          const at = new Date(start.getTime() + (si * 3 + ri) * 60_000).toLocaleTimeString(
            'fr-FR',
            {
              hour: '2-digit',
              minute: '2-digit',
            },
          );
          setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status } : r)));
          setEvents((es) => [...es, { rowId: row.id, status, at }]);
        });
      });
    });
    later(450 + rows.length * 260 + lifecycle.length * 900, () => setPhase('done'));
  };

  const reset = () => {
    clearTimers();
    setRows(initialRows);
    setIssues([]);
    setEvents([]);
    setFlash(null);
    setSelected('r2');
    setPhase('idle');
  };

  const testMode = phase === 'rehearsing' || phase === 'done';
  const selectedRow = rows.find((r) => r.id === selected);
  const selectedEvents = useMemo(
    () => events.filter((e) => e.rowId === selected),
    [events, selected],
  );
  const paidTotal = rows
    .filter((r) => r.status === 'paid')
    .reduce((s, r) => s + r.ht * (1 + r.vatRate / 100), 0);

  const cell = (row: Row, column: 'D' | 'F', content: string, extra = '') => (
    <td
      className={`px-2.5 py-2 transition-colors duration-500 ${extra} ${
        flash === `${row.id}-${column}`
          ? 'bg-leaf-200'
          : row.status === 'fix' && issues.some((i) => i.rowId === row.id && i.column === column)
            ? 'bg-amber-50 outline outline-2 -outline-offset-2 outline-amber-400'
            : ''
      }`}
    >
      {content}
    </td>
  );

  return (
    <div className="overflow-hidden rounded-[1.4rem] bg-white shadow-lift ring-1 ring-leaf-900/10">
      <div className="flex items-center justify-between gap-3 bg-[#1f6e43] px-4 py-2.5 text-xs text-white/90">
        <span className="flex items-center gap-2">
          <span className="flex gap-1.5" aria-hidden="true">
            <i className="h-2.5 w-2.5 rounded-full bg-white/30" />
            <i className="h-2.5 w-2.5 rounded-full bg-white/30" />
            <i className="h-2.5 w-2.5 rounded-full bg-white/30" />
          </span>
          <span className="ml-2 font-medium">Factures mars 2027.xlsx</span>
        </span>
        <span className="hidden text-white/60 sm:inline">
          Démonstration simulée · rien n’est envoyé
        </span>
      </div>

      {testMode && (
        <div
          className="flex items-center gap-2 bg-test px-4 py-2 text-sm font-medium text-amber-950"
          role="status"
        >
          <Icon name="flask" size={16} /> Mode test : aucune facture n’est envoyée à une vraie
          plateforme.
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_20rem]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse sm:min-w-[34rem] text-left text-[0.82rem]">
            <thead>
              <tr className="bg-[#eef1ef] text-[0.62rem] text-black/35">
                <th className={rowHead} />
                {columns.map((c) => (
                  <th
                    key={c.letter}
                    className={`px-2.5 py-0.5 text-center font-medium ${c.className}`}
                  >
                    {c.letter}
                  </th>
                ))}
              </tr>
              <tr className="bg-[#f3f5f4] text-[0.72rem] font-semibold text-black/45">
                <th className={rowHead}>1</th>
                <th className="px-2.5 py-2 font-semibold">N°</th>
                <th className="hidden px-2.5 py-2 font-semibold md:table-cell">Date</th>
                <th className="hidden px-2.5 py-2 font-semibold sm:table-cell">Client</th>
                <th className="px-2.5 py-2 font-semibold">SIREN client</th>
                <th className="hidden px-2.5 py-2 text-right font-semibold sm:table-cell">TTC</th>
                <th className="hidden px-2.5 py-2 font-semibold sm:table-cell">Pénalités</th>
                <th className="bg-leaf-50 px-2.5 py-2 font-semibold text-leaf-700">FI_Statut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr
                  key={row.id}
                  onClick={() => setSelected(row.id)}
                  className={`cursor-pointer border-b border-black/[0.05] transition hover:bg-leaf-50/40 ${selected === row.id ? 'bg-leaf-50/60' : ''}`}
                >
                  <td className={rowHead}>{ri + 2}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 tabular-nums text-black/70">
                    {row.number}
                  </td>
                  <td className="hidden px-2.5 py-2 tabular-nums text-black/60 md:table-cell">
                    {row.date}
                  </td>
                  <td className="hidden px-2.5 py-2 sm:table-cell">{row.client}</td>
                  {cell(row, 'D', row.siren.replace(/(\d{3})(?=\d)/g, '$1 '), 'tabular-nums')}
                  <td className="hidden px-2.5 py-2 text-right tabular-nums sm:table-cell">
                    {euro.format(row.ht * (1 + row.vatRate / 100))}
                  </td>
                  {cell(row, 'F', row.penalties ? 'Oui' : '—', 'hidden sm:table-cell')}
                  <td className="bg-leaf-50/40 px-2 py-1.5">
                    {row.status !== 'none' && (
                      <span
                        className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${statusTone[row.status]}`}
                      >
                        {statusLabel[row.status]}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {[7, 8, 9].map((n) => (
                <tr key={n} className="border-b border-black/[0.05]">
                  <td className={rowHead}>{n}</td>
                  <td colSpan={7} className="py-2">
                    &nbsp;
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2.5 text-xs text-black/45">
            Astuce : cliquez sur une ligne pour voir son historique. Les statuts reviennent dans
            FI_Statut. Les corrections restent soumises à votre confirmation.
          </p>
        </div>

        <aside
          className="border-t border-black/5 bg-cream p-4 lg:border-t-0 lg:border-l"
          aria-live="polite"
        >
          <p className="font-display text-base font-semibold text-leaf-900">Facture Impec</p>

          {phase === 'idle' && (
            <div className="mt-3">
              <p className="text-sm leading-relaxed text-muted">
                Cinq factures de mars sont prêtes. Vérifions-les avant l’envoi.
              </p>
              <button type="button" onClick={runCheck} className="btn btn-primary mt-4 w-full">
                <Icon name="shield" size={18} /> Vérifier mes factures
              </button>
            </div>
          )}

          {phase === 'checking' && (
            <div className="mt-4 flex items-center gap-3 text-sm text-muted">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-leaf-200 border-t-leaf-500" />
              Vérification des règles EN 16931 et des mentions françaises…
            </div>
          )}

          {phase === 'review' && (
            <div className="mt-3 space-y-3">
              <p className="text-sm font-semibold text-amber-800">
                {issues.length} point{issues.length > 1 ? 's' : ''} à corriger avant l’envoi
              </p>
              {issues.map((issue) => {
                const row = rows.find((r) => r.id === issue.rowId);
                const line = rows.findIndex((r) => r.id === issue.rowId) + 2;
                return (
                  <div
                    key={`${issue.rowId}-${issue.column}`}
                    className="rounded-xl bg-white p-3 shadow-soft"
                  >
                    <p className="text-[0.8rem] font-semibold text-ink">{issue.title}</p>
                    <p className="mt-1 text-[0.76rem] leading-snug text-muted">
                      {row?.number} · cellule {issue.column}
                      {line} — {issue.detail}
                    </p>
                    <button
                      type="button"
                      onClick={() => applyFix(issue)}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-leaf-500 px-3 py-1 text-[0.74rem] font-semibold text-white transition hover:bg-leaf-600"
                    >
                      <Icon name="check" size={14} /> {issue.fixLabel}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {phase === 'ready' && (
            <div className="mt-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-leaf-700">
                <Icon name="check" size={18} /> Les 5 factures sont conformes.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Avant un premier envoi réel, répétez tout le parcours en mode test.
              </p>
              <button
                type="button"
                onClick={rehearse}
                className="btn mt-4 w-full bg-test text-amber-950 hover:bg-amber-400"
              >
                <Icon name="flask" size={18} /> Répéter en mode test
              </button>
            </div>
          )}

          {(phase === 'rehearsing' || phase === 'done') && selectedRow && (
            <div className="mt-3">
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                Historique · {selectedRow.number}
              </p>
              <ol className="mt-3 space-y-2.5">
                {selectedEvents.length === 0 && <li className="text-sm text-muted">En attente…</li>}
                {selectedEvents.map((e) => (
                  <li key={e.status} className="flex animate-rise gap-2.5 text-[0.8rem]">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-leaf-500" />
                    <span>
                      <span className="tabular-nums text-black/45">{e.at}</span> ·{' '}
                      {eventText[e.status]}
                    </span>
                  </li>
                ))}
              </ol>
              {phase === 'done' && (
                <div className="mt-4 rounded-xl bg-white p-3 shadow-soft">
                  <p className="text-[0.76rem] font-semibold text-leaf-800">
                    Encaissé pendant la répétition
                  </p>
                  <p className="font-display text-xl font-semibold text-leaf-700">
                    {euro.format(paidTotal)}
                  </p>
                  <p className="mt-1 text-[0.74rem] leading-snug text-muted">
                    Tout est prêt. En réel, un clic sur « Envoyer » suffit.
                  </p>
                </div>
              )}
            </div>
          )}

          {phase !== 'idle' && phase !== 'checking' && (
            <button
              type="button"
              onClick={reset}
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted underline-offset-4 hover:text-leaf-800 hover:underline"
            >
              <Icon name="refresh" size={14} /> Recommencer la démo
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}
