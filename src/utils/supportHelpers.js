// src/utils/supportHelpers.js

/**
 * Categorías de soporte disponibles
 */
export const SUPPORT_CATEGORIES = {
    bug: {
        id: 'bug',
        label: 'Error/Bug',
        icon: '🐞',
        color: 'red'
    },
    payment: {
        id: 'payment',
        label: 'Pago/Suscripción',
        icon: '💳',
        color: 'blue'
    },
    question: {
        id: 'question',
        label: 'Consulta',
        icon: '❓',
        color: 'purple'
    },
    feature: {
        id: 'feature',
        label: 'Sugerencia',
        icon: '💡',
        color: 'yellow'
    },
    other: {
        id: 'other',
        label: 'Otro',
        icon: '📝',
        color: 'gray'
    }
};

/**
 * Estados de tickets
 */
export const TICKET_STATUS = {
    open: {
        id: 'open',
        label: 'Abierto',
        color: 'blue'
    },
    in_progress: {
        id: 'in_progress',
        label: 'En progreso',
        color: 'yellow'
    },
    waiting_client: {
        id: 'waiting_client',
        label: 'Pendiente cliente',
        color: 'orange'
    },
    resolved: {
        id: 'resolved',
        label: 'Resuelto',
        color: 'green'
    }
};

/**
 * Prioridades de tickets
 */
export const TICKET_PRIORITY = {
    low: {
        id: 'low',
        label: 'Baja',
        color: 'gray'
    },
    normal: {
        id: 'normal',
        label: 'Normal',
        color: 'blue'
    },
    high: {
        id: 'high',
        label: 'Alta',
        icon: '⚡',
        color: 'orange'
    },
    urgent: {
        id: 'urgent',
        label: 'Urgente',
        icon: '🚨',
        color: 'red'
    }
};

/**
 * Formatear timestamp relativo (hace 5m, hace 2h, etc.)
 */
export const formatRelativeTime = (isoDate) => {
    if (!isoDate) return '-';

    const now = new Date();
    const date = new Date(isoDate);
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Ahora';
    if (diffMins < 60) return `hace ${diffMins}m`;
    if (diffHours < 24) return `hace ${diffHours}h`;
    if (diffDays === 1) return 'Ayer';
    if (diffDays < 7) return `hace ${diffDays}d`;

    return date.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' });
};

/**
 * Formatear hora (12:34)
 */
export const formatMessageTime = (isoDate) => {
    if (!isoDate) return '';
    const date = new Date(isoDate);
    return date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
};

/**
 * Agrupar mensajes por día
 */
export const groupMessagesByDay = (messages) => {
    const groups = {};
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    messages.forEach(msg => {
        const msgDate = new Date(msg.created_at);
        const msgDateStr = msgDate.toDateString();

        let dayLabel;
        if (msgDateStr === today) {
            dayLabel = 'Hoy';
        } else if (msgDateStr === yesterday) {
            dayLabel = 'Ayer';
        } else {
            dayLabel = msgDate.toLocaleDateString('es-CL', {
                weekday: 'long',
                day: 'numeric',
                month: 'long'
            });
        }

        if (!groups[dayLabel]) {
            groups[dayLabel] = [];
        }
        groups[dayLabel].push(msg);
    });

    return groups;
};

/**
 * Obtener color de chip según estado
 */
export const getStatusColor = (status) => {
    return TICKET_STATUS[status]?.color || 'gray';
};

/**
 * Obtener color de chip según prioridad
 */
export const getPriorityColor = (priority) => {
    return TICKET_PRIORITY[priority]?.color || 'gray';
};

/**
 * Obtener clase CSS de color según el tipo
 */
export const getColorClasses = (color, variant = 'bg') => {
    const colors = {
        red: {
            bg: 'bg-red-500/20',
            text: 'text-red-400',
            border: 'border-red-500/30'
        },
        blue: {
            bg: 'bg-blue-500/20',
            text: 'text-blue-400',
            border: 'border-blue-500/30'
        },
        green: {
            bg: 'bg-green-500/20',
            text: 'text-green-400',
            border: 'border-green-500/30'
        },
        yellow: {
            bg: 'bg-yellow-500/20',
            text: 'text-yellow-400',
            border: 'border-yellow-500/30'
        },
        orange: {
            bg: 'bg-orange-500/20',
            text: 'text-orange-400',
            border: 'border-orange-500/30'
        },
        purple: {
            bg: 'bg-purple-500/20',
            text: 'text-purple-400',
            border: 'border-purple-500/30'
        },
        gray: {
            bg: 'bg-gray-500/20',
            text: 'text-gray-400',
            border: 'border-gray-500/30'
        }
    };

    if (variant === 'all') {
        const c = colors[color] || colors.gray;
        return `${c.bg} ${c.text} ${c.border}`;
    }

    return colors[color]?.[variant] || colors.gray[variant];
};

/**
 * Obtener label de categoría
 */
export const getCategoryLabel = (categoryId) => {
    return SUPPORT_CATEGORIES[categoryId]?.label || categoryId || 'General';
};

/**
 * Obtener label de estado
 */
export const getStatusLabel = (statusId) => {
    return TICKET_STATUS[statusId]?.label || statusId || 'Desconocido';
};

/**
 * Obtener label de prioridad
 */
export const getPriorityLabel = (priorityId) => {
    return TICKET_PRIORITY[priorityId]?.label || priorityId || 'Normal';
};
