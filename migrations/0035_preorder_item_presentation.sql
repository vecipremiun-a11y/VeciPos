-- Pedidos de la tienda web vendidos por caja: qué unidad de medida eligió el cliente.
--
-- EL PROBLEMA. miniveci.cl ya vende por Caja, Bandeja o Pack con las mismas
-- reglas del POS (migración 0030): el renglón llega en UNIDADES —2 cajas de 30
-- son 60 unidades a $250— y eso es lo que se separa de stock y se cobra. Pero en
-- la pestaña Tienda y en el ticket se veía "60 × $250", no "2 Caja (30 und)".
-- Y como $250 puede quedar por debajo del precio de oferta, esas 60 unidades se
-- contaban en el cupo de la oferta, cuando una caja nunca se vende a precio de
-- oferta (misma regla del POS).
--
-- CÓMO SE RESUELVE (contrato POSVECI-UNIDADES.md de miniveci, 17-oct-2026):
--   · presentation  JSON { pos_presentation_id, name, units, quantity, price }
--                   tal como lo manda la tienda (pos_presentation_id null = una
--                   caja creada en la tienda que el POS no tiene). NULL en los
--                   renglones por unidad.
--
-- Aditivo puro. Rollback: revertir el commit; la columna queda sin usar.

ALTER TABLE preorder_items ADD COLUMN presentation TEXT;
