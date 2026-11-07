//! Worker de analítica: broker → PostgreSQL.
//!
//! * Lee en lote con `XREADGROUP`.
//! * Valida de nuevo cada evento (defensa en profundidad).
//! * Escribe sesión + evento dentro de una transacción.
//! * `XACK` solo después del commit.
//! * Los mensajes inválidos van a `tracking:ingest_rejections` y al dead letter.
//! * Cada `TRACKING_CLAIM_INTERVAL_MS` reclama mensajes pendientes huérfanos.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use chrono::Utc;
use serde_json::Value;
use sqlx::PgPool;
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

use tracking::config::Config;
use tracking::model::StreamMessage;
use tracking::stream::{StreamConsumer, StreamEntry};
use tracking::validate;
use tracking::{store, SERVICE_NAME};

const RETRY_ATTEMPTS: usize = 3;
const RETRY_DELAY: Duration = Duration::from_secs(2);

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    init_tracing();

    let cfg = Config::from_env()?;

    if !cfg.enabled {
        tracing::warn!("TRACKING_ENABLED=false: el worker no procesará eventos");
        return Ok(());
    }

    let pool = store::connect(&cfg.database_url, cfg.db_max_connections).await?;

    let mut consumer = StreamConsumer::connect(
        &cfg.redis_url,
        cfg.stream_name.clone(),
        cfg.consumer_group.clone(),
        cfg.consumer_name.clone(),
        cfg.dead_letter_stream.clone(),
        cfg.max_stream_len,
    )
    .await?;
    consumer.ensure_group().await?;

    tracing::info!(
        service = SERVICE_NAME,
        consumer = %cfg.consumer_name,
        group = %cfg.consumer_group,
        stream = %cfg.stream_name,
        batch = cfg.batch_size,
        "worker escuchando"
    );

    let mut last_claim = Instant::now();
    let mut stopping = false;

    while !stopping {
        tokio::select! {
            _ = tracking::shutdown_signal() => {
                tracing::info!("señal de parada recibida; terminando el lote en curso");
                stopping = true;
            }
            result = consumer.read(cfg.batch_size, cfg.read_block_ms) => {
                match result {
                    Ok(entries) if !entries.is_empty() => {
                        if let Err(err) = process_entries(&pool, &mut consumer, entries).await {
                            tracing::error!(error = %err, "error procesando lote; se reintentará");
                            tokio::time::sleep(RETRY_DELAY).await;
                        }
                    }
                    Ok(_) => {}
                    Err(err) => {
                        tracing::error!(error = %err, "error leyendo del broker");
                        tokio::time::sleep(RETRY_DELAY).await;
                    }
                }
            }
        }

        if !stopping && last_claim.elapsed() >= cfg.claim_interval {
            match consumer
                .claim_stale(cfg.claim_min_idle_ms, cfg.batch_size)
                .await
            {
                Ok(entries) if !entries.is_empty() => {
                    tracing::warn!(count = entries.len(), "reclamando mensajes pendientes");
                    if let Err(err) = process_entries(&pool, &mut consumer, entries).await {
                        tracing::error!(error = %err, "error procesando mensajes reclamados");
                    }
                }
                Ok(_) => {}
                Err(err) => tracing::error!(error = %err, "error reclamando mensajes pendientes"),
            }
            last_claim = Instant::now();
        }
    }

    tracing::info!("worker detenido");
    Ok(())
}

async fn process_entries(
    pool: &PgPool,
    consumer: &mut StreamConsumer,
    entries: Vec<StreamEntry>,
) -> anyhow::Result<()> {
    let now = Utc::now();
    let mut valid: Vec<(String, StreamMessage)> = Vec::with_capacity(entries.len());
    let mut to_ack: Vec<String> = Vec::new();

    for entry in &entries {
        match parse_entry(entry, now) {
            Ok(message) => valid.push((entry.id.clone(), message)),
            Err(reason) => {
                tracing::warn!(stream_id = %entry.id, reason, "mensaje descartado");
                if let Err(err) =
                    store::record_rejection(pool, reason, None, entry.payload.as_deref()).await
                {
                    tracing::debug!(error = %err, "no se pudo registrar el rechazo");
                }
                if let Err(err) = consumer.dead_letter(reason, entry).await {
                    tracing::warn!(error = %err, "no se pudo publicar en el dead letter");
                }
                to_ack.push(entry.id.clone());
            }
        }
    }

    if !valid.is_empty() {
        let mut attempt = 0;

        loop {
            attempt += 1;
            match store_batch(pool, &valid).await {
                Ok((inserted, duplicated)) => {
                    tracing::info!(
                        events = valid.len(),
                        inserted,
                        duplicated,
                        "lote escrito en PostgreSQL"
                    );
                    break;
                }
                Err(err) if attempt < RETRY_ATTEMPTS => {
                    tracing::warn!(
                        attempt,
                        error = %err,
                        "fallo escribiendo el lote; reintentando"
                    );
                    tokio::time::sleep(RETRY_DELAY).await;
                }
                Err(err) => {
                    // No se hace ACK: el mensaje queda pendiente y se
                    // reintentará con XAUTOCLAIM.
                    return Err(err);
                }
            }
        }

        to_ack.extend(valid.into_iter().map(|(id, _)| id));
    }

    consumer.ack(&to_ack).await?;
    Ok(())
}

async fn store_batch(
    pool: &PgPool,
    valid: &[(String, StreamMessage)],
) -> anyhow::Result<(usize, usize)> {
    let mut tx = pool.begin().await?;
    let mut sessions: HashMap<Uuid, i64> = HashMap::new();
    let mut inserted = 0usize;
    let mut duplicated = 0usize;

    for (_, message) in valid {
        let event = &message.event;

        let session_id = if let Some(session_id) = sessions.get(&event.anonymous_id) {
            *session_id
        } else {
            let context = &event.context;
            let session_id = store::upsert_session(
                &mut *tx,
                event.anonymous_id,
                event.customer_id,
                Some(event.consent.version.trim()),
                event.occurred_at,
                message.remote_hash.as_deref(),
                ctx_str(context, "user_agent", 512),
                ctx_str(context, "locale", 32),
                ctx_str(context, "timezone", 64),
            )
            .await?;
            sessions.insert(event.anonymous_id, session_id);
            session_id
        };

        if store::insert_event(&mut *tx, event, session_id).await? {
            inserted += 1;
        } else {
            duplicated += 1;
        }
    }

    tx.commit().await?;
    Ok((inserted, duplicated))
}

fn parse_entry(
    entry: &StreamEntry,
    now: chrono::DateTime<Utc>,
) -> Result<StreamMessage, &'static str> {
    let payload = entry.payload.as_deref().ok_or("missing_payload")?;
    let message: StreamMessage = serde_json::from_str(payload).map_err(|_| "invalid_json")?;
    validate::validate_event(&message.event, now)?;

    if message.api_key_id <= 0 {
        return Err("invalid_api_key_id");
    }

    Ok(message)
}

fn ctx_str<'a>(context: &'a Value, key: &str, max_len: usize) -> Option<&'a str> {
    context
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            let mut end = value.len().min(max_len);
            while !value.is_char_boundary(end) {
                end -= 1;
            }
            &value[..end]
        })
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("tracking=info,worker=info"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .init();
}
