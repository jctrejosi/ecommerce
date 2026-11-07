//! Modelo de datos del pipeline de analítica.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;

pub const SCHEMA_VERSION: u32 = 1;
pub const DEFAULT_CONSENT_VERSION: &str = "2026-10";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    PageView,
    Click,
    Submit,
    Search,
    Navigation,
    Order,
    Custom,
}

impl EventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PageView => "page_view",
            Self::Click => "click",
            Self::Submit => "submit",
            Self::Search => "search",
            Self::Navigation => "navigation",
            Self::Order => "order",
            Self::Custom => "custom",
        }
    }
}

impl Default for EventKind {
    fn default() -> Self {
        Self::Custom
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PageCtx {
    /// Ruta interna, p. ej. `/catalog`.
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub referrer: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ElementCtx {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handler: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_line: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Consent {
    /// Debe ser `true`: la ingesta rechaza eventos sin consentimiento de analítica.
    pub analytics: bool,
    /// Versión de la política aceptada, p. ej. `2026-10`.
    pub version: String,
}

impl Consent {
    pub fn granted(version: impl Into<String>) -> Self {
        Self {
            analytics: true,
            version: version.into(),
        }
    }
}

fn default_schema_version() -> u32 {
    SCHEMA_VERSION
}

fn empty_object() -> Value {
    Value::Object(Map::new())
}

/// Evento tal como lo envía el cliente (web o APK).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventEnvelope {
    /// UUID v4 generado en el cliente. Clave de idempotencia.
    pub event_id: Uuid,
    /// UUID local del navegador/dispositivo.
    pub anonymous_id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_id: Option<i64>,
    #[serde(default)]
    pub kind: EventKind,
    /// `dominio.objeto.accion` en snake_case.
    pub event_name: String,
    /// Reloj del cliente, ISO-8601 con zona.
    pub occurred_at: DateTime<Utc>,
    pub page: PageCtx,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub element: Option<ElementCtx>,
    #[serde(default = "empty_object")]
    pub properties: Value,
    #[serde(default = "empty_object")]
    pub context: Value,
    pub consent: Consent,
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
}

/// Cuerpo de `POST /v1/events`: acepta un lote o un único evento.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum EventsBody {
    Batch { events: Vec<EventEnvelope> },
    Single(EventEnvelope),
}

impl EventsBody {
    pub fn into_vec(self) -> Vec<EventEnvelope> {
        match self {
            Self::Batch { events } => events,
            Self::Single(event) => vec![event],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConsentPurpose {
    Necessary,
    Analytics,
    Marketing,
}

impl ConsentPurpose {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Necessary => "necessary",
            Self::Analytics => "analytics",
            Self::Marketing => "marketing",
        }
    }
}

impl Default for ConsentPurpose {
    fn default() -> Self {
        Self::Analytics
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConsentSource {
    Banner,
    Settings,
    Api,
    Migration,
}

impl ConsentSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Banner => "banner",
            Self::Settings => "settings",
            Self::Api => "api",
            Self::Migration => "migration",
        }
    }
}

impl Default for ConsentSource {
    fn default() -> Self {
        Self::Banner
    }
}

/// Cuerpo de `POST /v1/consents`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConsentRequest {
    pub anonymous_id: Uuid,
    #[serde(default)]
    pub customer_id: Option<i64>,
    #[serde(default)]
    pub purpose: ConsentPurpose,
    pub granted: bool,
    pub policy_version: String,
    #[serde(default)]
    pub source: ConsentSource,
    #[serde(default)]
    pub context: Option<Value>,
}

/// Mensaje que viaja por el broker (evento + metadatos del transporte).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StreamMessage {
    pub event: EventEnvelope,
    /// Identificador de la API key que autenticó la ingesta.
    pub api_key_id: i64,
    /// `sha256(ip + salt)`, nunca la IP en claro.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_hash: Option<String>,
    /// Reloj del servidor al recibir la petición.
    pub received_at: DateTime<Utc>,
}

impl StreamMessage {
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}
