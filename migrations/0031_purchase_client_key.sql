-- Clave de la compra puesta por el navegador, para que reintentar no la duplique.
--
-- EL PROBLEMA. El 5-oct-2026 una compra de Terminal Agropecuario ($80.901,
-- 14 renglones) quedó guardada DOS veces (#1701 y #1702, 18 s de diferencia) y
-- el stock de los 14 productos se sumó doble. Al guardar, la pantalla esperó
-- 12 s, dijo "Sin respuesta del servidor", y se volvió a apretar Guardar. Pero
-- el servidor no se había caído: estaba lento (la primera escritura después de
-- un rato quieto llega a tardar más de 10 s) y terminó de guardar la primera.
--
-- CÓMO SE RESUELVE. El navegador genera una clave la primera vez que se aprieta
-- Guardar y manda LA MISMA en cada reintento de esa compra. Si el servidor ya
-- tiene una compra con esa clave, contesta "ya estaba guardada" con su número,
-- en vez de crear otra. El índice único lo garantiza aunque los dos intentos
-- lleguen al mismo tiempo.
--
-- Aditivo puro: columna nueva que admite NULL (las compras viejas quedan sin
-- clave) e índice parcial. El servidor funciona con o sin esta migración: si la
-- columna no está, guarda como antes. Rollback: revertir el commit; la columna
-- queda sin usar.

ALTER TABLE purchases ADD COLUMN client_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_client_key
    ON purchases (company_id, client_key)
    WHERE client_key IS NOT NULL;
