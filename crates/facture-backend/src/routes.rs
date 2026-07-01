//! Routes HTTP : santé, revalidation, envoi, statut.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::{
    extract::{Path, Request, State},
    http::{header::AUTHORIZATION, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use facture_core::{validate, Invoice};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_http::cors::{Any, CorsLayer};

use crate::ai::AiChecker;
use crate::ocr::{self, HeuristicExtractor, InvoiceExtractor};
use crate::pdp::PdpProvider;

#[derive(Clone)]
pub struct AppState {
    pub provider: Arc<dyn PdpProvider>,
    pub ai: Arc<dyn AiChecker>,
    /// Jeton Bearer attendu sur les routes mutantes ; `None` = ouvert (dev).
    pub auth_token: Option<String>,
    /// Cache d'idempotence des envois (mémoire ; en prod : store persistant). Clé → résultat.
    pub idem: Arc<Mutex<HashMap<String, Value>>>,
}

impl AppState {
    /// Construit un état avec un cache d'idempotence vide.
    pub fn new(
        provider: Arc<dyn PdpProvider>,
        ai: Arc<dyn AiChecker>,
        auth_token: Option<String>,
    ) -> Self {
        Self {
            provider,
            ai,
            auth_token,
            idem: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub fn router(state: AppState, allowed_origin: &str) -> Router {
    // Routes mutantes / sortantes : protégées par jeton (si configuré).
    let protected = Router::new()
        .route("/api/send", post(send_handler))
        .route("/api/status/:id", get(status_handler))
        .route("/api/ai-check", post(ai_check_handler))
        .route("/api/import", post(import_handler))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_auth));

    // Routes ouvertes : santé et revalidation (pures, sans secret ni effet de bord).
    let open = Router::new()
        .route("/health", get(health))
        .route("/api/validate", post(validate_handler));

    Router::new()
        .merge(protected)
        .merge(open)
        .layer(build_cors(allowed_origin))
        .with_state(state)
}

/// Middleware : exige `Authorization: Bearer <APP_TOKEN>` si un jeton est configuré.
async fn require_auth(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    if let Some(expected) = &state.auth_token {
        let provided = req
            .headers()
            .get(AUTHORIZATION)
            .and_then(|h| h.to_str().ok());
        let ok = provided == Some(format!("Bearer {expected}").as_str());
        if !ok {
            return Err(StatusCode::UNAUTHORIZED);
        }
    }
    Ok(next.run(req).await)
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
/// Idempotent : une même clé (`Idempotency-Key` ou numéro de facture) ne réémet pas.
/// Multi-tenant : en-tête `X-Account-Id` pour cibler un compte reseller.
async fn send_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
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

    let idem_key = header_str(&headers, "idempotency-key")
        .map(str::to_string)
        .or_else(|| invoice.invoice_number.clone());

    // Rejeu idempotent : renvoyer le résultat déjà mémorisé sans réémettre.
    if let Some(key) = &idem_key {
        if let Ok(map) = state.idem.lock() {
            if let Some(cached) = map.get(key) {
                let mut body = cached.clone();
                if let Some(obj) = body.as_object_mut() {
                    obj.insert("idempotent_replay".into(), Value::Bool(true));
                }
                return (StatusCode::OK, Json(body)).into_response();
            }
        }
    }

    let account = header_str(&headers, "x-account-id");
    match state.provider.send(&invoice, account).await {
        Ok(result) => {
            let value = json!(result);
            if let Some(key) = idem_key {
                if let Ok(mut map) = state.idem.lock() {
                    map.insert(key, value.clone());
                }
            }
            (StatusCode::OK, Json(value)).into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": "pdp", "message": e.to_string() })),
        )
            .into_response(),
    }
}

fn header_str<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(name)
        .and_then(|h| h.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

#[derive(Deserialize)]
struct ImportReq {
    /// Contenu du fichier encodé en base64 (PDF ou texte).
    content_base64: String,
    /// Type MIME indicatif (ex. "application/pdf", "text/plain").
    #[serde(default)]
    content_type: Option<String>,
}

/// Import : décode le fichier, extrait le texte (PDF ou brut), structure en `Invoice`, revalide.
async fn import_handler(Json(req): Json<ImportReq>) -> impl IntoResponse {
    let bytes = match STANDARD.decode(req.content_base64.trim()) {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "base64", "message": "Contenu base64 invalide." })),
            )
                .into_response()
        }
    };

    let is_pdf = req
        .content_type
        .as_deref()
        .map(|c| c.contains("pdf"))
        .unwrap_or(false)
        || ocr::looks_like_pdf(&bytes);

    let text = if is_pdf {
        match ocr::pdf_to_text(&bytes) {
            Ok(t) => t,
            Err(e) => {
                return (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    Json(json!({ "error": "pdf", "message": e.to_string() })),
                )
                    .into_response()
            }
        }
    } else {
        String::from_utf8_lossy(&bytes).to_string()
    };

    let invoice = HeuristicExtractor.structure(&text);
    let report = validate(&invoice);
    let preview: String = text.chars().take(600).collect();

    Json(json!({
        "invoice": invoice,
        "report": report,
        "text_preview": preview,
    }))
    .into_response()
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
