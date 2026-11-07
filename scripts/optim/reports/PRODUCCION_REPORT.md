# Producción — Fase 1: insumos, recetas y costo de fabricación

**Fecha:** 6-nov-2026 · **Estado:** sale en la v3.1 (7-nov-2026) · **Migración:** 0038

## Qué pidió Kevin

Calcular cuánto le cuesta fabricar lo que vende (pan de completo, empanadas,
chaparritas…) con los insumos de su inventario, y desde ahí poner el precio.
El ejemplo fue el saco de harina Morro: 25 kg a unos $13.400, cargado en "Und".

Decisiones de Kevin:
- La pantalla vieja de `/production` (encargos del día) se llama **Cocina**. La nueva pestaña se llama **Producción**.
- La receta usa el **costo + IVA** de cada insumo, nunca el precio de venta.

## Cómo quedó

**Ficha del producto, tarjeta "Producción"** (antes de Precios y Margen). Tiene dos interruptores independientes:

1. **Se usa como insumo.**
   - Pide cuánto trae una unidad: número y unidad (g, kg, ml, L o und). Lo propone leyendo el nombre ("Harina Morro 25 kg" → 25 kg).
   - Pide la merma en %, opcional.
   - Muestra el desglose: `$17.374 la unidad → $695 el kg → $0,69 el g`.
   - Un producto por Kg o Lt no necesita contenido.
2. **Lo fabrico yo (tiene receta).**
   - Se carga cuánto rinde la tanda, los insumos (con buscador) y otros costos fijos por tanda (gas, luz, mano de obra).
   - Calcula el costo de la tanda y el costo por unidad.
   - Si un insumo en "Und" no tiene contenido, se le carga ahí mismo y queda guardado en su ficha al instante.
   - **Usar como costo** escribe en Costo ($) el costo de la receta **sin el IVA de ese producto**. Así su fila "Costo + IVA" muestra exactamente el costo de la receta y el precio queda `costo receta × (1 + utilidad)`: el IVA no se cuenta dos veces.
   - **El precio de venta no se mueve solo.** Si ya había precio, se recalcula la utilidad; si no había precio pero sí utilidad, se calcula el precio.

**Pestaña Producción** (`/recetas`, menú Inventario → Producción, permiso `recetas.view`):
- Cada producto fabricado muestra:
  - el costo por unidad según la receta
  - el costo + IVA que dice su ficha
  - el precio
  - la utilidad real
- Cada uno tiene un estado: al día, la receta subió, la receta bajó o receta incompleta.
- Desde la tarjeta se abre la ficha para actualizar el costo.
- Abajo, la lista de insumos con su costo por kg, L o unidad, y en cuántas recetas se usa cada uno.

Ejemplo verificado (solo la harina es de Kevin; el resto son números de ejemplo, con IVA):

| | |
|---|---|
| Harina 5 kg + levadura 100 g + sal 100 g + manteca 250 g + gas $500 | tanda $4.705 |
| Rinde 100 panes | $47,05 por pan |
| Usar como costo | Costo $39,54 → Costo + IVA $47 |
| Utilidad 100% | precio $94,11 |

## Decisiones técnicas

- **Tabla aparte (`product_production`), no columnas en `products`.**
  - Toda columna agregada con ALTER queda después de la foto en base64 de la fila. Leerla obliga a recorrer la foto entera.
  - La pestaña lee solo esta tabla chica.
  - El catálogo offline del POS no cambia.
- **El costo no se copia a la receta.** Sale siempre del Costo de la ficha de cada insumo, que es el que actualizan las compras. Una receta nunca queda con un precio viejo.
- **Se guarda con el botón Guardar de siempre.** Viaja como `_produccion` dentro del alta o la edición del producto, y solo si cambió.
  - Se guarda en una sentencia aparte. Si esa parte falla, el producto queda guardado igual y se muestra un aviso.
  - Si la ficha no pudo cargar la receta, al guardar no se manda nada de producción: no se puede pisar lo que no se vio.
- **Lo que valida el servidor:**
  - Un insumo de otra empresa no entra en una receta.
  - Un producto no puede ser insumo de sí mismo.
  - Merma con tope de 95%.
  - Máximo 40 líneas y 10 otros costos por receta.
- **Al borrar un producto** se borra también su fila de producción. La receta que lo usaba lo muestra como "producto borrado".
- **Permiso `recetas.view`:**
  - El dueño y los administradores lo tienen sin configurar nada.
  - Cualquier otro rol hay que activarlo en Permisos, porque muestra costos y márgenes.
  - La clave no es `production` porque esa ya es de Cocina.

**No se tocó:** venta, SII, tienda (WooCommerce y MiniVeci), impresión, checkout y sincronización offline.
- En el store solo cambia lo que devuelven `addProduct` y `updateProduct` (se agrega `avisoProduccion`).
- La Fase 1 no mueve stock.

## Pruebas

- `node scripts/optim/test-produccion-recetas.mjs` → **Todo OK**.
  - Las cuentas, el ejemplo de arriba, los errores y avisos, y el contenido sacado del nombre (13 casos).
  - El servidor contra una base local: alta, edición parcial, aislamiento entre empresas, buscador, pestaña, `saveInput`, borrar, y la tabla inexistente (el producto igual se guarda).
- Navegador (Puppeteer + Vite):
  - Ficha: 47/47 en PC y celular de 360 px, sin scroll a lo ancho.
  - Pestaña: 21/21.
- Siguen pasando: `test-impuestos-producto`, `test-caja-precio-libre`, `test-sii-precio-decimal`, y los arneses de impuestos (42/42 y 8/8).
- `npm run build` OK. eslint sin errores; los avisos que salen ya estaban.

No se midió contra producción: no se leyó ninguna base real.

## Para desplegar

1. **Antes del push:** `npm run migrate-all -- --apply`, que aplica 0037 y 0038, y después `npm run verify-all`.
   - 0038 es aditiva: `CREATE TABLE IF NOT EXISTS`.
   - Si el push se adelantara a la migración, la ficha diría "No se pudo cargar la receta" y el producto se seguiría guardando igual.
2. Commit propio para esta fase. Push, y APK con la versión que sigue.

## Rollback

- Revertir el commit. La tabla `product_production` queda sin usar.
- Si se quiere borrar del todo: `DROP TABLE product_production`. Nada más la lee.

## Siguiente (Fase 2, sin empezar)

- **Registrar una tanda:** "hice 100 panes" descuenta los insumos (0,2 sacos) y suma el producto. Toca stock, así que va con su propio diseño y su propia prueba.
- **Recetas dentro de recetas** (masa base, relleno). Hoy ya funciona con un nivel: un insumo que se fabrica aporta el costo de su ficha.

## Nota aparte

Los comentarios de `api/data/actions.js` nombran una migración 0026 de índices de cobertura (`idx_products_company_sync_covering`). Ese archivo no está en `migrations/` ni en la historia de git, así que probablemente ese índice no existe en producción.
- Sin índice, la descarga del catálogo ya lee la fila completa, y `extra_taxes` (0037) no le suma costo.
- Si algún día se crea el índice, tiene que incluir `extra_taxes`.
