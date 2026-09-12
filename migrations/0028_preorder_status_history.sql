-- Historial de estados de un encargo: quién lo movió, cuándo y por qué.
--
-- EL PROBLEMA. El 8-sep-2026 el encargo #690 (Maritza, Pan Hamburguesa x15,
-- $4.125) se creó a las 12:08:52 y alguien lo canceló a las 12:11:07. Kevin
-- preguntó quién y por qué, y el sistema no tenía la respuesta: los cambios de
-- estado de un encargo no dejaban NINGÚN rastro. Se pudo reconstruir la hora
-- exacta solo de rebote, por el aviso saliente a miniveci en
-- `integration_sync_logs`, y aun así el usuario quedó sin identificar. En toda
-- la historia de la base hay 0 registros de encargos en `audit_logs`.
--
-- Peor: el botón de cancelar es una X que actúa al toque, sin confirmación y
-- sin motivo. Un dedo mal puesto en un celular mata un pedido de un cliente
-- habitual —Maritza lleva 10 encargos desde agosto— y no queda nada. El #690
-- nunca se rehízo ni se vendió: se perdió.
--
-- LA SALIDA. Una fila por cada cambio de estado, con el usuario, el momento, el
-- motivo y desde qué pantalla se hizo. El detalle del encargo lo muestra como
-- una línea de tiempo, así que la pregunta "¿quién canceló esto?" se contesta
-- mirando el pedido, no reconstruyendo logs.
--
-- Se guarda `user_name` además de `user_id` a propósito: es una foto del nombre
-- en el momento del cambio. Si mañana ese usuario se renombra —ya pasó con
-- "Katy" → "Chelo" (ver 0027)— el historial tiene que seguir diciendo lo que
-- decía ese día, no lo que dice la ficha hoy.
--
-- Aditivo puro: tabla nueva, nadie la lee todavía. Rollback: revertir el
-- commit; la tabla queda sin usar y ninguna consulta la toca.

CREATE TABLE IF NOT EXISTS preorder_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    preorder_id INTEGER NOT NULL,

    -- De dónde venía y a dónde fue. `from_status` es NULL en el alta.
    from_status TEXT,
    to_status TEXT NOT NULL,

    -- Obligatorio al cancelar (lo exige el servidor), libre en el resto.
    reason TEXT,

    -- Quién. `user_name` es la foto del nombre en ese momento, ver arriba.
    user_id INTEGER,
    user_name TEXT,

    -- Desde dónde: 'encargos', 'produccion', 'kds', 'tienda' o 'sistema'.
    -- El KDS no necesita identificar a la persona (es el panadero del turno),
    -- pero sí conviene distinguir la pantalla: un cambio hecho en la panadería
    -- no es lo mismo que uno hecho en la caja.
    source TEXT NOT NULL DEFAULT 'encargos',

    created_at TEXT NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (preorder_id) REFERENCES preorders(id) ON DELETE CASCADE
);

-- La consulta real: el historial de UN encargo, en orden.
CREATE INDEX IF NOT EXISTS idx_preorder_history_order
    ON preorder_status_history(preorder_id, created_at);

-- Para responder "qué se canceló esta semana y quién" sin recorrer la tabla.
CREATE INDEX IF NOT EXISTS idx_preorder_history_company_fecha
    ON preorder_status_history(company_id, created_at DESC);
