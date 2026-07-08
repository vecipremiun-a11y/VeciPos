-- 0001: columnas de plan y ciclo en payments
-- Permiten saber qué plan/ciclo activar al aprobar un pago manual (ej. transferencia).
-- Aditivo. ADD COLUMN no soporta IF NOT EXISTS; estas columnas no existían antes (versión 0001).

ALTER TABLE payments ADD COLUMN plan_id TEXT;
ALTER TABLE payments ADD COLUMN billing_cycle TEXT;
