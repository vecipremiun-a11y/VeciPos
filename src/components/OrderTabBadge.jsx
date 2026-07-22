import React from 'react';

// Badge de conteo para las pestañas Encargos / Tienda (número de pedidos activos).
// Rojo para que resalte como notificación; se oculta cuando no hay pedidos.
export default function OrderTabBadge({ count }) {
    const n = Number(count) || 0;
    if (n <= 0) return null;
    return (
        <span className="ml-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center bg-red-500 text-white leading-none">
            {n > 99 ? '99+' : n}
        </span>
    );
}
