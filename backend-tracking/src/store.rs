//! Acceso a PostgreSQL (`mercaldas_tracking`).
//!
//! Todas las consultas usan SQL dinámico (`sqlx::query`), no macros: el crate
//! debe compilar sin una base de datos disponible.

use std::time::Duration;

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::model::{ConsentRequest, EventEnvelope};

pub async fn connect(database_url: &str, max_connections: u32) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(max_connections.max(1))
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
        .await?;
    Ok(pool)
}

pub async fn find_active_api_key(pool: &PgPool, key_hash: &str) -> sqlx::Result<Option<i64>> {
    sqlx::query_scalar::<_, i64>(
        "select id from tracking_api_keys where key_hash = $1 and is_active limit 1",
    )
    .bind(key_hash)
    .fetch_optional(pool)
    .await
}

pub async fn touch_api_key(pool: &PgPool, key_id: i64) -> sqlx::Result<()> {
    sqlx::query(
        "update tracking_api_keys
            set last_used_at = now()
          where id = $1
            and (last_used_at is null or last_used_at < now() - interval '5 minutes')",
    )
    .bind(key_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Upsert de sesión anónima. Devuelve el `id` interno de `tracking_sessions`.
pub async fn upsert_session<'e, E>(
    executor: E,
    anonymous_id: Uuid,
    customer_id: Option<i64>,
    consent_version: Option<&str>,
    occurred_at: DateTime<Utc>,
    ip_hash: Option<&str>,
    user_agent: Option<&str>,
    locale: Option<&str>,
    timezone: Option<&str>,
) -> sqlx::Result<i64>
where
    E: sqlx::PgExecutor<'e>,
{
    sqlx::query_scalar::<_, i64>(
        r#"
        insert into tracking_sessions (
            anonymous_id, customer_id, consent_analytics, consent_version, consent_at,
            ip_hash, user_agent, locale, timezone, first_seen_at, last_seen_at
        )
        values ($1, $2, true, $3, $4, $5, $6, $7, $8, $4, $4)
        on conflict (anonymous_id) do update set
            customer_id       = coalesce(excluded.customer_id, tracking_sessions.customer_id),
            consent_version   = coalesce(excluded.consent_version, tracking_sessions.consent_version),
            consent_at        = coalesce(excluded.consent_at, tracking_sessions.consent_at),
            ip_hash           = coalesce(excluded.ip_hash, tracking_sessions.ip_hash),
            user_agent        = coalesce(excluded.user_agent, tracking_sessions.user_agent),
            locale            = coalesce(excluded.locale, tracking_sessions.locale),
            timezone          = coalesce(excluded.timezone, tracking_sessions.timezone),
            last_seen_at      = greatest(tracking_sessions.last_seen_at, excluded.last_seen_at)
        returning id
        "#,
    )
    .bind(anonymous_id)
    .bind(customer_id)
    .bind(consent_version)
    .bind(occurred_at)
    .bind(ip_hash)
    .bind(user_agent)
    .bind(locale)
    .bind(timezone)
    .fetch_one(executor)
    .await
}

/// Inserta un evento. `Ok(false)` significa que ya existía (`event_id`
/// repetido) y no se escribió nada.
pub async fn insert_event<'e, E>(
    executor: E,
    event: &EventEnvelope,
    session_id: i64,
) -> sqlx::Result<bool>
where
    E: sqlx::PgExecutor<'e>,
{
    let element = event.element.as_ref();
    let properties = serde_json::to_string(&event.properties).unwrap_or_else(|_| "{}".into());
    let context = serde_json::to_string(&event.context).unwrap_or_else(|_| "{}".into());

    let result = sqlx::query(
        r#"
        insert into tracking_events (
            event_id, session_id, anonymous_id, customer_id, kind, event_name, occurred_at,
            page_path, page_url, referrer,
            element_tag, element_label, element_id, element_role,
            component, handler, source_file, source_line,
            properties, context, consent_version, schema_version
        )
        values (
            $1, $2, $3, $4, $5::tracking_event_kind, $6, $7,
            $8, $9, $10,
            $11, $12, $13, $14,
            $15, $16, $17, $18,
            $19::jsonb, $20::jsonb, $21, $22
        )
        on conflict (event_id) do nothing
        "#,
    )
    .bind(event.event_id)
    .bind(session_id)
    .bind(event.anonymous_id)
    .bind(event.customer_id)
    .bind(event.kind.as_str())
    .bind(event.event_name.as_str())
    .bind(event.occurred_at)
    .bind(event.page.path.as_str())
    .bind(event.page.url.as_deref())
    .bind(event.page.referrer.as_deref())
    .bind(element.and_then(|e| e.tag.as_deref()))
    .bind(element.and_then(|e| e.label.as_deref()))
    .bind(element.and_then(|e| e.id.as_deref()))
    .bind(element.and_then(|e| e.role.as_deref()))
    .bind(element.and_then(|e| e.component.as_deref()))
    .bind(element.and_then(|e| e.handler.as_deref()))
    .bind(element.and_then(|e| e.source_file.as_deref()))
    .bind(element.and_then(|e| e.source_line))
    .bind(properties)
    .bind(context)
    .bind(event.consent.version.as_str())
    .bind(event.schema_version as i32)
    .execute(executor)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Registra la evidencia de consentimiento y sincroniza la sesión.
pub async fn record_consent(
    pool: &PgPool,
    request: &ConsentRequest,
    ip_hash: Option<&str>,
    user_agent: Option<&str>,
) -> sqlx::Result<()> {
    let locale = context_string(request.context.as_ref(), "locale");
    let timezone = context_string(request.context.as_ref(), "timezone");
    let now = Utc::now();
    let is_analytics = request.purpose == crate::model::ConsentPurpose::Analytics;

    let mut tx: Transaction<'_, Postgres> = pool.begin().await?;

    sqlx::query(
        r#"
        insert into tracking_consents (
            anonymous_id, customer_id, purpose, granted, policy_version, source, ip_hash, user_agent
        )
        values ($1, $2, $3::tracking_consent_purpose, $4, $5, $6::tracking_consent_source, $7, $8)
        "#,
    )
    .bind(request.anonymous_id)
    .bind(request.customer_id)
    .bind(request.purpose.as_str())
    .bind(request.granted)
    .bind(request.policy_version.trim())
    .bind(request.source.as_str())
    .bind(ip_hash)
    .bind(user_agent)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        insert into tracking_sessions (
            anonymous_id, customer_id, consent_analytics, consent_version, consent_at,
            ip_hash, user_agent, locale, timezone
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (anonymous_id) do update set
            customer_id       = coalesce(excluded.customer_id, tracking_sessions.customer_id),
            consent_analytics = case when $10 then excluded.consent_analytics else tracking_sessions.consent_analytics end,
            consent_version   = case when $10 then excluded.consent_version else tracking_sessions.consent_version end,
            consent_at        = case when $10 then excluded.consent_at else tracking_sessions.consent_at end,
            ip_hash           = coalesce(excluded.ip_hash, tracking_sessions.ip_hash),
            user_agent        = coalesce(excluded.user_agent, tracking_sessions.user_agent),
            locale            = coalesce(excluded.locale, tracking_sessions.locale),
            timezone          = coalesce(excluded.timezone, tracking_sessions.timezone),
            last_seen_at      = now()
        "#,
    )
    .bind(request.anonymous_id)
    .bind(request.customer_id)
    .bind(request.granted)
    .bind(request.policy_version.trim())
    .bind(now)
    .bind(ip_hash)
    .bind(user_agent)
    .bind(locale.as_deref())
    .bind(timezone.as_deref())
    .bind(is_analytics)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

/// Guarda un evento rechazado (sin PII) para poder depurar el cliente.
pub async fn record_rejection(
    pool: &PgPool,
    reason: &str,
    remote_hash: Option<&str>,
    payload: Option<&str>,
) -> sqlx::Result<()> {
    // El payload puede no ser JSON válido (es justamente uno de los motivos de
    // rechazo), así que se sanea antes de enviarlo a una columna `jsonb`.
    let payload = payload.map(|raw| {
        if let Ok(value) = serde_json::from_str::<Value>(raw) {
            value.to_string()
        } else {
            let truncated: String = raw.chars().take(2_000).collect();
            Value::String(truncated).to_string()
        }
    });

    sqlx::query(
        r#"
        insert into tracking_ingest_rejections (reason, remote_hash, payload)
        values ($1, $2, $3::jsonb)
        "#,
    )
    .bind(reason)
    .bind(remote_hash)
    .bind(payload.as_deref())
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn ping(pool: &PgPool) -> sqlx::Result<()> {
    sqlx::query_scalar::<_, i32>("select 1")
        .fetch_one(pool)
        .await?;
    Ok(())
}

fn context_string(context: Option<&Value>, key: &str) -> Option<String> {
    context?
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(128).collect())
}
