-- 0002: comprobante de transferencia en payments
-- Guarda el comprobante (imagen comprimida o PDF) como data URL base64 para que
-- el admin pueda verlo y confirmar el pago manual. Aditivo.
-- ADD COLUMN no soporta IF NOT EXISTS; esta columna no existía antes (versión 0002).

ALTER TABLE payments ADD COLUMN receipt_url TEXT;
