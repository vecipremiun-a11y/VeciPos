-- 0012: cada venta guarda a qué caja pertenece.
--
-- PROBLEMA. `sales` no tenía forma de saber en qué caja se hizo la venta. La relación
-- se adivinaba con la heurística (user_id = dueño de la caja) AND (date >= opening_time).
-- Eso trae tres fallas reales:
--   1. La venta cae en la caja según QUIÉN la grabó. Si la sesión del navegador cambia
--      (dos pestañas, dos usuarios), la venta aterriza en la caja del otro. Fue el
--      reclamo de minimarket D&A del 22-jul-2026: la caja de la cajera dejó de sumar.
--   2. `opening_time` lo generaba el dispositivo. Con la zona horaria del equipo mal
--      puesta, la hora de apertura queda en el futuro y NINGUNA venta suma.
--   3. Una caja abierta hace días arrastra las ventas de todos esos días.
--
-- SOLUCIÓN. Columna explícita `register_id`. Aditiva y anulable: las ventas viejas
-- quedan en NULL y se siguen resolviendo con la heurística anterior (ver el OR de
-- compatibilidad en api/_lib/registerActions.js). Revertir = revertir el código; los
-- datos no estorban.

ALTER TABLE sales ADD COLUMN register_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_sales_register ON sales(register_id);

-- Backfill acotado a las cajas que siguen ABIERTAS: son las únicas cuyo saldo se está
-- mostrando ahora mismo, y así quedan exactas desde el primer minuto. Las ventas de
-- cajas ya cerradas se quedan en NULL y las resuelve la heurística de compatibilidad
-- (son ~114 filas contra 68.728: el resto no se toca).
UPDATE sales
SET register_id = (
    SELECT cr.id
    FROM cash_registers cr
    WHERE cr.status = 'open'
      AND cr.user_id = sales.user_id
      AND cr.company_id = sales.company_id
      AND cr.opening_time <= sales.date
    ORDER BY cr.opening_time DESC
    LIMIT 1
)
WHERE register_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM cash_registers cr2
    WHERE cr2.status = 'open'
      AND cr2.user_id = sales.user_id
      AND cr2.company_id = sales.company_id
      AND cr2.opening_time <= sales.date
  );
