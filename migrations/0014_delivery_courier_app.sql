-- 0014: app del repartidor — estado "aceptado" y constancia de entrega.
--
-- ESTADO NUEVO. El flujo pasa a tener una etapa más: el repartidor primero VE el
-- pedido asignado y lo ACEPTA; recién entonces empieza a repartirlo. Eso separa
-- "me lo asignaron" de "me hago cargo", que es lo que pedía la operación:
--
--   pendiente → asignado → aceptado → retirado → en ruta → entregado
--                                                        ↘ no entregado
--
-- CONSTANCIA DE ENTREGA. Al entregar se registra a QUIÉN se le dejó el pedido y
-- una foto. Sirve de respaldo ante reclamos ("nunca me llegó").
--   received_by_kind : cliente | familiar | conserje | otro
--   received_by      : nombre de quien recibió (obligatorio si es "otro")
--   proof_photo      : foto en base64 (se comprime en el celular antes de subir,
--                      mismo criterio que las imágenes de producto)
--
-- Todo aditivo: las columnas nuevas quedan en NULL para los envíos ya existentes
-- y el código las trata como opcionales.

ALTER TABLE deliveries ADD COLUMN accepted_at TEXT;
ALTER TABLE deliveries ADD COLUMN received_by TEXT;
ALTER TABLE deliveries ADD COLUMN received_by_kind TEXT;
ALTER TABLE deliveries ADD COLUMN proof_photo TEXT;
