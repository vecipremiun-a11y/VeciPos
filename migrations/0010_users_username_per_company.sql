-- 0010: username único POR SUCURSAL (empresa), no global.
-- Antes users.username tenía UNIQUE global → no se podía repetir "luis" entre
-- sucursales. Ahora la unicidad es UNIQUE(company_id, username): cada sucursal
-- maneja su propio grupo de usuarios. El login desambigua por contraseña
-- (ver api/auth/login.js). Verificado: no hay duplicados (company_id,username)
-- previos, así que el rebuild no pierde filas.
--
-- SQLite no puede quitar un UNIQUE de columna con ALTER → se reconstruye la tabla
-- preservando los id (las FK user_companies/vacation_*/etc. son por valor de id).
-- Turso ENFORCEA foreign_keys, así que se desactivan durante el rebuild (el
-- PRAGMA aplica a la conexión del script; se re-activa al final).

PRAGMA foreign_keys=OFF;

-- 1) Respaldo por si acaso (rollback: recrear users desde aquí).
CREATE TABLE IF NOT EXISTS users_backup_0010 AS SELECT * FROM users;

-- 2) Tabla nueva sin UNIQUE global; con UNIQUE(company_id, username).
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  company_id TEXT DEFAULT 'default',
  has_labor_profile INTEGER DEFAULT 0,
  labor_position TEXT,
  labor_branch TEXT,
  labor_start_date TEXT,
  labor_status TEXT DEFAULT 'active',
  labor_pin TEXT,
  pay_type TEXT DEFAULT 'monthly',
  pay_method TEXT DEFAULT 'cash',
  pay_day TEXT,
  pay_base_amount REAL DEFAULT 0,
  pay_fixed_bonus REAL DEFAULT 0,
  pay_fixed_discount REAL DEFAULT 0,
  pay_bank_name TEXT,
  pay_bank_account TEXT,
  pay_bank_account_type TEXT,
  pay_bank_owner TEXT,
  UNIQUE(company_id, username)
);

-- 3) Copiar datos preservando id (mismo orden de columnas en ambas bases).
INSERT INTO users_new (id, username, password, name, role, company_id, has_labor_profile, labor_position, labor_branch, labor_start_date, labor_status, labor_pin, pay_type, pay_method, pay_day, pay_base_amount, pay_fixed_bonus, pay_fixed_discount, pay_bank_name, pay_bank_account, pay_bank_account_type, pay_bank_owner)
SELECT id, username, password, name, role, company_id, has_labor_profile, labor_position, labor_branch, labor_start_date, labor_status, labor_pin, pay_type, pay_method, pay_day, pay_base_amount, pay_fixed_bonus, pay_fixed_discount, pay_bank_name, pay_bank_account, pay_bank_account_type, pay_bank_owner
FROM users;

-- 4) Reemplazar la tabla.
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- 5) Recrear índice por empresa e igualar el contador AUTOINCREMENT.
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);
DELETE FROM sqlite_sequence WHERE name IN ('users', 'users_new');
INSERT INTO sqlite_sequence (name, seq) SELECT 'users', COALESCE(MAX(id), 0) FROM users;

PRAGMA foreign_keys=ON;
