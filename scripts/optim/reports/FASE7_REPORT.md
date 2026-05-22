# FASE 7 — UPSERTs en agregaciones post-venta

**Fecha:** 2026-05-22  
**Commits:** `5797a2a` (revertido) · `e177d16` (instrumentación) · `bce3387` (7.1) · `4260808` (7.2) · `a5ee32a` (7.3)  
**Status:** ✅ Completada. Validada en producción local con ventas reales.

## Contexto previo

Antes de Fase 7 las 5 tablas de agregación post-venta usaban el anti-patrón:

```js
const existing = await turso.execute({ sql: 'SELECT * FROM <tabla> WHERE …', args: […] });
if (existing.rows.length === 0) {
    await turso.execute({ sql: 'INSERT …', args: […] });
} else {
    await turso.execute({ sql: 'UPDATE …', args: […] });
}
```

Esto producía:
- **2 roundtrips de red por escritura** (uno para SELECT, otro para INSERT/UPDATE).
- **Race condition entre cajeros concurrentes** del mismo día: dos cajeros podían leer el mismo total y escribir uno encima del otro perdiendo una venta del agregado.
- En `product_daily_profit` y `product_movement_stats`, el patrón ocurría **dentro de un `for (item of items)`**, multiplicando el problema por N items por venta.

Nota: el script bulk `src/scripts/populateAggregations.js` **ya usaba ON CONFLICT** correctamente. La inconsistencia estaba solo en el path per-sale.

## Auditoría inicial (mapeo)

5 funciones identificadas en `src/store/useStore.js`:

| Función | Tabla | Escala con N items |
|---|---|---|
| `updateSalesDailySummary` | `sales_daily_summary` | NO (1 fila/día) |
| `updateVendorDailyPerformance` | `vendor_daily_performance` | NO (1 fila/usuario/día) |
| `updateProductDailyProfit` | `product_daily_profit` | **SÍ** |
| `updateProductMovementStats` | `product_movement_stats` | **SÍ** |
| `updateHourlySalesStats` | `hourly_sales_stats` | NO (1 fila/hora) |

Las 5 tablas tienen PK o UNIQUE constraint apropiada para `ON CONFLICT`. Sin DDL adicional necesario.

## Baseline medido (antes de cambios)

Instrumentación añadida en `src/lib/turso.js` (wrapper objeto plano, off por defecto, commit `e177d16`). Counter de queries por kind/tabla expuesto vía `window.__tursoTrace`.

> **Nota técnica importante:** intento inicial usó `Proxy` (`5797a2a`) — rompía `turso.transaction()` con `TypeError: Cannot read private member #promiseLimitFunction`. Los private fields del cliente libsql no atraviesan Proxy. Revertido (`fe733a0`) y reimplementado con objeto plano que reenvía `execute`/`batch`/`transaction` sin envolver — `transaction` se devuelve cruda para preservar private fields. Lección guardada en `memory/feedback_libsql_no_proxy.md`.

### Venta de 1 item (real)
| Tabla | Queries |
|---|---:|
| sales_daily_summary | 2 |
| vendor_daily_performance | 2 |
| product_daily_profit | 2 |
| product_movement_stats | 2 |
| hourly_sales_stats | 2 |
| **Total agregaciones** | **10** |

### Venta de 6 items (real, `sale_items: 6` confirmado)
| Tabla | Queries |
|---|---:|
| sales_daily_summary | 2 |
| vendor_daily_performance | 2 |
| product_daily_profit | **12** (= 2 × 6) |
| product_movement_stats | **12** (= 2 × 6) |
| hourly_sales_stats | 2 |
| **Total agregaciones** | **30** |

Confirmado: `product_daily_profit` y `product_movement_stats` escalan linealmente con N items.

## Cambios por fase

### Fase 7.1 — `sales_daily_summary` (commit `bce3387`)

Reemplazado el SELECT + INSERT/UPDATE por:

```sql
INSERT INTO sales_daily_summary
    (company_id, day, total_sales, total_orders, updated_at)
VALUES (?, ?, ?, 1, datetime('now'))
ON CONFLICT(company_id, day) DO UPDATE SET
    total_sales = total_sales + excluded.total_sales,
    total_orders = total_orders + 1,
    updated_at = datetime('now')
```

Drop-in replacement con math equivalente. `INSERT` path = caso "no existe" del original; `DO UPDATE` path = caso "existe" del original.

### Fase 7.2 — `product_daily_profit` (commit `4260808`)

**Cambio mayor**: el bucle `for (item of items) { execute(SELECT); execute(INSERT|UPDATE); }` se colapsó a 1 sola llamada `turso.batch(queries)` con N UPSERTs:

```sql
INSERT INTO product_daily_profit (…) VALUES (…)
ON CONFLICT(company_id, product_id, day) DO UPDATE SET
    total_quantity = total_quantity + excluded.total_quantity,
    total_revenue = total_revenue + excluded.total_revenue,
    total_cost = total_cost + excluded.total_cost,
    total_tax = total_tax + excluded.total_tax,
    total_profit = total_profit + excluded.total_profit,
    updated_at = CURRENT_TIMESTAMP
```

Beneficios extra del batch:
- **1 roundtrip de red total** (era N×2).
- **Transacción implícita** (libsql batch es atómica): si falla un item, no quedan agregados parciales.
- Race conditions eliminadas: el `+ excluded.X` se evalúa dentro del statement, no leyendo old → escribiendo new.

Guard inicial: `items` vacío retorna `{ success: true }` sin llamar `batch` (libsql falla con array vacío).

### Fase 7.3 — `vendor_daily_performance` + `hourly_sales_stats` + `product_movement_stats` (commit `a5ee32a`)

Tres conversiones en un commit por simetría:

