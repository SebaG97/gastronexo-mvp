CREATE TABLE IF NOT EXISTS app_state (
  id smallint PRIMARY KEY DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_state_singleton CHECK (id = 1)
);

INSERT INTO app_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
