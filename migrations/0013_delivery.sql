-- 0013: App Delivery — repartidores, envíos, rastreo y liquidación.
--
-- MODELO. Un ENVÍO (deliveries) es la unidad de trabajo, sin importar de dónde
-- venga el pedido: tienda web, encargo de cocina o una venta del POS marcada para
-- despacho. Así "Envíos" es una sola bandeja y el resto del sistema no cambia.
--   source_type/source_id apuntan al origen ('preorder' | 'sale' | 'manual').
--
-- DINERO (lección del doble conteo de encargos, commit e7669c4). Cuando el
-- repartidor cobra, esa plata NO está en la caja hasta que rinde. Por eso:
--   · deliveries.amount_to_collect  = lo que debe cobrar (0 si viene pagado)
--   · deliveries.collected_amount   = lo que efectivamente cobró
--   · la caja recibe ese efectivo por UNA SOLA VÍA: la liquidación
--     (delivery_settlements → movimiento de caja tipo IN). Nunca se suma
--     automáticamente desde la venta, o el arqueo quedaría inflado.
--
-- Todo es aditivo: si se revierte el código, estas tablas quedan sin uso y no
-- estorban a nada existente.

-- Repartidores. Se enlazan a un usuario para que puedan entrar a la app en
-- "Modo Repartidor". user_id queda anulable por si se registra uno sin cuenta.
CREATE TABLE IF NOT EXISTS couriers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    user_id INTEGER,
    name TEXT NOT NULL,
    phone TEXT,
    vehicle TEXT DEFAULT 'moto',            -- moto | auto | bici | pie
    status TEXT NOT NULL DEFAULT 'off',     -- available | busy | off
    active INTEGER NOT NULL DEFAULT 1,
    last_lat REAL,
    last_lng REAL,
    last_seen_at TEXT,
    created_at TEXT,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_couriers_company ON couriers(company_id, active);
CREATE INDEX IF NOT EXISTS idx_couriers_user ON couriers(user_id);

-- Envíos.
CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'manual',   -- preorder | sale | manual
    source_id INTEGER,
    courier_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',       -- pending|assigned|picked_up|on_route|delivered|failed|canceled
    client_name TEXT,
    client_phone TEXT,
    address TEXT,
    address_notes TEXT,
    lat REAL,
    lng REAL,
    -- Dinero: si amount_to_collect > 0 el repartidor cobra al entregar.
    amount_to_collect REAL NOT NULL DEFAULT 0,
    collected_amount REAL NOT NULL DEFAULT 0,
    collected_method TEXT,                        -- Efectivo | Tarjeta | Transferencia
    delivery_fee REAL NOT NULL DEFAULT 0,
    settlement_id INTEGER,                        -- liquidación donde se rindió
    failed_reason TEXT,
    notes TEXT,
    created_by INTEGER,
    assigned_at TEXT,
    picked_up_at TEXT,
    delivered_at TEXT,
    created_at TEXT,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_deliveries_company_status ON deliveries(company_id, status);
CREATE INDEX IF NOT EXISTS idx_deliveries_courier ON deliveries(courier_id, status);
CREATE INDEX IF NOT EXISTS idx_deliveries_source ON deliveries(company_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_settlement ON deliveries(settlement_id);

-- Bitácora: cada cambio de estado con hora y responsable (para medir tiempos).
CREATE TABLE IF NOT EXISTS delivery_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    delivery_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    by_user_id INTEGER,
    note TEXT,
    created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_delivery_events_del ON delivery_events(delivery_id);

-- Rastro de ubicación. Corto y con limpieza: solo se escribe mientras el
-- repartidor está en ruta, y se purga lo viejo para que no crezca sin control.
CREATE TABLE IF NOT EXISTS courier_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    courier_id INTEGER NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_courier_loc ON courier_locations(courier_id, created_at);

-- Liquidaciones: lo que el repartidor recaudó y rindió a una caja.
CREATE TABLE IF NOT EXISTS delivery_settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    courier_id INTEGER NOT NULL,
    register_id INTEGER,                    -- caja donde se rindió el efectivo
    total_collected REAL NOT NULL DEFAULT 0,
    cash_amount REAL NOT NULL DEFAULT 0,
    deliveries_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'closed',
    notes TEXT,
    settled_by INTEGER,
    created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_settlements_company ON delivery_settlements(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_settlements_courier ON delivery_settlements(courier_id);

-- Modo de asignación por empresa: manual | request | auto
ALTER TABLE companies ADD COLUMN delivery_assign_mode TEXT DEFAULT 'manual';
