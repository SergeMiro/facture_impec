import { t } from '@fi/shared';

// Placeholder task pane. The real screens (Connexion, Détection, Tableau de bord, …) arrive in M3.
export function App() {
  return (
    <main style={{ fontFamily: 'Segoe UI, sans-serif', padding: 16 }}>
      <h1>{t('app.title')}</h1>
      <p>{t('app.tagline')}</p>
      <p>{t('app.underConstruction')}</p>
    </main>
  );
}
