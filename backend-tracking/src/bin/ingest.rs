//! Ingesta HTTP de eventos de analítica.
//!
//! Endpoints:
//!
//! * `GET  /healthz` — liveness.
//! * `GET  /readyz` — comprueba PostgreSQL y Redis.
//! * `POST /v1/events` — lote (máx. `TRACKING_BATCH_SIZE`) o evento único.
//! * `POST /v1/consents` — evidencia de consentimiento.
//!
//! Autenticación: cabecera `X-Api-Key` (hash en `tracking_api_keys`).

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{ConnectInfo, DefaultBodyLimit, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use tracking::auth::ApiKeyAuthorizer;
use tracking::config::Config;
use tracking::model::{ConsentRequest, EventsBody, StreamMessage};
use tracking::ratelimit::RateLimiter;
use tracking::stream::StreamProducer;
use tracking::validate::{self, Rejection, MAX_BATCH};
use tracking::{store, SERVICE_NAME, VERSION};

const MAX_BODY_BYTES: usize = 256 * 1024;
const API_KEY_HEADER: &str = "x-api-key";

#[derive(Clone)]
struct AppState {
    cfg: Arc<Config>,
    pool: PgPool,
    auth: Arc<ApiKeyAuthorizer>,
    limiter: Arc<RateLimiter>,
    producer: Arc<tokio::sync::Mutex<StreamProducer>>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    init_tracing();

    let cfg = Config::from_env()?;

    if cfg.is_production() && cfg.api_key_salt.starts_with("dev-") {
        anyhow::bail!(
            "TRACKING_API_KEY_SALT sigue con el valor de desarrollo y TRACKING_ENV=production"
        );
    }

    let pool = store::connect(&cfg.database_url, cfg.db_max_connections).await?;
    let producer =
        StreamProducer::connect(&cfg.redis_url, cfg.stream_name.clone(), cfg.max_stream_len)
            .await?;

    let auth = Arc::new(ApiKeyAuthorizer::new(
        pool.clone(),
        cfg.api_key_salt.clone(),
        Duration::from_secs(60),
    ));
    let limiter = Arc::new(RateLimiter::new(
        cfg.request_limit_per_min,
        cfg.event_limit_per_min,
    ));

    let state = AppState {
        cfg: Arc::new(cfg.clone()),
        pool,
        auth,
        limiter,
        producer: Arc::new(tokio::sync::Mutex::new(producer)),
    };

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route("/v1/events", post(post_events))
        .route("/v1/consents", post(post_consents))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(TraceLayer::new_for_http())
        .layer(cors_layer(&cfg))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(cfg.bind_addr).await?;
    tracing::info!(
        service = SERVICE_NAME,
        version = VERSION,
        addr = %cfg.bind_addr,
        enabled = cfg.enabled,
        redis = %cfg.redis_url,
        stream = %cfg.stream_name,
        "ingesta escuchando"
    );

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(tracking::shutdown_signal())
    .await?;

    tracing::info!("ingesta detenida");
    Ok(())
}

async fn healthz(State(state): State<AppState>) -> Response {
    Json(json!({
        "status": "ok",
        "service": SERVICE_NAME,
        "version": VERSION,
        "enabled": state.cfg.enabled,
    }))
    .into_response()
}

async fn readyz(State(state): State<AppState>) -> Response {
    let db = store::ping(&state.pool).await;
    let redis = state.producer.lock().await.ping().await;

    let db_ok = db.is_ok();
    let redis_ok = redis.is_ok();

    if db_ok && redis_ok {
        Json(json!({ "status": "ready", "database": true, "broker": true })).into_response()
    } else {
        if let Err(err) = db {
            tracing::warn!(error = %err, "readiness: base de datos no disponible");
        }
        if let Err(err) = redis {
            tracing::warn!(error = %err, "readiness: broker no disponible");
        }
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "status": "unavailable", "database": db_ok, "broker": redis_ok })),
        )
            .into_response()
    }
}

#[derive(Serialize)]
struct EventsResponse {
    accepted: usize,
    rejected: Vec<Rejection>,
}

async fn post_events(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Result<Json<EventsBody>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if !state.cfg.enabled {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "status": "disabled", "error": "tracking_disabled" })),
        )
            .into_response();
    }

    let key_id = match authorize(&state, &headers).await {
        Ok(key_id) => key_id,
        Err(response) => return response,
    };

    let events = match body {
        Ok(Json(body)) => body.into_vec(),
        Err(rejection) => {
            return error_response(
                StatusCode::BAD_REQUEST,
                "invalid_payload",
                &rejection.body_text(),
            );
        }
    };

    if events.is_empty() {
        return error_response(StatusCode::BAD_REQUEST, "empty_batch", "el lote está vacío");
    }
    let max_batch = MAX_BATCH.min(state.cfg.batch_size);
    if events.len() > max_batch {
        return error_response(
            StatusCode::BAD_REQUEST,
            "batch_too_large",
            &format!("máximo {max_batch} eventos por petición"),
        );
    }

    let ip_hash =
        client_ip(&headers, Some(addr)).map(|ip| hash_with_salt(&ip, &state.cfg.ip_hash_salt));
    let origin = ip_hash.clone().unwrap_or_else(|| format!("key:{key_id}"));

    if !state.limiter.check_requests(&origin, 1) {
        return error_response(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "demasiadas peticiones",
        );
    }
    if !state.limiter.check_events(&origin, events.len() as u32) {
        return error_response(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "demasiados eventos",
        );
    }

    let now = Utc::now();
    let validated = validate::validate_batch(events, now);

    for rejection in validated.rejected.iter().take(20) {
        if let Err(err) =
            store::record_rejection(&state.pool, rejection.reason, ip_hash.as_deref(), None).await
        {
            tracing::debug!(error = %err, "no se pudo registrar el rechazo");
        }
    }

    if !validated.accepted.is_empty() {
        let mut producer = state.producer.lock().await;
        for event in &validated.accepted {
            let message = StreamMessage {
                event: event.clone(),
                api_key_id: key_id,
                remote_hash: ip_hash.clone(),
                received_at: now,
            };

            if let Err(err) = producer.publish(&message).await {
                tracing::error!(error = %err, "no se pudo publicar en el broker");
                return error_response(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "broker_unavailable",
                    "no se pudo encolar el evento; reintentar",
                );
            }
        }
    }

    let accepted = validated.accepted.len();
    let rejected = validated.rejected.len();

    if rejected > 0 {
        tracing::debug!(accepted, rejected, "lote procesado con rechazos");
    }

    (
        StatusCode::ACCEPTED,
        Json(EventsResponse {
            accepted,
            rejected: validated.rejected,
        }),
    )
        .into_response()
}

