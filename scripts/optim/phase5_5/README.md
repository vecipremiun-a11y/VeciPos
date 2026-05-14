# Fase 5.5 · Estabilización operativa (PWA · Mirrors · Observabilidad)

## Objetivo

Dejar la plataforma **operacionalmente sólida** antes de nuevas optimizaciones
grandes. No agrega features de negocio — sólo cierra los huecos descubiertos
en Fase 5 y blinda el sistema contra problemas similares.

## Problemas que resuelve

| # | Problema descubierto en Fase 5 | Solución en Fase 5.5 |
|---|---|---|
| 1 | El SW de PWA nunca avisaba a los clientes existentes → un usuario corrió código viejo por horas | `initPwaUpdate()` con polling 10 min, banner UI, auto-refresh por idle 30 min |
| 2 | Backfill incremental no era programable ni medible | `02-backfill-robust.mjs` con flags, exit codes, manifest JSON |
| 3 | No había forma de saber si las queries normalizadas fallaban en producción | Tabla `analytics_telemetry` + buffer en cliente |
| 4 | No había monitoreo continuo de la cobertura del mirror | `03-coverage-check.mjs` con umbrales y alertas |

## NO se ha tocado

- POS core / addSale / addPurchase
- SII, impresión, checkout
- WooCommerce ni APIs externas
- Lógica transaccional
- Offline sync existente (el PWA respeta ops pendientes antes de refrescar)

## Archivos nuevos

### Front-end (client)

| Archivo | Propósito |
|---|---|
| `src/lib/pwaUpdate.js` | Registra el SW (`virtual:pwa-register`), polling 10 min para nuevos deploys, callbacks para UI, auto-refresh por idle 30 min, hard-limit 24 h |
| `src/lib/analyticsTelemetry.js` | Buffer 50 eventos / flush cada 60 s o al cerrar tab, persistencia segura, nunca propaga errores |
| `src/components/PWAUpdatePrompt.jsx` | Banner discreto cuando hay nueva versión. Botón "Aplicar ahora" o "Más tarde" |

### Scripts y datos

| Archivo | Propósito |
|---|---|
| `scripts/optim/phase5_5/01-create-telemetry.mjs` | Crea tabla `analytics_telemetry` + 3 índices |
| `scripts/optim/phase5_5/02-backfill-robust.mjs` | Backfill incremental con `--health-check`, `--json`, `--since=N`, manifest |
| `scripts/optim/phase5_5/03-coverage-check.mjs` | Verifica cobertura mirror + reporta gap por usuario/día |
| `scripts/optim/phase5_5/last-backfill.json` | Manifest del último backfill (lo escribe `02-backfill-robust.mjs`) |

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/main.jsx` | Llama `initPwaUpdate()` después de `createRoot()` |
| `src/App.jsx` | Monta `<PWAUpdatePrompt />` + expone `activeCompanyId` a la capa lib |
| `src/pages/ProductProfile.jsx` | Loguea evento `fallback` cuando la query normalizada falla |

## Mecanismo del auto-update PWA

```
Usuario navegando
    │
    ▼
initPwaUpdate() en main.jsx
    │
    ├─► registerSW({ immediate: true })
    │       │
    │       ├─► onNeedRefresh ──► banner UI "Nueva versión disponible"
    │       │                     · Aplicar ahora     → refresh inmediato
    │       │                     · Más tarde         → banner se silencia 1h
    │       │                     · Sin acción 30 min → refresh auto (idle)
    │       │                     · Sin acción 24 h   → refresh auto (hard limit)
    │       │
    │       └─► onRegisteredSW ──► setInterval(r.update(), 10 min)
    │                              detecta nuevos deploys aunque
    │                              el usuario no navegue
    │
    └─► Safety checks antes de refresh:
        · Si navigator.onLine == false → posponer 60 s
        · Si pendingOpsApi.count(queued) > 0 → posponer 2 min
