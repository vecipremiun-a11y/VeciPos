# Fase 5 · Migración gradual de queries analíticas a tablas normalizadas

## Objetivo

Aprovechar las tablas normalizadas creadas en Fase 4 (`sale_items` /
`purchase_items`) para **acelerar queries analíticas/reporting**, sin tocar
ningún componente transaccional.

## Reglas estrictas

- ❌ NO se toca POS core, flujo de ventas, SII, impresión, offline sync,
  WooCommerce, APIs externas, checkout, payloads ni lógica transaccional.
- ✅ SÍ se migran solo dashboards, analytics, reportes, métricas, rankings.
- ✅ Toda query migrada conserva un **fallback automático** a la versión
  legacy basada en `sales.items` / `purchases.items` JSON.
- ✅ Antes de cualquier reemplazo se ejecutaron ambas versiones, se compararon
  resultados, se reportaron diferencias y se validaron edge cases.

## Resultados clave

### Speedups medidos (benchmark real con datos de producción)

#### Histórico de un producto en `ProductProfile.jsx`

| Rango | Histórico Ventas | Histórico Compras |
|---|---:|---:|
| 1 mes  | 1.35× | **7.22×** |
| 3 meses | 1.03× | **9.81×** |
| 6 meses | 1.04× | **11.14×** |
| 12 meses | 1.00× | **10.37×** |

#### Paridad (post-backfill incremental)

| Query | Filas norm/json | Suma ventas diff | Suma utilidad diff |
|---|---|---:|---:|
| productSalesHistory (1 producto, 1k filas) | 1000 / 1000 | — | — |
| productPurchasesHistory (1 producto, 1 año) | 25 / 25 | — | — |
| profitReport (mes completo, 25k items) | 25,020 / 25,020 | **$0** | **$0** |

**Paridad: 100% en todos los rangos validados.**

#### Reporte de utilidad (`SalesProfitReport.jsx`)

| Rango | Filas | Norm ms | JSON ms | Speedup |
|---|---:|---:|---:|---:|
| 7 días | 5,830 | 644 | 504 | 0.78× |
| 30 días | 25,020 | 1,103 | 776 | 0.70× |
| 90 días | 76,568 | 2,904 | 1,798 | 0.62× |
| 180 días | — | — | crash | crash |

→ **Decisión: NO migrar `SalesProfitReport.jsx` todavía.**
  El JSON ya es rápido por el index `(company_id, date)` en `sales`.
  La versión normalizada solo gana cuando el rango es muy amplio Y hay
  filtro por producto (caso de Profile).

## Bug crítico encontrado y resuelto: gap del mirror

### Síntoma

223 ventas y 6 compras posteriores al deploy de Fase 4 (13-mayo) NO tenían
filas en `sale_items` / `purchase_items` (gap de ~506 items).

### Causa raíz

**Cache del Service Worker PWA.** El usuario 7 (caja secundaria) seguía
ejecutando código JavaScript previo al deploy — su PWA nunca cargó el
bundle con `mirrorSaleItems`. Distribución:

- `user_id=2` (caja principal): 100% con mirror ✅
- `user_id=7` (caja con PWA cacheada): 100% sin mirror ❌

### Solución aplicada

1. **Backfill incremental** (`05-incremental-backfill.mjs`): detecta ventas /
   compras sin mirror, parsea su JSON original y completa las tablas
   normalizadas. Es **idempotente** (INSERT OR IGNORE + UNIQUE seq).
2. **Recomendación adicional**: el usuario 7 debería forzar refresh del PWA
   (Ctrl+Shift+R o desinstalar/reinstalar). Esto es operacional, no requiere
   cambio de código.

### Prevención a futuro

El script `05-incremental-backfill.mjs` se puede correr en cron diario
para detectar y rellenar gaps automáticamente. **Recomendado: agendarlo
en producción cada 6 horas.**

## Cambios de código

### Archivos nuevos

- `src/lib/analyticsQueries.js` — Funciones helper `*Normalized()` y
  `*ViaJson()`, con `compareResults()` para validación.

- `scripts/optim/phase5/`:
  - `01-compare-queries.mjs` — Comparativa de paridad y tiempos
  - `02-investigate-diff.mjs` — Diagnóstico del gap
  - `03-classify-missing.mjs` — Clasificar tipo de ventas faltantes
  - `04-mirror-coverage.mjs` — Cobertura del mirror por usuario/día
  - `05-incremental-backfill.mjs` — Backfill incremental (idempotente)
  - `06-profit-range-bench.mjs` — Benchmark profit report por rango
  - `07-final-bench.mjs` — Benchmark final (5 productos aleatorios)
  - `08-range-impact.mjs` — Impacto del rango en el speedup

### Archivos modificados

- `src/pages/ProductProfile.jsx` — Migrado a queries normalizadas con
  fallback automático a JSON. Forma de salida idéntica para la UI.

### Archivos NO modificados (intencionalmente)

- `src/pages/SalesProfitReport.jsx` — Sin speedup demostrable.
- `src/store/useStore.js` — No se toca el POS core.
- Cualquier componente transaccional, SII, impresión, offline, integración.

## Cómo deshacer (rollback)

1. Para revertir el código:
   ```bash
   git revert <commit-hash-fase5>
   ```
   El fallback a JSON queda activo automáticamente al revertir.

2. Las tablas `sale_items` / `purchase_items` siguen poblándose por el
   mirror live de Fase 4 — Fase 5 NO las toca.

3. Si quisieras también deshabilitar el mirror, ver Fase 4 README.

## Riesgos detectados

| Riesgo | Mitigación |
|---|---|
| Mirror live falla silenciosamente en clientes con cache vieja | Backfill incremental cron diario |
| Combos / productos con id no-numérico no se mirrorean | Detectado en `normalizeItemId` — fallback a JSON automáticamente |
| Cambios de schema en `sales.items` JSON | El JSON sigue siendo fuente de verdad — sale_items es snapshot |
| Discrepancias por status='cancelled' | Ambas versiones filtran `status != 'cancelled'` explícitamente |

## QA manual recomendado

1. Abrir **Perfil de Producto** → seleccionar un producto con bastante
   historia. Verificar que:
   - Tabla de compras muestra las mismas filas que antes.
   - Tabla de ventas muestra las mismas filas que antes.
   - Movimientos combinados (entradas/salidas) son idénticos.
   - Cambiar rango (1 mes / 3 meses / 1 año) → datos coherentes.

2. Probar con productos:
   - Recién creados (sin historia) → no debe crashear.
   - Productos en combos (no se ven en sale_items pero la UI ignora null).
   - Productos con muchísima historia → debe ser visible la mejora.

3. Verificar que en la consola del navegador NO aparece `[fase5] ...
   falló, cae a JSON` (si aparece, el fallback funcionó pero indica un
   problema operacional).

## Próximos pasos sugeridos (Fase 5.5 ó Fase 6)

1. **Cron de backfill incremental** — agendar `05-incremental-backfill.mjs`
   cada 6 horas en Vercel/Turso para garantizar paridad 100%.
2. **Telemetría de fallback** — contar cuántas veces se cae a JSON; si es
   >1%, hay un problema sistémico.
3. **Auto-update PWA** — configurar `registerSW({ immediate: true })` para
   reducir riesgo de service workers cacheados con código viejo.
4. **Migrar más reports si se identifican cuellos** — usar comparator
   primero para validar speedup real.
