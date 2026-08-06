-- Índice para el monitoreo de clientes (/admin/actividad).
--
-- `audit_logs` no tenía NINGÚN índice. La consulta que arma el panel
-- (GROUP BY company_id, user_id con MAX(created_at)) recorría la tabla entera:
-- medido el 06-ago-2026 sobre 84.540 filas → 2,8 s solo esa consulta, 3,6 s el
-- endpoint completo. La tabla crece ~3.000 filas/día, así que sin índice el
-- endpoint termina pasando el límite de 10 s de Vercel.
--
-- El orden de las columnas sigue el patrón de acceso: primero se agrupa por
-- empresa, después por usuario, y created_at cierra para que MAX() salga del
-- índice sin tocar la tabla.
--
-- Es aditivo y reversible: DROP INDEX idx_audit_company_user_date;
--
-- Va UN solo índice a propósito. En toda la app `audit_logs` solo se escribe
-- (un INSERT por venta, compra, ajuste…); el único lector es el panel de
-- actividad. Cada índice extra encarece esas escrituras sin que nadie lo lea.

CREATE INDEX IF NOT EXISTS idx_audit_company_user_date
    ON audit_logs(company_id, user_id, created_at DESC);
