-- Descansos y metas del picking (idempotente).
-- Aplica las tablas que ya están declaradas en backend/drizzle/schema.ts.

CREATE TABLE IF NOT EXISTS picker_daily_stats (
  user_id         bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day             date        NOT NULL,
  branch_id       bigint      REFERENCES branches(id) ON DELETE SET NULL,
  products_picked integer     NOT NULL DEFAULT 0,
  breaks_earned   integer     NOT NULL DEFAULT 0,
  bonus_awarded   boolean     NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT picker_daily_stats_pkey PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS picker_break_ledger (
  id              bigserial     PRIMARY KEY,
  user_id         bigint        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id       bigint        REFERENCES branches(id) ON DELETE SET NULL,
  day             date          NOT NULL,
  type            varchar(16)   NOT NULL,
  minutes         integer       NOT NULL DEFAULT 0,
  amount          numeric(12,2) NOT NULL DEFAULT '0',
  threshold_index integer,
  order_id        bigint        REFERENCES orders(id) ON DELETE SET NULL,
  note            text,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

-- Evita doble crédito del mismo umbral en el mismo día.
CREATE UNIQUE INDEX IF NOT EXISTS picker_break_earned_uniq
  ON picker_break_ledger (user_id, day, threshold_index)
  WHERE type = 'earned';

CREATE INDEX IF NOT EXISTS idx_picker_break_ledger_user_day
  ON picker_break_ledger USING btree (user_id, day);
