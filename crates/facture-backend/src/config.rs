//! Configuration via variables d'environnement. Les secrets ne sont jamais commités.

use std::env;

pub struct Config {
    pub bind_addr: String,
    /// Origine autorisée pour le CORS ("*" pour tout autoriser en démo).
    pub allowed_origin: String,
    /// Présent si une clé B2Brouter est configurée ; sinon on tombe sur le MockProvider.
    pub b2b: Option<B2bConfig>,
}

pub struct B2bConfig {
    pub base_url: String,
    pub api_key: String,
    pub api_version: String,
    pub account_id: String,
}

impl Config {
    pub fn from_env() -> Self {
        let bind_addr = env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into());
        let allowed_origin = env::var("ALLOWED_ORIGIN").unwrap_or_else(|_| "*".into());

        let api_key = env::var("B2BROUTER_API_KEY").unwrap_or_default();
        let account_id = env::var("B2BROUTER_ACCOUNT_ID").unwrap_or_default();
        let b2b = if !api_key.is_empty() && !account_id.is_empty() {
            Some(B2bConfig {
                base_url: env::var("B2BROUTER_BASE_URL")
                    .unwrap_or_else(|_| "https://api-staging.b2brouter.net".into()),
                api_key,
                api_version: env::var("B2BROUTER_API_VERSION").unwrap_or_else(|_| "2.0".into()),
                account_id,
            })
        } else {
            None
        };

        Config {
            bind_addr,
            allowed_origin,
            b2b,
        }
    }
}
