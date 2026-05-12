# Plan de Optimización POS multiempresa

Scripts standalone para medir y aplicar mejoras a la base Turso/libSQL **sin
modificar el bundle de la app** (Vite/React). Cada script es idempotente y
puede ejecutarse independientemente.

> Compatibilidad: NO se elimina `sales.items` ni `purchases.items`. NO se
> tocan SII, WooCommerce, impresión, APIs, Dexie offline ni sync offline.

## Estructura

```
scripts/optim/
  _client.mjs               cliente Turso compartido (lee .env.local / .env)
  phase1/                   medición y seguridad (solo lectura)
    01-snapshot-schema.mjs  dump DDL + row counts + pragmas
    02-list-indexes.mjs     todos los índices reales por tabla
    03-explain-queries.mjs  EXPLAIN QUERY PLAN + tiempos (marker: before/after)
  phase2/                   índices seguros, no invasivos
    01-apply-indexes.mjs    CREATE INDEX IF NOT EXISTS con detección de columnas
    02-write-impact.mjs     mide overhead en UPDATEs
    99-rollback-indexes.mjs DROP INDEX IF EXISTS para los índices creados
  snapshots/<timestamp>/    schema.sql + row_counts.json + pragmas.json
  reports/                  reportes datados por ejecución
```

## Uso

```bash
# Fase 1 (solo lectura, segura)
node scripts/optim/phase1/01-snapshot-schema.mjs
node scripts/optim/phase1/02-list-indexes.mjs
node scripts/optim/phase1/03-explain-queries.mjs before

# Fase 2 (escribe metadata de índices, sin tocar datos)
node scripts/optim/phase2/01-apply-indexes.mjs --dry   # vista previa
node scripts/optim/phase2/01-apply-indexes.mjs
node scripts/optim/phase2/02-write-impact.mjs
node scripts/optim/phase1/03-explain-queries.mjs after

# Rollback (si fuese necesario)
node scripts/optim/phase2/99-rollback-indexes.mjs           # preview
node scripts/optim/phase2/99-rollback-indexes.mjs --confirm
```

## Perf logger temporal (Fase 1)

`src/lib/perfLogger.js` — opt-in, no se ejecuta a menos que el usuario active el flag:

```js
// Browser DevTools
localStorage.setItem('perfLog', '1');
localStorage.setItem('perfLog.slowMs', '300');  // umbral opcional
window.__perf.getStats();                       // ver buckets agregados
localStorage.removeItem('perfLog');             // desactivar
```

```js
// Node scripts
process.env.PERF_LOG = '1';
```

Importar y envolver llamadas críticas (sin cambiar lógica):

```js
import { time } from '@/lib/perfLogger';
const rows = await time('sales.list', () => turso.execute({ sql, args }));
```

Cuando termine la medición, basta con quitar los `time(...)` o dejarlos:
el overhead es despreciable y solo loggea si el flag está activo.
