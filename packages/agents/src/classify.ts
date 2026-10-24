// What a received document is (BTP plan §7 DocumentGraph, `docs/DECISIONS.md` D7). Patterns first:
// a kind named in the document's first lines or its file's name is taken (0.95); one named only in
// its body (0.75) is what the rules say when no model answers. Otherwise the model of role
// `classify` reads the first 2 000 characters, pseudonymized, and an answer under 0.7 sends the
// document to a person. A malformed answer is not asked again. The model never reads amounts or
// dates: the rules of document-fields.ts do.
import { z } from 'zod';
import type { AiHandle } from './ai';
import { callStructured, estimateTokens, malformed, promptHash, readPrompt } from './llm';
import type { Degraded } from './mapping';
import type { Orchestrator } from './orchestrator';
import { Pseudonymizer } from './pseudonymize';

/**
 * The kinds a document can be told apart by: DOCUMENT_KINDS of @fi/domain with one `facture`, since
 * whether an invoice is a sale or a purchase depends on the company, which the text does not say.
 */
export const CLASSIFY_LABELS = [
  'facture',
  'situation',
  'avoir',
  'devis',
  'contrat_sous_traitance',
  'contrat_travail',
  'attestation_vigilance',
  'kbis',
  'attestation_assurance_decennale',
  'attestation_assurance_rc',
  'liste_salaries_etrangers',
  'pv_reception',
  'dgd',
  'autre',
] as const;
export type ClassifyLabel = (typeof CLASSIFY_LABELS)[number];

/** Confident enough to take without a model (BTP plan §7: ≥ 0.9). */
export const RULE_SURE = 0.9;
/** Under this a model's answer goes to a person (BTP plan §7). */
export const MODEL_SURE = 0.7;
/** The share of the text a model reads (BTP plan §7). */
export const MODEL_CHARS = 2000;
/** The document's head where its title is: about ten lines. */
const HEAD_CHARS = 600;

export interface DocumentText {
  text: string;
  name: string;
  /** The subject of the e-mail that brought it: shared by every attachment, so a body hint. */
  subject?: string | undefined;
}

/** Lowercase, without accents, one space between words; line breaks kept. */
export const normalizeText = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/[^\S\n]+/g, ' ');

const N = String.raw`(?:n|no|numero)\s*°?\s*`;

/**
 * A title pattern looks at the document's first lines and, apart, at its file's name; a generic
 * word (« facture », « devis », « avoir ») counts only where a line starts, since an invoice's
 * header names the quote it follows and a letter « notre facture n° 12 ». The title found first in
 * the text wins, then the order below: a « facture de situation » is a situation, an « attestation
 * RC et décennale » a décennale. A body pattern is narrower still: a contract's body names the
 * attestations it asks for, a quote's the invoice it will become.
 */