```

## Telemetría fallback

Tabla `analytics_telemetry` (Turso) — registra:

```sql
CREATE TABLE analytics_telemetry (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  TEXT,
  event_type  TEXT NOT NULL,    -- 'fallback' | 'error' | 'gap_detected'
  query_name  TEXT NOT NULL,    -- 'productSalesHistory', etc.
  error_msg   TEXT,
  duration_ms INTEGER,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

Diagnóstico rápido:

```sql
SELECT event_type, query_name, COUNT(*) c, MAX(created_at) last
FROM analytics_telemetry
WHERE created_at > datetime('now','-7 day')
GROUP BY event_type, query_name ORDER BY c DESC;
```

Si `c > 1%` del total de queries → hay un problema sistémico.

## Comandos operacionales

### Health-check diario (cron recomendado)

```bash
# Solo reportar (no escribe)
node scripts/optim/phase5_5/02-backfill-robust.mjs --health-check --json

# Reparar si hay gap
node scripts/optim/phase5_5/02-backfill-robust.mjs --since=2

# Coverage report
node scripts/optim/phase5_5/03-coverage-check.mjs
```

### Exit codes

| Script | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| `02-backfill-robust.mjs` | OK | — | Gap detectado (`--health-check`) | Errores |
| `03-coverage-check.mjs` | >= 99.5% | 95-99.5% | < 95% | — |

Configurar en Vercel cron / GitHub Actions para alerta automática.

## QA manual recomendado

### 1. PWA Auto-update (lo más importante)

1. **Probar localmente con `npm run build && npm run preview`**:
   - Abrir la app
   - Hacer un cambio cualquiera y `npm run build` nuevamente
   - Esperar ~10 min o forzar `swRegistration.update()` desde DevTools
   - Debe aparecer el banner "Nueva versión disponible"
   - "Aplicar ahora" → recarga inmediata
   - "Más tarde" → banner desaparece, esperar 30 min idle → auto-refresh
2. **En producción**:
   - El próximo deploy debería ser auto-detectado por todos los usuarios sin
     que cierren/reabran el navegador.

### 2. Safety durante una venta

- Iniciar una venta (no terminarla)
- Si llega un refresh, NO debe interrumpir la venta (el banner es discreto
  y NO recarga automáticamente sin idle/hard-limit).

### 3. Safety con ops offline pendientes

- Forzar pendingOpsApi a tener una op `queued`
- Disparar `applyUpdate({ reason: 'test' })` desde consola
- Debe loggear "ops offline pendientes, posponiendo refresh 2min"

### 4. Telemetría

- Abrir ProductProfile con un producto cualquiera
- Verificar consola: no debe haber `[fase5] ... falló` (si lo hay, ese
  evento debe aparecer en `analytics_telemetry` tras 60 s)
- Query:
  ```sql
  SELECT * FROM analytics_telemetry ORDER BY id DESC LIMIT 10;
  ```

### 5. Coverage

- `node scripts/optim/phase5_5/03-coverage-check.mjs`
- Debe mostrar 100% en ambas tablas

## Riesgos detectados y mitigados

| Riesgo | Mitigación |
|---|---|
| Refresh durante una venta interrumpe al cajero | Sólo refresh si idle 30 min, sin ops pendientes, y online |
| Telemetría satura Turso | Buffer 50 eventos, flush máx cada 60 s, fire-and-forget |
| `virtual:pwa-register` no existe en dev | Import dinámico con try/catch silencioso |
| Refresh dispara dos veces en pocos segundos | `cleanupTimers()` + flag `flushing` |
| `analytics_telemetry` crece sin control | Retención manual recomendada: `DELETE FROM analytics_telemetry WHERE created_at < datetime('now', '-30 day')` |

## Rollback

1. Revertir el commit:
   ```bash
   git revert <commit-hash>
   ```
2. La tabla `analytics_telemetry` puede quedar vacía sin afectar nada
   (no hay foreign keys ni dependencias).
3. Si se quisiera eliminar:
   ```sql
   DROP TABLE analytics_telemetry;
   DROP INDEX idx_analytics_telemetry_created;
   DROP INDEX idx_analytics_telemetry_event_type;
   DROP INDEX idx_analytics_telemetry_company;
   ```

## Próximos pasos sugeridos (Fase 6 ó más allá)

1. **Vercel cron** o GitHub Actions para correr `02-backfill-robust.mjs --health-check`
   cada 6 h y `03-coverage-check.mjs` cada 24 h.
2. **Dashboard interno** que lea `analytics_telemetry` y muestre tendencia.
3. **Cleanup retention** automático para `analytics_telemetry`.
4. **Más queries analíticas migradas** — usar telemetría para identificar
   las que más se usan y priorizar.
