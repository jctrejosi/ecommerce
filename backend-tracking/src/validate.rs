//! Validación de eventos.
//!
//! Defensa en profundidad: la ingesta valida antes de publicar y el worker
//! vuelve a validar antes de escribir. Un evento inválido nunca llega a
//! `tracking_events`; en el worker termina en `tracking_ingest_rejections` y en
//! el dead letter stream.

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use crate::model::{ConsentRequest, EventEnvelope, SCHEMA_VERSION};

/// Máximo de eventos por petición.
pub const MAX_BATCH: usize = 100;
/// Máximo de partes de un `event_name` (`dominio.objeto.accion`).
pub const MAX_EVENT_NAME_PARTS: usize = 4;
pub const MAX_EVENT_NAME_LEN: usize = 120;
pub const MAX_PAGE_PATH_LEN: usize = 512;
pub const MAX_CONSENT_VERSION_LEN: usize = 32;
pub const MAX_PROPERTIES_BYTES: usize = 8 * 1024;
pub const MAX_CONTEXT_BYTES: usize = 4 * 1024;
/// Tolerancia de reloj hacia el futuro.
pub const MAX_CLOCK_SKEW_MINUTES: i64 = 5;
/// Antigüedad máxima de un evento.
pub const MAX_EVENT_AGE_DAYS: i64 = 30;

/// Claves cuyo nombre (normalizado) se considera PII o secreto.
const FORBIDDEN_KEYS: &[&str] = &[
    "email",
    "correo",
    "correoelectronico",
    "mail",
    "phone",
    "telefono",
    "celular",
    "movil",
    "mobile",
    "password",
    "passwd",
    "contrasena",
    "passwordconfirmation",
    "token",
    "accesstoken",
    "refreshtoken",
    "authorization",
    "secret",
    "apikey",
    "creditcard",
    "cardnumber",
    "cvv",
    "cvc",
    "address",
    "direccion",
    "street",
    "document",
    "documento",
    "cedula",
    "nit",
    "taxid",
    "ssn",
    "dni",
    "rut",
    "ip",
    "query",
    "search",
    "q",
    "term",
    "texto",
    "busqueda",
];

/// Nombres compuestos que se prohíben completos (no por palabra), para no
/// rechazar datos legítimos como `product_name`.
const FORBIDDEN_EXACT_KEYS: &[&str] = &[
    "name",
    "nombre",
    "nombres",
    "apellido",
    "apellidos",
    "surname",
    "username",
    "fullname",
    "firstname",
    "lastname",
    "middlename",
    "displayname",
    "customername",
    "clientname",
    "emailaddress",
];

#[derive(Debug, Clone, Serialize)]
pub struct Rejection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_id: Option<Uuid>,
    pub reason: &'static str,
}

#[derive(Debug, Default)]
pub struct ValidatedBatch {
    pub accepted: Vec<EventEnvelope>,
    pub rejected: Vec<Rejection>,
}

/// Valida un lote completo. El límite de tamaño de lote se comprueba fuera
/// (para poder responder 400 y no 202).
pub fn validate_batch(events: Vec<EventEnvelope>, now: DateTime<Utc>) -> ValidatedBatch {
    let mut out = ValidatedBatch {
        accepted: Vec::with_capacity(events.len()),
        rejected: Vec::new(),
    };

    for event in events {
        match validate_event(&event, now) {
            Ok(()) => out.accepted.push(event),
            Err(reason) => out.rejected.push(Rejection {
                event_id: Some(event.event_id),
                reason,
            }),
        }
    }

    out
}

