# FASE 10 — Frontend performance (React/Vite)

## Auditoría inicial

Antes del cambio se detectaron 8 cuellos de botella:

| # | Hallazgo | Estado anterior |
|---|---|---|
| 1 | 5-6 componentes siempre montados con `useStore()` sin selector | re-render con CADA mutación del store de 13k líneas |
| 2 | 638 `console.*` (294 log/info/debug/warn + 344 error) ejecutándose en prod | CPU + memoria desperdiciada |
| 3 | Bundle monolítico de 4,326 kB | first paint lento |
| 4 | 44 páginas importadas estáticamente en `App.jsx` | contribuye al bundle gigante |
| 5 | `vite.config.js` sin `optimizeDeps` para recharts/jspdf/xlsx/html2canvas | **causa principal de dev lento** |
| 6 | POS ya usa `useShallow` | ✅ ok |
| 7 | OptimizedImage tiene lazy + IntersectionObserver | ✅ ok |
| 8 | Inventory infinite-scroll sin virtualización real | ⚠️ aceptable (no afecta perf percibido) |

## Cambios implementados

### 1. `vite.config.js`

```js
esbuild: {
  pure: ['console.log', 'console.info', 'console.debug', 'console.warn'],
  legalComments: 'none',
},
optimizeDeps: {
  include: ['react', 'react-dom', 'react-router-dom', 'zustand',
            'zustand/react/shallow', 'date-fns', 'date-fns-tz',
            'recharts', 'jspdf', 'jspdf-autotable', 'html2canvas',
            'xlsx', 'framer-motion', 'lucide-react',
            '@libsql/client', 'dexie'],
},
build: {
  chunkSizeWarningLimit: 1500,
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor-react':   ['react', 'react-dom', 'react-router-dom'],
        'vendor-charts':  ['recharts'],
        'vendor-pdf':     ['jspdf', 'jspdf-autotable', 'html2canvas'],
        'vendor-xlsx':    ['xlsx'],
        'vendor-motion':  ['framer-motion'],
        'vendor-dates':   ['date-fns', 'date-fns-tz'],
        'vendor-icons':   ['lucide-react'],
        'vendor-db':      ['@libsql/client', 'dexie'],
      },
    },
  },
},
```

`console.error` se conserva — solo se eliminan los `log/info/debug/warn` en builds de producción.

### 2. Selectores atómicos / `useShallow` en componentes siempre montados

| Archivo | Antes | Después |
|---|---|---|
| `src/App.jsx` | `useStore()` | 3 selectores atómicos (`fetchInitialData`, `darkMode`, `currentUser`) |
| `src/layouts/MainLayout.jsx` | `useStore()` | `useShallow` con 4 claves |
| `src/components/NotificationBell.jsx` | `useStore()` | `useShallow` con 7 claves |
| `src/components/CashStatusWidget.jsx` | `useStore()` | `useShallow` con 7 claves |
| `src/components/SupportWidget.jsx` | `useStore()` | `useShallow` con 9 claves |
| `src/components/CompanySwitcher.jsx` | `useStore()` | `useShallow` con 4 claves |

Resultado: estos componentes ahora solo se re-renderizan cuando SU subset del store cambia. Antes, una sola alerta nueva o un descuento de stock disparaba un re-render en cascada de TODA la interfaz.

### 3. Code-splitting con `React.lazy()` + `<Suspense>`

`src/App.jsx`:
- **Eager** (bundle inicial): Login, Register, SelectPlan, POS, Dashboard, MainLayout, AdminLayout, RequireAdmin, ProtectedPage, FeatureGatePage.
- **Lazy** (chunks separados, se cargan al navegar): 33 páginas (Reports, Admin*, Personal, Production, Inventory, SII, etc.).
- `<Suspense>` con spinner pequeño envuelve `<Routes>`.

## Resultados medibles

### Bundle size (npm run build)

