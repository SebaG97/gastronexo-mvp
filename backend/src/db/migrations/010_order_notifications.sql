-- Mision 7.4: avisos de pedidos nuevos fuera de la consola (Telegram y email).

-- Destinos de aviso por organizacion.
CREATE TABLE notification_settings (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  notify_emails TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  telegram_chat_id TEXT,
  telegram_chat_title TEXT,
  telegram_linked_at TIMESTAMPTZ,
  -- Codigo de un solo uso para vincular un chat: se envia al bot con /start <codigo>.
  telegram_link_code TEXT,
  telegram_link_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notification_settings_emails_max CHECK (cardinality(notify_emails) <= 5),
  CONSTRAINT notification_settings_link_code_pair
    CHECK ((telegram_link_code IS NULL) = (telegram_link_expires_at IS NULL))
);

CREATE UNIQUE INDEX notification_settings_link_code_unique
  ON notification_settings (telegram_link_code)
  WHERE telegram_link_code IS NOT NULL;

-- Cola de avisos (outbox). Se escribe en la misma transaccion que el pedido: si el pedido
-- existe, su aviso tambien. Un proceso de la API la despacha y reintenta.
CREATE TABLE order_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'email')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- Proximo intento; mientras un proceso envia, funciona como lease (se corre hacia adelante).
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_notifications_one_per_channel UNIQUE (order_id, channel),
  CONSTRAINT order_notifications_sent_at CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);

CREATE INDEX order_notifications_due_idx
  ON order_notifications (next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX order_notifications_org_recent_idx
  ON order_notifications (organization_id, created_at DESC);

-- Estado del bot compartido por toda la instalacion: ultimo update de Telegram procesado.
CREATE TABLE telegram_bot_state (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  update_offset BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO telegram_bot_state (id) VALUES (TRUE);
