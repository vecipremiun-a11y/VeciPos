# FASE 8 — Sincronización incremental real del catálogo

**Fecha:** 2026-05-22  
**Commits:** `773ca7c` (8.1) · `82c6073` (8.2 scripts) · `52ac22c` (8.3) · migration ejecutada contra prod `poskem-db-jasongo.aws-us-east-1.turso.io`  
**Status:** ✅ Completada. Validada en producción local con cambios reales (venta + edit cliente + edit categoría).

## Contexto previo

`syncCatalogFromServer` se llama desde 3 lugares:
- **Startup** (`App.jsx:212` dentro de `syncAll`)
- **Cambio de empresa** (`useStore.js:1304`)
- **Refresh manual** (`OfflineSync.jsx:93`)
- Y se **repite por polling** cada 60s (activo) / 5min (idle) vía `createSmartInterval`

En cada llamada el código bajaba **TODO el catálogo** sin filtro:

```js
const queries = [
  { sql: 'SELECT * FROM products WHERE company_id = ?', args: [companyId] },
  { sql: 'SELECT * FROM product_lots WHERE company_id = ? AND quantity > 0', args: [companyId] },
  { sql: 'SELECT * FROM clients WHERE company_id = ?', args: [companyId] },
  { sql: 'SELECT * FROM categories WHERE company_id = ?', args: [companyId] },
  { sql: 'SELECT * FROM tax_rates WHERE company_id = ?', args: [companyId] },
];
```

Y luego en Dexie: `DELETE all + bulkPut all` para cada tabla.

**Volumen real medido** en producción al momento de Fase 8:
- products: 4151
- product_lots: 2765
- clients: 12
- categories: 35-47
- tax_rates: 4
- **Total: ~6967-6979 filas bajadas y reinsertadas cada polling**, dura típicamente 1.5-3s + carga DB.

La clave `lastSync:${companyId}` ya se escribía en `localDb.meta`, pero **nunca se usaba como filtro**. Infra desperdiciada.

## Auditoría de schema (antes de Fase 8)

| Tabla | Tenía `updated_at` | Trigger UPDATE | Índice |
|---|---|---|---|
| products | ✅ (Fase 2.5) | ✅ `trg_products_updated_at` | ✅ `idx_products_company_updated_id` |
| tax_rates | ✅ (DEFAULT CURRENT_TIMESTAMP) | ❌ | ❌ |
| clients | ❌ | ❌ | ❌ |
| categories | ❌ | ❌ | ❌ |
| product_lots | ❌ | ❌ | ❌ |

## Cambios por sub-fase

### Fase 8.1 — Incremental para products + tax_rates (commit `773ca7c`)

Sin tocar schema: aprovechó la infra existente de Fase 2.5.

Nueva función `syncCatalogIncremental(companyId)` en `src/lib/db/sync.js`:
- Lee `lastSync` de Dexie meta.
- Si no hay → fallback a `syncCatalogFromServer` (full).
- Si hay → batch read con `WHERE company_id = ? AND updated_at > ?` solo en products y tax_rates.
- bulkPut como upsert (no se borran filas — el full sync de login cubre purgas).
- `lastSync` avanza al MAX(updated_at) observado; si 0 filas, no se mueve.
- Las otras 3 tablas (clients, categories, product_lots) **no se tocan** en este modo.

`App.jsx`:
- `syncAll` ahora recibe `{ incremental: bool }`.
- Startup: `incremental: false` (sin cambios).
- Polling: `incremental: true`.
- Cambio de empresa y refresh manual: sin cambios (siguen full).

**Validación runtime:**
- Venta de 1 item → polling detectó `{ products: 1, taxRates: 0 } lastSync→ 2026-05-22T06:22:55.915Z`.
- Confirmado: el trigger `trg_products_updated_at` se dispara al descontar stock.

### Fase 8.2 — DDL para clients + categories + product_lots + trigger en tax_rates (commit `82c6073` + ejecución prod)

Migration scripts en `scripts/optim/phase8/`:

**`01-add-updated-at.mjs`** — idempotente, para cada tabla:
1. `ALTER TABLE <tbl> ADD COLUMN updated_at TEXT` (si no existe).
2. Backfill: `UPDATE <tbl> SET updated_at = COALESCE(created_at, NOW) WHERE updated_at IS NULL`.
3. `CREATE TRIGGER trg_<tbl>_updated_at AFTER UPDATE ... WHEN COALESCE(NEW.updated_at, '') = COALESCE(OLD.updated_at, '') BEGIN UPDATE ... SET updated_at = NOW WHERE id = NEW.id END`. Mismo patrón anti-recursión que Fase 2.5.
4. `CREATE INDEX idx_<tbl>_company_updated_id ON <tbl>(company_id, updated_at, id)`.

