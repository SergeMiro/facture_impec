//! Tests d'intégration des routes (via `tower::ServiceExt::oneshot`, sans ouvrir de socket).

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use facture_backend::pdp::mock::MockProvider;
use facture_backend::routes::{router, AppState};
use http_body_util::BodyExt;
use tower::ServiceExt;

fn app() -> axum::Router {
    router(
        AppState {
            provider: Arc::new(MockProvider),
        },
        "*",
    )
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
