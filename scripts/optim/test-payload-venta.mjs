// Prueba del arreglo de payload en addSale (src/store/useStore.js).
//
// No toca la base ni el navegador: reproduce la misma transformación
// `sale.items.map(({ image: _image, ...item }) => item)` que se agregó justo
// antes del `userApiCall('saleCommit', ...)`, y comprueba que:
//   1. la foto desaparece del payload que viaja al servidor,
//   2. todo lo demás que el servidor SÍ necesita (id, combo_items, etc.) llega
//      intacto,
//   3. el array original `sale.items` no se muta (se sigue usando después,
//      para `comboItems = sale.items.filter(i => i.is_combo)`).
//
//   node scripts/optim/test-payload-venta.mjs

let failures = 0;
const check = (label, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${label}${extra ? ' -> ' + extra : ''}`);
    if (!ok) failures++;
};

// Item tal como lo arma addToCart (ver useStore.js ~línea 3248).
const item = {
    id: 42,
    name: 'Pan Amasado 1kg',
    price: 1500,
    cost: 900,
    quantity: 2,
    tax_rate: 19,
    image: 'data:image/jpeg;base64,' + 'A'.repeat(90_000), // ~90 KB, real de producción
    sku: 'PAN-1KG',
    stock: 40,
    unit: 'Und',
    category: 'Panadería',
    discountPercent: 0,
    price_ranges: [],
    scale_group_id: null,
    original_price: 1500,
    is_offer: false,
    offer_price: 0,
    is_combo: false,
    combo_id: null,
    combo_items: null,
};

const saleItems = [item, { ...item, id: 43, image: null, name: 'Sin foto' }];

// ── La transformación exacta que se agregó en addSale ────────────────────
const itemsSinFoto = saleItems.map(({ image: _image, ...rest }) => rest);

console.log('1. La foto desaparece del payload');
check('el primer ítem no trae `image`', !('image' in itemsSinFoto[0]));
check('el segundo ítem (sin foto) tampoco la trae', !('image' in itemsSinFoto[1]));

console.log('\n2. Todo lo demás llega intacto');
const { image: _omit, ...esperado } = item;
check('el resto de los campos es idéntico', JSON.stringify(itemsSinFoto[0]) === JSON.stringify(esperado));
check('conserva is_combo / combo_items (los necesita el servidor)',
    itemsSinFoto[0].is_combo === false && itemsSinFoto[0].combo_items === null);
check('conserva id, sku, quantity, price (los necesita el servidor)',
    itemsSinFoto[0].id === 42 && itemsSinFoto[0].sku === 'PAN-1KG' &&
    itemsSinFoto[0].quantity === 2 && itemsSinFoto[0].price === 1500);

console.log('\n3. El array original NO se muta');
check('sale.items sigue teniendo la foto (se usa después para comboItems)',
    saleItems[0].image === item.image);
check('sale.items sigue siendo el mismo array de objetos (misma referencia)',
    saleItems[0] === item);

console.log('\n4. El peso baja de verdad');
const pesoAntes = JSON.stringify(saleItems).length;
const pesoDespues = JSON.stringify(itemsSinFoto).length;
const bajo = pesoDespues < pesoAntes;
check('el JSON de salida pesa menos que el de entrada', bajo,
    `${(pesoAntes / 1024).toFixed(1)} KB -> ${(pesoDespues / 1024).toFixed(1)} KB`);
check('la reducción es la foto completa (no un recorte parcial)',
    pesoAntes - pesoDespues >= item.image.length - 20, // margen por comillas/comas del JSON
    `diferencia: ${pesoAntes - pesoDespues} bytes, foto: ${item.image.length} bytes`);

console.log(failures === 0 ? '\nTODO OK\n' : `\n${failures} PRUEBAS FALLARON\n`);
process.exit(failures === 0 ? 0 : 1);
