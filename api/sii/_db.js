import { createClient } from '@libsql/client';

let tursoClient = null;
let _tablesEnsured = false;

function getTursoClient() {
    if (tursoClient) return tursoClient;

    const url = process.env.VITE_TURSO_DATABASE_URL;
    const authToken = process.env.VITE_TURSO_AUTH_TOKEN;

    if (!url || !authToken) {
        throw new Error('Faltan variables Turso: VITE_TURSO_DATABASE_URL o VITE_TURSO_AUTH_TOKEN');
    }

    tursoClient = createClient({ url, authToken });
    return tursoClient;
}

async function ensureSiiTables() {
    if (_tablesEnsured) return;
    const c = getTursoClient();
    try {
        await c.execute(`CREATE TABLE IF NOT EXISTS sii_config (
            company_id TEXT PRIMARY KEY,
            rut_emisor TEXT NOT NULL DEFAULT '',
            razon_social TEXT NOT NULL DEFAULT '',
            giro TEXT NOT NULL DEFAULT '',
            direccion TEXT, comuna TEXT, ciudad TEXT, acteco TEXT,
            certificado_pfx TEXT, certificado_password TEXT,
            ambiente TEXT DEFAULT 'certificacion',
            sii_resolution_number TEXT, sii_resolution_date TEXT,
            auto_emit INTEGER DEFAULT 1, is_active INTEGER DEFAULT 0,
            created_at TEXT, updated_at TEXT
        )`);
        await c.execute(`CREATE TABLE IF NOT EXISTS sii_cafs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id TEXT NOT NULL, tipo_dte INTEGER NOT NULL,
            folio_desde INTEGER NOT NULL, folio_hasta INTEGER NOT NULL,
            folio_actual INTEGER NOT NULL, caf_xml TEXT NOT NULL,
            caf_fingerprint TEXT, estado TEXT DEFAULT 'active',
            created_at TEXT, updated_at TEXT
        )`);
        await c.execute(`CREATE INDEX IF NOT EXISTS idx_sii_cafs_lookup ON sii_cafs(company_id, tipo_dte, estado)`);
        await c.execute(`CREATE TABLE IF NOT EXISTS sii_dtes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id TEXT NOT NULL, sale_id INTEGER,
            tipo_dte INTEGER NOT NULL, folio INTEGER NOT NULL,
            rut_receptor TEXT, razon_social_receptor TEXT,
            monto_total INTEGER, monto_neto INTEGER, monto_iva INTEGER,
            xml_firmado TEXT, track_id TEXT,
            estado TEXT DEFAULT 'pending', sii_response TEXT,
            created_at TEXT, updated_at TEXT
        )`);
        await c.execute(`CREATE INDEX IF NOT EXISTS idx_sii_dtes_sale ON sii_dtes(company_id, sale_id)`);
        await c.execute(`CREATE INDEX IF NOT EXISTS idx_sii_dtes_estado ON sii_dtes(company_id, estado)`);
        await c.execute(`CREATE INDEX IF NOT EXISTS idx_sii_dtes_folio ON sii_dtes(company_id, tipo_dte, folio)`);
        await c.execute(`CREATE TABLE IF NOT EXISTS sii_rcof (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id TEXT NOT NULL, fecha TEXT NOT NULL,
            xml TEXT, track_id TEXT, estado TEXT DEFAULT 'pending', created_at TEXT
        )`);
        await c.execute(`CREATE INDEX IF NOT EXISTS idx_sii_rcof_lookup ON sii_rcof(company_id, fecha)`);

        // Folios pre-reservados para emisión offline.
        // Se reservan cuando hay internet (avanza folio_actual en sii_cafs);
        // se consumen offline al emitir una venta sin red; el DTE real se
        // emite al sincronizar usando el folio aquí asignado.
        await c.execute(`CREATE TABLE IF NOT EXISTS sii_offline_folios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id TEXT NOT NULL,
            tipo_dte INTEGER NOT NULL,
            folio INTEGER NOT NULL,
            caf_id INTEGER NOT NULL,
            reserved_for_user_id TEXT,
            status TEXT NOT NULL DEFAULT 'reserved',
            sale_id INTEGER,
            sale_temp_id TEXT,
            reserved_at TEXT,
            used_at TEXT,
            UNIQUE(company_id, tipo_dte, folio)
        )`);
        await c.execute(`CREATE INDEX IF NOT EXISTS idx_sii_off_lookup ON sii_offline_folios(company_id, tipo_dte, status)`);
        await c.execute(`CREATE INDEX IF NOT EXISTS idx_sii_off_user ON sii_offline_folios(company_id, reserved_for_user_id, status)`);

        _tablesEnsured = true;
    } catch (e) {
        console.error('Error ensuring SII tables:', e.message);
    }
}

export const turso = {
    execute: async (...args) => { await ensureSiiTables(); return getTursoClient().execute(...args); },
    batch: async (...args) => { await ensureSiiTables(); return getTursoClient().batch(...args); },
};