const RULES: ReadonlyArray<{ label: ClassifyLabel; title: RegExp; body: RegExp | null }> = [
  {
    label: 'attestation_vigilance',
    title:
      /attestation de vigilance|attestation de fourniture des declarations sociales|attestation urssaf/,
    body: /(?:urssaf|msa)[\s\S]{0,200}atteste|a jour de ses obligations (?:declaratives|de declaration et de paiement)/,
  },
  {
    label: 'liste_salaries_etrangers',
    title: /liste (?:nominative )?des salaries etrangers/,
    body: /salaries etrangers[\s\S]{0,120}autorisation de travail/,
  },
  {
    label: 'kbis',
    title:
      /\bk ?bis\b|extrait d'immatriculation|extrait (?:du |d'inscription au )?(?:registre du commerce|rcs|rne)\b|registre national des entreprises/,
    body: /greffe du tribunal de commerce[\s\S]{0,300}(?:immatriculation|extrait)|extrait d'immatriculation principale/,
  },
  {
    label: 'attestation_assurance_decennale',
    title:
      /(?:attestation|assurance|certificat)[\s\S]{0,80}decennale|decennale[\s\S]{0,80}(?:attestation|assurance)/,
    body: /(?:certifi|attest)[a-z]*\b[\s\S]{0,200}(?:garantie|responsabilite) (?:civile )?decennale/,
  },
  {
    label: 'attestation_assurance_rc',
    title:
      /(?:attestation|certificat) d'assurance[\s\S]{0,80}responsabilite civile|responsabilite civile (?:professionnelle|generale|exploitation)|\brc (?:pro|professionnelle|exploitation)\b/,
    body: /(?:certifi|attest)[a-z]*\b[\s\S]{0,200}responsabilite civile (?:professionnelle|generale|exploitation|du chef d'entreprise)/,
  },
  {
    label: 'pv_reception',
    title:
      /proces[- ]verbal de reception|\bpv de (?:reception|levee)|reception des (?:travaux|ouvrages)/,
    body: /(?:prononce|declare) la reception|reception (?:est |a ete )?prononcee|levee des reserves/,
  },
  {
    label: 'dgd',
    title: /decompte general(?: et)? definitif|^dgd\b/m,
    body: /decompte general(?: et)? definitif/,
  },
  {
    label: 'contrat_sous_traitance',
    title:
      /contrat de sous[- ]traitance|acte special de sous[- ]traitance|declaration de sous[- ]traitance|\bdc ?4\b/,
    body: /loi (?:n° ?)?75-1334|ci-apres (?:denomme|designe)e? (?:« ?)?le sous-traitant|le sous-traitant s'engage/,
  },
  {
    label: 'contrat_travail',
    title:
      /contrat de travail|contrat a duree (?:in)?determinee|contrat d'apprentissage|\bcd[di]\b/,
    body: /periode d'essai[\s\S]{0,400}(?:salarie|remuneration)|(?:salarie|remuneration)[\s\S]{0,400}periode d'essai/,
  },
  {
    label: 'situation',
    title: new RegExp(
      String.raw`situation (?:de travaux )?${N}\d+|etat de situation|facture de situation|situation de travaux|situation mensuelle`,
    ),
    body: new RegExp(
      String.raw`situation (?:de travaux )?${N}\d+|cumul (?:des )?travaux|avancement (?:des travaux )?[\s\S]{0,40}%`,
    ),
  },
  {
    label: 'avoir',
    title: /^(?:facture d')?avoir\b|facture d'avoir|note de credit|facture rectificative/m,
    body: new RegExp(
      String.raw`(?:montant|total) (?:de l')?avoir|\bavoir ${N}\w+|annulons (?:partiellement |totalement )?notre facture|montant a deduire`,
    ),
  },
  {
    label: 'devis',
    title: /^(?:devis|proposition (?:commerciale|de prix)|offre de prix)\b/m,
    body: /bon pour accord|validite de (?:l'offre|ce devis)|offre valable/,
  },
  {
    label: 'facture',
    title: /^facture\b/m,
    // Not « facture n° »: a letter, a quote or a credit note names the invoice it is about.
    body: /net a payer|date d'echeance|total ttc a payer/,
  },
  {
    label: 'autre',
    title:
      /^(?:bon de (?:livraison|commande|reception)|releve (?:de compte|bancaire)|bulletin de (?:paie|salaire)|lettre de relance)|avis de situation au repertoire sirene/m,
    body: null,
  },
];

export interface RuleMatch {
  label: ClassifyLabel;
  confidence: number;
  /** Where it was found, for the audit and the tests. */
  where: 'title' | 'body';
}

/** The name as words: « Kbis_Dupont-2026.pdf » → « kbis dupont 2026 ». */
const nameWords = (name: string) =>
  normalizeText(name.replace(/\.[a-z0-9]{2,4}$/i, ''))
    .replace(/[_.-]+/g, ' ')
    .trim();

/** The title rule found first in this text (ties: the order of RULES), or none. */
function firstTitle(text: string) {
  let best: { at: number; label: ClassifyLabel } | null = null;
  for (const r of RULES) {
    const at = r.title.exec(text)?.index;
    if (at !== undefined && (!best || at < best.at)) best = { at, label: r.label };
  }
  return best?.label ?? null;
}

/** The kind the patterns give, or null. A body match counts only when one kind alone matches. */
export function classifyByRules(doc: DocumentText): RuleMatch | null {
  const text = normalizeText(doc.text).replace(/^ +| +$/gm, '');
  const titled = firstTitle(text.slice(0, HEAD_CHARS)) ?? firstTitle(nameWords(doc.name));
  if (titled) return { label: titled, confidence: 0.95, where: 'title' };
  const body = `${text}\n${normalizeText(doc.subject ?? '')}`;
  const found = RULES.filter((r) => r.body?.test(body));
  const [only] = found;
  return found.length === 1 && only ? { label: only.label, confidence: 0.75, where: 'body' } : null;
}

export const ClassifyAnswer = z.object({
  kind: z.enum(CLASSIFY_LABELS),
  confidence: z.number().min(0).max(1),
});
export type ClassifyAnswer = z.infer<typeof ClassifyAnswer>;

const SYSTEM = readPrompt('classify.md');
export const CLASSIFY_PROMPT_HASH = promptHash(SYSTEM, ClassifyAnswer);

/** What the model reads: the name, the subject and the text's beginning, every identifier masked. */
export function classifyPrompt(doc: DocumentText, p: Pseudonymizer): string {
  return JSON.stringify({
    name: p.mask(doc.name),
    subject: doc.subject ? p.mask(doc.subject) : null,
    text: p.mask(doc.text.slice(0, MODEL_CHARS)),
  });
}

export interface Classification {
  /** Null: a person says what it is (`needs_review`, `unclassified`). */
  label: ClassifyLabel | null;
  confidence: number;
  source: 'rules' | 'agent' | 'none';
  /** Why no model answered, when one was asked or would have been. */
  degraded: Degraded | 'unsure' | null;
}

export interface ClassifyContext {
  tenantId: string;
  ai: AiHandle | null;
  orchestrator: Orchestrator;
  /** Names the patterns may miss (the company's own, its known parties): masked before the call. */
  known?: readonly string[];
  signal?: AbortSignal;
}

/** The model's answer on this document, rules aside: the eval records it on every fixture. */
export function askModel(doc: DocumentText, ctx: ClassifyContext & { ai: AiHandle }) {
  const { ai } = ctx;
  const p = new Pseudonymizer();
  for (const name of ctx.known ?? []) p.protect('PARTY', name);
  const prompt = classifyPrompt(doc, p);
  return ctx.orchestrator.run({
    tenantId: ctx.tenantId,
    phase: 'classify',
    provider: ai.provider,
    model: ai.modelId('classify'),
    promptHash: CLASSIFY_PROMPT_HASH,
    estimatedTokens: estimateTokens(SYSTEM, prompt),
    retryOn: (error) => !malformed(error),
    ...(ctx.signal && { signal: ctx.signal }),
    call: (signal) =>
      callStructured({
        model: ai.model('classify'),
        system: SYSTEM,
        prompt,
        schema: ClassifyAnswer,
        schemaName: 'document_kind',
        // The answer is twenty tokens; a reasoning model thinks inside this cap (200 cut 6 of 20).
        maxOutputTokens: 2000,
        signal,
      }),
  });
}

export async function classifyDocument(
  doc: DocumentText,
  ctx: ClassifyContext,
): Promise<Classification> {
  const rule = classifyByRules(doc);
  if (rule && rule.confidence >= RULE_SURE) {
    return { label: rule.label, confidence: rule.confidence, source: 'rules', degraded: null };
  }
  const fallback = (degraded: Classification['degraded']): Classification =>
    rule
      ? { label: rule.label, confidence: rule.confidence, source: 'rules', degraded }
      : { label: null, confidence: 0, source: 'none', degraded };
  const { ai } = ctx;
  if (!ai) return fallback('ai_off');
  if (!doc.text.trim()) return fallback(null);

  const outcome = await askModel(doc, { ...ctx, ai });
  if (!outcome.ok) return fallback(outcome.reason);
  const { kind, confidence } = outcome.output;
  // The model doubts: a person looks, even when a body pattern matched.
  if (confidence < MODEL_SURE)
    return { label: null, confidence, source: 'agent', degraded: 'unsure' };
  return { label: kind, confidence, source: 'agent', degraded: null };
}
