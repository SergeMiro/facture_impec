//! Implémentation B2Brouter du trait `PdpProvider`.
//!
//! ⚠️ Le mapping et les chemins d'endpoint sont établis à partir du plan et de la doc publique ;
//! ils DOIVENT être recoupés avec l'OpenAPI courant (`developer.b2brouter.net/llms.txt`) avant la prod
//! (cf. docs/PDP_INTEGRATION.md). Auth : en-têtes `X-B2B-API-Key` + `X-B2B-API-Version`.

use async_trait::async_trait;
use facture_core::Invoice;
use reqwest::Client;
use serde_json::{json, Value};

use super::{PdpError, PdpProvider, SendResult, StatusResult};

pub struct B2BrouterProvider {
    client: Client,
    base_url: String,
    api_key: String,
    api_version: String,
    account_id: String,
}

impl B2BrouterProvider {
    pub fn new(base_url: String, api_key: String, api_version: String, account_id: String) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key,
            api_version,
            account_id,
        }
    }

    /// Mappe le modèle neutre `Invoice` vers le payload B2Brouter (à confirmer via OpenAPI).
    pub fn map_invoice(&self, inv: &Invoice) -> Value {
        let lines: Vec<Value> = inv
            .lines
            .iter()
            .map(|l| {
                json!({
                    "description": l.description,
                    "quantity": l.quantity,
                    "price": l.unit_price,
                    "unit": l.unit,
                    "tax_percent": l.vat_rate,
                    "tax_category": l.vat_category.as_ref().map(|c| c.code()),
                })
            })
            .collect();

        let taxes: Vec<Value> = inv
            .vat_breakdown
            .iter()
            .map(|b| {
                json!({
                    "name": "TVA",
                    "percent": b.rate,
                    "category": b.category.as_ref().map(|c| c.code()),
                    "comment": b.exemption_reason_code,
                })
            })
            .collect();

        json!({
            "invoice": {
                "number": inv.invoice_number,
                "date": inv.issue_date,
                "due_date": inv.due_date,
                "currency": inv.currency,
                "send_after_import": true,
                "contact": {
                    "name": inv.buyer.name,
                    "vat_number": inv.buyer.vat_id,
                    "country": inv.buyer.address.country_code,
                },
                "invoice_lines_attributes": lines,
                "taxes_attributes": taxes,
            }
        })
    }

    fn extract_id(body: &Value) -> String {
        body.get("id")
            .or_else(|| body.pointer("/invoice/id"))
            .map(|v| match v {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .unwrap_or_default()
    }
}

#[async_trait]
impl PdpProvider for B2BrouterProvider {
    fn name(&self) -> &'static str {
        "b2brouter"
    }

    async fn send(&self, invoice: &Invoice) -> Result<SendResult, PdpError> {
        let url = format!("{}/accounts/{}/invoices", self.base_url, self.account_id);
        let payload = self.map_invoice(invoice);

        let resp = self
            .client
            .post(&url)
            .header("X-B2B-API-Key", &self.api_key)
            .header("X-B2B-API-Version", &self.api_version)
            .json(&payload)
            .send()
            .await
            .map_err(|e| PdpError::Http(e.to_string()))?;

        let status = resp.status();
        let body: Value = resp
            .json()
            .await
            .map_err(|e| PdpError::Response(e.to_string()))?;

        if !status.is_success() {
            return Err(PdpError::Response(format!("HTTP {status} : {body}")));
        }

        let state = body
            .get("state")
            .and_then(|v| v.as_str())
            .unwrap_or("submitted")
            .to_string();

        Ok(SendResult {
            id: Self::extract_id(&body),
            status: state,
            provider: "b2brouter".into(),
            simulated: false,
        })
    }

    async fn status(&self, id: &str) -> Result<StatusResult, PdpError> {
        let url = format!(
            "{}/accounts/{}/invoices/{}",
            self.base_url, self.account_id, id
        );
        let resp = self
            .client
            .get(&url)
            .header("X-B2B-API-Key", &self.api_key)
            .header("X-B2B-API-Version", &self.api_version)
            .send()
            .await
            .map_err(|e| PdpError::Http(e.to_string()))?;

        let status = resp.status();
        let body: Value = resp
            .json()
            .await
            .map_err(|e| PdpError::Response(e.to_string()))?;

        if !status.is_success() {
            return Err(PdpError::Response(format!("HTTP {status} : {body}")));
        }

        let state = body
            .get("state")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        Ok(StatusResult {
            id: id.to_string(),
            status: state,
            provider: "b2brouter".into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_lines_and_taxes() {
        let provider = B2BrouterProvider::new(
            "https://api-staging.b2brouter.net".into(),
            "k".into(),
            "2.0".into(),
            "42".into(),
        );
        let inv = Invoice {
            invoice_number: Some("F-1".into()),
            currency: Some("EUR".into()),
            lines: vec![facture_core::model::Line {
                description: Some("Conseil".into()),
                quantity: Some("2".parse().unwrap()),
                unit_price: Some("100.00".parse().unwrap()),
                vat_rate: Some("20".parse().unwrap()),
                vat_category: Some(facture_core::model::VatCategory::Standard),
                ..Default::default()
            }],
            ..Default::default()
        };

        let payload = provider.map_invoice(&inv);
        assert_eq!(payload["invoice"]["number"], "F-1");
        assert_eq!(payload["invoice"]["send_after_import"], true);
        assert_eq!(
            payload["invoice"]["invoice_lines_attributes"][0]["tax_category"],
            "S"
        );
    }
}
