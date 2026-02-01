import { turso } from '../lib/turso';
import { compressImage } from '../lib/imageCompression';

/**
 * Script para recomprimir todas las imágenes grandes en la BD
 * EJECUTAR SOLO UNA VEZ
 */
export const recompressAllImages = async () => {
    console.log('🔄 Iniciando recompresión de imágenes...');

    try {
        // Obtener todos los productos con imagen
        const result = await turso.execute({
            sql: "SELECT id, name, image FROM products WHERE image IS NOT NULL AND image != '[object Object]'"
        });

        const products = result.rows;
        console.log(`📦 Encontrados ${products.length} productos con imagen`);

        let compressed = 0;
        let skipped = 0;
        let errors = 0;

        for (const product of products) {
            try {
                const originalSize = (product.image.length * 0.75) / 1024; // KB

                // Si la imagen ya es pequeña, saltarla
                if (originalSize <= 200) {
                    console.log(`⏭️  ${product.name}: Ya es pequeña (${originalSize.toFixed(2)}KB)`);
                    skipped++;
                    continue;
                }

                console.log(`🔄 Comprimiendo ${product.name} (${originalSize.toFixed(2)}KB)...`);

                // Comprimir
                const compressedImage = await compressImage(product.image, 200, 800, 800);
                const newSize = (compressedImage.length * 0.75) / 1024;

                // Actualizar en BD
                await turso.execute({
                    sql: "UPDATE products SET image = ? WHERE id = ?",
                    args: [compressedImage, product.id]
                });

                console.log(`✅ ${product.name}: ${originalSize.toFixed(2)}KB → ${newSize.toFixed(2)}KB (${((1 - newSize / originalSize) * 100).toFixed(0)}% reducción)`);
                compressed++;

            } catch (error) {
                console.error(`❌ Error con ${product.name}:`, error);
                errors++;
            }
        }

        console.log('\n📊 RESUMEN:');
        console.log(`✅ Comprimidas: ${compressed}`);
        console.log(`⏭️  Saltadas: ${skipped}`);
        console.log(`❌ Errores: ${errors}`);
        console.log(`📦 Total: ${products.length}`);
        alert(`Optimización completa.\nComprimidas: ${compressed}\nSaltadas: ${skipped}\nErrores: ${errors}`);

    } catch (error) {
        console.error('❌ Error general:', error);
        alert('Error al ejecutar optimización check console');
    }
};
