import { compressImage } from '../lib/imageCompression';
import { dataApiCall } from '../lib/dataApi';
import { useStore } from '../store/useStore';

/**
 * Recomprime las imágenes grandes de los productos de la empresa activa.
 * La LECTURA y el UPDATE corren server-side (endpoint autenticado, sin token en
 * el navegador); la compresión ocurre aquí (canvas del navegador). Paginado.
 */
export const recompressAllImages = async () => {
    console.log('🔄 Iniciando recompresión de imágenes...');
    const companyId = useStore.getState().activeCompanyId;
    if (!companyId) { alert('No hay empresa activa.'); return; }

    try {
        const PAGE = 10;
        let offset = 0;
        let total = 0;
        let firstPage = true;
        let compressed = 0;
        let skipped = 0;
        let errors = 0;

        while (true) {
            const pageRes = await dataApiCall('productsWithImages', { companyId, offset, limit: PAGE });
            if (!pageRes?.success) { alert('Error leyendo productos: ' + (pageRes?.error || '')); return; }
            if (firstPage) { total = pageRes.total || 0; firstPage = false; console.log(`📦 ${total} productos con imagen`); }
            const products = pageRes.products || [];
            if (products.length === 0) break;

            for (const product of products) {
                try {
                    const originalSize = (product.image.length * 0.75) / 1024; // KB
                    if (originalSize <= 200) { skipped++; continue; }

                    console.log(`🔄 Comprimiendo ${product.name} (${originalSize.toFixed(2)}KB)...`);
                    const compressedImage = await compressImage(product.image, 200, 800, 800);
                    const newSize = (compressedImage.length * 0.75) / 1024;

                    const upd = await dataApiCall('productImageUpdate', { companyId, id: product.id, image: compressedImage });
                    if (!upd?.success) { errors++; continue; }

                    console.log(`✅ ${product.name}: ${originalSize.toFixed(2)}KB → ${newSize.toFixed(2)}KB`);
                    compressed++;
                } catch (error) {
                    console.error(`❌ Error con ${product.name}:`, error);
                    errors++;
                }
            }

            offset += products.length;
            if (products.length < PAGE) break;
        }

        console.log(`\n📊 RESUMEN: comprimidas ${compressed} · saltadas ${skipped} · errores ${errors} · total ${total}`);
        alert(`Optimización completa.\nComprimidas: ${compressed}\nSaltadas: ${skipped}\nErrores: ${errors}`);
    } catch (error) {
        console.error('❌ Error general:', error);
        alert('Error al ejecutar optimización, revisa la consola');
    }
};
