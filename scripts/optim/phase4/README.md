# Fase 4 · Normalización híbrida COMPLEMENTARIA

Objetivo: añadir tablas normalizadas `sale_items` y `purchase_items` como
**capa complementaria** para analytics, **sin reemplazar ni modificar** los
JSONs `sales.items` / `purchases.items`. Cero breaking changes.

---

## Arquitectura híbrida resultante

| Capa | Quién la consume | Quién la escribe |
|------|------------------|------------------|
| `sales.items` JSON | SII, impresión, WooCommerce, Dexie offline, APIs, historial | `addSale()`, sync offline, cobros de deuda |
| `sale_items` (nuevo) | Reservado para analytics y consultas rápidas | Mirror silencioso post-commit + backfill |
| `purchases.items` JSON | APIs, compatibilidad actual | `addPurchase()` |
| `purchase_items` (nuevo) | Reservado para analytics | Mirror silencioso post-commit + backfill |

**Regla de oro**: si la escritura mirror a la tabla normalizada falla,
la venta/compra original NO se ve afectada. Está envuelta en `try/catch`
silencioso, sin `await` bloqueante, y NO está dentro de la transacción
de la venta.

---

## Estado actual (post Fase 4)

```
sales_with_items:    41,996      sale_items_rows:    93,212
purchases_with_items:    701  purchase_items_rows:    4,432
coverage:           100.00%               (todas migradas)
sample compare:    5000/5000 OK  ·  0 DIFF  ·  0 NO_MIRROR
purchases compare:  701/701  OK  ·  0 DIFF  ·  0 NO_MIRROR
```

---

## Script catálogo

| Script | Propósito |
|--------|-----------|
| `00-inspect-items.mjs` | Inspección read-only del shape real de los JSON |
| `01-create-tables.mjs` | Crea tablas + índices + triggers (idempotente) |
| `02-backfill.mjs` | Backfill desde JSON por lotes, idempotente, resumible |
| `03-validate.mjs` | Compara JSON vs normalizado: counts, totales, missing |
| `04-explain.mjs` | EXPLAIN PLAN comparativo + tiempo real JSON vs normalized |
| `05-check-dups.mjs` | Diagnóstico de duplicados (forense) |
| `06-diagnose-dups.mjs` | Caso por caso de dup específico |
| `07-dup-forensics.mjs` | Análisis temporal de inserts para sale_id sospechoso |
| `08-dedupe-and-add-seq.mjs` | Hardening: añade columna `seq`, dedupea, crea UNIQUE INDEX |
| `09-investigate-missing.mjs` | Verifica que las ventas sin mirror sean legítimas |
| `10-source-breakdown.mjs` | Conteo por origen (live vs backfill) |
| `11-final-dup-check.mjs` | Check de duplicados remanentes |
| `12-final-cleanup.mjs` | Limpieza definitiva post-backfill |
| `99-rollback.mjs` | Drop completo de Fase 4 (requiere `CONFIRM=YES`) |

Flujo recomendado en una BD nueva:

```bash
node scripts/optim/phase4/01-create-tables.mjs
node scripts/optim/phase4/02-backfill.mjs --chunk 500
node scripts/optim/phase4/03-validate.mjs
node scripts/optim/phase4/04-explain.mjs
```

---

## Cambios en código de la app

| Archivo | Cambio |
|---------|--------|
| `src/lib/itemNormalization.js` | **NUEVO** · helpers `mirrorSaleItems`, `mirrorPurchaseItems` |
| `src/store/useStore.js` | `addSale()` y `addPurchase()` llaman al mirror **post-commit, sin await, con `.catch()`** |

**Garantías:**
- El mirror se invoca **después** de `tx.commit()`. La venta ya está guardada.
- Si el mirror falla por cualquier razón (red, schema, integridad), solo se loggea por consola con prefijo `[fase4]`. El usuario NO ve error. No afecta a SII, impresión, ni Dexie.
- El mirror NO está dentro de la transacción, no añade latencia perceptible.
- No se modificó el JSON ni el flujo offline ni la sync de pending ops.

---

## Cuidados específicos por sistema compatible

### SII Chile
Sin cambios. El payload del DTE se construye desde `sales.items` (JSON). El mirror se ejecuta después de que la venta está completamente guardada.

### WooCommerce
Sin cambios. Las API externas siguen leyendo del JSON.

### Impresión
Sin cambios. Tickets/boletas se imprimen desde el flujo normal.

### Dexie offline / sync
Sin cambios. La cola de operaciones offline (`pendingOpsApi`) sigue invocando `addSale()` con `_fromOfflineQueue: true`. Cuando la venta entra a Turso, el mirror se dispara naturalmente.

### Multiempresa
Cada fila en `sale_items` y `purchase_items` lleva su `company_id`. Todos los índices analíticos comienzan por `company_id`.

### Devoluciones (`sale_returns`)
Quedan intactas. NO se modifican filas existentes en `sale_items` cuando hay devolución; el JSON canónico ya incluye la lógica de tracking de devoluciones desde `sale_returns`.

---

## Cobertura no-cubierta (intencional)

