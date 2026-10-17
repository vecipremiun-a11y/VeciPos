-- Envío a domicilio con pago al recibir: pedido que separa stock, venta al entregar.
--
-- EL PROBLEMA. "Enviar a domicilio" con "Al recibir" registraba la venta
-- completa en el momento de despachar, a Crédito del cliente. El 5-oct-2026 un
-- envío de $219.000 para el día siguiente (venta #1036161) quedó sumado en las
-- ventas y la caja de ese día, sin boleta, y sin fecha de entrega: solo una
-- nota "Entregar después de las 12pm".
--
-- CÓMO SE RESUELVE (definido con Kevin el 6-oct-2026):
--   · Al despachar se guarda el PEDIDO (productos, precios, cliente) en el envío,
--     con fecha y hora de entrega. No hay venta.
--   · El stock de esos productos se SEPARA: baja en ese momento y queda anotado
--     qué se separó (`reserved_items`), para devolver exactamente eso si se
--     anula o no se entrega.
--   · Al entregar, el repartidor cobra (efectivo, transferencia o tarjeta) y
--     elige boleta o nota de venta: ahí nace la venta, con el proceso de cobro
--     de siempre. Primero se libera lo separado y la venta descuenta stock y
--     lotes como cualquier venta.
--
-- Columnas:
--   scheduled_date / scheduled_time  cuándo se entrega (AAAA-MM-DD, HH:MM)
--   order_data      JSON del pedido: { items, client, total } (solo pedidos sin venta)
--   order_total     total de productos del pedido, sin despacho
--   client_id       cliente del pedido
--   reserved_items  JSON [{ productId, qty }] del stock separado
--   stock_reserved  1 mientras el stock está separado
--   sale_id         venta creada al entregar
--   sale_register_id caja en la que cayó esa venta, si el que cobró tenía una
--                   abierta: la rendición no vuelve a sumar ese efectivo
--   client_key      evita crear dos veces el mismo pedido (doble toque, reintento)
--
-- Aditivo puro. Los envíos existentes quedan igual. Rollback: revertir el
-- commit; las columnas quedan sin usar.

ALTER TABLE deliveries ADD COLUMN scheduled_date TEXT;
ALTER TABLE deliveries ADD COLUMN scheduled_time TEXT;
ALTER TABLE deliveries ADD COLUMN order_data TEXT;
ALTER TABLE deliveries ADD COLUMN order_total REAL;
ALTER TABLE deliveries ADD COLUMN client_id INTEGER;
ALTER TABLE deliveries ADD COLUMN reserved_items TEXT;
ALTER TABLE deliveries ADD COLUMN stock_reserved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN sale_id INTEGER;
ALTER TABLE deliveries ADD COLUMN sale_register_id INTEGER;
ALTER TABLE deliveries ADD COLUMN client_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_client_key
    ON deliveries (company_id, client_key)
    WHERE client_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deliveries_scheduled
    ON deliveries (company_id, scheduled_date);
