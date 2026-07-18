-- 0008: modelo definitivo de 2 planes por sucursal (Standard / Profesional).
-- Remapea los planes legacy de companies.plan a los 2 planes actuales.
-- Aditivo e idempotente: al reejecutar, ninguna fila legacy queda por convertir.
--
--   basico / basic / (vacío) / free / gratis  →  standard
--   medium / medio / pro                       →  professional
--
-- El gating por plan lee companies.plan (ver src/store/useStore.js hasModule +
-- src/config/mercadopago.js getPlanLevel). Las suscripciones/pagos históricos
-- (subscriptions.plan_id, payments.plan_id) se dejan tal cual como registro.
--
-- NOTA: no se cambia el DEFAULT de la columna (SQLite requeriría rebuild). No hace
-- falta: todas las altas (start-trial, createCompany, companyLinkedCreate) fijan
-- el plan explícitamente.

UPDATE companies
   SET plan = 'standard'
 WHERE lower(coalesce(plan, '')) IN ('basico', 'basic', '', 'free', 'gratis');

UPDATE companies
   SET plan = 'professional'
 WHERE lower(coalesce(plan, '')) IN ('medium', 'medio', 'pro');
