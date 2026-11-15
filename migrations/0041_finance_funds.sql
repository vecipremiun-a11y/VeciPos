-- Fondos: caja chica, capital… plata apartada para pagar los gastos del local.
--
-- EL PEDIDO. Kevin (14-nov-2026): al pagar una cuenta, la plata no sale de la
-- caja de ventas. Quiere llevar aparte cuánto tiene de caja chica o de capital
-- y que de ahí se vaya descontando, sin mezclarse con las ventas del día.
--
-- EL SALDO NO SE GUARDA, SE CALCULA:
--   aportes − retiros (finance_fund_movements)
--   − gastos pagados con ese fondo (business_expenses.fund_id, status 'paid')
-- Así, si un gasto se corrige o se borra, el saldo se ajusta solo, sin
-- escribir dos veces lo mismo. Un gasto pendiente no descuenta hasta pagarse.
--
-- LAS TABLAS.
--   finance_funds           Un fondo por fila (nombre, activo).
--   finance_fund_movements  Plata que entra (deposit) o sale para otra cosa
--                           que no es un gasto (withdrawal). Monto siempre
--                           positivo; el signo lo da `kind`.
--   business_expenses.fund_id  De qué fondo salió el pago. NULL = de ninguno
--                           (como todos los gastos de antes).
--
-- Al desplegar: el servidor funciona sin esta migración (los fondos no
-- aparecen y lo demás de Administración sigue igual) y la usa apenas existe.
--
-- Aditivo. Rollback: revertir el commit; las tablas y la columna quedan sin usar.

CREATE TABLE IF NOT EXISTS finance_funds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_finance_funds_company ON finance_funds(company_id, active);

CREATE TABLE IF NOT EXISTS finance_fund_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    fund_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    movement_date TEXT NOT NULL,
    description TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY(fund_id) REFERENCES finance_funds(id)
);

CREATE INDEX IF NOT EXISTS idx_finance_fund_movements_fund
    ON finance_fund_movements(company_id, fund_id, movement_date);

ALTER TABLE business_expenses ADD COLUMN fund_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_business_expenses_fund
    ON business_expenses(company_id, fund_id, status);