async fn post_consents(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Result<Json<ConsentRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if !state.cfg.enabled {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "status": "disabled", "error": "tracking_disabled" })),
        )
            .into_response();
    }

    let _key_id = match authorize(&state, &headers).await {
        Ok(key_id) => key_id,
        Err(response) => return response,
    };

    let request = match body {
        Ok(Json(request)) => request,
        Err(rejection) => {
            return error_response(
                StatusCode::BAD_REQUEST,
                "invalid_payload",
                &rejection.body_text(),
            );
        }
    };

    if let Err(reason) = validate::validate_consent_request(&request) {
        return error_response(StatusCode::BAD_REQUEST, reason, "consentimiento inválido");
    }

    let ip_hash =
        client_ip(&headers, Some(addr)).map(|ip| hash_with_salt(&ip, &state.cfg.ip_hash_salt));
    let origin = ip_hash
        .clone()
        .unwrap_or_else(|| format!("anon:{}", request.anonymous_id));

    if !state.limiter.check_requests(&origin, 1) {
        return error_response(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "demasiadas peticiones",
        );
    }

    let user_agent = header_str(&headers, header::USER_AGENT.as_str());

    match store::record_consent(&state.pool, &request, ip_hash.as_deref(), user_agent).await {
        Ok(()) => (StatusCode::ACCEPTED, Json(json!({ "recorded": true }))).into_response(),
        Err(err) => {
            tracing::error!(error = %err, "no se pudo registrar el consentimiento");
            error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "database_unavailable",
                "no se pudo registrar el consentimiento; reintentar",
            )
        }
    }
}

async fn authorize(state: &AppState, headers: &HeaderMap) -> Result<i64, Response> {
    let Some(api_key) = header_str(headers, API_KEY_HEADER) else {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "missing_api_key",
            "falta la cabecera X-Api-Key",
        ));
    };

    match state.auth.authorize(api_key).await {
        Ok(Some(key_id)) => Ok(key_id),
        Ok(None) => Err(error_response(
            StatusCode::UNAUTHORIZED,
            "invalid_api_key",
            "API key inválida o inactiva",
        )),
        Err(err) => {
            tracing::error!(error = %err, "fallo al validar la API key");
            Err(error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "auth_unavailable",
                "no se pudo validar la API key",
            ))
        }
    }
}

fn error_response(status: StatusCode, error: &str, detail: &str) -> Response {
    (status, Json(json!({ "error": error, "detail": detail }))).into_response()
}

fn header_str<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(name)?
        .to_str()
        .ok()
        .map(str::trim)
        .filter(|v| !v.is_empty())
}

/// IP del cliente. Se confía en `X-Forwarded-For` porque la ingesta se despliega
/// detrás del proxy de la tienda; aun así solo se guarda su hash.
fn client_ip(headers: &HeaderMap, addr: Option<SocketAddr>) -> Option<String> {
    header_str(headers, "x-forwarded-for")
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| header_str(headers, "x-real-ip").map(ToString::to_string))
        .or_else(|| addr.map(|addr| addr.ip().to_string()))
}

fn hash_with_salt(value: &str, salt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hasher.update(b":");
    hasher.update(salt.as_bytes());
    hex::encode(hasher.finalize())
}

fn cors_layer(cfg: &Config) -> CorsLayer {
    let mut origins = Vec::new();
    let mut any = false;

    for origin in &cfg.allowed_origins {
        if origin == "*" {
            any = true;
            break;
        }
        match HeaderValue::from_str(origin) {
            Ok(value) => origins.push(value),
            Err(err) => tracing::warn!(origin, error = %err, "origen CORS inválido, se ignora"),
        }
    }

    let allow_origin = if any {
        AllowOrigin::any()
    } else if origins.is_empty() {
        AllowOrigin::list(Vec::<HeaderValue>::new())
    } else {
        AllowOrigin::list(origins)
    };

    CorsLayer::new()
        .allow_origin(allow_origin)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            header::CONTENT_TYPE,
            header::USER_AGENT,
            HeaderName::from_static(API_KEY_HEADER),
        ])
        .max_age(Duration::from_secs(600))
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("tracking=info,ingest=info,tower_http=info"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .init();
}
