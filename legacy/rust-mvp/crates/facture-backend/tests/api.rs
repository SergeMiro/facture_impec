//! Tests d'intégration des routes (via `tower::ServiceExt::oneshot`, sans ouvrir de socket).

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use facture_backend::ai::DisabledChecker;
use facture_backend::pdp::mock::MockProvider;
use facture_backend::pdp::{PdpError, PdpProvider, SendResult, StatusResult};
use facture_backend::routes::{router, AppState};
use facture_core::Invoice;
use http_body_util::BodyExt;
use tower::ServiceExt;

fn app() -> axum::Router {
    router(
        AppState::new(Arc::new(MockProvider), Arc::new(DisabledChecker), None),
        "*",
    )
}

/// Fournisseur de test qui compte ses envois (pour prouver l'idempotence).
struct CountingProvider {
    count: Arc<AtomicUsize>,
}

#[async_trait::async_trait]
impl PdpProvider for CountingProvider {
    fn name(&self) -> &'static str {
        "count"
    }
    async fn send(
        &self,
        invoice: &Invoice,
        _account: Option<&str>,
    ) -> Result<SendResult, PdpError> {
        self.count.fetch_add(1, Ordering::SeqCst);
        Ok(SendResult {
            id: format!("ID-{}", invoice.invoice_number.as_deref().unwrap_or("x")),
            status: "accepted".into(),
            provider: "count".into(),
            simulated: false,
        })
    }
    async fn status(&self, id: &str) -> Result<StatusResult, PdpError> {
        Ok(StatusResult {
            id: id.to_string(),
            status: "accepted".into(),
            provider: "count".into(),
        })
    }
}

fn valid_invoice_json() -> String {
    r#"{
      "invoice_number": "F-2026-001",
      "issue_date": "2026-09-01",
      "due_date": "2026-10-01",
      "type_code": "380",
      "currency": "EUR",
      "seller": {
        "name": "Vendeur SARL",
        "siren": "732829320",
        "siret": "73282932000074",
        "vat_id": "FR44732829320",
        "address": { "line1": "1 rue de Paris", "postal_code": "75001", "city": "Paris", "country_code": "FR" }
      },
      "buyer": {
        "name": "Acheteur SAS",
        "address": { "line1": "2 avenue de Lyon", "postal_code": "69001", "city": "Lyon", "country_code": "FR" }
      },
      "lines": [
        { "description": "Conseil", "quantity": "10", "unit": "h", "unit_price": "100.00", "line_amount": "1000.00", "vat_rate": "20", "vat_category": "S" },
        { "description": "Frais", "quantity": "2", "unit": "u", "unit_price": "50.00", "line_amount": "100.00", "vat_rate": "20", "vat_category": "S" }
      ],
      "vat_breakdown": [ { "category": "S", "rate": "20", "taxable_amount": "1100.00", "tax_amount": "220.00" } ],
      "totals": {
        "line_extension_amount": "1100.00", "tax_exclusive_amount": "1100.00", "tax_amount": "220.00",
        "tax_inclusive_amount": "1320.00", "payable_amount": "1320.00"
      }
    }"#
    .to_string()
}

async fn post_json(uri: &str, body: String) -> (StatusCode, serde_json::Value) {
    let req = Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(body))
        .unwrap();
    let resp = app().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, value)
}

#[tokio::test]
async fn health_ok() {
    let resp = app()
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn validate_reports_sendable() {
    let (status, body) = post_json("/api/validate", valid_invoice_json()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["is_sendable"], true);
    assert_eq!(body["issues"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn send_valid_returns_simulated_id() {
    let (status, body) = post_json("/api/send", valid_invoice_json()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["simulated"], true);
    assert_eq!(body["status"], "accepted");
    assert!(body["id"].as_str().unwrap().starts_with("SIM-"));
}

#[tokio::test]
async fn import_text_structures_invoice() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let text =
        "FACTURE n° F-2026-042\nDate : 01/09/2026\nSIRET 73282932000074\nTotal TTC : 120,00 €";
    let body = serde_json::json!({
        "content_base64": STANDARD.encode(text),
        "content_type": "text/plain",
    })
    .to_string();

    let (status, resp) = post_json("/api/import", body).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(resp["invoice"]["invoice_number"], "F-2026-042");
    assert_eq!(resp["invoice"]["seller"]["siret"], "73282932000074");
    // Sans lignes, la facture n'est pas encore envoyable : l'utilisateur complète.
    assert_eq!(resp["report"]["is_sendable"], false);
}

#[tokio::test]
async fn ai_check_disabled_returns_empty() {
    let (status, body) = post_json("/api/ai-check", valid_invoice_json()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["enabled"], false);
    assert_eq!(body["warnings"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn send_invalid_is_refused() {
    // Retire le numéro de facture → BR-02 (erreur dure) → 422, pas d'envoi.
    let broken = valid_invoice_json().replace(
        r#""invoice_number": "F-2026-001""#,
        r#""invoice_number": null"#,
    );
    let (status, body) = post_json("/api/send", broken).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["error"], "validation");
    assert_eq!(body["report"]["is_sendable"], false);
}

#[tokio::test]
async fn protected_routes_require_token() {
    let app = router(
        AppState::new(
            Arc::new(MockProvider),
            Arc::new(DisabledChecker),
            Some("secret".into()),
        ),
        "*",
    );

    // Sans jeton → 401.
    let no_token = Request::builder()
        .method("POST")
        .uri("/api/send")
        .header("content-type", "application/json")
        .body(Body::from(valid_invoice_json()))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(no_token).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );

    // Avec le bon jeton → 200.
    let with_token = Request::builder()
        .method("POST")
        .uri("/api/send")
        .header("content-type", "application/json")
        .header("authorization", "Bearer secret")
        .body(Body::from(valid_invoice_json()))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(with_token).await.unwrap().status(),
        StatusCode::OK
    );

    // /health reste ouvert.
    let health = Request::builder()
        .uri("/health")
        .body(Body::empty())
        .unwrap();
    assert_eq!(app.oneshot(health).await.unwrap().status(), StatusCode::OK);
}

#[tokio::test]
async fn send_is_idempotent() {
    let count = Arc::new(AtomicUsize::new(0));
    let app = router(
        AppState::new(
            Arc::new(CountingProvider {
                count: count.clone(),
            }),
            Arc::new(DisabledChecker),
            None,
        ),
        "*",
    );

    for _ in 0..2 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/send")
            .header("content-type", "application/json")
            .body(Body::from(valid_invoice_json()))
            .unwrap();
        assert_eq!(
            app.clone().oneshot(req).await.unwrap().status(),
            StatusCode::OK
        );
    }

    // Même facture (même numéro) → un seul envoi réel.
    assert_eq!(count.load(Ordering::SeqCst), 1);
}
