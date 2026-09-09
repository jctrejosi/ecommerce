-- 06_delivery_proof.sql
-- Prueba de entrega: fotos obligatorias (lugar + pedido) y nota opcional.
BEGIN;

ALTER TABLE delivery_assignments
  ADD COLUMN IF NOT EXISTS delivery_note TEXT;

DO $$
BEGIN
  CREATE TYPE delivery_proof_kind_enum AS ENUM ('LOCATION', 'PACKAGE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS delivery_proof_media (
  id            BIGSERIAL PRIMARY KEY,
  assignment_id BIGINT NOT NULL REFERENCES delivery_assignments(id) ON DELETE CASCADE,
  kind          delivery_proof_kind_enum NOT NULL,
  url           TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_proof_assignment
  ON delivery_proof_media(assignment_id);

COMMIT;