/// Devuelve el motivo del rechazo o `Ok(())` si el evento es válido.
pub fn validate_event(event: &EventEnvelope, now: DateTime<Utc>) -> Result<(), &'static str> {
    if event.schema_version != SCHEMA_VERSION {
        return Err("unsupported_schema_version");
    }
    if event.schema_version < 1 {
        return Err("unsupported_schema_version");
    }

    validate_event_name(&event.event_name)?;

    if event.occurred_at > now + Duration::minutes(MAX_CLOCK_SKEW_MINUTES) {
        return Err("occurred_at_in_future");
    }
    if event.occurred_at < now - Duration::days(MAX_EVENT_AGE_DAYS) {
        return Err("occurred_at_too_old");
    }

    if !event.consent.analytics {
        return Err("analytics_consent_missing");
    }
    let version = event.consent.version.trim();
    if version.is_empty() || version.len() > MAX_CONSENT_VERSION_LEN {
        return Err("invalid_consent_version");
    }

    if let Some(customer_id) = event.customer_id {
        if customer_id <= 0 {
            return Err("invalid_customer_id");
        }
    }

    let path = event.page.path.trim();
    if !path.starts_with('/') || path.len() > MAX_PAGE_PATH_LEN {
        return Err("invalid_page_path");
    }

    if let Some(element) = &event.element {
        if element.source_line.is_some_and(|line| line < 0) {
            return Err("invalid_element");
        }
        if element
            .label
            .as_deref()
            .is_some_and(|value| value.chars().count() > 160)
            || element.id.as_deref().is_some_and(|value| value.len() > 120)
            || element
                .component
                .as_deref()
                .is_some_and(|value| value.len() > 80)
            || element
                .handler
                .as_deref()
                .is_some_and(|value| value.len() > 160)
            || element.tag.as_deref().is_some_and(|value| value.len() > 32)
            || element
                .role
                .as_deref()
                .is_some_and(|value| value.len() > 64)
            || element
                .source_file
                .as_deref()
                .is_some_and(|value| value.len() > 256)
        {
            return Err("element_too_large");
        }
    }

    validate_json_object(&event.properties, "properties", MAX_PROPERTIES_BYTES)?;
    validate_json_object(&event.context, "context", MAX_CONTEXT_BYTES)?;

    Ok(())
}

/// Validación del cuerpo de `POST /v1/consents`.
pub fn validate_consent_request(request: &ConsentRequest) -> Result<(), &'static str> {
    let policy_version = request.policy_version.trim();
    if policy_version.is_empty() || policy_version.len() > 64 {
        return Err("invalid_policy_version");
    }
    if let Some(customer_id) = request.customer_id {
        if customer_id <= 0 {
            return Err("invalid_customer_id");
        }
    }
    validate_json_object(
        request.context.as_ref().unwrap_or(&Value::Null),
        "context",
        MAX_CONTEXT_BYTES,
    )?;
    Ok(())
}

fn validate_event_name(name: &str) -> Result<(), &'static str> {
    let name = name.trim();
    if name.is_empty() || name.len() > MAX_EVENT_NAME_LEN {
        return Err("invalid_event_name");
    }

    let parts: Vec<&str> = name.split('.').collect();
    if parts.len() < 2 || parts.len() > MAX_EVENT_NAME_PARTS {
        return Err("invalid_event_name");
    }

    for part in parts {
        if part.is_empty() || part.len() > 40 {
            return Err("invalid_event_name");
        }
        if !part
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
        {
            return Err("invalid_event_name");
        }
    }

    Ok(())
}

fn validate_json_object(
    value: &Value,
    field: &'static str,
    max_bytes: usize,
) -> Result<(), &'static str> {
    match value {
        Value::Null => return Ok(()),
        Value::Object(_) => {}
        _ => {
            return Err(if field == "properties" {
                "invalid_properties"
            } else {
                "invalid_context"
            })
        }
    }

    let size = serde_json::to_vec(value)
        .map(|buf| buf.len())
        .unwrap_or(usize::MAX);
    if size > max_bytes {
        return Err(if field == "properties" {
            "properties_too_large"
        } else {
            "context_too_large"
        });
    }

    if contains_forbidden_key(value, 0) {
        return Err(if field == "properties" {
            "forbidden_property_key"
        } else {
            "forbidden_context_key"
        });
    }

    Ok(())
}

