import { PUBLIC_CONTACT_EMAIL } from 'astro:env/client';
import type { IconName } from '../components/Icon';

// All marketing copy that appears in more than one place (landing page and /presentation).

export const deadlines = {
  reception: { date: '2026-09-01', label: '1er septembre 2026' },
  emission: { date: '2027-09-01', label: '1er septembre 2027' },
} as const;

export const trialDays = 30;
// Real sends to the platform during the trial are capped; Mode test is unlimited (PRICING.md §3.2).
export const trialRealSends = 10;

export interface Offer {
  name: string;
  pitch: string;
  price: number;
  unit: string;
  features: string[];
  cta: string;
}

// The single price the owner set on 2026-11-18: 2,99 € HT a month, no commitment, after the trial.
// It replaces the three plans proposed in docs/research/PRICING.md §3.2.
export const offer: Offer = {
  name: 'Facture Impec',
  pitch: 'Pour l’artisan, l’indépendant, la TPE et la PME qui facturent dans Excel.',
  price: 2.99,
  unit: '/ mois',
  features: [
    'Vérification avant envoi dans Excel : EN 16931 et mentions françaises',
    'Conversion Factur-X et envoi par une plateforme agréée',
    'Suivi des statuts jusqu’au paiement, directement dans votre feuille',
    'Factures fournisseurs reçues et contrôlées dans Excel',
    'Relances prêtes à envoyer, pénalités de retard calculées',
    'Rapport hebdomadaire et export pour votre comptable',
    'Assistant IA facultatif, avec votre propre clé',
  ],
  cta: 'Commencer l’essai gratuit',
};

export interface Provider {
  name: string;
  note: string;
  eu?: boolean;
}

export const providers: Provider[] = [
  { name: 'Mistral AI', note: 'Modèles européens, hébergés en UE', eu: true },
  { name: 'Anthropic Claude', note: 'Raisonnement et explications de haut niveau' },
  { name: 'OpenAI', note: 'GPT, avec votre clé' },
  { name: 'Google Gemini', note: 'Modèles rapides et économiques' },
  { name: 'Azure OpenAI', note: 'Déploiement dans une région UE', eu: true },
  { name: 'Scaleway · OVHcloud', note: 'Fournisseurs français compatibles OpenAI', eu: true },
  { name: 'OpenRouter · Groq', note: 'Tout service compatible OpenAI' },
  { name: 'Ollama · LM Studio', note: 'Votre modèle, sur votre serveur', eu: true },
];

export interface Feature {
  icon: IconName;
  title: string;
  text: string;
}

export const features: Feature[] = [
  {
    icon: 'sheet',
    title: 'Vous restez dans Excel',
    text: 'Aucun nouveau logiciel. Facture Impec lit vos colonnes telles qu’elles sont et ajoute deux colonnes de suivi, sans jamais toucher aux vôtres.',
  },
  {
    icon: 'shield',
    title: 'Vérification instantanée',
    text: 'Les règles de la norme européenne EN 16931 et les mentions obligatoires françaises : SIREN, TVA, totaux, échéances. Chaque erreur pointe la cellule à corriger.',
  },
  {
    icon: 'flask',
    title: 'Mode test, sans risque',
    text: 'Répétez tout le parcours avant le premier envoi réel : rejet, refus, paiement tardif. Rien ne part tant que vous n’êtes pas prêt.',
  },
  {
    icon: 'send',
    title: 'Envoi en un clic',
    text: 'Conversion au format Factur-X et transmission par une plateforme agréée par l’administration fiscale. Vous gardez la main sur chaque envoi.',
  },
  {
    icon: 'bell',
    title: 'Relances qui font payer',
    text: 'Échéances suivies, relances courtoises puis fermes préparées pour vous. Une mise en demeure n’est jamais envoyée sans votre accord.',
  },
  {
    icon: 'inbox',
    title: 'Réception des factures fournisseurs',
    text: 'Vos factures reçues arrivent au même endroit, contrôlées : doublons, TVA incohérente, IBAN modifié. Export prêt pour votre comptable.',
  },
  {
    icon: 'history',
    title: 'Tout est tracé',
    text: 'Chaque facture a son historique complet : qui, quoi, quand. Utile pour vous, votre comptable et en cas de contrôle.',
  },
  {
    icon: 'chart',
    title: 'Votre trésorerie en clair',
    text: 'Chaque lundi, un résumé en dix lignes : ce qui est encaissé, ce qui est en retard, les trois actions qui vous attendent.',
  },
];

export interface Faq {
  q: string;
  a: string;
}

export const faqs: Faq[] = [
  {
    q: 'Dois-je changer de logiciel de facturation ?',
    a: 'Non. Vous continuez à facturer dans Excel, avec vos modèles. Facture Impec s’installe comme un complément et s’adapte à vos colonnes.',
  },
  {
    q: 'Facture Impec est-il une plateforme agréée ?',
    a: 'Facture Impec est une solution compatible : nous préparons et contrôlons vos factures, puis les transmettons par une plateforme agréée immatriculée par l’administration fiscale. C’est elle qui achemine la facture et transmet les données à l’État.',
  },
  {
    q: 'Est-ce que ça marche sur Mac et sur Excel en ligne ?',
    a: 'Oui : Excel pour Windows, Excel pour Mac et Excel sur le web (Microsoft 365).',
  },
  {
    q: 'Que se passe-t-il si une facture est rejetée ?',
    a: 'Vous êtes prévenu dans votre feuille, avec la raison en français simple et la correction à faire. Votre facture n’est pas perdue : vous corrigez, vous renvoyez.',
  },
  {
    q: 'Où sont mes données ? Et l’IA ?',
    a: 'Vos données sont hébergées dans l’Union européenne. Avant tout appel à une IA, les noms, SIREN, IBAN et adresses sont remplacés par des jetons anonymes. L’IA explique et propose ; elle ne décide jamais si une facture est valide.',
  },
  {
    q: 'L’IA est-elle obligatoire ?',
    a: 'Non. Toutes les vérifications reposent sur des règles et fonctionnent sans IA. L’assistant IA (explications, reconnaissance des colonnes, relances rédigées) est facultatif : vous branchez votre propre clé Mistral, OpenAI, Anthropic, Gemini, Azure OpenAI ou de tout service compatible OpenAI, y compris un modèle hébergé chez vous.',
  },
  {
    q: 'Comment fonctionne l’essai gratuit ?',
    a: '30 jours avec toutes les fonctionnalités, sans carte bancaire. Le mode test est illimité ; jusqu’à 10 factures peuvent être envoyées pour de vrai pendant l’essai. Ensuite, 2,99 € HT par mois, sans engagement.',
  },
  {
    q: 'Combien de temps pour démarrer ?',
    a: 'Une dizaine de minutes : installer le complément, laisser Facture Impec reconnaître vos colonnes, corriger ce qu’il signale, lancer une répétition en mode test.',
  },
  {
    q: 'Je suis expert-comptable. Puis-je l’utiliser pour mes clients ?',
    a: 'Oui : chaque dossier client a son propre abonnement à 2,99 € HT par mois, et le complément se déploie de façon centralisée dans votre cabinet, à votre marque.',
  },
];

// Publisher identity for the legal pages. Nulls render as a visible "à compléter" marker: fill them
// in before the site goes to production (LCEN art. 6 III requires them).
export const legal = {
  publisher: null as string | null,
  legalForm: null as string | null,
  siren: null as string | null,
  address: null as string | null,
  director: null as string | null,
  email: PUBLIC_CONTACT_EMAIL,
};
