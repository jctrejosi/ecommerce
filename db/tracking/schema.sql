-- ============================================================================
-- Mercaldas · Analítica propia (tracking) · Esquema PostgreSQL
-- ============================================================================
-- Base de datos separada de la operativa (`ecommerce`). El servicio de ingesta
-- (Rust) valida y publica en el broker; el worker (Rust) consume y escribe aquí.
--
-- Principios de diseño (ver docs/tracking/README.md):
--   * Sin cookies ni servicios de terceros: todo es first-party.
--   * Minimización: no se guardan valores de formularios ni IPs en claro.
--   * Consentimiento: solo se persisten eventos con consentimiento de analítica.
--   * Retención: eventos crudos 90 días; agregados 24 meses; consentimientos 5 años.
--
-- Aplicar sobre una base nueva:
--   createdb mercaldas_tracking
--   psql -d mercaldas_tracking -v ON_ERROR_STOP=1 -f db/tracking/schema.sql
-- ============================================================================

create extension if not exists pgcrypto;

-- ── Enums ───────────────────────────────────────────────────────────────────
do $$ begin
  create type tracking_event_kind as enum (
    'page_view', 'click', 'submit', 'search', 'navigation', 'order', 'custom'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type tracking_consent_purpose as enum ('necessary', 'analytics', 'marketing');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tracking_consent_source as enum ('banner', 'settings', 'api', 'migration');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tracking_deletion_status as enum ('pending', 'processing', 'completed', 'rejected');
exception when duplicate_object then null; end $$;

-- ── Sesiones anónimas ───────────────────────────────────────────────────────
-- Una sesión agrupa eventos de un mismo navegador/dispositivo. `anonymous_id`
-- es un UUID generado en el cliente y persistido localmente (no es PII).
create table if not exists tracking_sessions (
  id                  bigserial primary key,
  anonymous_id        uuid        not null unique,
  customer_id         bigint,                       -- vínculo pseudónimo (opcional)
  consent_analytics   boolean     not null default false,
  consent_version     text,
  consent_at          timestamptz,
  ip_hash             text,                         -- sha256(ip + salt); nunca la IP
  user_agent          text,
  locale              text,
  timezone            text,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now()
);

comment on table tracking_sessions is
  'Sesión anónima de analítica. No se almacena IP en claro ni valores de formularios.';
comment on column tracking_sessions.ip_hash is
  'Hash con sal secreta de la IP de origen. Permite deduplicar/abusos sin identificar.';

create index if not exists idx_tracking_sessions_customer
  on tracking_sessions (customer_id) where customer_id is not null;
create index if not exists idx_tracking_sessions_last_seen
  on tracking_sessions (last_seen_at desc);

-- ── Consentimientos (evidencia) ─────────────────────────────────────────────
-- Registro append-only: cada cambio de consentimiento deja traza con versión de
-- política y fecha. Es la evidencia exigible ante una reclamación.
create table if not exists tracking_consents (
  id              bigserial primary key,
  anonymous_id    uuid                    not null,
  customer_id     bigint,
  purpose         tracking_consent_purpose not null,
  granted         boolean                 not null,
  policy_version  text                    not null,
  source          tracking_consent_source not null default 'banner',
  ip_hash         text,
  user_agent      text,
  created_at      timestamptz             not null default now()
);

create index if not exists idx_tracking_consents_anonymous
  on tracking_consents (anonymous_id, created_at desc);
create index if not exists idx_tracking_consents_customer
  on tracking_consents (customer_id, created_at desc) where customer_id is not null;
create index if not exists idx_tracking_consents_purpose
  on tracking_consents (purpose, granted, created_at desc);

-- ── Eventos crudos ──────────────────────────────────────────────────────────
-- Append-only. `event_id` es la clave de idempotencia generada por el cliente:
-- si el broker reentrega, el worker hace ON CONFLICT DO NOTHING.
create table if not exists tracking_events (
  id              bigserial primary key,
  event_id        uuid        not null unique,
  session_id      bigint      not null references tracking_sessions (id) on delete cascade,
  anonymous_id    uuid        not null,
  customer_id     bigint,
  kind            tracking_event_kind not null default 'custom',
  event_name      text        not null,             -- p. ej. ui.header.search_submit
  occurred_at     timestamptz not null,             -- reloj del cliente
  received_at     timestamptz not null default now(), -- reloj del servidor
  page_path       text,
  page_url        text,
  referrer        text,
  element_tag     text,
  element_label   text,
  element_id      text,
  element_role    text,
  component       text,
  handler         text,
  source_file     text,
  source_line     integer,
  properties      jsonb       not null default '{}'::jsonb,
  context         jsonb       not null default '{}'::jsonb,
  consent_version text,
  schema_version  integer     not null default 1,
  constraint tracking_events_name_len check (char_length(event_name) between 1 and 120),
  constraint tracking_events_schema_version check (schema_version >= 1)
);

comment on table tracking_events is
  'Eventos de interacción. Append-only; el worker nunca actualiza filas.';
comment on column tracking_events.properties is
  'Datos del evento (producto, categoría, importe…). PROHIBIDO guardar PII o valores de formularios.';
comment on column tracking_events.context is
  'Contexto técnico: viewport, dispositivo, versión de la app, idioma.';

create index if not exists idx_tracking_events_occurred
  on tracking_events (occurred_at desc);
create index if not exists idx_tracking_events_name_occurred
  on tracking_events (event_name, occurred_at desc);
create index if not exists idx_tracking_events_session
  on tracking_events (session_id, occurred_at desc);
create index if not exists idx_tracking_events_anonymous
  on tracking_events (anonymous_id, occurred_at desc);
create index if not exists idx_tracking_events_customer
  on tracking_events (customer_id, occurred_at desc) where customer_id is not null;
create index if not exists idx_tracking_events_page
  on tracking_events (page_path, occurred_at desc);
create index if not exists idx_tracking_events_properties
  on tracking_events using gin (properties);

-- ── Agregados diarios (rollup para dashboards) ──────────────────────────────
-- Se recalculan con refresh_tracking_event_daily(day) desde los eventos crudos,
-- de modo que sobreviven al purgado de los crudos.
create table if not exists tracking_event_daily (
  day             date    not null,
  event_name      text    not null,
  page_path       text    not null default '',
  element_label   text    not null default '',
  events          integer not null default 0,
  sessions        integer not null default 0,
  primary key (day, event_name, page_path, element_label)
);

create index if not exists idx_tracking_event_daily_event
  on tracking_event_daily (event_name, day desc);

-- ── Solicitudes de derechos del titular ─────────────────────────────────────
-- Consulta, corrección o supresión. El worker/administrador las procesa y deja
-- constancia. La supresión borra eventos y sesión del anonymous_id/customer_id.
create table if not exists tracking_deletion_requests (
  id              bigserial primary key,
  anonymous_id    uuid,
  customer_id     bigint,
  status          tracking_deletion_status not null default 'pending',
  requested_at    timestamptz not null default now(),
  processed_at    timestamptz,
  notes           text,
  constraint tracking_deletion_requests_subject
    check (anonymous_id is not null or customer_id is not null)
);

create index if not exists idx_tracking_deletion_status
  on tracking_deletion_requests (status, requested_at);

-- ── Rechazos de ingesta (observabilidad) ────────────────────────────────────
-- Eventos que no pasaron validación (payload inválido, sin consentimiento…).
-- Se guardan sin PII y con retención corta (30 días) para depurar el cliente.
create table if not exists tracking_ingest_rejections (
  id            bigserial primary key,
  received_at   timestamptz not null default now(),
  reason        text        not null,
  remote_hash   text,
  payload       jsonb
);

create index if not exists idx_tracking_rejections_received
  on tracking_ingest_rejections (received_at desc);

-- ── Claves de API para la ingesta ───────────────────────────────────────────
-- El servicio de ingesta valida una API key por cliente (web/app). Se guarda el
-- hash, nunca la clave. Permite rotación y revocación sin desplegar.
create table if not exists tracking_api_keys (
  id            bigserial primary key,
  name          text        not null,
  key_hash      text        not null unique,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

-- ════════════════════════════════════════════════════════════════════════════
-- Funciones de mantenimiento
-- ════════════════════════════════════════════════════════════════════════════

-- Purga de eventos crudos fuera del plazo de conservación (por defecto 90 días).
create or replace function purge_tracking_events(retention_days integer default 90)
returns bigint
language plpgsql
as $$
declare
  removed bigint;
begin
  if retention_days < 1 then
    raise exception 'retention_days debe ser >= 1';
  end if;
  delete from tracking_events
   where occurred_at < now() - make_interval(days => retention_days);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Recalcula el rollup de un día concreto desde los eventos crudos.
create or replace function refresh_tracking_event_daily(target_day date)
returns void
language plpgsql
as $$
begin
  delete from tracking_event_daily where day = target_day;

  insert into tracking_event_daily (day, event_name, page_path, element_label, events, sessions)
  select target_day,
         event_name,
         coalesce(page_path, ''),
         coalesce(element_label, ''),
         count(*)::int,
         count(distinct session_id)::int
    from tracking_events
   where occurred_at >= target_day::timestamptz
     and occurred_at <  (target_day + 1)::timestamptz
   group by event_name, coalesce(page_path, ''), coalesce(element_label, '');
end;
$$;

-- Anonimiza la sesión y elimina sus eventos (derecho de supresión).
create or replace function delete_tracking_subject(
  p_anonymous_id uuid default null,
  p_customer_id bigint default null
)
returns bigint
language plpgsql
as $$
declare
  removed bigint := 0;
begin
  if p_anonymous_id is null and p_customer_id is null then
    raise exception 'Debe indicar anonymous_id o customer_id';
  end if;

  delete from tracking_events
   where (p_anonymous_id is not null and anonymous_id = p_anonymous_id)
      or (p_customer_id  is not null and customer_id  = p_customer_id);
  get diagnostics removed = row_count;

  delete from tracking_sessions
   where (p_anonymous_id is not null and anonymous_id = p_anonymous_id)
      or (p_customer_id  is not null and customer_id  = p_customer_id);

  return removed;
end;
$$;
