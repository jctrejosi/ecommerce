-- ============================================================================
-- Mercaldas · tracking · Roles de mínimo privilegio
-- ============================================================================
-- Ejecutar conectado a la base `mercaldas_tracking`, después de schema.sql:
--   psql -d mercaldas_tracking -v ON_ERROR_STOP=1 -f db/tracking/roles.sql
--
-- Los roles son CLUSTER-WIDE (Postgres): si ya existen, los bloques DO no fallan.
-- Asignar contraseñas/credenciales por fuera (no se guardan aquí).
-- ============================================================================

do $$ begin create role tracking_ingest nologin; exception when duplicate_object then null; end $$;
do $$ begin create role tracking_worker nologin; exception when duplicate_object then null; end $$;
do $$ begin create role tracking_readonly nologin; exception when duplicate_object then null; end $$;

grant connect on database mercaldas_tracking to
  tracking_ingest, tracking_worker, tracking_readonly;

grant usage on schema public to
  tracking_ingest, tracking_worker, tracking_readonly;

-- ── Ingesta: valida API key/consentimiento y registra rechazos ─────────────
grant select on tracking_api_keys to tracking_ingest;
grant select on tracking_sessions to tracking_ingest;
grant select on tracking_consents to tracking_ingest;
grant insert on tracking_ingest_rejections to tracking_ingest;
grant usage, select on sequence tracking_ingest_rejections_id_seq to tracking_ingest;

-- ── Worker: escribe eventos (append-only) y rollups ───────────────────────
grant select, insert, update on
  tracking_sessions,
  tracking_consents,
  tracking_deletion_requests,
  tracking_event_daily,
  tracking_api_keys
 to tracking_worker;

-- Los eventos y rechazos son append-only: el worker nunca los actualiza.
grant select, insert on
  tracking_events,
  tracking_ingest_rejections
 to tracking_worker;

grant usage, select on all sequences in schema public to tracking_worker;
grant execute on function purge_tracking_events(integer) to tracking_worker;
grant execute on function refresh_tracking_event_daily(date) to tracking_worker;
grant execute on function delete_tracking_subject(uuid, bigint) to tracking_worker;

-- ── Solo lectura: dashboards y BI (sin acceso a hashes de API keys) ───────
grant select on
  tracking_sessions,
  tracking_consents,
  tracking_events,
  tracking_event_daily,
  tracking_deletion_requests,
  tracking_ingest_rejections
 to tracking_readonly;

-- A partir de aquí, los objetos nuevos heredan los permisos del owner; si se
-- crean más tablas, repetir los grants o usar ALTER DEFAULT PRIVILEGES.
