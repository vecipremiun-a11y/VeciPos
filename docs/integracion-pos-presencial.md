# Integración POSVECI → miniveci · Encargos presenciales

**Versión:** 1.0
**Estado:** POSVECI implementado · miniveci PENDIENTE
**Fecha:** 2026-05-24

## Contexto

POSVECI ya está integrado con miniveci en estos flujos:

| Flujo | Endpoint | Quién implementa | Estado |
|---|---|---|---|
| Crear encargo desde web | `POST {posveci}/api/external/preorders` | POSVECI | ✅ |
| Cancelar encargo desde web | `PATCH {posveci}/api/external/preorders` | POSVECI | ✅ |
| Cambio de estado del encargo | `PATCH {miniveci}/api/pos/bakery/orders/{public_code}/status` | miniveci | ✅ |
| Sync producto / stock / precio | `PUT {miniveci}/api/pos/products/*` | miniveci | ✅ |
| **Crear encargo presencial en miniveci** | `POST {miniveci}/api/pos/bakery/orders` | **miniveci** | ❌ **PENDIENTE** |

**Lo que falta:** un endpoint en miniveci para recibir encargos que el cajero crea presencialmente en POSVECI. Sin esto, los encargos presenciales NO aparecen en la cuenta web del cliente, y los cambios de estado tampoco le llegan.

POSVECI ya está listo del lado de él: al crear un encargo presencial, llama best-effort al endpoint miniveci propuesto acá. Mientras miniveci no lo implemente, el push falla silencioso (se loguea en `integration_sync_logs`) y no afecta el flujo del POS. Cuando miniveci lo implemente respetando este contrato, empieza a funcionar automático.

---

## Contrato del endpoint a implementar en miniveci

### Ruta

```
POST {tienda_url}/api/pos/bakery/orders
```

(Hermano "crear" del que ya existe para actualizar estado: `PATCH /api/pos/bakery/orders/{public_code}/status`.)

### Autenticación

Mismos headers que ya usa POSVECI para los otros endpoints (`/api/pos/products/*` y `/status`). El secreto está en `tienda_config` de POSVECI:

```
x-api-key:            <api_key de la tienda>
x-api-secret:         <api_secret de la tienda>
x-api-consumer-key:   <api_key de la tienda>  (alias por compatibilidad)
x-api-consumer-secret: <api_secret de la tienda>
Content-Type:         application/json
```

Si los headers no coinciden con la config de la tienda → `401 Unauthorized`.

### Body (request)

```json
{
  "external_order_id": "posveci_4321",
  "source": "posveci_presencial",
  "client": {
    "external_id": "uuid-del-cliente-en-miniveci-si-se-conoce",
    "rut": "12345678-9",
    "phone": "+56912345678",
    "email": "cliente@ejemplo.cl",
    "name": "Juan Pérez"
  },
  "scheduled_for": "2026-05-25T10:00:00",
  "method": "pickup",
  "address": null,
  "items": [
    {
      "product_external_id": "57",
      "product_name": "Pan de Completo 1kg",
      "quantity": 15,
      "unit": "Und",
      "pricing_mode": "kg",
      "unit_price": 2500,
      "line_subtotal": 37500,
      "grams_per_unit": 80,
      "note": null
    }
  ],
  "subtotal": 37500,
  "delivery_fee": 0,
  "total": 37500,
  "deposit": 0,
  "payment_method": null,
  "general_notes": "Cliente recoge en la tarde"
}
```

#### Detalle de campos del request

