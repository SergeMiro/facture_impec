// Helpers UI : manipulation de chemins de champ (style Rust "lines[0].line_amount"),
// regroupement des problèmes par champ, libellés.

import type { Invoice, Issue, ValidationReport } from "./types";

/** "lines[0].line_amount" → ["lines", 0, "line_amount"] */
export function parsePath(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const seg of path.split(".")) {
    const m = seg.match(/^([^[]+)(\[(\d+)\])?$/);
    if (!m) {
      out.push(seg);
      continue;
    }
    out.push(m[1]);
    if (m[3] !== undefined) out.push(Number(m[3]));
  }
  return out;
}

/** Renvoie une copie de la facture avec `path` mis à `value` ("" → null, considéré comme absent). */
export function setPath(invoice: Invoice, path: string, value: string): Invoice {
  const clone: Invoice = structuredClone(invoice);
  const parts = parsePath(path);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cursor: any = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    cursor = cursor[parts[i]];
    if (cursor === undefined || cursor === null) return clone;
  }
  cursor[parts[parts.length - 1]] = value === "" ? null : value;
  return clone;
}

/** Map champ → problèmes (pour colorer chaque cellule/champ). */
export function issuesByField(report: ValidationReport): Map<string, Issue[]> {
  const map = new Map<string, Issue[]>();
  for (const issue of report.issues) {
    const list = map.get(issue.field) ?? [];
    list.push(issue);
    map.set(issue.field, list);
  }
  return map;
}

export function hasHardErrors(report: ValidationReport): boolean {
  return report.issues.some((i) => i.severity === "hard");
}

export function countBySeverity(report: ValidationReport): { hard: number; soft: number } {
  let hard = 0;
  let soft = 0;
  for (const i of report.issues) i.severity === "hard" ? hard++ : soft++;
  return { hard, soft };
}
