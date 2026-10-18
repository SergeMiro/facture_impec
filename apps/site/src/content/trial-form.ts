import type { TrialRequest } from '@fi/shared';

// Copy for the trial-access form, shared by the React island and the /api/trial endpoint.

export type TrialField = keyof TrialRequest;

export const fieldErrors: Record<TrialField, string> = {
  firstName: 'Indiquez votre prénom.',
  lastName: 'Indiquez votre nom.',
  email: 'Cette adresse e-mail ne semble pas valide.',
  company: 'Indiquez le nom de votre entreprise ou de votre cabinet.',
  siren: 'Le SIREN compte 9 chiffres (vous pouvez aussi laisser ce champ vide).',
  profile: 'Choisissez une option.',
  invoicesPerMonth: 'Choisissez une option.',
  excel: 'Choisissez une option.',
  plan: 'Choisissez une offre.',
  message: 'Votre message est trop long (2 000 caractères au plus).',
  consent: 'Merci d’accepter d’être recontacté au sujet de votre essai.',
};

export const volumeOptions: { value: TrialRequest['invoicesPerMonth']; label: string }[] = [
  { value: 'lt20', label: 'Moins de 20' },
  { value: '20to100', label: 'De 20 à 100' },
  { value: '100to500', label: 'De 100 à 500' },
  { value: 'gt500', label: 'Plus de 500' },
];

export const excelOptions: { value: TrialRequest['excel']; label: string }[] = [
  { value: 'windows', label: 'Excel pour Windows' },
  { value: 'mac', label: 'Excel pour Mac' },
  { value: 'web', label: 'Excel sur le web (Microsoft 365)' },
  { value: 'unknown', label: 'Je ne sais pas' },
];

export const planOptions: { value: NonNullable<TrialRequest['plan']>; label: string }[] = [
  { value: 'essentiel', label: 'Essentiel' },
  { value: 'croissance', label: 'Croissance' },
  { value: 'cabinet', label: 'Cabinet' },
];

export const messages = {
  unavailable:
    'Les demandes d’essai ouvrent très bientôt. Votre demande n’a pas été enregistrée : réessayez dans quelques jours.',
  network:
    'Votre demande n’est pas partie : la connexion a été interrompue. Vos informations sont toujours dans le formulaire, il suffit de réessayer.',
  server:
    'Un incident nous empêche d’enregistrer votre demande. Vos informations sont toujours dans le formulaire : réessayez dans un instant.',
  invalid: 'Quelques champs sont à vérifier.',
} as const;
