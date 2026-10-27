-- Publicidad con IA: diseños publicitarios hechos con los productos del inventario.
--
-- QUÉ ES. Desde el menú Publicidad se eligen productos, un formato (post,
-- historia, cartel…), una campaña y un estilo. La IA genera SOLO EL FONDO de la
-- imagen; la foto real del producto, el nombre, el precio y los textos los pone
-- el sistema encima, así un precio nunca depende de que la IA lo escriba bien y se
-- puede cambiar sin volver a generar (pedido por Kevin el 23-oct-2026).
--
-- QUÉ NO HACE. No toca `products`: el precio de la publicidad es una COPIA que se
-- guarda en el diseño. Si mañana el producto cambia de precio, la publicidad de
-- hoy sigue diciendo lo que decía; para actualizarla se duplica.
--
-- Las imágenes (fondos, fotos subidas solo para una publicidad y la imagen final)
-- viven en Vercel Blob; acá se guardan sus URL.
--
--   ad_designs       una publicidad: productos con sus precios del momento,
--                    formato, campaña, estilo, textos, colores, posiciones, el
--                    fondo elegido y la imagen final exportada.
--   ad_backgrounds   cada fondo generado (para volver a uno anterior), con el
--                    modelo, los tokens y el costo estimado. `client_key` único:
--                    un doble clic no genera (ni cobra) dos veces.
--
-- Aditivo puro. Rollback: revertir el commit; las tablas quedan sin usar.

CREATE TABLE IF NOT EXISTS ad_designs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    user_id INTEGER,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'borrador',
    format TEXT NOT NULL,
    campaign TEXT,
    style TEXT,
    products TEXT NOT NULL,
    texts TEXT,
    layout TEXT,
    background_id INTEGER,
    final_url TEXT,
    -- Miniatura chica (JPEG en data URL, unos 10 KB) para el historial: así la
    -- lista no baja la imagen final entera de cada publicidad.
    thumb TEXT,
    parent_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ad_designs_company
    ON ad_designs (company_id, updated_at);

CREATE TABLE IF NOT EXISTS ad_backgrounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    design_id INTEGER,
    user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pendiente',
    mode TEXT NOT NULL DEFAULT 'fondo',
    model TEXT NOT NULL,
    size TEXT,
    prompt TEXT,
    url TEXT,
    error TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    seconds REAL,
    client_key TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ad_backgrounds_design
    ON ad_backgrounds (company_id, design_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_backgrounds_client_key
    ON ad_backgrounds (company_id, client_key)
    WHERE client_key IS NOT NULL;
