-- Cupones digitales: código autogenerado, descuento y/o saldo, ledger de movimientos.

ALTER TYPE payment_method_enum ADD VALUE IF NOT EXISTS 'COUPON';

BEGIN;

ALTER TABLE coupons
  ALTER COLUMN promotion_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS kind varchar(20) NOT NULL DEFAULT 'discount',
  ADD COLUMN IF NOT EXISTS discount_type varchar(20),
  ADD COLUMN IF NOT EXISTS discount_value numeric(12, 2),
  ADD COLUMN IF NOT EXISTS maximum_discount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS initial_balance numeric(12, 2),
  ADD COLUMN IF NOT EXISTS current_balance numeric(12, 2),
  ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'COP',
  ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS issued_customer_id bigint,
  ADD COLUMN IF NOT EXISTS created_by bigint,
  ADD COLUMN IF NOT EXISTS notes text;

CREATE INDEX IF NOT EXISTS idx_coupon_status ON coupons (status);
CREATE INDEX IF NOT EXISTS idx_coupon_issued_customer ON coupons (issued_customer_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_issued_customer_id_fkey'
  ) THEN
    ALTER TABLE coupons
      ADD CONSTRAINT coupons_issued_customer_id_fkey
      FOREIGN KEY (issued_customer_id) REFERENCES customers(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_created_by_fkey'
  ) THEN
    ALTER TABLE coupons
      ADD CONSTRAINT coupons_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES users(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coupon_transaction_type_enum') THEN
    CREATE TYPE coupon_transaction_type_enum AS ENUM (
      'ISSUE', 'REDEEM', 'REVERSAL', 'ADJUSTMENT', 'EXPIRATION'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS coupon_transactions (
  id bigserial PRIMARY KEY,
  coupon_id bigint NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  order_id bigint REFERENCES orders(id) ON DELETE SET NULL,
  customer_id bigint REFERENCES customers(id) ON DELETE SET NULL,
  guest_session_id bigint,
  type coupon_transaction_type_enum NOT NULL,
  discount_amount numeric(12, 2) NOT NULL DEFAULT 0,
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  balance_before numeric(12, 2),
  balance_after numeric(12, 2),
  created_by bigint,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coupon_transactions_coupon
  ON coupon_transactions (coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_transactions_order
  ON coupon_transactions (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_transactions_order_unique
  ON coupon_transactions (coupon_id, order_id, type)
  WHERE order_id IS NOT NULL;

COMMIT;
