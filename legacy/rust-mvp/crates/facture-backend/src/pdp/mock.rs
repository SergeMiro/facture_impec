//! Fournisseur de simulation : utilisé quand aucune clé B2Brouter n'est configurée.
//! Accepte toute facture déjà jugée valide par le cœur — permet de tester le flux de bout en bout.

use async_trait::async_trait;
use facture_core::Invoice;

use super::{PdpError, PdpProvider, SendResult, StatusResult};

pub struct MockProvider;

#[async_trait]
impl PdpProvider for MockProvider {
    fn name(&self) -> &'static str {
        "simulation"
    }

    async fn send(
        &self,
        invoice: &Invoice,
        _account: Option<&str>,
    ) -> Result<SendResult, PdpError> {
        let num = invoice.invoice_number.as_deref().unwrap_or("SANS-NUMERO");
        Ok(SendResult {
            id: format!("SIM-{num}"),
            status: "accepted".into(),
            provider: "simulation".into(),
            simulated: true,
        })
    }

    async fn status(&self, id: &str) -> Result<StatusResult, PdpError> {
        Ok(StatusResult {
            id: id.to_string(),
            status: "accepted".into(),
            provider: "simulation".into(),
        })
    }
}
