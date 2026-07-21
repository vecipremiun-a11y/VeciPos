-- 0011: columnas de facturación para company_apps (modelo de pago unificado B).
-- Aditivo. El runner corre cada migración una sola vez (versión en system_settings),
-- así que los ADD COLUMN se ejecutan una vez por base.
--
--   period_end   : fin del período vigente (pagado o de prueba). NULL en activos
--                  grandfathered = sin vencimiento.
--   trial_used   : 1 = ya consumió su prueba gratis (una sola prueba por sucursal).
--   will_renew   : 1 = renueva junto al plan; 0 = cancelada, activa hasta period_end.
--   source       : 'marketplace' | 'admin' | 'grant' (origen de la activación).
--   granted_free : 1 = otorgada gratis; no suma al pago mensual.

ALTER TABLE company_apps ADD COLUMN period_end TEXT;
ALTER TABLE company_apps ADD COLUMN trial_used INTEGER DEFAULT 0;
ALTER TABLE company_apps ADD COLUMN will_renew INTEGER DEFAULT 1;
ALTER TABLE company_apps ADD COLUMN source TEXT DEFAULT 'marketplace';
ALTER TABLE company_apps ADD COLUMN granted_free INTEGER DEFAULT 0;

-- Backfill: las pruebas vigentes conservan su fecha como fin de período.
UPDATE company_apps SET period_end = trial_ends_at WHERE status = 'trial' AND period_end IS NULL;

-- Backfill: toda fila existente ya ocupó su cupo de prueba (no re-ofrecer prueba).
UPDATE company_apps SET trial_used = 1 WHERE trial_used = 0;

-- Grandfather: los activos sin precio ni prueba (venían del alta masiva de 0009)
-- se conservan GRATIS y sin vencimiento — no se cobran retroactivamente.
UPDATE company_apps
   SET granted_free = 1, source = 'grant'
 WHERE status = 'active' AND trial_ends_at IS NULL AND (price IS NULL OR price = 0);
