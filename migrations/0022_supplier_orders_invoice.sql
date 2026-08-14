-- Número de factura en los pedidos a proveedor.
--
-- Los pedidos guardaban proveedor, total, productos y fechas, pero no el número
-- del documento. Mientras los pedidos se armaban a mano no hacía falta: se
-- pedía primero y la factura llegaba después.
--
-- Cambia con la carga de facturas por foto. Ahí el pedido nace DESDE un
-- documento que ya existe, y sin el número no hay forma de saber si esa factura
-- ya se cargó — que es justamente el error que el asistente encontró en la
-- factura de Vastus (un vinagre de $8.760 sin cargar). Tampoco se puede volver
-- del pedido al papel cuando algo no cuadra.

ALTER TABLE supplier_orders ADD COLUMN invoice_number TEXT;

-- Buscar "¿esta factura ya está?" antes de crear un pedido duplicado. Parcial
-- porque los pedidos armados a mano no tienen número y no aportan nada al
-- índice.
CREATE INDEX IF NOT EXISTS idx_supplier_orders_invoice
    ON supplier_orders(company_id, invoice_number)
    WHERE invoice_number IS NOT NULL;
