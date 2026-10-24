// Shared by the replay tests and the record script: scoring and the recordings on disk.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CORE_FIELDS, KEY_LAYOUT_FIELDS, type LayoutMapping, type SheetMapping } from '@fi/core';
import { z } from 'zod';
import type { LayoutFixture } from './layout.fixtures';
import type { MappingFixture } from './mapping.fixtures';

export const RECORDINGS = new URL('./recordings/', import.meta.url);

export const Recording = z.object({
  agent: z.enum(['mapping', 'layout', 'explain', 'monitor', 'chat', 'classify']),
  label: z.string(),
  provider: z.string(),
  model: z.string(),
  recordedAt: z.string(),
  promptHash: z.string(),
  /** A gating recording must pass the plan's thresholds; others are kept for comparison. */
  gate: z.boolean(),
  /** Fixture name → the model's raw answer (the chat: every answer of the conversation), or null. */
  answers: z.record(z.string(), z.unknown().nullable()),
});
export type Recording = z.infer<typeof Recording>;

export function loadRecordings(agent: Recording['agent']): Recording[] {
  return readdirSync(RECORDINGS)
    .filter((f) => f.startsWith(`${agent}.`) && f.endsWith('.json'))
    .sort()
    .map((f) => Recording.parse(JSON.parse(readFileSync(new URL(f, RECORDINGS), 'utf8'))));
}

export function saveRecording(r: Recording) {
  const file = new URL(`${r.agent}.${r.label}.json`, RECORDINGS);
  writeFileSync(file, `${JSON.stringify(r, null, 2)}\n`);
  return file;
}

export interface MappingScore {
  correct: number;
  total: number;
  misses: string[];
  headerOk: boolean;
  groupingOk: boolean;
}

/** Core fields mapped to the expected column, a field the sheet lacks counting as right when left out. */
export function scoreMapping(f: MappingFixture, m: SheetMapping): MappingScore {
  const misses = CORE_FIELDS.filter(
    (field) => (m.mapping[field]?.column ?? null) !== (f.expected.fields[field] ?? null),
  ).map(
    (field) => `${field}: ${m.mapping[field]?.column ?? '—'} ≠ ${f.expected.fields[field] ?? '—'}`,
  );
  return {
    correct: CORE_FIELDS.length - misses.length,
    total: CORE_FIELDS.length,
    misses,
    headerOk: m.headerRow === f.expected.headerRow,
    groupingOk: (m.grouping?.by ?? null) === f.expected.grouping,
  };
}

export interface LayoutScore {
  correct: number;
  total: number;
  misses: string[];
  headerOk: boolean;
}

/** The kind plus the key fields: one point each, a field the sheet lacks counting as right when left out. */
export function scoreLayout(f: LayoutFixture, m: LayoutMapping): LayoutScore {
  const misses = KEY_LAYOUT_FIELDS.filter(
    (field) => (m.mapping[field]?.column ?? null) !== (f.expected.fields[field] ?? null),
  ).map(
    (field) => `${field}: ${m.mapping[field]?.column ?? '—'} ≠ ${f.expected.fields[field] ?? '—'}`,
  );
  if (m.kind !== f.expected.kind) misses.unshift(`kind: ${m.kind} ≠ ${f.expected.kind}`);
  return {
    correct: KEY_LAYOUT_FIELDS.length + 1 - misses.length,
    total: KEY_LAYOUT_FIELDS.length + 1,
    misses,
    headerOk: m.headerRow === f.expected.headerRow,
  };
}

export const ratio = (scores: readonly { correct: number; total: number }[]) =>
  scores.reduce((n, s) => n + s.correct, 0) / scores.reduce((n, s) => n + s.total, 0);
