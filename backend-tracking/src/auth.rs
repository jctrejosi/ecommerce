//! Autenticación de la ingesta mediante API keys.
//!
//! Se guarda solo `sha256(key + salt)` en `tracking_api_keys`. La ingesta
//! mantiene una caché en memoria con TTL corto para no consultar la BD en cada
//! petición.

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::store;

/// Hash de una API key con la sal configurada. Nunca se registra la clave.
pub fn hash_api_key(key: &str, salt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key.as_bytes());
    hasher.update(b":");
    hasher.update(salt.as_bytes());
    hex::encode(hasher.finalize())
}

#[derive(Debug, Clone)]
struct CacheEntry {
    key_id: i64,
    expires_at: Instant,
}

pub struct ApiKeyAuthorizer {
    pool: PgPool,
    salt: String,
    ttl: Duration,
    cache: RwLock<HashMap<String, CacheEntry>>,
}

impl ApiKeyAuthorizer {
    pub fn new(pool: PgPool, salt: impl Into<String>, ttl: Duration) -> Self {
        Self {
            pool,
            salt: salt.into(),
            ttl,
            cache: RwLock::new(HashMap::new()),
        }
    }

    /// Devuelve el `id` de la API key si es válida y está activa.
    pub async fn authorize(&self, api_key: &str) -> anyhow::Result<Option<i64>> {
        if api_key.trim().is_empty() {
            return Ok(None);
        }

        let hash = hash_api_key(api_key.trim(), &self.salt);

        if let Some(key_id) = self.cached(&hash) {
            return Ok(Some(key_id));
        }

        let key_id = store::find_active_api_key(&self.pool, &hash).await?;

        if let Some(key_id) = key_id {
            self.remember(&hash, key_id);
            // Best effort: no bloquea la respuesta.
            let pool = self.pool.clone();
            tokio::spawn(async move {
                if let Err(err) = store::touch_api_key(&pool, key_id).await {
                    tracing::debug!(error = %err, "no se pudo actualizar last_used_at");
                }
            });
            Ok(Some(key_id))
        } else {
            Ok(None)
        }
    }

    fn cached(&self, hash: &str) -> Option<i64> {
        let cache = self.cache.read().ok()?;
        let entry = cache.get(hash)?;
        (entry.expires_at > Instant::now()).then_some(entry.key_id)
    }

    fn remember(&self, hash: &str, key_id: i64) {
        if let Ok(mut cache) = self.cache.write() {
            // Limpieza simple para que la caché no crezca sin control.
            if cache.len() > 1_024 {
                let now = Instant::now();
                cache.retain(|_, entry| entry.expires_at > now);
            }
            cache.insert(
                hash.to_string(),
                CacheEntry {
                    key_id,
                    expires_at: Instant::now() + self.ttl,
                },
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_es_estable_y_depende_de_la_sal() {
        let a = hash_api_key("secret", "salt-a");
        let b = hash_api_key("secret", "salt-a");
        let c = hash_api_key("secret", "salt-b");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 64);
    }
}
