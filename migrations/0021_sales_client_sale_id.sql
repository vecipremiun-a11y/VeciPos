-- Clave propia de cada venta, para que un reintento no la cobre dos veces.
--
-- El 12-ago-2026 una venta de Diana quedó cargada tres veces ($4.913 × 3, a las
-- 21:33:12, 21:33:24 y 21:33:25). No fue un caso aislado: medido sobre la base,
-- 30 pares de ventas gemelas en los 14 días previos y 11 más en las 20 horas
-- siguientes al despliegue del corte por tiempo.
--
-- CÓMO SE DUPLICA. La venta viaja al servidor, el servidor la registra bien,
-- pero la respuesta tarda. El navegador se cansa de esperar, la da por fallida y
-- la encola. Al reintentar manda exactamente lo mismo… y como no hay nada que
-- diga "esta es la misma venta de recién", el servidor la registra otra vez.
-- Lo mismo pasa con un doble clic en Cobrar.
--
-- Que la respuesta tarde no es raro: función que arranca en frío, internet del
-- local, un pico de la base. Y el navegador nunca puede saber si el silencio
-- significa "no llegó" o "llegó y estoy esperando la confirmación". Por eso el
-- arreglo no puede ser esperar más ni reintentar menos — reintentar tiene que
-- ser inofensivo.
--
-- CÓMO SE ARREGLA. El navegador arma un identificador cuando se confirma la
-- venta, UNA vez, y lo repite en cada reintento. El servidor lo guarda acá. Si
-- llega uno que ya existe, devuelve la venta que ya tenía en lugar de crear
-- otra. El índice único es lo que lo garantiza: aunque dos pedidos entren
-- exactamente a la vez, la base deja pasar solo uno.
--
-- Las ventas viejas quedan en NULL y el índice las ignora, así que nada de lo
-- que ya está cargado se toca.

ALTER TABLE sales ADD COLUMN client_sale_id TEXT;

-- El índice PARCIAL (WHERE ... IS NOT NULL) es deliberado: sin esa condición,
-- todas las ventas históricas con NULL chocarían entre sí en SQLite y la
-- migración fallaría.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_sale_id
    ON sales(company_id, client_sale_id)
    WHERE client_sale_id IS NOT NULL;