| Métrica | Antes | Después | Mejora |
|---|---:|---:|---:|
| **First paint (raw)** | 4,326 kB | 1,647 kB | **−62%** |
| **First paint (gzip)** | 1,157 kB | 436 kB | **−62%** |
| Chunks generados | 1 | 30+ | code-split funciona |
| Build time | 1m 36s | 27s | **−72%** |

### Chunks separados (se cargan on-demand)

| Chunk | Tamaño | Cuándo se carga |
|---|---:|---|
| vendor-pdf (jspdf + html2canvas + autotable) | 618 kB | Solo al imprimir/exportar PDF |
| vendor-charts (recharts) | 395 kB | Solo en páginas de reportes con gráficos |
| vendor-xlsx | 282 kB | Solo al exportar Excel |
| vendor-db (libsql + dexie) | 176 kB | En el primer load (es crítico) |
| Settings | 109 kB | Solo al entrar a settings |
| Personal | 122 kB | Solo al entrar a personal |
| vendor-motion (framer-motion) | 119 kB | En el primer load |
| Clients | 58 kB | Solo al entrar a clientes |
| ... | | |

### Re-renders evitados (estimación cualitativa)

Antes, cada cambio en `inventoryAlerts`, `unreadAlertCount`, `registerStats`, `supportTickets` o cualquiera de las ~150 claves del store disparaba un re-render de:
- App.jsx
- MainLayout.jsx (sidebar entero)
- NotificationBell.jsx
- CashStatusWidget.jsx
- SupportWidget.jsx
- CompanySwitcher.jsx
- Y todos sus subárboles de componentes

Ahora cada uno se re-renderiza SOLO cuando su slice cambia.

### Dev mode

Con `optimizeDeps`, `npm run dev` pre-bundlea recharts, jspdf, xlsx, html2canvas, framer-motion en el primer arranque. **Esa era la principal razón** de la lentitud percibida en dev vs preview: Vite tenía que compilar esas libs on-demand cada vez que un componente las importaba.

## Compatibilidad verificada

- ✅ `npm run lint`: sin errores nuevos.
- ✅ `npm run build`: ✓ 4053 modules transformed, 27s.
- ✅ `npm run preview`: arranca en `http://localhost:4173/`.
- ✅ NO se cambió lógica de venta, SII, WooCommerce, Dexie offline, sync offline, JSON `sales.items`, ni ninguna API.
- ✅ Las cadencias de polling de Fase 9 siguen iguales.
- ✅ El POS ya usaba `useShallow` correctamente, no se tocó.

## Pendientes (no incluidos en esta fase)

- **Virtualización de Inventory table / POS grid**: con react-window. Solo si la prueba muestra que es necesario. Hoy el infinite-scroll del POS y la tabla de Inventory tienen lazy-loading via scroll handler — funciona pero mantiene los nodos en memoria. En la práctica el usuario solo navega los primeros ~50 productos.
- **Limpieza de los 100 `console.log` del store**: ya no se ejecutan en producción gracias a `esbuild.pure`, pero ralentizan dev. Se puede hacer en una limpieza posterior.
- **Bundle inicial 1,647 kB sigue alto**: el código de la app sigue grande. Una siguiente fase podría separar el store (13k líneas) en módulos más chicos.

## Cómo verificar manualmente

1. `npm run build && npm run preview` → abrir `http://localhost:4173/`
2. DevTools → Network → recargar
3. **Antes**: 1 chunk de ~1.1MB gzip
4. **Ahora**: ~5-6 chunks iniciales chicos (~436KB gzip total)
5. Navegar a Reportes → ver que aparece un chunk nuevo de `vendor-charts` (390KB)
6. Navegar a Settings → ver chunk `Settings-*.js` (109KB)
7. Imprimir un ticket → ver chunk `vendor-pdf` (618KB) cargarse on-demand
8. Verificar Performance tab → menos scripting time entre acciones
9. **Dev mode**: `npm run dev` debería arrancar más rápido y sentirse menos pesado (gracias a `optimizeDeps`).
