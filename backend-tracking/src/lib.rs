#![forbid(unsafe_code)]
//! Analítica propia de Mercaldas.
//!
//! Este crate contiene la lógica compartida por los dos binarios:
//!
//! * `ingest`: API HTTP (axum) que valida eventos y los publica en el broker.
//! * `worker`: consumidor del broker que escribe en PostgreSQL.
//!
//! El diseño completo está documentado en `docs/tracking/README.md`.

pub mod auth;
pub mod config;
pub mod model;
pub mod ratelimit;
pub mod store;
pub mod stream;
pub mod validate;

/// Nombre del servicio, usado en logs y en `/healthz`.
pub const SERVICE_NAME: &str = "backend-tracking";

/// Versión del crate (`Cargo.toml`).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Resuelve con `Ctrl+C` o `SIGTERM`, para apagar los binarios ordenadamente.
pub async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(err) => {
                tracing::warn!(error = %err, "no se pudo instalar el handler de SIGTERM");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
}
