// The public company directory behind « Créer un compte » (docs/ONBOARDING.md §1): the Annuaire des
// entreprises API of the DINUM, no key, read 2026-10-18. One SIREN in, the legal name, the head office
// and the VAT number DGFiP lists out. The directory says what it knows; the person confirms or types.
import { type Address, isValidSiren } from '@fi/core';
import { z } from 'zod';

/** What « Créer un compte » prefills. Null fields are for the person to type. */
export interface DirectoryCompany {
  siren: string;
  name: string | null;
  address: Address | null;
  /** From DGFiP's list of active numbers; else the usual key computed from the SIREN, to confirm. */
  vatId: string | null;
  vatSource: 'dgfip' | 'computed';
  /** The company has ceased trading (`etat_administratif` C). */
  closed: boolean;
  /** This SIREN is a duplicate; the one to use instead (`siren_conserve`). */
  keptSiren: string | null;
  /** Some fields were withheld at the company's request (partial diffusion). */
  masked: boolean;
}

export interface Directory {
  /** Null: no company has this SIREN. Throws DirectoryUnavailable when the directory cannot answer. */
  lookup(siren: string): Promise<DirectoryCompany | null>;
}

export class DirectoryUnavailable extends Error {
  constructor(
    message: string,
    /** Seconds the directory asked us to wait (429 Retry-After). */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = 'DirectoryUnavailable';
  }
}

/** Fields withheld for partial diffusion come back as this literal (docs/ONBOARDING.md §1.3). */
const WITHHELD = '[NON-DIFFUSIBLE]';

const text = z
  .string()
  .nullish()
  .transform((v) => {
    const s = v?.trim();
    return s && s !== WITHHELD ? s : null;
  });

const Siege = z.object({
  numero_voie: text,
  indice_repetition: text,
  type_voie: text,
  libelle_voie: text,
  complement_adresse: text,
  distribution_speciale: text,
  code_postal: text,
  libelle_commune: text,
  cedex: text,
  libelle_cedex: text,
  code_pays_etranger: text,
  libelle_commune_etranger: text,
});

const Result = z.object({
  siren: z.string(),
  siren_conserve: z.string().nullish(),
  nom_raison_sociale: z.string().nullish(),
  nom_complet: z.string().nullish(),
  etat_administratif: z.string().nullish(),
  statut_diffusion: z.string().nullish(),
  tva: z.array(z.string()).nullish(),
  siege: Siege.nullish(),
});

const Answer = z.object({ results: z.array(Result), total_results: z.number() });

/**
 * The usual key of a French VAT number, `FR` + (12 + 3 × (SIREN mod 97)) mod 97 + SIREN. It matched
 * every number we checked, but no official text publishes it and DGFiP says computed numbers did not
 * always match the issued ones: a suggestion the person confirms, never a fact.
 */
export function computedVatId(siren: string): string {
  const key = (12 + 3 * (Number(siren) % 97)) % 97;
  return `FR${String(key).padStart(2, '0')}${siren}`;
}

function address(siege: z.infer<typeof Siege> | null | undefined): Address | null {
  if (!siege) return null;
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(' ') || undefined;
  const street = join(
    siege.numero_voie,
    siege.indice_repetition,
    siege.type_voie,
    siege.libelle_voie,
  );
  const abroad = siege.code_pays_etranger;
  const a: Address = {
    line1: street ?? join(siege.complement_adresse),
    line2: street ? join(siege.complement_adresse, siege.distribution_speciale) : undefined,
    postCode: siege.cedex ?? siege.code_postal ?? undefined,
    city:
      siege.libelle_cedex ?? siege.libelle_commune ?? siege.libelle_commune_etranger ?? undefined,
    // The directory gives foreign countries as INSEE codes, not ISO ones: the person picks.
    country: abroad ? undefined : 'FR',
  };
  return a.line1 || a.city ? a : null;
}

const USER_AGENT = 'FactureImpec/1.0 (inscription; +https://facture-impec.vercel.app)';

/** GET /search?q=<siren>&minimal=true&include=siege,tva (docs/ONBOARDING.md §1.1). */
export class RechercheEntreprises implements Directory {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async lookup(siren: string): Promise<DirectoryCompany | null> {
    if (!isValidSiren(siren)) return null;
    const url = new URL('/search', this.baseUrl);
    url.searchParams.set('q', siren);
    url.searchParams.set('minimal', 'true');
    url.searchParams.set('include', 'siege,tva');
    url.searchParams.set('per_page', '1');
    let res: Response;
    try {
      res = await this.fetcher(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(8_000),
      });
    } catch (e) {
      throw new DirectoryUnavailable(`directory unreachable: ${String(e)}`);
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after'));
      throw new DirectoryUnavailable('directory: 429', Number.isFinite(wait) ? wait : null);
    }
    if (!res.ok) throw new DirectoryUnavailable(`directory: ${res.status}`);
    const parsed = Answer.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new DirectoryUnavailable('directory: unexpected answer');
    // Not found is a 200 with no result; a direct lookup returns that SIREN or nothing.
    const found = parsed.data.results.find((r) => r.siren === siren);
    if (!found) return null;
    const name = text.parse(found.nom_raison_sociale) ?? text.parse(found.nom_complet);
    const listed = found.tva?.find((v) => /^FR[0-9A-Z]{2}\d{9}$/.test(v) && v.endsWith(siren));
    return {
      siren,
      name,
      address: address(found.siege),
      vatId: listed ?? computedVatId(siren),
      vatSource: listed ? 'dgfip' : 'computed',
      closed: found.etat_administratif === 'C',
      keptSiren:
        found.siren_conserve && found.siren_conserve !== siren ? found.siren_conserve : null,
      masked:
        found.statut_diffusion === 'P' ||
        found.nom_raison_sociale === WITHHELD ||
        found.nom_complet === WITHHELD,
    };
  }
}
