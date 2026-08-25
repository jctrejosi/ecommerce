-- ======================================================
-- EXTENSIONES NECESARIAS PARA EL ECOMMERCE
-- ======================================================

-- 1. PostGIS: Para columnas GEOGRAPHY (ubicaciones, zonas de entrega)
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. citext: Para emails case-insensitive (users, customers, drivers)
CREATE EXTENSION IF NOT EXISTS citext;

-- 3. uuid-ossp: Para generar UUIDs (sesiones, tokens, etc.)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 4. unaccent: Búsqueda insensible a tildes/ñ (buscador del catálogo)
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 5. pg_trgm: Búsqueda difusa por similitud de trigramas (tolera tipeos)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 6. immutable_unaccent: wrapper IMMUTABLE de unaccent() para poder usarlo en
--    índices (unaccent() es STABLE y PostgreSQL no permite STABLE en índices).
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT public.unaccent($1) $$;

-- ======================================================
-- VERIFICACIÓN (opcional)
-- ======================================================
DO $$
BEGIN
    RAISE NOTICE '✅ Extensiones instaladas correctamente:';
    RAISE NOTICE '   - postgis: %', (SELECT extversion FROM pg_extension WHERE extname = 'postgis');
    RAISE NOTICE '   - citext: %', (SELECT extversion FROM pg_extension WHERE extname = 'citext');
    RAISE NOTICE '   - uuid-ossp: %', (SELECT extversion FROM pg_extension WHERE extname = 'uuid-ossp');
END $$;