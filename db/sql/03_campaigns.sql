-- ============================================================
-- 03_campaigns.sql — Tablas del módulo de campañas de marketing
-- (backend: modules/campaigns). Aditivo e idempotente.
-- ============================================================

DO $$
BEGIN
  CREATE TYPE campaign_status_enum AS ENUM (
    'borrador', 'programada', 'enviando', 'enviada', 'fallida'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE campaign_channel_enum AS ENUM ('whatsapp', 'email', 'sms');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE campaign_recipient_status_enum AS ENUM (
    'pendiente', 'enviado', 'abierto', 'fallido'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS campaigns (
  id              bigserial PRIMARY KEY,
  name            varchar(200) NOT NULL,
  product_id      bigint,
  prompt          text,
  tone            varchar(50),
  channels        jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          campaign_status_enum NOT NULL DEFAULT 'borrador',
  audience_count  integer NOT NULL DEFAULT 0,
  scheduled_at    timestamptz,
  sent_at         timestamptz,
  sent_count      integer NOT NULL DEFAULT 0,
  opened_count    integer NOT NULL DEFAULT 0,
  converted_count integer NOT NULL DEFAULT 0,
  created_by      bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status
  ON campaigns USING btree (status);
CREATE INDEX IF NOT EXISTS idx_campaigns_deleted_at
  ON campaigns (deleted_at);

CREATE TABLE IF NOT EXISTS campaign_messages (
  id           bigserial PRIMARY KEY,
  campaign_id  bigint NOT NULL,
  channel      campaign_channel_enum NOT NULL,
  subject      varchar(300),
  content      text,
  html         text,
  email_blocks jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_messages_campaign
  ON campaign_messages (campaign_id);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id          bigserial PRIMARY KEY,
  campaign_id bigint NOT NULL,
  customer_id bigint,
  name        varchar(200),
  email       varchar(255),
  phone       varchar(50),
  status      campaign_recipient_status_enum NOT NULL DEFAULT 'pendiente',
  sent_at     timestamptz,
  opened_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign
  ON campaign_recipients (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_status
  ON campaign_recipients USING btree (status);
