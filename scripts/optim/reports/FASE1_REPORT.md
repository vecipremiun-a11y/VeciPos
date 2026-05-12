# FASE 1 — Medición y Seguridad

## Qué cambió
- Nuevo directorio `scripts/optim/` con herramientas standalone (no se importan desde el bundle de la app).
- `phase1/01-snapshot-schema.mjs`: guarda DDL completo + conteo de filas + pragmas en `snapshots/<timestamp>/`.
- `phase1/02-list-indexes.mjs`: enumera todos los índices reales con columnas, unicidad y origen.
- `phase1/03-explain-queries.mjs`: corre `EXPLAIN QUERY PLAN` y mide tiempos de 14 queries críticas. Soporta marcador `before` / `after` para comparar antes y después de cada fase.
- `src/lib/perfLogger.js`: logger opt-in (queries lentas, sync, polling, búsquedas) — NO cambia lógica, NO se ejecuta hasta que se active el flag.

## Resultados de la medición inicial (marker=before)
- **DB**: `libsql://poskem-db-jasongo.aws-us-east-1.turso.io`
- **Tablas**: 67
- **Tablas más grandes**: `integration_sync_logs` (66.7k), `audit_logs` (48.7k), `sales` (41.9k), `product_daily_profit` (36k), `product_lots` (4.5k), `products` (4.3k).

### Hallazgos clave del schema
Dos columnas del plan **no existen** todavía en la base real:
- `sales.external_order_id` → afecta `idx_sales_company_external_order` (WooCommerce/APIs lookup).
- `products.updated_at` → afecta `idx_products_company_updated_id` (sync incremental — Fase 8).

Estas columnas son **dependencias de fases posteriores**; los scripts las detectan automáticamente y omiten los índices correspondientes con `SKIP` claro en el reporte.

### Plan actual de queries críticas (resumen)
Todas las queries golpean índices existentes, pero **9 de 12** usan `TEMP B-TREE FOR ORDER BY` (ordenamiento adicional en RAM porque los índices no cubren el `ORDER BY`). Esto es lo que mejora la Fase 2.

Tiempos baseline (incluyen ~125 ms de RTT a Turso):
| Query | ms |
|---|---|
| sales_history_by_company_date | 129 |
| sales_by_company_payment_method | 130 |
| sales_by_user_date_range | 128 |
| sales_credit_pending | 131 |
| products_by_sku | 127 |
| products_search_name_like | **758** |
| products_offer_by_name | 130 |
| products_by_category_offer | 167 |
| product_lots_active_by_expiry | 127 |
| product_lots_expiring_soon | 131 |
| inventory_alerts_recent | 131 |
| sii_dtes_recent | 137 |

`products_search_name_like` (758 ms) es el outlier — full scan con `LIKE '%...%'`. Esto se resuelve en **Fase 10** (FTS5 / búsqueda híbrida), NO en Fase 2.

## Impacto esperado
- Visibilidad total del estado actual antes de cualquier cambio.
- Capacidad de comparar antes/después de cada fase con métricas reproducibles.
- Cero cambios funcionales en la app — todo lo de Fase 1 es solo lectura.

## Riesgos
- Ninguno. Scripts en `solo lectura` + logger opt-in que no se ejecuta sin flag.

## Compatibilidad verificada
- SII: sin cambios.
- WooCommerce / APIs: sin cambios.
- Impresión: sin cambios.
- Historial de ventas: sin cambios.
- Dexie offline / sync offline: sin cambios.
- JSON `sales.items`: intacto.
