import { createClient } from "@libsql/client";

const _base = createClient({
    url: import.meta.env.VITE_TURSO_DATABASE_URL,
    authToken: import.meta.env.VITE_TURSO_AUTH_TOKEN,
});

// ─── Instrumentación opcional de roundtrips (Fase 7 baseline) ────────────
// OFF por defecto: cero overhead en producción.
//
// IMPORTANTE: NO se envuelve `turso.transaction()`. Esa devuelve un objeto
// `tx` cuyas methods acceden a private fields (#promiseLimitFunction) del
// cliente padre — cualquier wrapper (Proxy u objeto) sobre el cliente
// rompería el tx. Por eso `transaction` se reenvía tal cual.
//
// Consecuencia para mediciones: solo se cuentan las llamadas directas a
// `turso.execute` y `turso.batch`. Las queries DENTRO de una transacción
// (vía tx.execute) NO se cuentan. Para Fase 7 esto es OK: las agregaciones
// post-venta (sales_daily_summary, product_daily_profit) son llamadas
// directas, no van por tx.
//
// Activar:
//   localStorage.setItem('posveci.turso.trace', 'on'); location.reload();
// Uso:
//   __tursoTrace.reset();
//   // ... operación a medir ...
//   __tursoTrace.snapshot();
// Desactivar:
//   localStorage.removeItem('posveci.turso.trace'); location.reload();

const TRACE_KEY = 'posveci.turso.trace';
let _enabled = false;
try {
    _enabled = (typeof localStorage !== 'undefined') && localStorage.getItem(TRACE_KEY) === 'on';
} catch { /* SSR / no storage */ }

const _state = {
    total: 0,
    byKind: Object.create(null),
    byTable: Object.create(null),
    recent: [],
    marks: [],
};
const RECENT_CAP = 500;

function classify(sql) {
    const s = String(sql || '').trim();
    if (!s) return { kind: 'EMPTY', table: 'unknown' };
    const head = s.slice(0, 12).toUpperCase();
    let kind = 'OTHER';
    if (head.startsWith('SELECT')) kind = 'SELECT';
    else if (head.startsWith('INSERT')) kind = 'INSERT';
    else if (head.startsWith('UPDATE')) kind = 'UPDATE';
    else if (head.startsWith('DELETE')) kind = 'DELETE';
    else if (head.startsWith('BEGIN') || head.startsWith('COMMIT') || head.startsWith('ROLLBACK')) kind = 'TX';
    else if (head.startsWith('CREATE') || head.startsWith('ALTER') || head.startsWith('DROP')) kind = 'DDL';
    const m = s.match(/(?:FROM|INTO|UPDATE)\s+["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?/i);
    const table = m ? m[1].toLowerCase() : 'unknown';
    return { kind, table };
}

function record(sql, batchSize) {
    if (!_enabled) return;
    const { kind, table } = classify(sql);
    _state.total++;
    _state.byKind[kind] = (_state.byKind[kind] || 0) + 1;
    _state.byTable[table] = (_state.byTable[table] || 0) + 1;
    _state.recent.push({ t: Date.now(), kind, table, sql: String(sql || '').slice(0, 140), batch: batchSize || 0 });
    if (_state.recent.length > RECENT_CAP) _state.recent.shift();
}

function extractSql(arg) {
    if (typeof arg === 'string') return arg;
    if (arg && typeof arg.sql === 'string') return arg.sql;
    return '';
}

// Wrapper objeto plano — NO Proxy, NO modifica el prototype de _base.
// transaction se reenvía tal cual para preservar private fields.
export const turso = {
    execute(arg) {
        record(extractSql(arg));
        return _base.execute(arg);
    },
    batch(queries, mode) {
        if (Array.isArray(queries)) {
            const size = queries.length;
            for (const q of queries) record(extractSql(q), size);
        }
        return _base.batch(queries, mode);
    },
    transaction(...args) {
        return _base.transaction(...args);
    },
};

if (typeof window !== 'undefined') {
    window.__tursoTrace = {
        isEnabled: () => _enabled,
        enable: () => {
            try { localStorage.setItem(TRACE_KEY, 'on'); } catch {}
            _enabled = true;
            console.warn('[turso-trace] habilitado. Reset con __tursoTrace.reset(), snapshot con __tursoTrace.snapshot(). Nota: queries dentro de turso.transaction() NO se cuentan.');
        },
        disable: () => {
            try { localStorage.removeItem(TRACE_KEY); } catch {}
            _enabled = false;
            console.warn('[turso-trace] deshabilitado.');
        },
        reset: () => {
            _state.total = 0;
            _state.byKind = Object.create(null);
            _state.byTable = Object.create(null);
            _state.recent = [];
            _state.marks = [];
            console.info('[turso-trace] contadores reseteados.');
        },
        mark: (label) => {
            const m = { label: String(label || 'mark'), total: _state.total, t: Date.now() };
            _state.marks.push(m);
            console.info(`[turso-trace] mark "${m.label}" @ total=${m.total}`);
            return m;
        },
        snapshot: () => {
            const snap = {
                enabled: _enabled,
                total: _state.total,
                byKind: { ..._state.byKind },
                byTable: { ..._state.byTable },
                marks: _state.marks.slice(),
                recentCount: _state.recent.length,
                note: 'queries dentro de turso.transaction() NO se cuentan',
            };
            console.table(snap.byKind);
            console.table(snap.byTable);
            return snap;
        },
        recent: (n = 50) => _state.recent.slice(-n),
    };
}
