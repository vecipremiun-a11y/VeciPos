# FASE 9 — Smart polling (Visibility API + adaptativo + actividad)

## Qué cambió

### Nuevo módulo `src/lib/smartPolling.js`
Utilidad central que reemplaza `setInterval` ciego con:
- **Page Visibility API**: pausa total cuando la pestaña está oculta.
- **Network status**: pausa cuando `!navigator.onLine`.
- **Intervalos adaptativos**: `activeMs` mientras hay actividad reciente, `idleMs` cuando el usuario está idle.
- **Re-ejecución inmediata** al volver a foco / visible / online / actividad.
- **Backoff exponencial** ante errores consecutivos.
- **Sin overlapping**: nunca dispara el callback si el anterior aún corre.
- API: `createSmartInterval(callback, opts)` → devuelve función `cancel()` (drop-in para `clearInterval`).
- Helper `markActivity()`: marca actividad global → todos los polling switches a modo "activo" y los que pidieron `runOnActivity: true` se ejecutan al instante.

### Integración con el store
`addSale()` ahora llama `markActivity()` justo después de `tx.commit()`. Resultado: cada venta exitosa dispara un sync inmediato y pone todos los polling en modo "activo" durante 5 minutos.

### Migración de los 10 puntos de polling

| Sitio | Antes | Activo (con actividad) | Idle | Mejoras |
|---|---|---|---|---|
| `App.jsx` syncAll | 60s ciego | **60s** | **5min** | visibilidad, online, actividad, backoff |
| `Dashboard.jsx` | 60s ciego | 60s | 5min | visibilidad, actividad |
| `NotificationBell` | 60s ciego | **2min** | **10min** | visibilidad, actividad — badge no necesita 60s |
| `CashStatusWidget` | **10s ciego** | **15s** | **60s** | visibilidad, actividad — antes muy agresivo |
| `Production.jsx` | 30s | 30s | 2min | visibilidad, actividad |
| `OfflineSync.jsx` | 5s ciego | 5s | 30s | visibilidad — antes corría 5s siempre |
| `SupportWidget` global | 30s | 30s | 3min | visibilidad |
| `SupportWidget` chat | 3s | 3s | 3s | visibilidad — antes corría con tab oculta |
| `SupportInbox` chat | 3s | 3s | 3s | visibilidad |
| `MainLayout` permisos | 5min | 5min | 15min | visibilidad, focus (antes 5min ciego + listener focus separado) |

## Impacto esperado

### Reducción de requests a Turso

Escenario típico: usuario admin con caja abierta, dashboard cargado, una pestaña abierta y la deja en background mientras hace otras cosas.

**Antes** (1 hora de tab en background):
- App sync: 60 req
- Dashboard: 60 req
- NotificationBell: 60 req
- CashStatusWidget: 360 req
- Permisos: 12 req
- **Total: ~552 requests**

**Después** (1 hora de tab en background):
- Todos pausados por Visibility API → **0 requests**

Y cuando vuelve a la pestaña: cada polling se ejecuta UNA VEZ inmediatamente para refrescar.

### Modo "activo" tras venta
Al hacer una venta, `markActivity()` ejecuta inmediatamente todos los polling que pidieron `runOnActivity: true` (sync, dashboard, notificaciones, caja, producción). Resultado: UX casi-instantáneo sin recurrir a polling agresivo.

### Backoff ante caídas
Si Turso o el server caen, los polling no martillan: cada error duplica el intervalo (hasta 5min). Cuando vuelve a funcionar, vuelve al intervalo normal en el siguiente éxito.

## Riesgos

- **Datos un poco más "fríos" en idle**: dashboard se actualiza cada 5min si no hay actividad. Mitigación: cualquier acción del usuario (incluso un click que dispare sync) reinicia el modo "activo" por 5min. Ventas son detectadas via `markActivity()`.
- **`runOnVisible` puede generar pico al volver**: al volver a la tab, varios polling se ejecutan a la vez. Mitigación: cada uno tiene su propio guard de "running" (sin overlapping del MISMO polling); los distintos polling sí pueden coincidir, pero son requests pequeños y la base ya tiene los índices de Fase 2.
- **Chat de soporte**: la pausa cuando tab oculta significa que un admin podría no ver mensajes nuevos mientras está en otra pestaña. Comportamiento esperado — el polling se reanuda al volver. Si necesitamos notificación push real, eso queda fuera de Fase 9 (requiere Web Push o WebSockets).

## Compatibilidad verificada

- ✅ `npm run lint`: sin errores nuevos.
- ✅ `npm run build`: `✓ 4053 modules transformed` (+2kB de bundle por la utilidad).
- ✅ `npm run dev`: ready en 895ms sin errores.
- ✅ No se tocaron SII, WooCommerce, Dexie offline, sync offline, JSON `sales.items`, ni la lógica de venta. Solo se cambió la cadencia de los polling.
- ✅ Comportamiento al volver online y al volver a foco se preserva (se ejecutan los callbacks inmediatamente).

## Cómo verificar manualmente

1. Abrir la app, hacer login, ir al dashboard.
2. Abrir DevTools → Network. Filtro `libsql` o `turso`.
3. Esperar 30s con la tab visible: aparecen requests de polling (dashboard, alertas, caja).
4. Cambiar a otra pestaña 2 min: **no debe haber requests nuevos**.
5. Volver a la tab: aparece UN burst de requests (re-ejecución inmediata) y luego se estabiliza.
6. Hacer una venta: aparece un burst inmediato (sync, dashboard, caja).
7. Desconectar red (DevTools → offline): polling se pausa, no spam de errores.
8. Reconectar: aparece burst inmediato.
