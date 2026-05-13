import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Paperclip, MessageCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import {
    SUPPORT_CATEGORIES,
    TICKET_STATUS,
    formatMessageTime,
    groupMessagesByDay
} from '../utils/supportHelpers';
import { createSmartInterval } from '../lib/smartPolling';

const SupportWidget = () => {
    // FASE 10 · useShallow para evitar re-render con cualquier mutación del store.
    const {
        currentUser,
        supportTickets,
        unreadSupportCount,
        fetchSupportTickets,
        createSupportTicket,
        fetchTicketMessages,
        sendSupportMessage,
        markMessagesAsRead,
        uploadSupportAttachment
    } = useStore(useShallow(s => ({
        currentUser: s.currentUser,
        supportTickets: s.supportTickets,
        unreadSupportCount: s.unreadSupportCount,
        fetchSupportTickets: s.fetchSupportTickets,
        createSupportTicket: s.createSupportTicket,
        fetchTicketMessages: s.fetchTicketMessages,
        sendSupportMessage: s.sendSupportMessage,
        markMessagesAsRead: s.markMessagesAsRead,
        uploadSupportAttachment: s.uploadSupportAttachment,
    })));

    const [isOpen, setIsOpen] = useState(false);
    const [currentTicket, setCurrentTicket] = useState(null);
    const [messages, setMessages] = useState([]);
    const [inputMessage, setInputMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const [selectedImage, setSelectedImage] = useState(null);

    const messagesEndRef = useRef(null);
    const pollingIntervalRef = useRef(null);
    const fileInputRef = useRef(null);

    // Cargar tickets al montar
    // ... (rest of effects)

    const handleCloseLightbox = () => setSelectedImage(null);

    // Cargar tickets al montar
    // Cargar tickets al montar y polling global
    useEffect(() => {
        if (currentUser?.role !== 'Administrador') return;

        fetchSupportTickets();

        // FASE 9 · Polling inteligente: 30s con actividad / 3min idle,
        // pausa tab oculta o sin conexión.
        const stop = createSmartInterval(fetchSupportTickets, {
            label: 'support-widget',
            activeMs: 30_000,
            idleMs: 3 * 60_000,
            pauseWhenHidden: true,
            pauseWhenOffline: true,
            runOnVisible: true,
        });

        return stop;
    }, [currentUser?.role, fetchSupportTickets]);

    // Polling: revisar mensajes nuevos cada 3 segundos cuando el panel está abierto
    useEffect(() => {
        if (currentUser?.role !== 'Administrador') return;

        if (isOpen && currentTicket) {
            loadMessages();

            // FASE 9 · Polling de chat: 3s mientras visible y panel abierto,
            // pausa si la tab pasa a oculta. Antes corría aún en background.
            const stop = createSmartInterval(
                () => loadMessages(true), // silent = true para no mostrar loading
                {
                    label: 'support-chat',
                    activeMs: 3_000,
                    idleMs: 3_000, // siempre rápido mientras está visible
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
    }, [currentUser?.role, isOpen, currentTicket]);

    // Auto-scroll al final cuando hay mensajes nuevos
    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Si no es administrador, no mostrar el widget
    if (currentUser?.role !== 'Administrador') return null;

    function scrollToBottom() {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }

    async function loadMessages(silent = false) {
        if (!currentTicket) return;

        if (!silent) setIsLoading(true);

        const result = await fetchTicketMessages(currentTicket.id);
        if (result.success) {
            setMessages(result.messages);

            // Marcar como leído
            const hasUnread = result.messages.some(m =>
                m.sender_type === 'admin' && m.read_by_client === 0
            );
            if (hasUnread) {
                await markMessagesAsRead(currentTicket.id);
                fetchSupportTickets(); // Actualizar badge
            }
        }

        if (!silent) setIsLoading(false);
    }

    const handleOpenWidget = () => {
        setIsOpen(true);

        // Si ya hay un ticket abierto o en progreso, cargarlo
        const openTicket = supportTickets.find(t =>
            t.status === 'open' || t.status === 'in_progress' || t.status === 'waiting_client'
        );

        if (openTicket) {
            setCurrentTicket(openTicket);
        }
    };

    const handleSelectCategory = async (categoryId) => {
        const category = SUPPORT_CATEGORIES[categoryId];

        // Crear ticket con categoría
        setIsLoading(true);
        const result = await createSupportTicket(
            `Categoría: ${category.label}`,
            categoryId,
            `${category.icon} ${category.label}`
        );

        if (result.success) {
            // Recargar tickets y abrir el nuevo
            await fetchSupportTickets();
            const newTicket = supportTickets.find(t => t.id === result.ticketId);
            setCurrentTicket(newTicket || { id: result.ticketId });
            loadMessages();
        }

        setIsLoading(false);
    };

    const handleSendMessage = async () => {
        if (!inputMessage.trim() || !currentTicket) return;

        const messageText = inputMessage;
        setInputMessage('');

        const result = await sendSupportMessage(currentTicket.id, messageText);

        if (result.success) {
            loadMessages(); // Recargar mensajes
        }
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const handleAttachment = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Validar tamaño (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            alert('El archivo es muy grande. Máximo 5MB.');
            return;
        }

        // Validar tipo
        if (!file.type.startsWith('image/')) {
            alert('Solo se permiten imágenes.');
            return;
        }

        setIsLoading(true);

        // Enviar mensaje con texto
        const result = await sendSupportMessage(currentTicket.id, `📎 Adjunto: ${file.name}`);

        if (result.success) {
            // Subir archivo
            await uploadSupportAttachment(currentTicket.id, result.messageId, file);
            loadMessages();
        }

        setIsLoading(false);
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

    const renderNewTicketView = () => (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <MessageCircle size={48} className="text-[var(--color-primary)] mb-4" />
            <h3 className="text-lg font-bold text-[var(--color-text)] mb-2">
                ¿En qué te ayudamos?
            </h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-6">
                Selecciona una categoría para comenzar
            </p>

            <div className="grid grid-cols-1 gap-3 w-full max-w-sm">
                {Object.values(SUPPORT_CATEGORIES).map(category => (
                    <button
                        key={category.id}
                        onClick={() => handleSelectCategory(category.id)}
                        className="flex items-center gap-3 p-4 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg hover:bg-white/10 transition-all text-left"
                    >
                        <span className="text-2xl">{category.icon}</span>
                        <div>
                            <div className="font-semibold text-[var(--color-text)]">
                                {category.label}
                            </div>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );

    const renderMessages = () => {
        const groupedMessages = groupMessagesByDay(messages);

        return (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {Object.entries(groupedMessages).map(([day, dayMessages]) => (
                    <div key={day}>
                        {/* Separador de día */}
                        <div className="flex items-center gap-2 my-4">
                            <div className="flex-1 h-px bg-[var(--glass-border)]"></div>
                            <span className="text-xs text-[var(--color-text-muted)] font-semibold">
                                {day}
                            </span>
                            <div className="flex-1 h-px bg-[var(--glass-border)]"></div>
                        </div>

                        {/* Mensajes del día */}
                        {dayMessages.map((msg) => (
                            <div
                                key={msg.id}
                                className={`flex ${msg.sender_type === 'client' ? 'justify-end' : 'justify-start'} mb-3`}
                            >
                                <div
                                    className={`max-w-[75%] rounded-2xl px-4 py-2 ${msg.sender_type === 'client'
                                        ? 'bg-[var(--color-primary)] text-white'
                                        : 'bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]'
                                        }`}
                                >
                                    <div className="text-sm whitespace-pre-wrap break-words">
                                        {msg.message}
                                    </div>

                                    {/* Adjuntos */}
                                    {msg.attachments && msg.attachments.length > 0 && (
                                        <div className="mt-2 space-y-2">
                                            {msg.attachments.map(att => (
                                                <div key={att.id}>
                                                    {att.file_type?.startsWith('image/') ? (
                                                        <img
                                                            src={att.file_url}
                                                            alt="Adjunto"
                                                            className="rounded-lg max-w-full max-h-48 object-cover border border-white/10 cursor-pointer hover:opacity-90 transition-opacity"
                                                            onClick={() => setSelectedImage(att.file_url)}
                                                        />
                                                    ) : (
                                                        <a
                                                            href={att.file_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="flex items-center gap-2 p-2 bg-black/20 rounded text-xs hover:bg-black/30 transition-colors"
                                                        >
                                                            <Paperclip size={12} />
                                                            {att.filename || 'Archivo adjunto'}
                                                        </a>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <div
                                        className={`text-[10px] mt-1 ${msg.sender_type === 'client'
                                            ? 'text-white/70'
                                            : 'text-[var(--color-text-muted)]'
                                            }`}
                                    >
                                        {formatMessageTime(msg.created_at)}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>
        );
    };

    if (!isOpen) {
        // Botón flotante
        return (
            <button
                onClick={handleOpenWidget}
                className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-[var(--color-primary)] text-white rounded-full shadow-lg hover:scale-110 transition-transform flex items-center justify-center"
            >
                <MessageCircle size={24} />
                {unreadSupportCount > 0 && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                        {unreadSupportCount}
                    </div>
                )}
            </button>
        );
    }

    // Panel drawer abierto
    return (
        <>
            {/* Overlay */}
            <div
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]"
                onClick={() => setIsOpen(false)}
            />

            {/* Panel */}
            <div className="fixed right-0 top-0 bottom-0 w-full md:w-[400px] bg-[#0a0a1a] z-[101] flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-[var(--glass-border)] bg-[var(--glass-bg)]">
                    <div>
                        <h2 className="text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
                            <MessageCircle size={20} className="text-[var(--color-primary)]" />
                            Soporte PosVeci
                        </h2>
                        <p className="text-xs text-[var(--color-text-muted)]">
                            {currentUser?.name || 'Usuario'}
                        </p>
                    </div>
                    <button
                        onClick={() => setIsOpen(false)}
                        className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors p-2 hover:bg-white/5 rounded-full"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Estado del ticket */}
                {currentTicket && (
                    <div className="px-4 py-2 bg-[var(--glass-bg)] border-b border-[var(--glass-border)]">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[var(--color-text-muted)]">
                                Estado:
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${getStatusClasses(currentTicket.status)}`}>
                                {TICKET_STATUS[currentTicket.status]?.label || currentTicket.status}
                            </span>
                        </div>
                    </div>
                )}

                {/* Contenido */}
                {!currentTicket ? (
                    renderNewTicketView()
                ) : (
                    <>
                        {/* Mensajes */}
                        {isLoading && messages.length === 0 ? (
                            <div className="flex-1 flex items-center justify-center">
                                <div className="text-[var(--color-text-muted)]">
                                    Cargando mensajes...
                                </div>
                            </div>
                        ) : (
                            renderMessages()
                        )}

                        {/* Barra rápida de categorías (solo si es ticket nuevo sin mensajes) */}
                        {messages.length <= 1 && (
                            <div className="px-4 py-2 border-t border-[var(--glass-border)] bg-[var(--glass-bg)]">
                                <div className="flex gap-2 justify-center flex-wrap">
                                    {Object.values(SUPPORT_CATEGORIES).slice(0, 3).map(cat => (
                                        <button
                                            key={cat.id}
                                            className="flex items-center gap-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs transition-colors"
                                        >
                                            <span>{cat.icon}</span>
                                            <span className="text-[var(--color-text)]">{cat.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Input de mensaje */}
                        <div className="p-4 border-t border-[var(--glass-border)] bg-[var(--glass-bg)]">
                            <div className="flex gap-2">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={handleAttachment}
                                />

                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
                                    title="Adjuntar imagen"
                                >
                                    <Paperclip size={20} />
                                </button>

                                <input
                                    type="text"
                                    value={inputMessage}
                                    onChange={(e) => setInputMessage(e.target.value)}
                                    onKeyPress={handleKeyPress}
                                    placeholder="Escribe tu mensaje..."
                                    className="flex-1 bg-[#1a1a2e] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)]"
                                />

                                <button
                                    onClick={handleSendMessage}
                                    disabled={!inputMessage.trim()}
                                    className="p-2 bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Send size={20} />
                                </button>
                            </div>
                            <p className="text-[10px] text-[var(--color-text-muted)] mt-2 text-center">
                                💡 Incluye captura de pantalla si es un error
                            </p>
                        </div>
                    </>
                )}
            </div>

            {/* Lightbox para imágenes */}
            {selectedImage && (
                <div
                    className="fixed inset-0 bg-black/90 z-[200] flex items-center justify-center p-4 animate-in fade-in duration-200"
                    onClick={handleCloseLightbox}
                >
                    <button
                        onClick={handleCloseLightbox}
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
        </>
    );
};

export default SupportWidget;
