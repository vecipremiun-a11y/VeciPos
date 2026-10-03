-- Unidades de medida de un producto: vender la misma cosa por caja, display o
-- pack, sin dejar de llevar el stock en unidades.
--
-- EL PROBLEMA. El local vende por unidad, pero también por caja. Hasta acá la
-- única forma de vender una caja era armar un COMBO aparte ("caja de huevo
-- extra" = 30 × Ariztia Huevo Extra): otro producto en el catálogo, con su
-- propio precio, que hay que mantener al lado del original. Y el vendedor que
-- quería venderle una caja a alguien tenía que saber cuántas unidades trae, o
-- ir sumando de a una hasta que saltara el precio de mayoreo, sin saber dónde
-- estaba el corte.
--
-- CÓMO SE RESUELVE. Cada producto puede tener presentaciones: "Caja" de 30,
-- "Bandeja" de 12, "Pack" de 6, con su propio precio y su propio código de
-- barras. Escanear el código de la caja la vende como caja; escanear el del
-- producto la vende por unidad. El STOCK sigue en unidades: vender una caja de
-- 30 son 30 unidades menos, y la venta se registra en unidades (30 × precio de
-- la caja ÷ 30). Por eso la venta, los reportes, la caja y la tienda online no
-- cambian: lo único que sabe de cajas es el carrito, y el ticket.
--
-- `units` es REAL a propósito: hoy es por unidad, pero el día que se haga lo
-- mismo para kilo y litro, una "Bolsa" de 25 kg o un "Balde" de 20 lt entran en
-- la misma tabla.
--
-- Aditivo puro: tabla nueva. Rollback: revertir el commit; la tabla queda sin
-- usar y los productos se siguen vendiendo por unidad como hasta hoy.

CREATE TABLE IF NOT EXISTS product_presentations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    -- El código de la caja suele ser distinto al de la unidad (DUN-14 / EAN de
    -- caja). Opcional: sin código igual se puede elegir la caja en el carrito.
    barcode TEXT,
    -- Cuántas unidades del producto trae esta presentación.
    units REAL NOT NULL,
    -- Precio de venta de la presentación entera, IVA incluido, como el precio
    -- del producto.
    price REAL NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Las presentaciones de un producto: lo que muestra la ficha y el carrito.
CREATE INDEX IF NOT EXISTS idx_product_presentations_product
    ON product_presentations(company_id, product_id);

-- Escanear: un código de caja apunta a UNA sola presentación dentro de la
-- empresa. Sin esto, dos cajas con el mismo código harían que la pistola eligiera
-- una al azar.
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_presentations_barcode
    ON product_presentations(company_id, barcode)
    WHERE barcode IS NOT NULL AND barcode <> '';
