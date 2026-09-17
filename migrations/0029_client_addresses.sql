-- La libreta de direcciones del cliente: varias direcciones, una principal.
--
-- EL PROBLEMA. Un cliente tiene UNA dirección en POSVECI (`clients.address`,
-- texto suelto). En miniveci.cl, en cambio, cada cliente tiene su libreta
-- (`customer_addresses`: etiqueta, dirección, comuna, ciudad, referencia y cuál
-- es la principal) desde hace meses. Lo único que viaja a POSVECI es la
-- dirección vieja del perfil, y solo cuando el cliente se registra o edita su
-- perfil: si agrega o cambia una dirección de su libreta, acá no se entera
-- nadie. Medido el 16-sep-2026 contra las dos bases de producción: 13 clientes
-- en la tienda, 3 direcciones de libreta en 2 de ellos, y en UNO la principal
-- de la libreta ya es distinta de la que POSVECI tiene guardada. Del lado de
-- POSVECI, 9 de 20 clientes vienen de la tienda y solo 7 de 20 tienen alguna
-- dirección.
--
-- Resultado práctico: el cajero abre "Enviar a domicilio" y la dirección sale
-- vacía, o sale una que el cliente ya cambió en la tienda.
--
-- CÓMO SE RESUELVE. Esta tabla es un ESPEJO de la libreta de la tienda. La
-- tienda manda, POSVECI copia; el POS no escribe direcciones hacia allá. Por eso
-- cada fila dice de dónde vino:
--   origin = 'miniveci' → la maneja el cliente desde la tienda. El sync la
--                         reemplaza; el POS no la edita.
--   origin = 'pos'      → reservado. Un cliente cargado acá, sin cuenta en la
--                         tienda, sigue con su dirección en `clients.address`:
--                         nadie más puede mantenérsela y se edita desde el POS
--                         como hasta hoy.
--
-- `clients.address` NO se elimina y se sigue manteniendo al día con la
-- principal. No es redundancia por descuido: los despachos, la impresión, los
-- encargos y la venta a domicilio la leen de ahí, y migrarlos de golpe sería
-- cambiar muchas cosas a la vez para arreglar una. El id pasa a ser la verdad;
-- el texto queda como copia sincronizada.
--
-- Aditivo puro: tabla nueva. Rollback: revertir el commit; `clients.address`
-- sigue funcionando sola y ninguna consulta vieja toca esta tabla.

CREATE TABLE IF NOT EXISTS client_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    client_id INTEGER NOT NULL,

    -- Id de esa misma dirección en miniveci.cl (customer_addresses.id). Es la
    -- llave del emparejamiento: si el cliente corrige el texto de su dirección,
    -- se actualiza la fila en vez de aparecer una duplicada. NULL = nació acá.
    external_id TEXT,
    origin TEXT NOT NULL DEFAULT 'pos',

    label TEXT,
    address TEXT NOT NULL,
    comuna TEXT,
    ciudad TEXT,
    notes TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Las direcciones de un cliente: es la única consulta que hace el POS.
CREATE INDEX IF NOT EXISTS idx_client_addresses_client
    ON client_addresses(company_id, client_id);

-- El sync entrante busca por el id de la tienda. Único: dos filas con el mismo
-- id de allá serían la misma dirección duplicada.
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_addresses_external
    ON client_addresses(company_id, external_id)
    WHERE external_id IS NOT NULL;

-- Sin relleno inicial a propósito: para un cliente cargado en el POS, la verdad
-- sigue siendo `clients.address` —se edita desde su ficha y desde el despacho—,
-- y copiarla acá solo crearía una segunda versión que se queda vieja. Esta tabla
-- se llena únicamente con lo que manda la tienda.
