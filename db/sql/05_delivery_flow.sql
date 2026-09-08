-- 05_delivery_flow.sql
-- Máquina de estados del delivery (contrato de la app) + timestamps del ciclo
-- de vida + token push del repartidor.
BEGIN;

-- Estados nuevos del flujo del repartidor.
ALTER TYPE delivery_assignment_status_enum ADD VALUE IF NOT EXISTS 'ACCEPTED';
ALTER TYPE delivery_assignment_status_enum ADD VALUE IF NOT EXISTS 'READY_FOR_PICKUP';
ALTER TYPE delivery_assignment_status_enum ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE delivery_assignment_status_enum ADD VALUE IF NOT EXISTS 'FAILED_DELIVERY';

-- IN_TRANSIT (legado) pasa a IN_DELIVERY (contrato de la app).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'delivery_assignment_status_enum'::regtype
      AND enumlabel = 'IN_TRANSIT'
  ) THEN
    ALTER TYPE delivery_assignment_status_enum RENAME VALUE 'IN_TRANSIT' TO 'IN_DELIVERY';
  END IF;
END $$;

-- Timestamps del ciclo de vida de la asignación.
ALTER TABLE delivery_assignments
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ready_for_pickup_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS in_delivery_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reject_reason TEXT;

-- Token push (FCM/expo) del repartidor.
ALTER TABLE delivery_drivers
  ADD COLUMN IF NOT EXISTS push_token TEXT;

COMMIT;
