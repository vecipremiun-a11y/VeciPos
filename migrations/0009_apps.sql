-- 0009: complementos (Apps) del Marketplace. Cada empresa/sucursal puede
-- contratar Apps aparte del plan. Aditivo e idempotente.
--
-- scope  : 'branch'  = licencia por sucursal (la fila vive en cada company_id)
--          'company' = licencia por empresa (a futuro; hoy todas las reales son branch)
-- status : 'trial' (prueba 30 días) | 'active' (pagada) | 'cancelled'
-- El gating efectivo lo aplica hasApp() en el cliente (mismo modelo que hasModule).

CREATE TABLE IF NOT EXISTS company_apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    app_key TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'branch',
    status TEXT NOT NULL DEFAULT 'trial',
    trial_ends_at TEXT,
    activated_at TEXT,
    cancelled_at TEXT,
    price REAL,
    currency TEXT DEFAULT 'CLP',
    created_at TEXT,
    updated_at TEXT,
    UNIQUE(company_id, app_key)
);

CREATE INDEX IF NOT EXISTS idx_company_apps_company ON company_apps(company_id, status);

-- Grandfather: las empresas que hoy son Profesional (venían de medium/pro y ya
-- usaban Encargos/Integración/Balanza) conservan esas funciones como Apps activas
-- sin cobro retroactivo. Las cuentas nuevas activarán cada App desde el Marketplace.
INSERT OR IGNORE INTO company_apps (company_id, app_key, scope, status, activated_at, created_at, updated_at)
SELECT id, 'cocina', 'branch', 'active', datetime('now'), datetime('now'), datetime('now')
FROM companies WHERE lower(coalesce(plan,'')) IN ('professional', 'medium', 'medio', 'pro');

INSERT OR IGNORE INTO company_apps (company_id, app_key, scope, status, activated_at, created_at, updated_at)
SELECT id, 'integracion', 'branch', 'active', datetime('now'), datetime('now'), datetime('now')
FROM companies WHERE lower(coalesce(plan,'')) IN ('professional', 'medium', 'medio', 'pro');

INSERT OR IGNORE INTO company_apps (company_id, app_key, scope, status, activated_at, created_at, updated_at)
SELECT id, 'bascula', 'branch', 'active', datetime('now'), datetime('now'), datetime('now')
FROM companies WHERE lower(coalesce(plan,'')) IN ('professional', 'medium', 'medio', 'pro');

INSERT OR IGNORE INTO company_apps (company_id, app_key, scope, status, activated_at, created_at, updated_at)
SELECT id, 'tienda_web', 'branch', 'active', datetime('now'), datetime('now'), datetime('now')
FROM companies WHERE lower(coalesce(plan,'')) IN ('professional', 'medium', 'medio', 'pro');
