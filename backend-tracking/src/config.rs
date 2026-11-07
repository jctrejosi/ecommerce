//! Configuración por variables de entorno.
//!
//! Todas las variables llevan el prefijo `TRACKING_`. Se puede usar un archivo
//! `.env` en el directorio del crate (se carga con `dotenvy` desde los binarios).

use std::env;
use std::net::SocketAddr;
use std::time::Duration;

use anyhow::{bail, Context, Result};

const DEV_SALT: &str = "dev-insecure-salt-change-me";

#[derive(Debug, Clone)]
pub struct Config {
    /// Dirección de escucha de la ingesta (`TRACKING_BIND_ADDR`).
    pub bind_addr: SocketAddr,
    /// Cadena de conexión a PostgreSQL (`mercaldas_tracking`).
    pub database_url: String,
    /// URL del broker Redis Streams.
    pub redis_url: String,
    /// Sal con la que se hashean las API keys antes de guardarlas/consultarlas.
    pub api_key_salt: String,
    /// Sal con la que se hashea la IP de origen (nunca se guarda la IP en claro).
    pub ip_hash_salt: String,
    /// Stream principal de eventos.
    pub stream_name: String,
    /// Stream de mensajes que no se pudieron procesar.
    pub dead_letter_stream: String,
    /// Consumer group del worker.
    pub consumer_group: String,
    /// Nombre de este consumidor dentro del grupo.
    pub consumer_name: String,
    /// Máximo de eventos por petición en la ingesta.
    pub batch_size: usize,
    /// Retención aproximada del stream (`MAXLEN ~`).
    pub max_stream_len: usize,
    /// Kill switch general. Si está en `false` la ingesta responde 503.
    pub enabled: bool,
    /// Orígenes permitidos por CORS.
    pub allowed_origins: Vec<String>,
    /// Rate limit de peticiones por minuto y por origen.
    pub request_limit_per_min: u32,
    /// Rate limit de eventos por minuto y por origen.
    pub event_limit_per_min: u32,
    /// Bloqueo de `XREADGROUP` en milisegundos.
    pub read_block_ms: usize,
    /// Antigüedad mínima (ms) para reclamar mensajes pendientes de otro worker.
    pub claim_min_idle_ms: u64,
    /// Cada cuánto se intenta reclamar mensajes huérfanos.
    pub claim_interval: Duration,
    /// Tamaño máximo del pool de PostgreSQL.
    pub db_max_connections: u32,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let database_url = env_var("TRACKING_DATABASE_URL")
            .or_else(|| env_var("DATABASE_URL"))
            .context(
                "falta TRACKING_DATABASE_URL (o DATABASE_URL) apuntando a mercaldas_tracking",
            )?;

        let api_key_salt = env_var("TRACKING_API_KEY_SALT").unwrap_or_else(|| {
            tracing::warn!(
                "TRACKING_API_KEY_SALT no está definida; usando la sal de desarrollo. \
                 Definir una sal propia en producción."
            );
            DEV_SALT.to_string()
        });

        let ip_hash_salt = env_var("TRACKING_IP_HASH_SALT").unwrap_or_else(|| api_key_salt.clone());

        let bind_addr = parse_or("TRACKING_BIND_ADDR", "0.0.0.0:8090")?;

        let allowed_origins = env_var("TRACKING_ALLOWED_ORIGINS")
            .map(|raw| {
                raw.split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_else(default_origins);

        let config = Self {
            bind_addr,
            database_url,
            redis_url: env_var("TRACKING_REDIS_URL")
                .unwrap_or_else(|| "redis://localhost:6380/0".to_string()),
            api_key_salt,
            ip_hash_salt,
            stream_name: env_var("TRACKING_STREAM").unwrap_or_else(|| "tracking:events".into()),
            dead_letter_stream: env_var("TRACKING_DEAD_LETTER_STREAM")
                .unwrap_or_else(|| "tracking:dead".into()),
            consumer_group: env_var("TRACKING_CONSUMER_GROUP")
                .unwrap_or_else(|| "tracking-workers".into()),
            consumer_name: env_var("TRACKING_CONSUMER_NAME").unwrap_or_else(default_consumer_name),
            batch_size: parse_or("TRACKING_BATCH_SIZE", "100")?,
            max_stream_len: parse_or("TRACKING_MAX_STREAM_LEN", "1000000")?,
            enabled: parse_or("TRACKING_ENABLED", "true")?,
            allowed_origins,
            request_limit_per_min: parse_or("TRACKING_REQUEST_LIMIT_PER_MIN", "120")?,
            event_limit_per_min: parse_or("TRACKING_EVENT_LIMIT_PER_MIN", "2000")?,
            read_block_ms: parse_or("TRACKING_READ_BLOCK_MS", "5000")?,
            claim_min_idle_ms: parse_or("TRACKING_CLAIM_MIN_IDLE_MS", "60000")?,
            claim_interval: Duration::from_millis(parse_or("TRACKING_CLAIM_INTERVAL_MS", "60000")?),
            db_max_connections: parse_or("TRACKING_DB_MAX_CONNECTIONS", "10")?,
        };

        if config.batch_size == 0 {
            bail!("TRACKING_BATCH_SIZE debe ser >= 1");
        }
        if config.max_stream_len < 1000 {
            bail!("TRACKING_MAX_STREAM_LEN debe ser >= 1000");
        }

        Ok(config)
    }

    pub fn is_production(&self) -> bool {
        env_var("TRACKING_ENV")
            .map(|env| env.eq_ignore_ascii_case("production") || env.eq_ignore_ascii_case("prod"))
            .unwrap_or(false)
    }
}

fn env_var(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn parse_or<T>(key: &str, default: &str) -> Result<T>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    let raw = env_var(key).unwrap_or_else(|| default.to_string());
    raw.parse::<T>()
        .map_err(|err| anyhow::anyhow!("{key} inválida ({raw:?}): {err}"))
}

fn default_consumer_name() -> String {
    format!("worker-{}", std::process::id())
}

fn default_origins() -> Vec<String> {
    [
        "http://localhost:4173",
        "http://localhost:5173",
        "http://192.168.0.132:4173",
        "http://192-168-0-132.sslip.io:4173",
    ]
    .into_iter()
    .map(ToString::to_string)
    .collect()
}
