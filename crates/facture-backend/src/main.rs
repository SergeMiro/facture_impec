//! Point d'entrée du backend Facture Impec.

use std::sync::Arc;

use facture_backend::ai::{mistral::MistralChecker, AiChecker, DisabledChecker};
use facture_backend::config::Config;
use facture_backend::pdp::{b2brouter::B2BrouterProvider, mock::MockProvider, PdpProvider};
use facture_backend::routes::{router, AppState};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cfg = Config::from_env();

    // Sécurité (durcissement) : ne jamais exposer /api/send (envoi réel = coût + effet légal)
    // sans authentification. Si une PDP réelle est configurée, un APP_TOKEN est obligatoire.
    if cfg.b2b.is_some() && cfg.auth_token.is_none() {
        panic!(
            "APP_TOKEN est obligatoire lorsque B2Brouter est configuré : la route /api/send \
             ne doit pas être ouverte sans jeton Bearer. Définissez la variable APP_TOKEN."
        );
    }

    let provider: Arc<dyn PdpProvider> = match &cfg.b2b {
        Some(b) => {
            tracing::info!("PDP : B2Brouter ({})", b.base_url);
            Arc::new(B2BrouterProvider::new(
                b.base_url.clone(),
                b.api_key.clone(),
                b.api_version.clone(),
                b.account_id.clone(),
            ))
        }
        None => {
            tracing::warn!(
                "PDP : aucune clé B2Brouter configurée → mode simulation (MockProvider)"
            );
            Arc::new(MockProvider)
        }
    };

    let ai: Arc<dyn AiChecker> = match &cfg.ai {
        Some(a) => {
            tracing::info!("IA : Mistral ({})", a.model);
            Arc::new(MistralChecker::new(a.api_key.clone(), a.model.clone()))
        }
        None => {
            tracing::info!("IA : désactivée (aucune clé Mistral)");
            Arc::new(DisabledChecker)
        }
    };

    if cfg.auth_token.is_some() {
        tracing::info!("Auth : jeton Bearer requis sur les routes mutantes");
    } else {
        tracing::warn!("Auth : aucun APP_TOKEN → routes ouvertes (dev uniquement)");
    }

    let state = AppState::new(provider, ai, cfg.auth_token);
    let app = router(state, &cfg.allowed_origin);

    let listener = tokio::net::TcpListener::bind(&cfg.bind_addr)
        .await
        .expect("liaison du port impossible");
    tracing::info!("facture-backend écoute sur http://{}", cfg.bind_addr);

    axum::serve(listener, app)
        .await
        .expect("serveur interrompu");
}
