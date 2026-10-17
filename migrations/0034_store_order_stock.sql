-- Pedidos de la tienda web: el stock se separa al llegar y la venta nace al cobrar.
--
-- EL PROBLEMA. Un pedido de miniveci.cl entraba a la pestaña Tienda sin mover el
-- stock de POSVECI, ni al llegar ni al entregarse. Mientras tanto el local podía
-- vender esa misma mercadería, y el stock que POSVECI le manda a la tienda
-- (absoluto) le borraba a miniveci.cl el descuento de su propia venta. Y un
-- pedido contra entrega se cerraba anotando un pago, sin venta ni boleta.
--
-- CÓMO SE RESUELVE (definido con Kevin el 8-oct-2026):
--   · stock_reserved  1 = el pedido tiene su stock separado en products.stock.
--                     Pasa a 0 UNA vez: al cancelarse (vuelve al stock) o justo
--                     antes de registrar la venta (la venta lo descuenta).
--   · reserved_items  exactamente qué se separó: [{productId, qty}]. Es lo que
--                     se devuelve, aunque el producto haya cambiado después.
--   · sale_id         la venta que se registró al cobrar (con su boleta o nota
--                     de venta). Un pedido con venta ya no cuenta para el cupo
--                     de la oferta por su renglón de pedido: cuenta la venta.
--   · payment_status  lo que dice miniveci.cl: 'paid' (pagado en la web) o
--                     'pending' (se cobra al entregar, o transferencia sin
--                     revisar). Pasa a 'paid' cuando el local confirma la
--                     transferencia (ahí nace la venta).
--   · payment_proof_url  el comprobante de transferencia que subió el cliente
--                     en la tienda: el local lo abre desde la pestaña Tienda.
--   · invoice_data    los datos de factura que dejó el cliente en el checkout
--                     ({rut, razon_social, giro, direccion, comuna, ciudad,
--                     email}). Con ellos el local hace la factura a mano desde
--                     la pestaña Tienda; sin ellos, la boleta.
--
-- Aditivo puro. Rollback: revertir el commit; las columnas quedan sin usar.

ALTER TABLE preorders ADD COLUMN stock_reserved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE preorders ADD COLUMN reserved_items TEXT;
ALTER TABLE preorders ADD COLUMN sale_id INTEGER;
ALTER TABLE preorders ADD COLUMN payment_status TEXT;
ALTER TABLE preorders ADD COLUMN payment_proof_url TEXT;
ALTER TABLE preorders ADD COLUMN invoice_data TEXT;
