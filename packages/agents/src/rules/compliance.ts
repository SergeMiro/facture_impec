// Compliance rules (memory doc §8): a subcontractor on a live chantier whose attestation de vigilance
// the memory does not hold. The contractor is jointly liable from 5 000 € HT (C. trav. L8222-1).
import type { Found, MemoryRule } from './context';

export const subcontractorNoDocs: MemoryRule = {
  entry: {
    id: 'subcontractor-no-docs',
    category: 'conformite',
    trigger: 'on_edge',
    runs: 'memory',
    draft: 'message',
    autonomy: 'propose',
    outward: true,
    minConfidence: 'strong',
    cooldownDays: 14,
    legal: 'C. trav. art. L8222-1, R8222-1, D8222-5',
  },
  on: ['tiers'],
  detect(ctx) {
    const min = subcontractorNoDocs.entry.minConfidence;
    const valid = new Set(
      ctx
        .ofType('attestation_vigilance')
        .filter((a) => a.frontmatter.valid_to >= ctx.today)
        .map((a) => a.frontmatter.party),
    );
    return ctx.ofType('tiers').flatMap((party): Found[] => {
      if (!party.frontmatter.roles.includes('sous_traitant') || valid.has(party.path)) return [];
      const live = ctx.linked(party, 'works_on', min).filter((path) => {
        const site = ctx.get(path);
        return site?.frontmatter.type === 'chantier' && site.frontmatter.status === 'en_cours';
      });
      if (live.length === 0) return [];
      return [
        {
          entity: party.path,
          facts: {
            party: party.frontmatter.title,
            siren: party.frontmatter.siren ?? null,
            chantiers: live.map((s) => ctx.title(s)),
          },
          cites: [party.path, ...live],
        },
      ];
    });
  },
};
