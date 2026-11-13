-- Mision 9.1: motivo opcional en los cambios de estado de un pedido (por ejemplo, por que se
-- cancelo). Se guarda en el historial, que sigue siendo de solo agregar.

ALTER TABLE order_status_history
  ADD COLUMN IF NOT EXISTS note TEXT;

ALTER TABLE order_status_history
  DROP CONSTRAINT IF EXISTS order_status_history_note_length;

ALTER TABLE order_status_history
  ADD CONSTRAINT order_status_history_note_length CHECK (note IS NULL OR char_length(note) <= 300);