- **vendor_daily_performance**: UPSERT con `ON CONFLICT(company_id, user_id, date)`. `avg_ticket` se recalcula inline: `(total_amount + excluded.total_amount) / (total_sales + 1)` — aprovecha que SQLite evalúa las expresiones de SET sobre los valores OLD del row.
- **hourly_sales_stats**: UPSERT simple con `ON CONFLICT(company_id, date, hour)`.
- **product_movement_stats**: batch UPSERT con `ON CONFLICT(company_id, product_id)`, mismo patrón que 7.2 — escala con N items.

## Resultados medibles

### Venta de 5 items (medición real después de Fase 7.3)

| Tabla | Antes | Después | Δ statements | Δ roundtrips |
|---|---:|---:|---:|---:|
| sales_daily_summary | 2 | 1 | −50% | −50% |
| vendor_daily_performance | 2 | 1 | −50% | −50% |
| product_daily_profit | 10 | 5 (1 batch) | −50% | **−90%** |
| product_movement_stats | 10 | 5 (1 batch) | −50% | **−90%** |
| hourly_sales_stats | 2 | 1 | −50% | −50% |
| **Total** | **26** | **13** | **−50%** | **−81%** |

### Proyección por tamaño de venta

| Items | Statements antes | Statements después | Roundtrips antes | Roundtrips después |
|---:|---:|---:|---:|---:|
| 1 | 10 | 5 | 10 | 5 |
| 5 | 26 | 13 | 26 | 5 |
| 10 | 46 | 23 | 46 | 5 |
| 20 | 86 | 43 | 86 | 5 |

`product_daily_profit` y `product_movement_stats` siempre quedan en **1 roundtrip cada uno**, sin importar N. Las otras 3 son 1 roundtrip fijo cada una.

### Beneficios cualitativos

- **Race conditions eliminadas** en las 5 tablas de agregación. Antes, dos cajeros vendiendo el mismo segundo podían perder una venta del agregado por leer el mismo total → escribir uno encima del otro. Ahora la suma se hace en el statement (`total_X + excluded.total_X`), atómica.
- **Atomicidad de items**: si un item falla en 7.2/7.3, ninguno se aplica (batch transaccional). Antes, podía aplicarse parcial.

## Validación

- **Linting**: 0 errores nuevos en `src/store/useStore.js` ni en `src/lib/turso.js`.
- **Ventas reales en local**: 4+ ventas con 1, 5, 6 y 7 items distintos. Todas completadas OK, dashboard refresh OK, historial OK.
- **Logs**: `All aggregations updated` en cada venta.
- **Math equivalence**: cada UPSERT preserva exactamente la semántica del SELECT+IF/ELSE original (verificado leyendo each branch).

### NO se tocó

- `addSale` core (la transacción principal sigue idéntica)
- SII (emisión, CAFs, folios)
- WooCommerce / sync con tienda
- Impresión
- Checkout
- APIs externas
- `sync offline core` (`syncCatalogFromServer`, `syncPendingOpsToServer`)
- JSON source-of-truth en mirrors

## Riesgos detectados

1. **`product_movement_stats.sold_last_7_days` / `sold_last_30_days`** son ventanas deslizantes lógicas, pero el código original (y el nuevo) solo **incrementa** — nunca decrementa al pasar el tiempo. **Bug pre-existente**, fuera de scope de Fase 7. Documentado para mini-fase futura si se quiere arreglar.
2. **`turso.batch` con `mode` por defecto** crea transacción implícita 'deferred'. Si en el futuro se introducen statements que requieran 'write' explícito, revisar.
3. **`turso.transaction()` NO se instrumenta** — `__tursoTrace` solo cuenta `execute`/`batch` directos. Los SQL dentro de la transacción de `addSale` (INSERT de venta + UPDATEs de stock) **no aparecen** en los snapshots. Esto es intencional (por seguridad con private fields del cliente libsql) y aceptable para Fase 7 (las agregaciones son post-tx, llamadas directas).

## Rollback

Las 3 fases se revierten independientemente:

```bash
git revert a5ee32a   # Fase 7.3
git revert 4260808   # Fase 7.2
git revert bce3387   # Fase 7.1
git revert e177d16   # Instrumentación (opcional, no afecta funcionalidad)
```

Cada commit es drop-in. Sin kill-switch porque el cambio es matemáticamente equivalente al original — no hay "modo viejo" que activar dinámicamente.

## QA sugerido (10 min)

1. Hacer 3 ventas distintas:
   - 1 item, sin cliente
   - 5 items, con cliente seleccionado
   - 10+ items mezclados (kg + und + algún producto repetido)
2. Verificar para cada una:
   - Aparece en Historial con total correcto
   - Dashboard (Stats refreshed) muestra balance/sales actualizados
   - Productos más vendidos refleja los nuevos items
   - Performance por vendedor refleja la nueva venta
3. (Opcional) Habilitar trace: `__tursoTrace.enable(); location.reload();` y verificar que los conteos por tabla coinciden con la tabla de resultados arriba.
4. Hacer una anulación de venta — el reverso usa funciones diferentes (`reverseSalesDailySummary` etc., NO tocadas) — debe seguir funcionando idéntico.

## Próximos pasos sugeridos

- **Fase 8** (ya planeada): sync incremental real con `updated_at > last_sync`. ROI muy alto: hoy `syncCatalogFromServer` descarga el catálogo completo en cada llamada.
- **Mini-fase opcional** (baja prioridad): convertir `updateSupplierPurchaseSummary` (no incluida en Fase 7 porque se llama en post-compra, no post-venta, y el ROI es menor) con el mismo patrón si se prioriza.
- **Mini-fase opcional**: arreglar el bug de ventanas deslizantes en `product_movement_stats` (cron job o lógica de expiración).
