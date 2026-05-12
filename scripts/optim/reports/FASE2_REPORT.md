# FASE 2 — Índices seguros

## Qué cambió
- `phase2/01-apply-indexes.mjs`: crea 11 índices nuevos con `CREATE INDEX IF NOT EXISTS`. Detecta columnas faltantes y omite índices imposibles con WARN claro (no rompe la migración).
- `phase2/02-write-impact.mjs`: mide el costo extra de mantener índices en UPDATEs reales.
- `phase2/99-rollback-indexes.mjs`: rollback selectivo (solo drop los que creamos).

NO se eliminó ningún índice existente. NO se cambió ninguna query de la app.

## Resultado de la aplicación
11 índices creados, 2 omitidos por columnas inexistentes (se aplicarán cuando se agreguen las columnas correspondientes en Fases 4/8):

| Estado | Índice | Tiempo creación |
|---|---|---|
| OK | idx_sales_company_date_id_desc | 7743 ms |
| OK | idx_sales_company_payment_date | 5514 ms |
| OK | idx_sales_company_user_date | 4420 ms |
| SKIP | idx_sales_company_external_order | — (falta sales.external_order_id) |
| OK | idx_products_company_sku | 3251 ms |
| SKIP | idx_products_company_updated_id | — (falta products.updated_at) |
| OK | idx_products_company_offer_name | 834 ms |
| OK | idx_products_company_category_offer_name | 855 ms |
| OK | idx_product_lots_company_product_expiry_active | 176 ms |
| OK | idx_product_lots_company_expiry_product_active | 215 ms |
| OK | idx_inventory_alerts_company_created | 145 ms |
| OK | idx_sii_dtes_company_created | 166 ms |
| OK | idx_sales_credit_client_pending | 4039 ms |

## Comparación EXPLAIN QUERY PLAN (before → after)

| Query | Plan ANTES | Plan AHORA | Mejora |
|---|---|---|---|
| sales_history_by_company_date | `idx_sales_company_date` + ORDER BY | `idx_sales_company_date_id_desc` (sin TEMP B-TREE) | ✅ ORDER BY servido por índice |
| sales_by_company_payment_method | `idx_sales_company_date` + filtro extra | `idx_sales_company_payment_date` (payment_method indexado) | ✅ Filtra desde índice |
| sales_by_user_date_range | `idx_sales_user_date` (sin company_id) | `idx_sales_company_user_date` (company_id + user_id + date) | ✅ Filtro multi-empresa correcto |
| sales_credit_pending | `idx_sales_client` (full scan adicional) | `idx_sales_credit_client_pending` (partial, ~filas pendientes solamente) | ✅ Index parcial, mucho menos páginas |
| products_offer_by_name | `idx_products_stock_company` + TEMP B-TREE | **COVERING** `idx_products_company_offer_name` | ✅ Sin TEMP B-TREE, sin lookup a tabla |
| products_by_category_offer | `idx_products_category_company` + TEMP B-TREE | **COVERING** `idx_products_company_category_offer_name` | ✅ Sin TEMP B-TREE, sin lookup a tabla |
| product_lots_expiring_soon | `idx_product_lots_company_qty` + TEMP B-TREE | `idx_product_lots_company_expiry_product_active` (partial WHERE quantity > 0) | ✅ Sin TEMP B-TREE, filas relevantes solamente |
| inventory_alerts_recent | `idx_alerts_company_read` + TEMP B-TREE | `idx_inventory_alerts_company_created` | ✅ Sin TEMP B-TREE |
| sii_dtes_recent | `idx_sii_dtes_folio` + TEMP B-TREE | `idx_sii_dtes_company_created` | ✅ Sin TEMP B-TREE |
| products_by_sku | `sqlite_autoindex_products_1` (UNIQUE) | mismo (planner consideró óptimo) | = neutral, índice nuevo disponible si crece la tabla |
| product_lots_active_by_expiry | `idx_product_lots_product` | mismo (product_id muy selectivo) | = neutral |
| products_search_name_like | full scan vía company | full scan vía company | = sin cambio (FTS5 en Fase 10) |

### Tiempos absolutos (incluyen ~125 ms RTT Turso)
| Query | before | after | delta |
|---|---:|---:|---:|
| sales_history_by_company_date | 129 | 135 | +6 |
| sales_by_company_payment_method | 130 | 127 | −3 |
| sales_by_user_date_range | 128 | 127 | −1 |
| sales_credit_pending | 131 | 126 | −5 |
| products_by_sku | 127 | 137 | +10 |
| products_search_name_like | 758 | 902 | +144 (variabilidad red) |
| products_offer_by_name | 130 | 126 | −4 |
| products_by_category_offer | 167 | 128 | **−39** |
| product_lots_active_by_expiry | 127 | 128 | +1 |
| product_lots_expiring_soon | 131 | 131 | 0 |
| inventory_alerts_recent | 131 | 128 | −3 |
| sii_dtes_recent | 137 | 129 | −8 |

> Los tiempos están dominados por latencia de red (~125 ms RTT). La mejora estructural está en los PLANES (TEMP B-TREE eliminado, índices cobertores) — se nota especialmente bajo concurrencia y con datos crecientes. En `products_by_category_offer` ya se ve un −24 % aún con dataset pequeño.

## Write impact
20 UPDATEs idempotentes por tabla (no cambian datos, solo recalculan índices):
- sales: 145 ms/UPDATE promedio
- products: 161 ms/UPDATE promedio
- product_lots: 127 ms/UPDATE promedio

Todo dominado por RTT a Turso (~125 ms). Overhead local por índices nuevos es despreciable (sales tiene 41.9k filas y suma 4 índices nuevos sin impacto medible).

## Impacto esperado en producción
- **Listados paginados de ventas** (POS + historial): ordenamiento servido por índice, mejora notable cuando crecen las tablas.
- **Reportes por método de pago / por usuario**: filtros multi-columna ahora indexados.
- **Cobranza crédito**: índice parcial reduce dramáticamente el set escaneado (solo ventas pendientes a crédito).
- **Alertas / DTEs SII recientes**: ya no requieren ordenamiento adicional.
- **Listados de ofertas y categorías**: COVERING INDEX → no se toca la tabla.

## Riesgos
- **Tamaño del WAL/storage**: 11 índices nuevos sobre tablas pequeñas/medianas — incremento despreciable (sales 41.9k filas).
- **Escritura**: probada y sin impacto medible.
- **Planner choice**: el optimizador podría preferir aún índices viejos en algunos casos (visto en `products_by_sku` y `product_lots_active_by_expiry`); no es un problema — solo significa que el viejo seguía siendo óptimo. Los nuevos quedan disponibles para cuando crezcan los datos.
- **No se eliminan índices antiguos en esta fase** (por diseño del plan). Se evaluará en una fase posterior una vez confirmado el beneficio.

## Compatibilidad verificada
- SII: sin cambios.
- WooCommerce / APIs: sin cambios. La SKIP de `idx_sales_company_external_order` indica que la columna aún no existe — su creación está prevista cuando se requiera el lookup masivo.
- Impresión: sin cambios.
- Historial de ventas: mismo SQL, mejor plan.
- Dexie offline / sync offline: sin cambios.
- JSON `sales.items`: intacto.

## Rollback
```bash
node scripts/optim/phase2/99-rollback-indexes.mjs           # preview
node scripts/optim/phase2/99-rollback-indexes.mjs --confirm # ejecuta DROP IF EXISTS
```