| Campo | Tipo | Descripción |
|---|---|---|
| `external_order_id` | string, requerido | ID idempotente generado por POSVECI (formato `posveci_{preorder_id}`). Si llega el mismo dos veces, miniveci debe devolver el mismo `public_code` (idempotencia). |
| `source` | string | Siempre `"posveci_presencial"` para identificar el origen. |
| `client.external_id` | string nullable | ID del cliente en miniveci si POSVECI ya lo conoce (porque pidió por web antes). Puede ser null para clientes nuevos. |
| `client.rut`, `phone`, `email`, `name` | string nullable | Identificadores adicionales. Miniveci debe usarlos para hacer match con cuentas existentes (ver lógica abajo). Al menos uno de estos cuatro vendrá poblado (POSVECI no manda si todos son null). |
| `scheduled_for` | string ISO 8601 (sin zona) | Fecha + hora de entrega, hora local de la panadería. Ej: `"2026-05-25T10:00:00"`. |
| `method` | `"pickup"` \| `"delivery"` | Tipo de entrega. |
| `address` | string nullable | Solo si `method = "delivery"`. |
| `items[]` | array, requerido (≥1) | Detalles abajo. |
| `items[].product_external_id` | string nullable | El `id` de POSVECI del producto, o el `external_id` si miniveci tiene mapeo. Útil para asociarlo a un producto del catálogo de miniveci. |
| `items[].product_name` | string | Nombre que muestra POSVECI (fallback si no se mapea por id). |
| `items[].quantity` | number | Cantidad. Para `pricing_mode: "kg"`, esto es el conteo de unidades (ej. "15 panes"); el peso real se conoce solo al entregar. |
| `items[].unit` | string | "Und", "kg", etc. (escala de `quantity`). |
| `items[].pricing_mode` | `"unit"` \| `"kg"` | Si el precio es por unidad o por kg. |
| `items[].unit_price` | number | Precio por unidad (si `unit`) o por kg (si `kg`). |
| `items[].line_subtotal` | number | Subtotal estimado de la línea. Para `kg`, es estimación basada en `grams_per_unit`. |
| `items[].grams_per_unit` | number | Solo para `kg`. Gramaje aproximado por unidad para estimar peso total. |
| `items[].note` | string nullable | Nota específica del item. |
| `subtotal` | number | Suma de items antes de delivery. |
| `delivery_fee` | number | Cargo de delivery (0 si pickup). |
| `total` | number | Total esperado (subtotal + delivery_fee). |
| `deposit` | number | Abono ya cobrado en POSVECI al crear. |
| `payment_method` | string nullable | Método del abono (Efectivo, Tarjeta, Transferencia) si hubo. |
| `general_notes` | string nullable | Nota general del encargo. |

### Response

#### 200 / 201 — Encargo creado o ya existente (idempotencia)

```json
{
  "success": true,
  "public_code": "MNV-A7K3X9",
  "external_order_id": "posveci_4321",
  "customer_id": "777",
  "duplicate": false
}
```

| Campo | Descripción |
|---|---|
| `public_code` | Código corto generado por miniveci. POSVECI lo guarda en `preorders.external_public_code` y lo usa para los cambios de estado posteriores (`PATCH .../{public_code}/status`). |
| `customer_id` | **IMPORTANTE — el ID único de la cuenta de miniveci** con la que quedó asociado el encargo (cuando matcheó/usó una cuenta REAL). POSVECI lo guarda en `clients.external_id` → así el cliente presencial queda amarrado a su cuenta web por ID exacto y permanente (los próximos pedidos ya no dependen del match por rut/teléfono/email). En guest orders (sin cuenta real) va `null`. |
| `external_order_id` | Devolver el mismo que llegó, por confirmación. |
| `duplicate` | `true` si `external_order_id` ya existía (idempotencia: devolver el mismo `public_code` que la primera vez). |

#### 400 — Body inválido
```json
{ "success": false, "error": "Missing items" }
```

#### 401 — Auth inválida
```json
{ "success": false, "error": "Unauthorized" }
```

#### 200 con `unclaimed: true` — Guest order (sin match de cuenta)
Si ningún identificador hace match con un customer existente, NO devolver 422.
Crear igual el order en miniveci como "guest/unclaimed order" con los
identificadores recibidos (rut, email, phone, name) y devolver:
```json
{
  "success": true,
  "public_code": "MNV-A7K3X9",
  "external_order_id": "posveci_4321",
  "customer_id": null,
  "unclaimed": true
}
```
En guest orders `customer_id` va `null` (todavía no hay cuenta real → no hay
ID que amarrar). POSVECI guarda el `public_code` igual → los cambios de estado
siguen sincronizándose. Más tarde, cuando un cliente se registre con esos
identificadores, miniveci debe ejecutar un "claim" que asigne los guest
orders correspondientes a su cuenta (ver sección "Política de match" abajo).

