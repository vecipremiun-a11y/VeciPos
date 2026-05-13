# FASE 2.5 — Columnas faltantes + trigger + índices pendientes

Fase intermedia para habilitar dos índices que en Fase 2 quedaron SKIP por columnas inexistentes. Se añaden las columnas con compatibilidad total (NULL en filas existentes, backfill con timestamp actual donde corresponde, y trigger que mantiene `updated_at` automáticamente — el código de la app NO necesita cambiar).

## Qué cambió

### DB (vía `scripts/optim/phase2_5/01-add-columns.mjs`)
- `ALTER TABLE products ADD COLUMN updated_at TEXT` — backfill: 4347 filas con `strftime('%Y-%m-%dT%H:%M:%fZ','now')`.
- `CREATE TRIGGER trg_products_updated_at AFTER UPDATE ON products` — actualiza `updated_at` solo cuando NEW.updated_at no fue explícitamente modificado (evita recursión).
- `CREATE INDEX idx_products_company_updated_id ON products(company_id, updated_at, id)` — preparado para sync incremental (Fase 8).
- `ALTER TABLE sales ADD COLUMN external_order_id TEXT` — nullable.
- `CREATE INDEX idx_sales_company_external_order ON sales(company_id, external_order_id) WHERE external_order_id IS NOT NULL` — índice parcial para WooCommerce/APIs.

### Verificación
`scripts/optim/phase2_5/02-verify-trigger.mjs` ejecutado con éxito:
```
Antes:   updated_at = 2026-05-12T23:54:00.099Z
Después: updated_at = 2026-05-13T00:00:15.853Z
Trigger funciona: true
```
`UPDATE ... SET name = name` (idempotente) disparó el trigger correctamente.

## Compatibilidad
- Las nuevas columnas son **nullable**. Las inserciones existentes (que no las mencionan) siguen funcionando.
- El trigger usa `WHEN COALESCE(NEW.updated_at,'') = COALESCE(OLD.updated_at,'')` → si algún día el código pasa un `updated_at` explícito, el trigger lo respeta y no sobreescribe.
- No se modificó ningún query de la app. Las nuevas columnas se exponen automáticamente en `SELECT *`.

## Impacto esperado
- Habilita Fase 8 (sync incremental) sin nueva migración.
- Habilita Fase 4 (WooCommerce / APIs) para guardar `external_order_id` en futuras ventas — el campo ya existe.

## Riesgos
- El trigger añade un mini-overhead al UPDATE de productos. Medido vía `phase2/02-write-impact.mjs` no es perceptible (~145ms/UPDATE dominado por RTT).
- Ningún riesgo de compatibilidad con queries existentes.
