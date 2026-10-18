//! Implémentation LLM via **Mistral** (hébergement EU — RGPD).
//!
//! Envoie une version MINIMISÉE de la facture (pas d'adresse complète ni d'IBAN) et exige
//! une réponse JSON stricte. Toute déviation → ignorée (aucun avertissement fabriqué).

use async_trait::async_trait;
use facture_core::{Invoice, Issue};
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;

use super::AiChecker;

const DEFAULT_BASE: &str = "https://api.mistral.ai";

pub struct MistralChecker {
    client: Client,
    api_key: String,
    model: String,
    base_url: String,
}

#[derive(Deserialize)]
struct LlmWarning {
    code: Option<String>,
    field: Option<String>,
    message_fr: String,
}

#[derive(Deserialize)]
struct LlmOutput {
    warnings: Vec<LlmWarning>,
}

impl MistralChecker {
    pub fn new(api_key: String, model: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
            model,
            base_url: DEFAULT_BASE.to_string(),
        }
    }

    fn system_prompt() -> &'static str {
        "Tu es un assistant de contrôle de facture française. On te fournit une facture DÉJÀ valide \
         formellement. Repère UNIQUEMENT des anomalies sémantiques douces, NON bloquantes : taux de TVA \
         improbable pour la nature du service, incohérence description ↔ prix, raison sociale douteuse, \
         montants suspects, logique de dates. N'invente jamais d'erreur bloquante. \
         Réponds STRICTEMENT en JSON, sans préambule, au format : \
         {\"warnings\":[{\"code\":\"AI-...\",\"field\":\"lines[0].vat_rate\",\"message_fr\":\"...\"}]}. \
         Si rien d'anormal, renvoie {\"warnings\":[]}."
    }

    /// Version minimisée envoyée au LLM (RGPD : pas d'adresse, pas d'IBAN).
    fn minimized(invoice: &Invoice) -> serde_json::Value {
        json!({
            "currency": invoice.currency,
            "issue_date": invoice.issue_date,
            "due_date": invoice.due_date,
            "seller_name": invoice.seller.name,
            "buyer_name": invoice.buyer.name,
            "lines": invoice.lines.iter().map(|l| json!({
                "description": l.description,
                "quantity": l.quantity,
                "unit_price": l.unit_price,
                "vat_rate": l.vat_rate,
                "vat_category": l.vat_category.as_ref().map(|c| c.code()),
            })).collect::<Vec<_>>(),
            "total_ttc": invoice.totals.tax_inclusive_amount,
        })
    }

    /// Garde-fou : transforme le contenu LLM en avertissements DOUX. Contenu invalide → vecteur vide.
    fn parse_warnings(content: &str) -> Vec<Issue> {
        let parsed: LlmOutput = match serde_json::from_str(content.trim()) {
            Ok(p) => p,
            Err(_) => return Vec::new(),
        };
        parsed
            .warnings
            .into_iter()
            .map(|w| {
                let code = w
                    .code
                    .filter(|c| c.starts_with("AI-"))
                    .unwrap_or_else(|| "AI-LLM".to_string());
                Issue::soft(code, w.field.unwrap_or_default(), w.message_fr)
            })
            .collect()
    }
}

#[async_trait]
impl AiChecker for MistralChecker {
    fn enabled(&self) -> bool {
        true
    }

    async fn check(&self, invoice: &Invoice) -> Vec<Issue> {
        let payload = json!({
            "model": self.model,
            "temperature": 0.1,
            "response_format": { "type": "json_object" },
            "messages": [
                { "role": "system", "content": Self::system_prompt() },
                { "role": "user", "content": Self::minimized(invoice).to_string() }
            ]
        });

        let resp = match self
            .client
            .post(format!("{}/v1/chat/completions", self.base_url))
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("IA Mistral injoignable : {e}");
                return Vec::new();
            }
        };

        let body: serde_json::Value = match resp.json().await {
            Ok(b) => b,
            Err(_) => return Vec::new(),
        };

        let content = body
            .pointer("/choices/0/message/content")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        Self::parse_warnings(content)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use facture_core::Severity;

    #[test]
    fn parses_valid_warnings_as_soft() {
        let content = r#"{"warnings":[{"code":"AI-VAT-RATE","field":"lines[0].vat_rate","message_fr":"Taux inhabituel."}]}"#;
        let issues = MistralChecker::parse_warnings(content);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "AI-VAT-RATE");
        assert_eq!(issues[0].severity, Severity::SoftWarning);
    }

    #[test]
    fn normalizes_missing_or_bad_code() {
        let content = r#"{"warnings":[{"message_fr":"x"},{"code":"HARD","message_fr":"y"}]}"#;
        let issues = MistralChecker::parse_warnings(content);
        assert_eq!(issues.len(), 2);
        assert!(issues.iter().all(|i| i.code == "AI-LLM"));
        assert!(issues.iter().all(|i| i.severity == Severity::SoftWarning));
    }

    #[test]
    fn ignores_malformed_output() {
        assert!(MistralChecker::parse_warnings("pas du json").is_empty());
        assert!(MistralChecker::parse_warnings("{\"bad\":true}").is_empty());
    }
}
