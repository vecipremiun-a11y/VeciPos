# FASE 3 — Concurrencia de stock con UPDATE condicional

## Qué cambió

### `src/store/useStore.js` → `addSale()`

Antes:
```js
// UPDATE incondicional: dos cajas concurrentes podían dejar stock < 0
UPDATE products SET stock = ROUND(stock - ?, 3), pending_adjustment = ...
WHERE id = ? AND company_id = ?

UPDATE product_lots SET quantity = ROUND(quantity - ?, 3) WHERE id = ?
```

Ahora:
```js
// Solo si NO se permite stock negativo (inventoryAdjustmentMode === false):
UPDATE products SET stock = ROUND(stock - ?, 3), pending_adjustment = ...
WHERE id = ? AND company_id = ? AND stock >= ?

UPDATE product_lots SET quantity = ROUND(quantity - ?, 3)
WHERE id = ? AND quantity >= ?
```

Y después del `Promise.all` de UPDATEs:
- Se inspecciona `rowsAffected` de cada UPDATE.
- Si alguno = 0, significa que **otra caja vendió el último ítem entre la pre-validación y este UPDATE** → se hace `tx.rollback()` y se retorna:
  ```
  { success: false, error: 'CONCURRENT_STOCK', message: 'Stock insuficiente (otra caja vendió primero): <nombres>' }
  ```

### Respeto al modo de ajuste
Si `inventoryAdjustmentMode === true` (la empresa permite stock negativo intencionalmente, por ejemplo cuando entra stock en pre-venta), el comportamiento es **idéntico al anterior**: UPDATE sin guarda, sin validación de `rowsAffected`. Cero cambios funcionales para ese caso de uso.

## Impacto esperado
- **Elimina la race condition**: dos cajas concurrentes ya no pueden ambas descontar el último stock.
- El usuario afectado recibe un error claro y la venta se aborta atómicamente (transacción revertida → no quedan ventas huérfanas ni stock inconsistente).
- Latencia: cero. La guarda se evalúa en el mismo UPDATE — no agrega round-trips.

## Riesgos
- **Falsos rechazos en condiciones extremas**: si el código de la app calcula la cantidad a deducir con redondeo distinto al de la DB, `stock >= ?` podría rechazar por diferencias de 0.001. Mitigación: el SQL usa los mismos `ROUND(..., 3)` que el código de la app y el cálculo de `quantityToDeduct` se hace antes con el mismo `parseFloat`. Probado con build OK.
- **Combos**: la guarda aplica también a productos componentes. Si un combo deja un componente sin stock por concurrencia, se rechaza el combo entero (correcto: un combo a medio-vender es peor que un rechazo).
- **Modo `inventoryAdjustmentMode = true`**: NO se aplica guarda (intencional). Si la empresa lo activó es porque acepta stock negativo (preventas, ventas con reposición pendiente, etc.).

## Compatibilidad verificada
- ✅ SII: el flujo de emisión DTE corre DESPUÉS del commit; si rolleback ocurre, no se emite DTE.
- ✅ WooCommerce / APIs: igual al SII — los hooks de integración se ejecutan post-commit.
- ✅ Impresión: el ticket no se imprime si la venta no concluye.
- ✅ Historial de ventas: solo se persisten ventas exitosas.
- ✅ Dexie offline / sync offline: la ruta offline (`_addSaleOffline`) NO se vio afectada (el cambio es exclusivo del path online dentro de la transacción Turso).
- ✅ JSON `sales.items`: intacto. El INSERT de la venta no cambió.
- ✅ `npm run lint`: sin errores nuevos.
- ✅ `npm run build`: build de producción OK (`✓ 4053 modules transformed`).
- ✅ `npm run dev`: arranca en 2.2s sin errores.

## Cómo probar el caso concurrente (manual)
1. Abrir 2 ventanas de POS con la misma empresa y mismo producto cuyo `stock = 1` y `inventoryAdjustmentMode = false`.
2. Agregar el ítem al carrito en ambas.
3. Finalizar la venta en la ventana A → debe completarse.
4. Finalizar la venta en la ventana B → debe rechazarse con `CONCURRENT_STOCK`.
5. Stock final: 0 (no -1).

Si la empresa tiene `inventoryAdjustmentMode = true`, ambas ventas se completan y el stock queda en -1 (comportamiento esperado e intencional para preventas).