fn contains_forbidden_key(value: &Value, depth: usize) -> bool {
    // Profundidad acotada: el payload ya viene limitado en tamaño, pero no
    // queremos recursión sin fin con estructuras muy anidadas.
    if depth > 6 {
        return false;
    }

    match value {
        Value::Object(map) => map.iter().any(|(key, child)| {
            let normalized = normalize_key(key);
            let tokens = key_tokens(key);

            FORBIDDEN_EXACT_KEYS.contains(&normalized.as_str())
                || tokens
                    .iter()
                    .any(|token| FORBIDDEN_KEYS.contains(&token.as_str()))
                || contains_forbidden_key(child, depth + 1)
        }),
        Value::Array(items) => items
            .iter()
            .any(|child| contains_forbidden_key(child, depth + 1)),
        _ => false,
    }
}

fn normalize_key(key: &str) -> String {
    key.chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// Separa `customerEmail`, `customer-email` y `customer_email` en palabras.
fn key_tokens(key: &str) -> Vec<String> {
    let mut expanded = String::with_capacity(key.len() + 4);
    let mut previous_was_lower = false;

    for ch in key.chars() {
        if ch.is_ascii_uppercase() && previous_was_lower {
            expanded.push('_');
        }
        previous_was_lower = ch.is_ascii_lowercase() || ch.is_ascii_digit();
        expanded.push(ch);
    }

    expanded
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .map(str::to_ascii_lowercase)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Consent, EventKind, PageCtx};

    fn event(name: &str) -> EventEnvelope {
        EventEnvelope {
            event_id: Uuid::new_v4(),
            anonymous_id: Uuid::new_v4(),
            customer_id: None,
            kind: EventKind::Click,
            event_name: name.to_string(),
            occurred_at: Utc::now(),
            page: PageCtx {
                path: "/catalog".into(),
                url: None,
                referrer: None,
            },
            element: None,
            properties: serde_json::json!({ "product_id": 1 }),
            context: serde_json::json!({ "device": "mobile" }),
            consent: Consent::granted("2026-10"),
            schema_version: SCHEMA_VERSION,
        }
    }

    #[test]
    fn acepta_evento_valido() {
        assert!(validate_event(&event("ecom.cart.add"), Utc::now()).is_ok());
    }

    #[test]
    fn rechaza_sin_consentimiento() {
        let mut ev = event("ecom.cart.add");
        ev.consent.analytics = false;
        assert_eq!(
            validate_event(&ev, Utc::now()),
            Err("analytics_consent_missing")
        );
    }

    #[test]
    fn rechaza_nombre_invalido() {
        assert_eq!(
            validate_event(&event("Click"), Utc::now()),
            Err("invalid_event_name")
        );
    }

    #[test]
    fn rechaza_pii_en_propiedades() {
        let mut ev = event("ecom.cart.add");
        ev.properties = serde_json::json!({ "customer_email": "a@b.c" });
        assert_eq!(
            validate_event(&ev, Utc::now()),
            Err("forbidden_property_key")
        );
    }

    #[test]
    fn acepta_datos_de_producto_no_pii() {
        let mut ev = event("ecom.product.view");
        ev.properties = serde_json::json!({
            "product_id": 10,
            "product_name": "Arroz 500 g",
            "category": "GRANOS",
            "price": 3200
        });
        assert!(validate_event(&ev, Utc::now()).is_ok());
    }

    #[test]
    fn detecta_pii_en_camel_case() {
        let mut ev = event("ecom.cart.add");
        ev.properties = serde_json::json!({ "userPhone": "3001234567" });
        assert_eq!(
            validate_event(&ev, Utc::now()),
            Err("forbidden_property_key")
        );
    }

    #[test]
    fn rechaza_evento_muy_viejo() {
        let mut ev = event("page.view");
        ev.occurred_at = Utc::now() - Duration::days(31);
        assert_eq!(validate_event(&ev, Utc::now()), Err("occurred_at_too_old"));
    }
}
