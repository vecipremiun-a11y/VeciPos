import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Pusher from 'pusher-js';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { playProductionSound } from '../utils/productionSounds';
import WebOrderCard from './WebOrderCard';
import { notificar, pedirPermisoNotificaciones } from '../lib/notificaciones';
import { formatCurrency } from '../utils/formatCurrency';

// Aviso global de encargos que entran desde la web (miniveci).
// - Escucha el canal Pusher `preorders` en CUALQUIER pantalla, para todas las
//   sesiones abiertas (más probabilidad de que alguien lo vea).
// - Muestra una tarjeta abajo a la izquierda que NO se cierra sola: solo con la
//   X (queda en la campanita) o al Aceptar/Rechazar.
// - Se reconcilia contra la DB al montar y en cada order.updated para caerse
//   sola cuando alguien ya lo atendió, y para sobrevivir recargas.
const MAX_VISIBLE = 4;

const WebOrderToast = () => {
    const navigate = useNavigate();

    const {
        webOrders,
        dismissedWebOrderToasts,
        currentCurrency,
        pushWebOrder,
        removeWebOrder,
        dismissWebOrderToast,
        fetchPendingWebOrders,
        fetchOrderBadges,
        updatePreorderStatus,
    } = useStore(useShallow(s => ({
        webOrders: s.webOrders,
        dismissedWebOrderToasts: s.dismissedWebOrderToasts,
        currentCurrency: s.currentCurrency,
        pushWebOrder: s.pushWebOrder,
        removeWebOrder: s.removeWebOrder,
        dismissWebOrderToast: s.dismissWebOrderToast,
        fetchPendingWebOrders: s.fetchPendingWebOrders,
        fetchOrderBadges: s.fetchOrderBadges,
        updatePreorderStatus: s.updatePreorderStatus,
    })));

    // Reconciliar al montar (sobrevive recargas).
    useEffect(() => {
        fetchPendingWebOrders();
        fetchOrderBadges();
        // Permiso de notificaciones. Se pide acá porque este componente se monta
        // una vez con la sesión ya iniciada: pedirlo antes de entrar sería pedir
        // permiso a alguien que todavía no sabe para qué. En Android 13+ es
        // obligatorio; sin él los avisos se descartan sin decir nada.
        pedirPermisoNotificaciones();
    }, []);

    // Canal Pusher en vivo.
    useEffect(() => {
        const key = import.meta.env.VITE_PUSHER_KEY;
        const cluster = import.meta.env.VITE_PUSHER_CLUSTER;
        if (!key || !cluster) return;

        const pusher = new Pusher(key, { cluster, forceTLS: true, enabledTransports: ['ws', 'wss'] });
        const channel = pusher.subscribe('preorders');
        // El canal es global; solo reaccionamos a eventos de la empresa activa
        // (evita consultas innecesarias por pedidos de otras empresas).
        const isForActiveCompany = (data) => !data?.company_id || data.company_id === useStore.getState().activeCompanyId;

        channel.bind('order.created', (data) => {
            // pushWebOrder ya descarta lo que no es de la empresa activa, así que
            // `added` es la señal correcta: solo avisa por pedidos propios.
            const added = pushWebOrder(data);
            if (added) {
                playProductionSound('zen-chime'); // campanita (no toca el sonido de Producción)
                // Aviso del sistema: la tarjeta y el sonido solo sirven si
                // alguien está mirando la pantalla. Esto suena y aparece en la
                // barra aunque la app esté en segundo plano.
                const esTienda = data.order_kind === 'store';
                const cliente = data.client_name || 'Cliente web';
                const monto = Number(data.total ?? data.total_amount) || 0;
                notificar({
                    titulo: esTienda ? '🛒 Nuevo pedido de la tienda' : '📦 Nuevo encargo',
                    cuerpo: monto > 0
                        ? `${cliente} · ${formatCurrency(monto, currentCurrency)}`
                        : cliente,
                    etiqueta: `pedido-${data.id}`,
                });
            }
            if (isForActiveCompany(data)) fetchOrderBadges(); // refrescar contadores de las pestañas
        });
        channel.bind('order.updated', (data) => {
            if (isForActiveCompany(data)) { fetchPendingWebOrders(); fetchOrderBadges(); }
        });

        return () => {
            try {
                channel.unbind_all();
                pusher.unsubscribe('preorders');
                pusher.disconnect();
            } catch { /* ignore */ }
        };
    }, []);

    const handleAccept = async (id) => {
        await updatePreorderStatus(id, 'confirmed');
        removeWebOrder(id);
    };

    const handleReject = async (id) => {
        if (!window.confirm('¿Rechazar este pedido? El cliente verá que fue rechazado.')) return;
        await updatePreorderStatus(id, 'canceled', 'Rechazado desde el aviso de encargo web');
        removeWebOrder(id);
    };

    const handleView = (id) => {
        dismissWebOrderToast(id); // pasa a la campanita
        const order = webOrders.find(o => o.id === id);
        if (order?.order_kind === 'store') {
            navigate('/store-orders');
        } else {
            navigate('/preorders', { state: { tab: 'list', focusPreorderId: id } });
        }
    };

    const visible = webOrders.filter(o => !dismissedWebOrderToasts.includes(o.id));
    if (visible.length === 0) return null;

    const shown = visible.slice(0, MAX_VISIBLE);
    const hidden = visible.length - shown.length;

    return (
        <div className="fixed bottom-4 left-4 z-[60] w-[92vw] max-w-[360px] space-y-3 pointer-events-none">
            {shown.map(order => (
                <div key={order.id} className="pointer-events-auto shadow-2xl shadow-black/40 rounded-xl">
                    <WebOrderCard
                        order={order}
                        currency={currentCurrency}
                        onAccept={handleAccept}
                        onReject={handleReject}
                        onView={handleView}
                        onClose={dismissWebOrderToast}
                    />
                </div>
            ))}
            {hidden > 0 && (
                <div className="pointer-events-auto text-center text-[11px] text-[var(--color-text-muted)] bg-[var(--color-surface)] border border-[var(--glass-border)] rounded-lg py-1.5">
                    +{hidden} pedido{hidden > 1 ? 's' : ''} más en la campanita 🔔
                </div>
            )}
        </div>
    );
};

export default WebOrderToast;
