-- 0005: enlace entre empresas de una misma cuenta (multi-empresa).
-- parent_company_id = id de la empresa principal (raíz). NULL = empresa principal.
-- Cada empresa mantiene su propio plan/pago/bloqueo; el enlace solo agrupa las
-- empresas de un mismo dueño para saber cuál pertenece a cuál y mostrarlas juntas.
-- Aditivo.

ALTER TABLE companies ADD COLUMN parent_company_id TEXT;

CREATE INDEX IF NOT EXISTS idx_companies_parent ON companies (parent_company_id);
