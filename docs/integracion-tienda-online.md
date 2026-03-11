# Integración API POSKEM ↔ Tienda Online

Fecha: 2026-03-07

## 1) Base URL

Usar la URL pública donde está desplegado el proyecto (ejemplo):

- `https://tu-dominio.com`

Rutas externas implementadas:

- `GET /api/external/ping`
- `GET /api/external/products`
- `POST /api/external/products`
- `PUT /api/external/products`
- `DELETE /api/external/products`
- `PATCH /api/external/product-stock`
- `PATCH /api/external/product-price`
- `POST /api/external/orders`
- `PATCH /api/external/orders`

---

## 2) Autenticación

- **Tipo:** `Bearer`
- **Dónde va:** Header `Authorization`
- **Formato:** `Authorization: Bearer <EXTERNAL_API_KEY>`
- **Variable backend:** `EXTERNAL_API_KEY`

No hay OAuth/Basic/API-key por query.

---

## 3) API de lectura

## `GET /api/external/ping`

```bash
curl -X GET "https://tu-dominio.com/api/external/ping" \
  -H "Authorization: Bearer TU_EXTERNAL_API_KEY"
```

Response 200:

```json
{
  "success": true,
  "service": "PosVeci",
  "version": "1.0.0",
  "timestamp": "2026-03-07T12:00:00.000Z"
}
```

## `GET /api/external/products`

Query soportado:

- `category` (opcional)
- `limit` (opcional, 1..10000)
- `offset` (opcional)
- `updated_since` (opcional, ISO)

`updated_since` es **incremental real** porque el endpoint garantiza `updated_at` y filtra por ese campo.

```bash
curl -X GET "https://tu-dominio.com/api/external/products?updated_since=2026-03-07T00:00:00.000Z&limit=100&offset=0" \
  -H "Authorization: Bearer TU_EXTERNAL_API_KEY"
```

Response 200:

```json
{
  "success": true,
  "total": 1,
  "synced_at": "2026-03-07T12:00:00.000Z",
  "incremental_supported": true,
  "products": [
    {
      "pos_id": "154",
      "sku": "7791234567890",
      "barcode": "7791234567890",
      "name": "Coca Cola 1.5L",
      "sale_price": 2200,
      "cost_price": 1600,
      "stock": 18,
      "category": "Bebidas",
      "image_url": "https://cdn.tienda.com/img/154.jpg",
      "image_base64": null,
      "image_format": "public_url",
      "unit": "un",
      "is_active": true,
      "updated_at": "2026-03-07T11:59:00.000Z",
      "created_at": "2026-03-01T10:00:00.000Z"
    }
  ]
}
```

---

## 4) API de escritura

## `POST /api/external/products` (crear producto)

Request ejemplo:

```bash
curl -X POST "https://tu-dominio.com/api/external/products" \
  -H "Authorization: Bearer TU_EXTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "7791234567890",
    "name": "Coca Cola 1.5L",
    "sale_price": 2200,
    "cost_price": 1600,
    "stock": 18,
    "category": "Bebidas",
    "unit": "un",
    "image_url": "https://cdn.tienda.com/img/cc-15l.jpg"
  }'
```

Response 201:

```json
{
  "success": true,
  "product": {
    "pos_id": "154",
    "sku": "7791234567890",
    "barcode": "7791234567890",
    "name": "Coca Cola 1.5L",
    "sale_price": 2200,
    "cost_price": 1600,
    "stock": 18,
    "category": "Bebidas",
    "image_url": "https://cdn.tienda.com/img/cc-15l.jpg",
    "image_base64": null,
    "image_format": "public_url",
    "unit": "un",
    "is_active": true,
    "updated_at": "2026-03-07T12:10:00.000Z",
    "created_at": "2026-03-07T12:10:00.000Z"
  },
  "webhook": {
    "sent": true,
    "status": 200,
    "ok": true,
    "response": "ok"
  }
}
```

## `PUT /api/external/products` (editar producto)

Identificación por `pos_id` o `sku`.

```json
{
  "pos_id": "154",
  "name": "Coca Cola 1.5L Retornable",
  "sale_price": 2100,
  "category": "Bebidas"
}
```

## `PATCH /api/external/product-stock` (actualizar stock)

```json
{
  "pos_id": "154",
  "stock": 22,
  "reason": "sync_from_store"
}
```

## `PATCH /api/external/product-price` (actualizar precio)

```json
{
  "sku": "7791234567890",
  "sale_price": 2300,
  "is_offer": false
}
```

## `DELETE /api/external/products` (desactivar/eliminar)

- Soft delete (default):
  - `DELETE /api/external/products?pos_id=154`
- Hard delete:
  - `DELETE /api/external/products?pos_id=154&mode=hard`

---

## 5) Pedidos / ventas

## `POST /api/external/orders` (crear pedido/venta)

