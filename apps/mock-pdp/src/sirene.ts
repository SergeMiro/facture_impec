// A stand-in for the Annuaire des entreprises search API (docs/ONBOARDING.md §1), served at /sirene:
// GET /search?q=<siren or name>&minimal=true&include=siege,tva, answered as the real one answers a
// direct SIREN lookup or a search by name. Synthetic companies only: any valid SIREN gets a made-up one,
// a name gets three made-up companies around it (the same ones on a later SIREN lookup), and a few
// SIRENs play the cases the wizard must handle. No real company, no real person.
import { Hono } from 'hono';

/** SIRENs that play a case (Luhn-valid, in no register we know of). */
export const SIRENE_CASES = {
  /** Ceased trading: etat_administratif C. */
  closed: '999000003',
  /** A duplicate: siren_conserve points to `kept`. */
  duplicate: '999000011',
  kept: '999000029',
  /** Partial diffusion: the head office's street withheld. */
  withheld: '999000037',
  /** No active VAT number in DGFiP's list (franchise en base). */
  noVat: '999000045',
  /** In no register: total_results 0. */
  unknown: '999000052',
  /** The directory is overloaded: 429 with Retry-After. */
  busy: '999000060',
} as const;

const luhn = (digits: string) =>
  [...digits].reverse().reduce((sum, c, i) => {
    const d = Number(c) * (i % 2 ? 2 : 1);
    return sum + (d > 9 ? d - 9 : d);
  }, 0) %
    10 ===
  0;

const vat = (siren: string) =>
  `FR${String((12 + 3 * (Number(siren) % 97)) % 97).padStart(2, '0')}${siren}`;

const ND = '[NON-DIFFUSIBLE]';

/** A search by name whose words contain this finds nothing. */
export const SIRENE_NOBODY = 'inconnu';
/** The only post code the made-up companies have an establishment in. */
export const SIRENE_POST_CODE = '21000';

/** A Luhn-valid SIREN starting with 998 for a seed, the same seed always giving the same SIREN. */
export function sirenFor(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 100_000;
  const base = `998${String(h).padStart(5, '0')}`;
  for (let d = 0; d < 10; d++) if (luhn(`${base}${d}`)) return `${base}${d}`;
  throw new Error('unreachable');
}

/** The three companies a search by name finds, best first. */
export const namesFor = (q: string) => {
  const name = q.trim().toUpperCase();
  return [name, `${name} ET FILS`, `BOULANGERIE ${name}`];
};

function company(siren: string, named?: string) {
  const withheld = siren === SIRENE_CASES.withheld;
  const n = Number(siren.slice(-3));
  const name = named ?? `ENTREPRISE DE DEMONSTRATION ${siren.slice(-4)}`;
  return {
    siren,
    siren_conserve: siren === SIRENE_CASES.duplicate ? SIRENE_CASES.kept : null,
    nom_complet: name,
    nom_raison_sociale: name,
    etat_administratif: siren === SIRENE_CASES.closed ? 'C' : 'A',
    statut_diffusion: withheld ? 'P' : 'O',
    tva: siren === SIRENE_CASES.noVat ? [] : [vat(siren)],
    siege: {
      siret: `${siren}00017`,
      est_siege: true,
      etat_administratif: 'A',
      statut_diffusion_etablissement: withheld ? 'P' : 'O',
      complement_adresse: withheld ? ND : null,
      numero_voie: withheld ? ND : String((n % 90) + 1),
      indice_repetition: null,
      type_voie: withheld ? ND : 'RUE',
      libelle_voie: withheld ? ND : 'DES EXEMPLES',
      distribution_speciale: null,
      code_postal: withheld ? ND : '21000',
      libelle_commune: 'DIJON',
      commune: '21231',
      cedex: null,
      libelle_cedex: null,
      code_pays_etranger: null,
      libelle_pays_etranger: null,
      libelle_commune_etranger: null,
    },
    matching_etablissements: [],
  };
}

export function sireneStandIn(): Hono {
  const app = new Hono();
  /** Names given by a search, so that a SIREN lookup afterwards describes the same company. */
  const named = new Map<string, string>();
  app.get('/search', (c) => {
    const raw = c.req.query('q') ?? '';
    const q = raw.replace(/\s/g, '');
    if (!q) return c.json({ erreur: 'Veuillez indiquer au moins un paramètre de recherche.' }, 400);
    if (c.req.query('include') && c.req.query('minimal') !== 'true') {
      return c.json({ erreur: 'Veuillez indiquer si vous souhaitez une réponse minimale.' }, 400);
    }
    if (q === SIRENE_CASES.busy) {
      return c.json({ erreur: 'Too Many Requests' }, 429, { 'retry-after': '2' });
    }
    let results: ReturnType<typeof company>[];
    if (/^\d+$/.test(q)) {
      const found = q.length === 9 && luhn(q) && q !== SIRENE_CASES.unknown;
      results = found ? [company(q, named.get(q))] : [];
    } else {
      if (raw.trim().length < 3) {
        return c.json(
          {
            erreur:
              '3 caractères minimum pour les termes de la requête (ou utilisez au moins un filtre)',
          },
          400,
        );
      }
      const postCode = c.req.query('code_postal');
      const nobody =
        raw.toLowerCase().includes(SIRENE_NOBODY) || (postCode && postCode !== SIRENE_POST_CODE);
      results = nobody
        ? []
        : namesFor(raw).map((name) => {
            const siren = sirenFor(name);
            named.set(siren, name);
            return company(siren, name);
          });
      results = results.slice(0, Number(c.req.query('per_page') ?? 10));
    }
    return c.json({
      results,
      total_results: results.length,
      page: 1,
      per_page: Number(c.req.query('per_page') ?? 10),
      total_pages: results.length,
    });
  });
  return app;
}
