//! Utilitaires transverses.

use std::future::Future;
use std::time::Duration;

/// Réessaie une opération asynchrone jusqu'à `attempts` fois, avec un délai linéaire (backoff).
///
/// Renvoie le premier succès, ou la dernière erreur si tous les essais échouent.
/// Utilisé pour absorber les erreurs réseau transitoires vers la plateforme agréée / le LLM.
pub async fn retry<T, E, F, Fut>(attempts: u32, base_delay: Duration, mut op: F) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
{
    let total = attempts.max(1);
    let mut last_err: Option<E> = None;
    for attempt in 0..total {
        match op().await {
            Ok(value) => return Ok(value),
            Err(e) => {
                last_err = Some(e);
                if attempt + 1 < total && !base_delay.is_zero() {
                    tokio::time::sleep(base_delay * (attempt + 1)).await;
                }
            }
        }
    }
    Err(last_err.expect("au moins un essai a eu lieu"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    #[tokio::test]
    async fn succeeds_after_transient_failures() {
        let calls = AtomicU32::new(0);
        let result: Result<u32, &str> = retry(3, Duration::ZERO, || {
            let n = calls.fetch_add(1, Ordering::SeqCst);
            async move {
                if n < 2 {
                    Err("transitoire")
                } else {
                    Ok(42)
                }
            }
        })
        .await;
        assert_eq!(result, Ok(42));
        assert_eq!(calls.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn gives_up_after_all_attempts() {
        let calls = AtomicU32::new(0);
        let result: Result<u32, &str> = retry(2, Duration::ZERO, || {
            calls.fetch_add(1, Ordering::SeqCst);
            async move { Err("échec") }
        })
        .await;
        assert_eq!(result, Err("échec"));
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }
}
