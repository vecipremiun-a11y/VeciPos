/**
 * Comprime una imagen a un tamaño máximo especificado
 * @param {File|string} file - Archivo de imagen o base64
 * @param {number} maxSizeKB - Tamaño máximo en KB (default: 200KB)
 * @param {number} maxWidth - Ancho máximo en px (default: 800px)
 * @param {number} maxHeight - Alto máximo en px (default: 800px)
 * @returns {Promise<string>} - Imagen comprimida en base64
 */
export const compressImage = async (file, maxSizeKB = 200, maxWidth = 800, maxHeight = 800) => {
    return new Promise((resolve, reject) => {
        // Si es string base64, convertir a blob
        if (typeof file === 'string') {
            if (file.startsWith('data:image')) {
                // Ya es base64, comprobar tamaño
                const sizeKB = (file.length * 0.75) / 1024; // Aproximado
                if (sizeKB <= maxSizeKB) {
                    resolve(file); // Ya es suficientemente pequeña
                    return;
                }
                // Convertir base64 a blob para recomprimir
                fetch(file)
                    .then(res => res.blob())
                    .then(blob => processImage(blob))
                    .catch(reject);
                return;
            } else {
                reject(new Error('Formato de imagen inválido'));
                return;
            }
        }

        // Si es File, procesarla directamente
        if (file instanceof File || file instanceof Blob) {
            processImage(file);
        } else {
            reject(new Error('Tipo de archivo no soportado'));
        }

        function processImage(imageFile) {
            const reader = new FileReader();

            reader.onload = (e) => {
                const img = new Image();

                img.onload = () => {
                    // Calcular nuevas dimensiones manteniendo aspect ratio
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth) {
                        height = (height * maxWidth) / width;
                        width = maxWidth;
                    }

                    if (height > maxHeight) {
                        width = (width * maxHeight) / height;
                        height = maxHeight;
                    }

                    // Crear canvas para comprimir
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Intentar diferentes calidades hasta alcanzar tamaño objetivo
                    let quality = 0.9;
                    let compressedBase64 = canvas.toDataURL('image/jpeg', quality);

                    // Reducir calidad si aún es muy grande
                    while ((compressedBase64.length * 0.75) / 1024 > maxSizeKB && quality > 0.1) {
                        quality -= 0.1;
                        compressedBase64 = canvas.toDataURL('image/jpeg', quality);
                    }

                    const finalSizeKB = (compressedBase64.length * 0.75) / 1024;
                    console.log(`✅ Imagen comprimida: ${finalSizeKB.toFixed(2)}KB (calidad: ${(quality * 100).toFixed(0)}%)`);

                    resolve(compressedBase64);
                };

                img.onerror = () => {
                    reject(new Error('Error al cargar la imagen'));
                };

                img.src = e.target.result;
            };

            reader.onerror = () => {
                reject(new Error('Error al leer el archivo'));
            };

            reader.readAsDataURL(imageFile);
        }
    });
};

/**
 * Valida que el archivo sea una imagen válida
 */
export const validateImage = (file) => {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    const maxSizeMB = 10; // 10MB antes de comprimir

    if (!file) {
        return { valid: false, error: 'No se seleccionó ningún archivo' };
    }

    if (!validTypes.includes(file.type)) {
        return { valid: false, error: 'Formato no válido. Use JPG, PNG, WEBP o GIF' };
    }

    if (file.size > maxSizeMB * 1024 * 1024) {
        return { valid: false, error: `El archivo es muy grande (máx ${maxSizeMB}MB)` };
    }

    return { valid: true };
};
