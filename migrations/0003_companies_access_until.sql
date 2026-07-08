-- 0003: fecha única de caducidad de acceso por empresa (fuente de verdad del ciclo de vida)
-- access_until = datetime ISO hasta cuándo la empresa tiene acceso (prueba, plan pagado
-- o activación manual usan la misma fecha). El estado efectivo y la automatización
-- (login + cron) se calculan a partir de esta fecha. Aditivo.

ALTER TABLE companies ADD COLUMN access_until TEXT;

-- Backfill: las empresas en prueba usan su trial_ends_at;
-- las pagadas usan el current_period_end de su suscripción vinculada.
UPDATE companies SET access_until = trial_ends_at
  WHERE access_until IS NULL AND trial_ends_at IS NOT NULL;

UPDATE companies SET access_until = (
    SELECT s.current_period_end FROM subscriptions s WHERE s.id = companies.subscription_id
) WHERE access_until IS NULL AND subscription_id IS NOT NULL;
