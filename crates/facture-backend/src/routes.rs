//! Routes HTTP : santé, revalidation, envoi, statut.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{HeaderValue, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use facture_core::{validate, Invoice};
use serde_json::json;
use tower_http::cors::{Any, CorsLayer};

use crate::ai::AiChecker;
use crate::pdp::PdpProvider;

#[derive(Clone)]
pub struct AppState {
    pub provider: Arc<dyn PdpProvider>,
    pub ai: Arc<dyn AiChecker>,
}

pub fn router(state: AppState, allowed_origin: &str) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/validate", post(validate_handler))
        .route("/api/send", post(send_handler))
        .route("/api/status/:id", get(status_handler))
        .route("/api/ai-check", post(ai_check_handler))
        .layer(build_cors(allowed_origin))
        .with_state(state)
}

fn build_cors(allowed_origin: &str) -> CorsLayer {
    let layer = CorsLayer::new().allow_methods(Any).allow_headers(Any);
    if allowed_origin == "*" {
        layer.allow_origin(Any)
    } else {
        match HeaderValue::from_str(allowed_origin) {
            Ok(v) => layer.allow_origin(v),
            Err(_) => layer.allow_origin(Any),
        }
    }
}

async fn health() -> &'static str {
    "ok"
}

/// Revalidation serveur (defense in depth) : renvoie le `ValidationReport`.
async fn validate_handler(Json(invoice): Json<Invoice>) -> impl IntoResponse {
    Json(validate(&invoice))
}

/// Revalide puis envoie via la plateforme agréée. Refuse (422) si des erreurs dures subsistent.
async fn send_handler(
    State(state): State<AppState>,
    Json(invoice): Json<Invoice>,
) -> impl IntoResponse {
    let report = validate(&invoice);
    if !report.is_sendable {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({
                "error": "validation",
                "message": "La facture contient des erreurs bloquantes ; envoi refusé.",
                "report": report,
            })),
        )
            .into_response();
    }

    match state.provider.send(&invoice).await {
        Ok(result) => (StatusCode::OK, Json(json!(result))).into_response(),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": "pdp", "message": e.to_string() })),
        )
            .into_response(),
    }
}

/// Couche IA douce : renvoie des avertissements jaunes (jamais bloquant).
async fn ai_check_handler(
    State(state): State<AppState>,
    Json(invoice): Json<Invoice>,
) -> impl IntoResponse {
    let warnings = state.ai.check(&invoice).await;
    Json(json!({ "enabled": state.ai.enabled(), "warnings": warnings }))
}

async fn status_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.provider.status(&id).await {
        Ok(result) => (StatusCode::OK, Json(json!(result))).into_response(),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": "pdp", "message": e.to_string() })),
        )
            .into_response(),
    }
}
