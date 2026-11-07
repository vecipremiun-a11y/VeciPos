-- Producción: insumos y recetas (Fase 1, 6-nov-2026).
--
-- QUÉ RESUELVE. Kevin fabrica parte de lo que vende (pan de completo, empanadas,
-- chaparritas…) con productos de su propio inventario, y quiere saber cuánto le
-- cuesta cada uno para ponerle precio. Los insumos están casi todos en "Und": el
-- saco de harina Morro es 1 unidad, así que sin saber que trae 25 kg no hay forma
-- de calcular cuánto cuestan los 5 kg de una tanda.
--
-- CÓMO. Una fila por producto que participa en producción:
--
--   is_input       1 = se usa como insumo (aparece en la lista de insumos).
--   input_content  cuánto trae 1 unidad del producto (25), en
--   input_unit     g | kg | ml | L | und. NULL = se usa en su propia unidad
--                  (un producto por Kg o Lt no lo necesita).
--   input_waste    % que se pierde al usarlo (hueso, cáscara). 0 = nada.
--   recipe         JSON de la receta, si el producto se fabrica:
--                  {"yield":100,
--                   "items":[{"product_id":12,"qty":5,"unit":"kg"}],
--                   "others":[{"name":"Gas y luz","amount":500}]}
--                  NULL = no se fabrica.
--
-- El costo NO se guarda acá: sale siempre del Costo de la ficha de cada insumo
-- (con IVA y otros impuestos, decisión de Kevin del 6-nov-2026), que es el que
-- actualizan las compras. Así una receta nunca queda con un precio viejo.
--
-- POR QUÉ UNA TABLA APARTE y no columnas en `products`: la fila del producto lleva
-- la foto en base64, y toda columna agregada con ALTER queda DESPUÉS de la foto.
-- Leerla obliga a recorrer la foto entera. Acá no: la pantalla de Producción lee
-- solo esta tabla, que es chica, y el catálogo del POS no se entera de nada.
--
-- Nada de venta, SII, tienda, impresión ni sincronización offline lee esta tabla.
--
-- Aditivo puro. Rollback: revertir el commit; la tabla queda sin usar (o
-- DROP TABLE product_production si se quiere borrar).

CREATE TABLE IF NOT EXISTS product_production (
    product_id INTEGER PRIMARY KEY,
    company_id TEXT NOT NULL,
    is_input INTEGER NOT NULL DEFAULT 0,
    input_content REAL,
    input_unit TEXT,
    input_waste REAL NOT NULL DEFAULT 0,
    recipe TEXT,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_product_production_company ON product_production(company_id);
