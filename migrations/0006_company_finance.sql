-- 0006: administración financiera y gastos operacionales por empresa.
-- Separa compromisos recurrentes de sus pagos/gastos reales para evitar
-- duplicados y permitir calcular utilidad operacional por período.

CREATE TABLE IF NOT EXISTS expense_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#64748b',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS recurring_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    category_id INTEGER,
    description TEXT NOT NULL,
    supplier TEXT,
    amount REAL NOT NULL DEFAULT 0,
    frequency TEXT NOT NULL DEFAULT 'monthly',
    start_date TEXT NOT NULL,
    end_date TEXT,
    due_day INTEGER,
    payment_method TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(category_id) REFERENCES expense_categories(id)
);

CREATE TABLE IF NOT EXISTS business_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    recurring_expense_id INTEGER,
    category_id INTEGER,
    period_key TEXT,
    description TEXT NOT NULL,
    supplier TEXT,
    amount REAL NOT NULL DEFAULT 0,
    expense_date TEXT NOT NULL,
    due_date TEXT,
    paid_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    payment_method TEXT,
    notes TEXT,
    receipt_url TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(recurring_expense_id) REFERENCES recurring_expenses(id),
    FOREIGN KEY(category_id) REFERENCES expense_categories(id),
    UNIQUE(company_id, recurring_expense_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_company
    ON expense_categories(company_id, active, name);
CREATE INDEX IF NOT EXISTS idx_recurring_expenses_company
    ON recurring_expenses(company_id, active, start_date);
CREATE INDEX IF NOT EXISTS idx_business_expenses_company_date
    ON business_expenses(company_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_business_expenses_company_status
    ON business_expenses(company_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_business_expenses_recurring_period
    ON business_expenses(company_id, recurring_expense_id, period_key);

-- Permisos para empresas existentes. Owner/super_admin mantienen su bypass.
INSERT OR IGNORE INTO role_permissions (company_id, role, permission, granted)
SELECT DISTINCT company_id, 'Administrador', 'finance.view', 1 FROM role_permissions;
INSERT OR IGNORE INTO role_permissions (company_id, role, permission, granted)
SELECT DISTINCT company_id, 'Administrador', 'finance.manage', 1 FROM role_permissions;
INSERT OR IGNORE INTO role_permissions (company_id, role, permission, granted)
SELECT DISTINCT company_id, 'Supervisor', 'finance.view', 1 FROM role_permissions;
INSERT OR IGNORE INTO role_permissions (company_id, role, permission, granted)
SELECT DISTINCT company_id, role, 'finance.manage', 0
FROM role_permissions WHERE role IN ('Caja', 'Vendedor', 'Bodeguero', 'Supervisor');
INSERT OR IGNORE INTO role_permissions (company_id, role, permission, granted)
SELECT DISTINCT company_id, role, 'finance.view', 0
FROM role_permissions WHERE role IN ('Caja', 'Vendedor', 'Bodeguero');
