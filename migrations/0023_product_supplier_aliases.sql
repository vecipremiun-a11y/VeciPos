-- Cómo escribe el proveedor cada producto en su factura.
--
-- El emparejador compara el texto de la factura contra el nombre del catálogo,
-- y eso tiene un techo que ya se tocó: el proveedor abrevia. "DINAMITA FH 100"
-- es "Doritos Dinamita Flamin Hot 100g"; "CHISPCP 200GX12" es "ChisPop 200g".
-- Ninguna comparación de palabras va a resolver eso, porque las palabras
-- simplemente no están.
--
-- Lo que sí lo resuelve es que el sistema se acuerde. La primera vez la persona
-- elige cuál era; a partir de ahí ese texto —y sobre todo el código que el
-- proveedor imprime en su factura— quedan atados al producto, y las próximas
-- facturas del mismo proveedor entran solas.
--
-- El código es la llave fuerte: "300065901" no cambia aunque cambien el nombre,
-- el gramaje o la abreviatura.

CREATE TABLE IF NOT EXISTS product_supplier_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    -- Informativo: qué proveedor enseñó esta equivalencia. NO entra en la
    -- unicidad a propósito — ver abajo.
    supplier_id INTEGER,
    alias_code TEXT,
    -- Guardado en forma compacta (minúsculas, sin tildes, sin espacios ni
    -- signos), para que "LAYS ORE 45G" y "LAYSORE45G" sean la misma cosa.
    alias_text TEXT,
    -- 'aprendido' (la persona corrigió un renglón) | 'manual' (lo escribió a mano)
    source TEXT NOT NULL DEFAULT 'aprendido',
    created_at TEXT NOT NULL,
    created_by INTEGER
);

-- Una equivalencia por texto y por código dentro de la empresa.
--
-- Deliberadamente NO se incluye el proveedor en la unicidad. Si se incluyera,
-- una factura donde el proveedor no se reconoce —pasa seguido, el nombre
-- impreso rara vez calza con el del catálogo— no encontraría lo aprendido y la
-- memoria serviría a medias. El costo de esta decisión es que si dos
-- proveedores escriben igual dos productos distintos, gana la última
-- corrección; se arregla volviendo a corregir.
CREATE UNIQUE INDEX IF NOT EXISTS idx_alias_code
    ON product_supplier_aliases(company_id, alias_code)
    WHERE alias_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_alias_text
    ON product_supplier_aliases(company_id, alias_text)
    WHERE alias_text IS NOT NULL;

-- Para poder mostrar y limpiar los alias de un producto.
CREATE INDEX IF NOT EXISTS idx_alias_producto
    ON product_supplier_aliases(company_id, product_id);
