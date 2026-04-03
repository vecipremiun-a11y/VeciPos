import { createClient } from "@libsql/client";
import dotenv from 'dotenv';
dotenv.config();

const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

// Buscar por nombre parcial — cambiar si el producto se llama distinto
const SEARCH_TERM = '%huevo%extra%';
const COMPANY_ID = 'default';

async function diagnoseStock() {
    console.log('========================================');
    console.log('   DIAGNÓSTICO DE STOCK - POSKEM');
    console.log('========================================\n');

    // 1. Buscar el producto
    const prodRes = await turso.execute({
        sql: `SELECT id, name, stock, cost, price, unit, supplier FROM products WHERE company_id = ? AND LOWER(name) LIKE LOWER(?)`,
        args: [COMPANY_ID, SEARCH_TERM]
    });

    if (prodRes.rows.length === 0) {
        console.log('❌ No se encontró el producto. Ajusta SEARCH_TERM.');
        const all = await turso.execute({
            sql: `SELECT id, name, stock FROM products WHERE company_id = ? AND LOWER(name) LIKE '%huevo%' LIMIT 20`,
            args: [COMPANY_ID]
        });
        console.log('\nProductos con "huevo":');
        all.rows.forEach(p => console.log(`  ID ${p.id}: ${p.name} (stock: ${p.stock})`));
        return;
    }

    for (const product of prodRes.rows) {
        console.log(`\n📦 PRODUCTO: ${product.name} (ID: ${product.id})`);
        console.log(`   Stock en tabla products: ${product.stock}`);
        console.log(`   Costo: ${product.cost} | Precio: ${product.price} | Unidad: ${product.unit}`);
        console.log(`   Proveedor: ${product.supplier}\n`);

        // 2. Lotes del producto
        const lotsRes = await turso.execute({
            sql: `SELECT id, batch_number, expiry_date, quantity, initial_quantity, cost, supplier_name, created_at, status, purchase_id
                  FROM product_lots WHERE product_id = ? AND company_id = ?
                  ORDER BY created_at DESC`,
            args: [product.id, COMPANY_ID]
        });

        console.log(`📋 LOTES (${lotsRes.rows.length} total):`);
        let totalLotQty = 0;
        let totalInitialQty = 0;
        for (const lot of lotsRes.rows) {
            totalLotQty += parseFloat(lot.quantity) || 0;
            totalInitialQty += parseFloat(lot.initial_quantity) || 0;
            console.log(`   Lote #${lot.id} | Cant: ${lot.quantity}/${lot.initial_quantity} | Venc: ${lot.expiry_date || 'N/A'} | Estado: ${lot.status} | Proveedor: ${lot.supplier_name} | Compra: ${lot.purchase_id} | Creado: ${lot.created_at}`);
        }
        console.log(`   TOTAL en lotes: ${totalLotQty} (de ${totalInitialQty} iniciales)`);
        console.log(`   ⚠️ DIFERENCIA (products.stock - sum lotes): ${parseFloat(product.stock) - totalLotQty}\n`);

        // 3. Compras que incluyen este producto
        const purchasesRes = await turso.execute({
            sql: `SELECT p.id, p.invoice_number, p.date, p.total, p.items, p.user_id, p.status, u.name as user_name
                  FROM purchases p
                  LEFT JOIN users u ON p.user_id = u.id
                  WHERE p.company_id = ? AND p.items LIKE ?
                  ORDER BY p.date DESC LIMIT 30`,
            args: [COMPANY_ID, `%"id":${product.id},%`]
        });

        // Fallback: buscar por ID como string también
        const purchasesRes2 = await turso.execute({
            sql: `SELECT p.id, p.invoice_number, p.date, p.total, p.items, p.user_id, p.status, u.name as user_name
                  FROM purchases p
                  LEFT JOIN users u ON p.user_id = u.id
                  WHERE p.company_id = ? AND p.items LIKE ?
                  ORDER BY p.date DESC LIMIT 30`,
            args: [COMPANY_ID, `%"id":"${product.id}"%`]
        });

        // Merge unique
        const allPurchases = [...purchasesRes.rows];
        for (const p of purchasesRes2.rows) {
            if (!allPurchases.find(x => x.id === p.id)) allPurchases.push(p);
        }

        console.log(`🛒 COMPRAS que incluyen este producto (${allPurchases.length}):`);
        let totalComprado = 0;
        for (const p of allPurchases) {
            try {
                const items = JSON.parse(p.items || '[]');
                const item = items.find(i => String(i.id) === String(product.id) || String(i.productId) === String(product.id));
                if (item) {
                    const qty = parseFloat(item.quantity) || 0;
                    totalComprado += qty;
                    console.log(`   Compra #${p.id} | Factura: ${p.invoice_number} | Fecha: ${p.date} | Cant: ${qty} | Usuario: ${p.user_name || 'ID:' + p.user_id} | Estado: ${p.status}`);
                }
            } catch (e) { /* parse error */ }
        }
        console.log(`   TOTAL COMPRADO: ${totalComprado}\n`);

        // 4. Ventas que incluyen este producto
        const salesRes = await turso.execute({
            sql: `SELECT s.id, s.date, s.total, s.items, s.status, s.user_id, u.name as user_name
                  FROM sales s
                  LEFT JOIN users u ON s.user_id = u.id
                  WHERE s.company_id = ? AND s.items LIKE ? AND s.status = 'completed'
                  ORDER BY s.date DESC LIMIT 100`,
            args: [COMPANY_ID, `%${product.id}%`]
        });

        console.log(`💰 VENTAS que incluyen este producto (filtradas):`);
        let totalVendido = 0;
        let ventasDetalle = [];
        for (const s of salesRes.rows) {
            try {
                const items = JSON.parse(s.items || '[]');
                const item = items.find(i => String(i.id) === String(product.id) || String(i.productId) === String(product.id));
                if (item) {
                    const qty = parseFloat(item.quantity) || 0;
                    totalVendido += qty;
                    ventasDetalle.push({ id: s.id, date: s.date, qty, user: s.user_name || 'ID:' + s.user_id });
                    console.log(`   Venta #${s.id} | Fecha: ${s.date} | Cant: ${qty} | Usuario: ${s.user_name || 'ID:' + s.user_id}`);
                }
            } catch (e) { /* parse error */ }
        }
        console.log(`   TOTAL VENDIDO: ${totalVendido}\n`);

        // 5. Pérdidas (inventory_losses)
        try {
            const lossesRes = await turso.execute({
                sql: `SELECT * FROM inventory_losses WHERE product_id = ? AND company_id = ? ORDER BY created_at DESC LIMIT 20`,
                args: [product.id, COMPANY_ID]
            });

            if (lossesRes.rows.length > 0) {
                console.log(`🗑️ PÉRDIDAS/MERMAS (${lossesRes.rows.length}):`);
                let totalLost = 0;
                for (const l of lossesRes.rows) {
                    totalLost += parseFloat(l.quantity) || 0;
                    console.log(`   Pérdida #${l.id} | Cant: ${l.quantity} | Razón: ${l.reason} | Notas: ${l.notes} | Fecha: ${l.created_at}`);
                }
                console.log(`   TOTAL PERDIDO: ${totalLost}\n`);
            } else {
                console.log(`🗑️ PÉRDIDAS: Ninguna registrada\n`);
            }
        } catch (e) {
            console.log(`🗑️ PÉRDIDAS: Tabla no existe o error: ${e.message}\n`);
        }

        // 6. Devoluciones
        try {
            const returnsRes = await turso.execute({
                sql: `SELECT * FROM returns WHERE company_id = ? AND items LIKE ? ORDER BY created_at DESC LIMIT 20`,
                args: [COMPANY_ID, `%${product.id}%`]
            });

            if (returnsRes.rows.length > 0) {
                console.log(`↩️ DEVOLUCIONES (${returnsRes.rows.length}):`);
                let totalReturned = 0;
                for (const r of returnsRes.rows) {
                    try {
                        const items = JSON.parse(r.items || '[]');
                        const item = items.find(i => String(i.id) === String(product.id));
                        if (item) {
                            totalReturned += parseFloat(item.quantity) || 0;
                            console.log(`   Devol. #${r.id} | Cant: ${item.quantity} | Tipo: ${r.type} | Fecha: ${r.created_at}`);
                        }
                    } catch (e) { /* parse error */ }
                }
                console.log(`   TOTAL DEVUELTO: ${totalReturned}\n`);
            } else {
                console.log(`↩️ DEVOLUCIONES: Ninguna\n`);
            }
        } catch (e) {
            console.log(`↩️ DEVOLUCIONES: Tabla no existe o error: ${e.message}\n`);
        }

        // 7. Resumen
        console.log('========================================');
        console.log('   RESUMEN MATEMÁTICO');
        console.log('========================================');
        console.log(`   Stock en products.stock:        ${product.stock}`);
        console.log(`   Suma de product_lots.quantity:   ${totalLotQty}`);
        console.log(`   Diferencia (stock - lotes):      ${parseFloat(product.stock) - totalLotQty}`);
        console.log('');
        console.log(`   Total comprado (histórico):     +${totalComprado}`);
        console.log(`   Total vendido (histórico):      -${totalVendido}`);
        const expectedStock = totalComprado - totalVendido;
        console.log(`   Stock esperado (compras-ventas): ${expectedStock}`);
        console.log(`   Stock real (products.stock):     ${product.stock}`);
        console.log(`   ⚠️ DESVIACIÓN:                  ${parseFloat(product.stock) - expectedStock}`);
        console.log('========================================\n');
    }
}

diagnoseStock().catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
});