```bash
curl -X POST "https://tu-dominio.com/api/external/orders" \
  -H "Authorization: Bearer TU_EXTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "external_order_id": "WEB-100045",
    "status": "pending",
    "client_name": "Juan Pérez",
    "items": [
      {"pos_id":"154", "sku":"7791234567890", "name":"Coca Cola 1.5L", "quantity":2, "price":2200},
      {"pos_id":"211", "sku":"7802800001111", "name":"Pan Molde", "quantity":1, "price":1800}
    ],
    "payment_method": "webpay"
  }'
```

Response 201:

```json
{
  "success": true,
  "order": {
    "order_id": "9821",
    "external_order_id": "WEB-100045",
    "status": "pending",
    "total": 6200,
    "company_id": "default",
    "date": "2026-03-07T12:20:00.000Z",
    "client_name": "Juan Pérez",
    "items": [
      {"line":1,"pos_id":"154","sku":"7791234567890","name":"Coca Cola 1.5L","quantity":2,"price":2200,"subtotal":4400},
      {"line":2,"pos_id":"211","sku":"7802800001111","name":"Pan Molde","quantity":1,"price":1800,"subtotal":1800}
    ]
  }
}
```

## `PATCH /api/external/orders` (actualizar estado)

```json
{
  "external_order_id": "WEB-100045",
  "status": "paid",
  "observation": "Pago confirmado por tienda online"
}
```

---

## 6) Webhook de catálogo/POS (saliente)

El POS envía webhooks al configurar:

- `EXTERNAL_WEBHOOK_URL` (o `EXTERNAL_OUTBOUND_WEBHOOK_URL`)
- `EXTERNAL_WEBHOOK_SECRET` (opcional para firma HMAC)

Headers enviados:

- `x-poskem-event`
- `x-poskem-timestamp`
- `x-poskem-signature` (si hay secret)

Firma:

- algoritmo: `HMAC-SHA256`
- base string: `${timestamp}.${raw_body_json}`
- digest: hex

Eventos emitidos:

- `product.created`
- `product.updated`
- `product.deactivated`
- `product.deleted`
- `product.stock_updated`
- `product.price_updated`
- `order.created`
- `order.status_updated`

### Ejemplo real de payload webhook: `product.stock_updated`

```json
{
  "event": "product.stock_updated",
  "timestamp": "2026-03-07T12:25:00.000Z",
  "source": "poskem",
  "company_id": "default",
  "product": {
    "pos_id": "154",
    "sku": "7791234567890",
    "barcode": "7791234567890",
    "name": "Coca Cola 1.5L",
    "sale_price": 2200,
    "cost_price": 1600,
    "stock": 22,
    "category": "Bebidas",
    "image_url": "https://cdn.tienda.com/img/cc-15l.jpg",
    "image_base64": null,
    "image_format": "public_url",
    "unit": "un",
    "is_active": true,
    "updated_at": "2026-03-07T12:25:00.000Z",
    "created_at": "2026-03-07T12:10:00.000Z"
  },
  "stock_change": {
    "from": 18,
    "to": 22,
    "reason": "sync_from_store"
  }
}
```

### Ejemplo real de payload webhook: `order.status_updated`

```json
{
  "event": "order.status_updated",
  "timestamp": "2026-03-07T12:30:00.000Z",
  "source": "poskem",
  "company_id": "default",
  "order": {
    "order_id": "9821",
    "external_order_id": "WEB-100045",
    "status": "paid",
    "previous_status": "pending",
    "total": 6200,
    "company_id": "default",
    "updated_at": "2026-03-07T12:30:00.000Z",
    "items": [
      {"line":1,"pos_id":"154","sku":"7791234567890","name":"Coca Cola 1.5L","quantity":2,"price":2200,"subtotal":4400},
      {"line":2,"pos_id":"211","sku":"7802800001111","name":"Pan Molde","quantity":1,"price":1800,"subtotal":1800}
    ]
  }
}
```

---

## 7) Imagen, SKU y posId

- `image_url`: soporta URL pública **o** base64.
- Si envías `image_base64`, se prioriza base64.
- Respuesta entrega:
  - `image_url` (si es URL)
  - `image_base64` (si se guardó base64)
  - `image_format`: `public_url | base64 | null`

IDs:

- `sku`: identificador comercial.
- `pos_id`: identificador estable del POS (mapea a `products.id`).

---

## 8) Códigos de error

Comunes:

- `400` payload inválido / faltan campos.
- `401` auth inválida.
- `404` recurso no encontrado.
- `405` método no permitido.
- `500` error interno.

---

## 9) Rate limits

No hay rate limiting explícito en código actualmente.

---

## 10) Archivos técnicos relevantes

- `api/external/ping.js`
- `api/external/products.js`
- `api/external/product-stock.js`
- `api/external/product-price.js`
- `api/external/orders.js`
- `api/external/_common.js`

Swagger/OpenAPI listo para compartir:

- `docs/openapi-external.yaml`
