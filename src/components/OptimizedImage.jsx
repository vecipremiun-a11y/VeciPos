import React, { useState, useEffect, useRef } from 'react';
import { ImageOff } from 'lucide-react';

/**
 * Componente de imagen optimizada con lazy loading y placeholder
 */
const OptimizedImage = ({
    src,
    alt = '',
    className = '',
    fallback = null,
    onError = null,
    priority = false // Si es true, no usa lazy loading
}) => {
    const [isLoaded, setIsLoaded] = useState(false);
    const [hasError, setHasError] = useState(false);
    const [isInView, setIsInView] = useState(priority); // Si es priority, cargar inmediatamente
    const imgRef = useRef(null);

    // Intersection Observer para lazy loading
    useEffect(() => {
        if (priority || !imgRef.current) return;
        const el = imgRef.current;

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setIsInView(true);
                        observer.disconnect();
                    }
                });
            },
            {
                rootMargin: '50px', // Empezar a cargar 50px antes de ser visible
            }
        );

        observer.observe(el);

        return () => observer.unobserve(el);
        // Incluye `src`: si la imagen llega después (carga diferida), re-observa el
        // elemento real para que se muestre aunque no estuviera en viewport antes.
    }, [priority, src]);

    // Al cambiar de foto hay que olvidar lo que pasó con la anterior.
    //
    // Sin esto `hasError` quedaba pegado para siempre: bastaba UN fallo para que
    // ese recuadro mostrara "Sin imagen" el resto de la sesión. Y como React
    // reutiliza el mismo componente para el producto que caiga después en esa
    // posición de la grilla, el hueco se contagiaba a productos con la foto
    // perfecta.
    //
    // Los dos casos donde se veía: al volver de segundo plano —el WebView corta
    // las peticiones en curso y fallan todas las fotos a medio cargar de una— y
    // después de buscar varias veces, que va dejando huecos acumulados.
    useEffect(() => {
        setHasError(false);
        setIsLoaded(false);
    }, [src]);

    // Volver a intentar al regresar a la app.
    //
    // El efecto de arriba solo se dispara si CAMBIA la foto, y al volver de
    // segundo plano el producto es el mismo: mismo src, efecto que no corre,
    // recuadro que sigue roto. Acá se limpia el fallo cuando la pantalla vuelve
    // a estar a la vista, que es justo cuando conviene reintentar.
    //
    // Solo hace algo si esta imagen falló: sin esa condición, cada vez que se
    // vuelve a la app se redibujarían todas las fotos de la grilla para nada.
    useEffect(() => {
        if (!hasError) return;
        const alVolver = () => {
            if (document.visibilityState === 'visible') {
                setHasError(false);
                setIsLoaded(false);
            }
        };
        document.addEventListener('visibilitychange', alVolver);
        return () => document.removeEventListener('visibilitychange', alVolver);
    }, [hasError]);

    const handleLoad = () => {
        setIsLoaded(true);
    };

    const handleError = () => {
        setHasError(true);
        if (onError) onError();
    };

    // Validar que la imagen sea válida
    const isValidImage = src &&
        src !== '[object Object]' &&
        (src.startsWith('http') || src.startsWith('data:image'));

    // Mostrar fallback si hay error o imagen inválida
    if (hasError || !isValidImage) {
        return (
            <div
                ref={imgRef}
                className={`flex items-center justify-center bg-gray-800 ${className}`}
            >
                {fallback || (
                    <div className="flex flex-col items-center justify-center text-gray-500">
                        <ImageOff className="w-8 h-8 mb-1 opacity-50" />
                        <span className="text-xs">Sin imagen</span>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div ref={imgRef} className={`relative overflow-hidden ${className}`}>
            {/* Placeholder mientras carga */}
            {!isLoaded && (
                <div className="absolute inset-0 bg-gray-800 animate-pulse" />
            )}

            {/* Imagen real */}
            {isInView && (
                <img
                    src={src}
                    alt={alt}
                    className={`w-full h-full object-cover transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'
                        }`}
                    onLoad={handleLoad}
                    onError={handleError}
                    loading={priority ? 'eager' : 'lazy'}
                />
            )}
        </div>
    );
};

export default OptimizedImage;
