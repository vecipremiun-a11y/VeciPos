-- Índice para la búsqueda de "Pedidos a Proveedores".
--
-- Medido el 9-ago-2026 sobre 4.986 productos: filtrar por proveedor tardaba
-- 609 ms contra 134 ms de latencia base hasta Turso, o sea ~475 ms de trabajo
-- para devolver 74 filas.
--
-- El plan era:
--   SEARCH products USING INDEX idx_products_stock_company (company_id=?)
--
-- Es decir, usaba (company_id, stock) y después comprobaba `supplier` fila por
-- fila. No existía NINGÚN índice que incluyera `supplier`. Y como el índice no
-- lo contiene, para cada candidata tiene que leer la fila COMPLETA de la tabla
-- — y cada fila arrastra la foto en base64 (`image` pesa 153 MB de los 154 que
-- ocupa products). Así, filtrar 74 productos obligaba a leer decenas de MB.
--
-- Con este índice el plan pasa a:
--   SEARCH products USING INDEX idx_products_company_supplier_stock
--          (company_id=? AND supplier=?)
--
-- Va directo a las filas del proveedor y ya en orden de stock, que es como las
-- pide la consulta (ORDER BY stock ASC), así que tampoco hay que ordenar.
-- Verificado sobre una copia local con los productos reales: 4,4× más rápido
-- solo en CPU; en producción el ahorro es mayor porque desaparecen esas lecturas.
--
-- Aditivo y reversible: DROP INDEX idx_products_company_supplier_stock;

CREATE INDEX IF NOT EXISTS idx_products_company_supplier_stock
    ON products(company_id, supplier, stock);