#### 500 — Error interno
```json
{ "success": false, "error": "Internal error" }
```

### Lógica esperada en miniveci

1. **Auth:** validar headers contra la tienda; si no matchean → 401.
2. **Idempotencia:** si ya existe un order con ese `external_order_id` → devolver el `public_code` original con `duplicate: true`.
3. **Match de cliente** (en este orden, primer match gana):
   1. `client.external_id` si está presente → buscar account por id
   2. `client.rut` → buscar account por RUT
   3. `client.phone` (normalizado, sin espacios/guiones, prefijo país opcional) → buscar account por teléfono
   4. `client.email` (lowercase, trim) → buscar account por email
4. **Si HAY match:** crear el order asociado a esa account, devolver `public_code`. Listo.
5. **Si NO hay match → patrón "guest order con deferred claim" (RECOMENDADO):**
   - NO crear cuenta automática (ensucia la base con cuentas fantasma).
   - SÍ crear el order como **guest/unclaimed order** con los identificadores recibidos guardados (rut, email, phone, name).
   - Devolver `200 OK` con `public_code` válido + `unclaimed: true`.
   - POSVECI seguirá sincronizando cambios de estado normal usando ese `public_code`.

#### Proceso "claim unclaimed orders" (esencial para que la idea funcione)

Cuando un cliente se registra en miniveci (o agrega/edita un identificador en una cuenta existente), disparar un proceso que busca guest orders matcheables y los asigna a la cuenta:

- **Prioridad de match para claim** (más confiable a menos):
  1. **RUT** ← más confiable (único por ley en Chile).
  2. **Email** (lowercase, trim) ← muy confiable.
  3. **Teléfono** (normalizado) ← bueno.
  4. **Nombre solo** ← NO usar para claim automático (ambiguo).
- Al encontrar matches: asignar los guest orders a la cuenta. Aparecen retroactivos en "Mis pedidos".
- Idempotente: si se vuelve a correr, no asignar dos veces.

#### Alternativas (no recomendadas)

- **Crear cuenta auto en el push:** ensucia la base, el cliente nunca activa esas cuentas. Evitar.
- **422 client_not_matched:** se pierde data útil. Evitar salvo que haya razones legales.

6. **Generar `public_code`** corto y único (el mismo formato que usás para órdenes web).
7. **Responder** según los casos arriba.

### Cambios de estado posteriores

Una vez que miniveci devuelve `public_code`, POSVECI lo guarda en `preorders.external_public_code`. **Sin trabajo adicional:** cuando el panadero cambia el estado en POSVECI (confirmar, preparar, listo, entregar, cancelar), POSVECI ya dispara automáticamente `PATCH {miniveci}/api/pos/bakery/orders/{public_code}/status` con el nuevo estado, y miniveci actualiza el order en la cuenta del cliente (esto ya funciona hoy, solo aplicado a otros encargos).

---

## Verificación end-to-end (cuando miniveci implemente)

1. **Cliente con cuenta web ya existente:** desde el POS, crear un encargo presencial seleccionando ese cliente. Verificar:
   - Aparece en su cuenta web bajo "Mis pedidos".
   - Cambiar el estado en POSVECI (confirmar, preparar, listo) → se ve en vivo en la web.
2. **Cliente sin cuenta web:** crear encargo presencial con un cliente nuevo. Verificar que miniveci crea la cuenta (o no, según política elegida).
3. **Idempotencia:** repetir manualmente el push del mismo encargo. Verificar que NO se duplica en miniveci.
4. **Integración off:** desactivar `tienda_config.is_active` y crear un encargo. Verificar que POSVECI no llama a miniveci (logueado como `skipped: integration_not_configured`).

POSVECI loguea cada intento en `integration_sync_logs` con `event = 'bakery_order.push_presencial'` para auditoría.

---

## Implementación POSVECI (referencia)

- Endpoint: `api/integration/push-preorder.js`
- Hook que lo dispara: `src/store/useStore.js` → `createPreorder` (fire-and-forget al finalizar).
- Notificación de estado: `src/store/useStore.js` → `updatePreorderStatus` ya disparaba para encargos miniveci-originated; ahora dispara para **cualquier** preorder con `external_public_code` (incluidos los presenciales-pushed).
