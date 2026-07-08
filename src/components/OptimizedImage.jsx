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