**`02-verify-triggers.mjs`** — para cada tabla: UPDATE name=name idempotente, verifica que `updated_at` cambió.

**Ejecución contra producción** (`poskem-db-jasongo.aws-us-east-1.turso.io`):

```
— clients —
  OK  ALTER clients ADD updated_at  (148 ms)
      backfill: 12 filas
  OK  trigger trg_clients_updated_at creado
  OK  idx_clients_company_updated_id  (145 ms)

— categories —
  OK  ALTER categories ADD updated_at  (156 ms)
      backfill: 47 filas
  OK  trigger trg_categories_updated_at creado
  OK  idx_categories_company_updated_id  (143 ms)

— product_lots —
  OK  ALTER product_lots ADD updated_at  (146 ms)
      backfill: 5007 filas
  OK  trigger trg_product_lots_updated_at creado
  OK  idx_product_lots_company_updated_id  (151 ms)

— tax_rates —
  tax_rates.updated_at ya existe — skip ALTER
      backfill: 0 filas (ya estaba poblado)
  OK  trigger trg_tax_rates_updated_at creado
  OK  idx_tax_rates_company_updated_id  (140 ms)
```

**Verificación:** los 4 triggers actualizaron `updated_at` correctamente tras un UPDATE idempotente.

### Fase 8.3 — Extender incremental a las 5 tablas (commit `52ac22c`)

`syncCatalogIncremental` ahora trae las 5 tablas en un único `turso.batch(queries, 'read')`. Diferencia respecto al full:
- product_lots: **NO** filtra `quantity > 0` en incremental (sí en full). Razón: queremos detectar lotes que llegan a 0 (vencidos, agotados, consumidos por venta).
- Sigue siendo upsert con `bulkPut` (no delete).
- `lastSync` avanza al MAX(updated_at) global entre las 5 tablas.

**Validación runtime con cambios reales:**

| Acción | Tabla esperada en delta | Resultado |
|---|---|---|
| Venta de 1 item | products + product_lots + (clients si tiene credit) | `{ clients: 1 }` (cliente Hilda guzman, balance) |
| Editar categoría "prueba" → Inactiva | categories | `{ categories: 1 } lastSync→ 2026-05-22T06:42:38.616Z` |
| Sin cambios | nada | log silencioso (allRows.length === 0) |

## Incidencia: confusión de migration

En la primera iteración el usuario indicó haber corrido la migration pero al refrescar Fase 8.3 hubo errores `SQLite input error: no such column: updated_at`. Diagnóstico: el script no se había ejecutado realmente contra producción. **Reverté Fase 8.3 en caliente** (sin commit), confirmé URL de producción, y ejecuté el script desde el asistente con autorización explícita.

Lección guardada para futuro: cuando un cambio depende de un schema migration, validar con un query simple antes de re-aplicar el código que la asume. Por ejemplo `PRAGMA table_info(clients)` desde el navegador o el script `02-verify-triggers.mjs`.

## Resultados medibles

### Tráfico Turso por polling

| Escenario | Antes (full cada polling) | Después (incremental) |
|---|---|---|
| Sin cambios | ~7000 filas + DELETE + bulkPut | 0 filas (5 WHERE filters vacíos en 1 batch read) |
| 1 venta en otra caja | ~7000 filas | 1-3 filas (products + product_lots + posible client) |
| Edit de 1 producto | ~7000 filas | 1 fila |
| Edit de 1 cliente / categoría | ~7000 filas | 1 fila |

### Concurrencia multiusuario

Antes, dos cajas haciendo polling al mismo tiempo cargaban el catálogo entero cada una. Ahora hacen 1 batch con WHERE filter, que con el índice `idx_<tbl>_company_updated_id` es near-O(log n) sobre el rango de delta.

### Carga local (Dexie)

- Antes: DELETE all + bulkPut all (transacción pesada).
- Después: bulkPut upsert solo de las filas delta (transacción liviana).

## Lo que NO cambia (estabilidad)