- **78 ventas con `items: []`** (array vacío): tests o cobros sin productos. No requieren mirror. Excluidas explícitamente por el validator.
- **Cobros de deuda** (línea 7911 de `useStore.js`): inserción directa en `sales` sin invocar `addSale()`. NO se mirrorean (es deseable: son movimientos contables, no ventas de productos). Si en el futuro quieres incluirlos, basta con añadir una llamada a `mirrorSaleItems()` en `payDebt` post-commit.

---

## Schema final

```sql
CREATE TABLE sale_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id      INTEGER NOT NULL,
  company_id   TEXT    NOT NULL,
  product_id   INTEGER,             -- NULL para combos / abonos
  product_ref  TEXT,                -- "combo_4" para combos
  sku          TEXT,
  name         TEXT,
  quantity     REAL    NOT NULL,
  price        REAL    NOT NULL DEFAULT 0,
  cost         REAL    NOT NULL DEFAULT 0,
  tax_rate     REAL    NOT NULL DEFAULT 0,
  discount_pct REAL    NOT NULL DEFAULT 0,
  line_total   REAL,                -- quantity * price * (1 - discount/100)
  is_combo     INTEGER NOT NULL DEFAULT 0,
  sale_date    TEXT,
  created_at   TEXT    NOT NULL,
  source       TEXT    NOT NULL DEFAULT 'live',   -- 'live' | 'backfill' | 'offline'
  seq          INTEGER              -- posición 0-based en el array JSON original
);
-- UNIQUE INDEX(sale_id, seq) WHERE seq IS NOT NULL → previene re-inserts
-- INDEX(sale_id), INDEX(company_id, product_id, sale_date DESC), etc.
```

`purchase_items` es análoga, con `expiry_date`, `batch_number` y omitiendo
el campo `image` (base64) por economía de espacio.

---

## Comparativa de rendimiento (medida en la BD real)

| Query analítica | JSON actual | Normalizada | Speedup |
|---|---:|---:|---:|
| Top 10 productos vendidos / 30 días | 1.977 ms (11.446 filas leídas) | 304 ms (10 filas) | **6.5×** |
| Histórico de un producto / 90 días | 4.166 ms (34.469 filas) | 157 ms | **26.5×** |
| Ingresos por producto / 30 días | 721 ms (11.468 filas) | 260 ms | **2.8×** |

> ⚠️ La app de producción NO está usando estos nuevos planes todavía.
> Esta tabla justifica una posible Fase 5 que migre queries de reporting.

---

## Riesgos detectados durante la ejecución

| Riesgo | Severidad | Mitigación aplicada |
|---|---|---|
| Cliente libsql retransmite batches al timeout → doble insert | **Medio** | `seq` 0-based del item + UNIQUE INDEX(sale_id, seq) + `INSERT OR IGNORE` |
| Backfill interrumpido (Ctrl-C, crash de Node) | Bajo | Set en memoria + chequeo inicial de `sale_id IN (SELECT sale_id FROM sale_items)` → resumible |
| Mirror falla y bloquea la venta | **Crítico (evitado)** | Llamada fuera de `tx`, sin await, con `.catch()` de log |
| App sigue corriendo escritura dual durante migración | Bajo | Idempotencia por UNIQUE INDEX hace que coexistan sin conflict |
| Combos con `id="combo_4"` (string) | Bajo | `product_id` NULL + `product_ref` guarda el string original |
| `purchases.items.image` base64 enorme | Medio (espacio) | Mirror NO replica `image`. Solo metadata pertinente |

---

## QA manual recomendada

Antes de declarar la fase 4 cerrada, verificar manualmente:

1. **Crear una venta nueva** y revisar que la consola NO muestre errores
   con prefijo `[fase4]`. Verificar en BD:
   ```sql
   SELECT COUNT(*) FROM sale_items WHERE sale_id = <id_recién_creado>;
   ```
   Debe coincidir con la cantidad de items del JSON.

2. **Crear una compra nueva** → igual chequeo en `purchase_items`.

3. **Venta offline**: cortar red, vender, restaurar red. La cola debe
   procesar y el mirror debe aparecer post-sync.

4. **Imprimir un ticket** después de una venta. Sin cambios en flujo.

5. **Emitir un DTE/boleta SII** → verificar que el folio se asigna y firma normalmente.

6. **WooCommerce push** (si está activado) → orden creada igual que antes.

7. **Devolución parcial** sobre una venta migrada → `sale_returns` se actualiza, `sale_items` queda intacta (decisión consciente: el snapshot histórico no se modifica).

8. **Cambio de empresa activa**: nuevas ventas/compras llevan correctamente su `company_id` en las tablas normalizadas.

9. **Cierre de caja**: sin cambios.

10. **Reportes existentes en la UI**: deben seguir funcionando idénticos
    (siguen leyendo del JSON).

---

## Cómo deshacer la Fase 4

Si por cualquier razón hay que revertir:

```powershell
# 1. Quitar la escritura dual del store (revert del commit que toca useStore.js
#    y borrar src/lib/itemNormalization.js).

# 2. Drop de las tablas:
$env:CONFIRM="YES"
node scripts/optim/phase4/99-rollback.mjs
```

El JSON `sales.items` / `purchases.items` queda intacto. Cero pérdida de datos.
