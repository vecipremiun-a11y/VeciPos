-- 0004: completar access_until desde la suscripción más reciente por company_id.
-- En 0003 el backfill usó companies.subscription_id, pero varias empresas tienen ese
-- campo en NULL aunque sí existe una suscripción vinculada por company_id. Esto dejaba
-- access_until en NULL y la empresa se mostraba como Activa pese a estar vencida.

UPDATE companies SET access_until = (
    SELECT s.current_period_end
    FROM subscriptions s
    WHERE s.company_id = companies.id AND s.current_period_end IS NOT NULL
    ORDER BY s.current_period_end DESC
    LIMIT 1
)
WHERE access_until IS NULL
  AND EXISTS (
      SELECT 1 FROM subscriptions s2
      WHERE s2.company_id = companies.id AND s2.current_period_end IS NOT NULL
  );
