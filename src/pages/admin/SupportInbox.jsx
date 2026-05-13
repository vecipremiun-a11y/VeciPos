import React, { useState, useEffect, useRef } from 'react';
import {
    Search, Send,
    CheckCircle, User, Building2,
    Phone, Mail, TrendingUp, ExternalLink,
    MessageSquare, X
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { turso } from '../../lib/turso';
import {
    TICKET_STATUS,
    TICKET_PRIORITY,
    formatRelativeTime,
    formatMessageTime,
    groupMessagesByDay
} from '../../utils/supportHelpers';
import { createSmartInterval } from '../../lib/smartPolling';

const SupportInbox = () => {
    const {
        fetchAllSupportTickets,
        fetchTicketMessages,
        replyToTicket,
        updateTicketStatus,
        updateTicketPriority,
        markTicketAsReadByAdmin
    } = useStore();

    const [tickets, setTickets] = useState([]);
    const [selectedTicket, setSelectedTicket] = useState(null);
    const [messages, setMessages] = useState([]);
    const [companyContext, setCompanyContext] = useState(null);
    const [inputMessage, setInputMessage] = useState('');
    const [selectedImage, setSelectedImage] = useState(null);

    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('open');
    const [isLoading, setIsLoading] = useState(false);

    const messagesEndRef = useRef(null);
    const pollingIntervalRef = useRef(null);

    // Cargar tickets al montar
    useEffect(() => {
        loadTickets();
    }, [statusFilter]);

    // FASE 9 · Polling inteligente de chat: 3s mientras visible, pausa cuando oculta.
    useEffect(() => {
        if (selectedTicket) {
            loadMessages();

            const stop = createSmartInterval(
                () => loadMessages(true),
                {
                    label: 'support-inbox-chat',
                    activeMs: 3_000,
                    idleMs: 3_000,
                    pauseWhenHidden: true,
                    pauseWhenOffline: true,
                    runOnVisible: true,
                }
            );
            pollingIntervalRef.current = stop;

            return () => {
                if (pollingIntervalRef.current) {
                    pollingIntervalRef.current();
                    pollingIntervalRef.current = null;
                }
            };
        }
    }, [selectedTicket?.id]);

    // Auto-scroll
    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    function scrollToBottom() {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }

    async function loadTickets() {
        const filters = {
            status: statusFilter === 'all' ? null : statusFilter,
            search: searchQuery || null
        };

        const result = await fetchAllSupportTickets(filters);
        if (result.success) {
            setTickets(result.tickets);
        }
    }

    async function loadMessages(silent = false) {
        if (!selectedTicket) return;

        if (!silent) setIsLoading(true);

        const result = await fetchTicketMessages(selectedTicket.id);
        if (result.success) {
            setMessages(result.messages);

            // Marcar como leído por admin
            await markTicketAsReadByAdmin(selectedTicket.id);
            loadTickets(); // Actualizar lista
        }

        if (!silent) setIsLoading(false);
    }

    async function loadCompanyContext(ticket) {
        // Cargar contexto de la empresa
        try {
            const result = await turso.execute({
                sql: `SELECT 
                        c.*,
                        (SELECT COUNT(*) FROM users WHERE company_id = c.id) as user_count,
                        (SELECT MAX(date) FROM sales WHERE company_id = c.id) as last_sale_date
                      FROM companies c
                      WHERE c.id = ?`,
                args: [ticket.company_id]
            });

            if (result.rows.length > 0) {
                setCompanyContext(result.rows[0]);
            }
        } catch (e) {
            console.error('Error loading company context:', e);
        }
    }

    const handleSelectTicket = (ticket) => {
        setSelectedTicket(ticket);
        loadCompanyContext(ticket);
    };

    const handleSendReply = async () => {
        if (!inputMessage.trim() || !selectedTicket) return;

        const messageText = inputMessage;
        setInputMessage('');

        const result = await replyToTicket(selectedTicket.id, messageText);

        if (result.success) {
            loadMessages();
            loadTickets();
        }
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendReply();
        }
    };

    const handleMarkResolved = async () => {
        if (!selectedTicket) return;

        const result = await updateTicketStatus(selectedTicket.id, 'resolved');
        if (result.success) {
            loadTickets();
            setSelectedTicket({ ...selectedTicket, status: 'resolved' });
        }
    };

    const handleChangePriority = async (priority) => {
        if (!selectedTicket) return;

        const result = await updateTicketPriority(selectedTicket.id, priority);
        if (result.success) {
            loadTickets();
            setSelectedTicket({ ...selectedTicket, priority });
        }
    };

    const handleChangeStatus = async (status) => {
        if (!selectedTicket) return;

        const result = await updateTicketStatus(selectedTicket.id, status);
        if (result.success) {
            loadTickets();
            setSelectedTicket({ ...selectedTicket, status });
        }
    };

    const getStatusClasses = (status) => {
        const colorMap = {
            open: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
            in_progress: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
            waiting_client: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
            resolved: 'bg-green-500/20 text-green-400 border-green-500/30'
        };
        return colorMap[status] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    };

    return (
        <div className="h-screen flex flex-col bg-[#0a0a1a]">
            {/* Header Superior */}
            <div className="h-16 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] px-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <h1 className="text-2xl font-bold text-[var(--color-text)]">
                        Soporte
                    </h1>

                    {/* Filtros rápidos */}
                    <div className="flex gap-2">
                        {['open', 'in_progress', 'waiting_client', 'resolved', 'all'].map(status => (
                            <button
                                key={status}
                                onClick={() => setStatusFilter(status)}
                                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${statusFilter === status
                                    ? 'bg-[var(--color-primary)] text-white'
                                    : 'bg-white/5 text-[var(--color-text-muted)] hover:bg-white/10'
                                    }`}
                            >
                                {status === 'all' ? 'Todos' : TICKET_STATUS[status]?.label || status}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Buscador */}
                <div className="flex items-center gap-2 bg-[#1a1a2e] rounded-lg px-4 py-2 w-80">
                    <Search size={16} className="text-[var(--color-text-muted)]" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && loadTickets()}
                        placeholder="Buscar empresa o asunto..."
                        className="flex-1 bg-transparent text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none text-sm"
                    />
                </div>
            </div>

            {/* Layout de 3 columnas */}
            <div className="flex-1 flex overflow-hidden">
                {/* COLUMNA 1: Lista de conversaciones */}
                <div className="w-80 border-r border-[var(--glass-border)] bg-[var(--glass-bg)] flex flex-col">
                    <div className="flex-1 overflow-y-auto">
                        {tickets.length === 0 ? (
                            <div className="p-6 text-center text-[var(--color-text-muted)]">
                                No hay tickets
                            </div>
                        ) : (
                            tickets.map(ticket => (
                                <div
                                    key={ticket.id}
                                    onClick={() => handleSelectTicket(ticket)}
                                    className={`p-4 border-b border-[var(--glass-border)] cursor-pointer hover:bg-white/5 transition-colors ${selectedTicket?.id === ticket.id ? 'bg-white/10' : ''
                                        }`}
                                >
                                    <div className="flex items-start justify-between mb-2">
                                        <div className="flex-1">
                                            <h3 className="font-semibold text-[var(--color-text)] text-sm">
                                                {ticket.company_name || 'Empresa'}
                                            </h3>
                                            <p className="text-xs text-[var(--color-text-muted)] line-clamp-1">
                                                {ticket.subject}
                                            </p>
                                        </div>
                                        {ticket.unread_count > 0 && (
                                            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                                        )}
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getStatusClasses(ticket.status)}`}>
                                                {TICKET_STATUS[ticket.status]?.label}
                                            </span>
                                            {(ticket.priority === 'high' || ticket.priority === 'urgent') && (
                                                <span className="text-orange-400">⚡</span>
                                            )}
                                        </div>
                                        <span className="text-[10px] text-[var(--color-text-muted)]">
                                            {formatRelativeTime(ticket.updated_at)}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* COLUMNA 2: Chat */}
                <div className="flex-1 flex flex-col">
                    {!selectedTicket ? (
                        <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
                            <div className="text-center">
                                <MessageSquare size={48} className="mx-auto mb-4 opacity-50" />
                                <p>Selecciona una conversación</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Header del chat */}
                            <div className="h-16 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] px-6 flex items-center justify-between">
                                <div>
                                    <h2 className="font-bold text-[var(--color-text)]">
                                        {selectedTicket.company_name}
                                    </h2>
                                    <p className="text-xs text-[var(--color-text-muted)]">
                                        Última actividad: {formatRelativeTime(selectedTicket.updated_at)}
                                    </p>
                                </div>

                                <div className="flex items-center gap-2">
                                    {/* Botón cambiar estado */}
                                    <select
                                        value={selectedTicket.status}
                                        onChange={(e) => handleChangeStatus(e.target.value)}
                                        className="bg-[#1a1a2e] border border-[var(--glass-border)] rounded-lg px-3 py-1 text-xs text-[var(--color-text)]"
                                    >
                                        {Object.values(TICKET_STATUS).map(s => (
                                            <option key={s.id} value={s.id}>{s.label}</option>
                                        ))}
                                    </select>

                                    {/* Botón cambiar prioridad */}
                                    <select
                                        value={selectedTicket.priority}
                                        onChange={(e) => handleChangePriority(e.target.value)}
                                        className="bg-[#1a1a2e] border border-[var(--glass-border)] rounded-lg px-3 py-1 text-xs text-[var(--color-text)]"
                                    >
                                        {Object.values(TICKET_PRIORITY).map(p => (
                                            <option key={p.id} value={p.id}>{p.label}</option>
                                        ))}
                                    </select>

                                    <button
                                        onClick={handleMarkResolved}
                                        className="px-3 py-1 bg-green-500/20 text-green-400 rounded-lg text-xs font-semibold hover:bg-green-500/30 transition-colors"
                                    >
                                        <CheckCircle size={14} className="inline mr-1" />
                                        Resolver
                                    </button>
                                </div>
                            </div>

                            {/* Mensajes */}
                            <div className="flex-1 overflow-y-auto p-6">
                                {isLoading && messages.length === 0 ? (
                                    <div className="text-center text-[var(--color-text-muted)]">
                                        Cargando mensajes...
                                    </div>
                                ) : (
                                    <>
                                        {Object.entries(groupMessagesByDay(messages)).map(([day, dayMessages]) => (
                                            <div key={day}>
                                                {/* Separador de día */}
                                                <div className="flex items-center gap-2 my-4">
                                                    <div className="flex-1 h-px bg-[var(--glass-border)]"></div>
                                                    <span className="text-xs text-[var(--color-text-muted)] font-semibold">
                                                        {day}
                                                    </span>
                                                    <div className="flex-1 h-px bg-[var(--glass-border)]"></div>
                                                </div>

                                                {/* Mensajes */}
                                                {dayMessages.map(msg => (
                                                    <div
                                                        key={msg.id}
                                                        className={`flex ${msg.sender_type === 'admin' ? 'justify-end' : 'justify-start'} mb-3`}
                                                    >
                                                        <div
                                                            className={`max-w-[70%] rounded-2xl px-4 py-2 ${msg.sender_type === 'admin'
                                                                ? 'bg-[var(--color-primary)] text-white'
                                                                : 'bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]'
                                                                }`}
                                                        >
                                                            <div className="text-[10px] font-semibold mb-1 opacity-70">
                                                                {msg.sender_name}
                                                            </div>
                                                            <div className="text-sm whitespace-pre-wrap break-words">
                                                                {msg.message}
                                                            </div>

                                                            {/* Adjuntos */}
                                                            {msg.attachments && msg.attachments.length > 0 && (
                                                                <div className="mt-2 space-y-2">
                                                                    {msg.attachments.map(att => (
                                                                        <div key={att.id} className="max-w-xs">
                                                                            {att.file_type?.startsWith('image/') ? (
                                                                                <div
                                                                                    className="cursor-pointer"
                                                                                    onClick={() => setSelectedImage(att.file_url)}
                                                                                >
                                                                                    <img
                                                                                        src={att.file_url}
                                                                                        alt="Adjunto"
                                                                                        className="rounded-lg w-full object-cover border border-white/10 hover:opacity-90 transition-opacity"
                                                                                    />
                                                                                </div>
                                                                            ) : (
                                                                                <a
                                                                                    href={att.file_url}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    className="flex items-center gap-2 p-2 bg-black/20 rounded text-xs hover:bg-black/30 transition-colors"
                                                                                >
                                                                                    <ExternalLink size={12} />
                                                                                    {att.filename || 'Archivo adjunto'}
                                                                                </a>
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}

                                                            <div className="text-[10px] mt-1 opacity-70">
                                                                {formatMessageTime(msg.created_at)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                        <div ref={messagesEndRef} />
                                    </>
                                )}
                            </div>

                            {/* Input de respuesta */}
                            <div className="border-t border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
                                <div className="flex gap-2 mb-2">
                                    <input
                                        type="text"
                                        value={inputMessage}
                                        onChange={(e) => setInputMessage(e.target.value)}
                                        onKeyPress={handleKeyPress}
                                        placeholder="Escribe tu respuesta..."
                                        className="flex-1 bg-[#1a1a2e] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)]"
                                    />
                                    <button
                                        onClick={handleSendReply}
                                        disabled={!inputMessage.trim()}
                                        className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Send size={20} />
                                    </button>
                                </div>

                            </div>

                        </>
                    )}
                </div>

                {/* COLUMNA 3: Contexto de empresa */}
                {selectedTicket && companyContext && (
                    <div className="w-80 border-l border-[var(--glass-border)] bg-[var(--glass-bg)] overflow-y-auto p-4">
                        <h3 className="text-sm font-bold text-[var(--color-text)] mb-4">
                            Contexto de Empresa
                        </h3>

                        {/* Datos empresa */}
                        <div className="mb-6">
                            <div className="flex items-center gap-2 mb-2">
                                <Building2 size={16} className="text-[var(--color-primary)]" />
                                <h4 className="text-xs font-semibold text-[var(--color-text)]">
                                    Datos Empresa
                                </h4>
                            </div>
                            <div className="space-y-2 text-xs">
                                <div>
                                    <span className="text-[var(--color-text-muted)]">Nombre:</span>
                                    <span className="text-[var(--color-text)] ml-2 font-semibold">
                                        {companyContext.name}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[var(--color-text-muted)]">ID:</span>
                                    <span className="text-[var(--color-text)] ml-2 font-mono text-[10px]">
                                        {companyContext.id}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[var(--color-text-muted)]">Plan:</span>
                                    <span className={`ml-2 px-2 py-0.5 rounded ${companyContext.plan === 'pro' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-500/20 text-gray-400'
                                        }`}>
                                        {companyContext.plan || 'Demo'}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[var(--color-text-muted)]">Usuarios:</span>
                                    <span className="text-[var(--color-text)] ml-2">
                                        {companyContext.user_count || 0}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Contacto */}
                        <div className="mb-6">
                            <div className="flex items-center gap-2 mb-2">
                                <User size={16} className="text-[var(--color-primary)]" />
                                <h4 className="text-xs font-semibold text-[var(--color-text)]">
                                    Contacto
                                </h4>
                            </div>
                            <div className="space-y-2 text-xs">
                                <div>
                                    <span className="text-[var(--color-text-muted)]">Usuario:</span>
                                    <span className="text-[var(--color-text)] ml-2">
                                        {selectedTicket.user_name}
                                    </span>
                                </div>
                                {companyContext.phone_main && (
                                    <div className="flex items-center gap-2">
                                        <Phone size={12} className="text-[var(--color-text-muted)]" />
                                        <span className="text-[var(--color-text)]">
                                            {companyContext.phone_main}
                                        </span>
                                    </div>
                                )}
                                {companyContext.email_main && (
                                    <div className="flex items-center gap-2">
                                        <Mail size={12} className="text-[var(--color-text-muted)]" />
                                        <span className="text-[var(--color-text)]">
                                            {companyContext.email_main}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Salud del sistema */}
                        <div className="mb-6">
                            <div className="flex items-center gap-2 mb-2">
                                <TrendingUp size={16} className="text-[var(--color-primary)]" />
                                <h4 className="text-xs font-semibold text-[var(--color-text)]">
                                    Salud del Sistema
                                </h4>
                            </div>
                            <div className="space-y-2 text-xs">
                                <div>
                                    <span className="text-[var(--color-text-muted)]">Última venta:</span>
                                    <span className="text-[var(--color-text)] ml-2">
                                        {companyContext.last_sale_date
                                            ? formatRelativeTime(companyContext.last_sale_date)
                                            : 'Sin ventas'
                                        }
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[var(--color-text-muted)]">Zona horaria:</span>
                                    <span className="text-[var(--color-text)] ml-2">
                                        {companyContext.timezone || 'No configurada'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Acciones rápidas */}
                        <div>
                            <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
                                Acciones Rápidas
                            </h4>
                            <div className="space-y-2">
                                <button className="w-full text-left px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs text-[var(--color-text)] transition-colors flex items-center gap-2">
                                    <ExternalLink size={12} />
                                    Abrir empresa en admin
                                </button>
                                <button className="w-full text-left px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs text-[var(--color-text)] transition-colors flex items-center gap-2">
                                    <User size={12} />
                                    Ver usuarios de la empresa
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Lightbox para imágenes */}
            {selectedImage && (
                <div
                    className="fixed inset-0 bg-black/90 z-[200] flex items-center justify-center p-4 animate-in fade-in duration-200"
                    onClick={() => setSelectedImage(null)}
                >
                    <button
                        onClick={() => setSelectedImage(null)}
                        className="absolute top-4 right-4 text-white hover:text-gray-300 p-2"
                    >
                        <X size={32} />
                    </button>
                    <img
                        src={selectedImage}
                        alt="Vista previa"
                        className="max-w-full max-h-[90vh] object-contain rounded-lg"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
};

export default SupportInbox;