- **Startup:** sigue siendo full sync. Garantiza estado limpio post-logout/install.
- **Cambio de empresa:** sigue siendo full sync. Garantiza no mezclar catálogos.
- **Refresh manual** (OfflineSync.jsx): sigue siendo full sync. Es la "escotilla de emergencia" si algo se cuela.
- `addSale`, SII, WooCommerce, impresión, checkout, APIs externas: **no se tocan**.
- `syncPendingOpsToServer` (cola offline): sin cambios.

## Riesgos conocidos / aceptados

1. **Soft-delete diferido (Fase 8.4).** Rows borradas en Turso siguen vivas en Dexie hasta el próximo full sync (login / company switch / OfflineSync.jsx). Decisión explícita del usuario al inicio de Fase 8: defer. Si en el futuro se observan problemas reales (productos fantasma persistiendo), implementar soft-delete con tabla central `sync_deletions` o columna `deleted_at` por tabla.

2. **Clock skew entre cliente y servidor.** `lastSync` se calcula sobre timestamps de Turso (no del cliente), así que clock skew del cliente no afecta. Pero si dos transacciones en el mismo segundo tienen el mismo `updated_at`, una podría ser saltada por el filtro `updated_at > lastSync`. Mitigación posible: usar `>=` + idempotencia. Por ahora `>` con resolución de milisegundos en SQLite (`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`) hace la colisión muy improbable.

3. **product_lots en incremental no filtra `quantity > 0`.** Intencional: queremos detectar lotes vencidos/agotados. Dexie ahora puede tener lotes con quantity 0 que el full sync borraría. Si esto causa problemas de UI (listar lotes vacíos), filtrar en la query del consumer, no acá.

4. **No hay alarma si lastSync no avanza por días.** Si el polling falla silenciosamente (por ejemplo, network siempre falla), Dexie quedaría stale sin warning visible. Posible mejora futura: si `Date.now() - lastSync > 24h`, forzar un full sync al próximo polling exitoso.

## Rollback

Las 3 sub-fases se revierten independientemente:

```bash
git revert 52ac22c   # 8.3 — vuelve a incremental products+tax_rates solamente
git revert 82c6073   # 8.2 — quita scripts (las columnas en DB se quedan, son additive y no molestan)
git revert 773ca7c   # 8.1 — vuelve a full sync en polling
```

Los ALTER TABLE en producción NO se revierten automáticamente. Pero las columnas, triggers e índices son additive y no afectan queries existentes ni performance — pueden quedarse aunque se revierta el código.

Si se requiere rollback total de schema:

```sql
DROP TRIGGER trg_clients_updated_at;
DROP TRIGGER trg_categories_updated_at;
DROP TRIGGER trg_product_lots_updated_at;
DROP TRIGGER trg_tax_rates_updated_at;
DROP INDEX idx_clients_company_updated_id;
DROP INDEX idx_categories_company_updated_id;
DROP INDEX idx_product_lots_company_updated_id;
DROP INDEX idx_tax_rates_company_updated_id;
-- SQLite no soporta DROP COLUMN antes de 3.35; en Turso/libsql moderno sí.
ALTER TABLE clients DROP COLUMN updated_at;
ALTER TABLE categories DROP COLUMN updated_at;
ALTER TABLE product_lots DROP COLUMN updated_at;
```

## QA sugerido

1. Refresh duro del POS → verificar `[sync] Catálogo sincronizado: ...` (full en startup).
2. Esperar ~60s sin actividad → verificar que el polling es silencioso (sin `[sync] Incremental: ...` si no hubo cambios reales en Turso).
3. Hacer una venta → al siguiente polling, verificar `[sync] Incremental: {products: 1, productLots: 1, ...}`.
4. Editar un cliente → verificar `{ clients: 1 }`.
5. Editar una categoría → verificar `{ categories: 1 }`.
6. Cambiar de empresa → verificar full sync nuevamente.
7. Refresh manual en OfflineSync.jsx → verificar full sync.
8. Verificar que ventas offline (cortar internet) y restauración siguen funcionando idéntico — `syncPendingOpsToServer` no se tocó.

## Próximos pasos sugeridos

- **Fase 8.4** (opcional): soft-delete con tabla `sync_deletions` o `deleted_at` por tabla. Solo si las stale rows se vuelven un problema real.
- **Monitor de staleness** (opcional): warning en UI si `lastSync` es de hace > N horas.
- **Cleanup del wrapper de trace de turso.js** (opcional): si no se usará más, puede quedarse off-by-default sin costo, o removerse en commit aparte.
