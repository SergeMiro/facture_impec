//! Point d'entrée du backend Facture Impec.

use std::sync::Arc;

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

    let app = router(AppState { provider }, &cfg.allowed_origin);

    let listener = tokio::net::TcpListener::bind(&cfg.bind_addr)
        .await
        .expect("liaison du port impossible");
    tracing::info!("facture-backend écoute sur http://{}", cfg.bind_addr);

    axum::serve(listener, app)
        .await
        .expect("serveur interrompu");
}
