// Tickets de soporte — lado CLIENTE server-side (Fase 1 · Paso 28).
// FIX cross-tenant: las operaciones por ticketId verifican que el ticket
// pertenezca a la empresa de la sesión (antes cualquier ticketId servía).

const rid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// ¿El ticket es de esta empresa?
async function ownsTicket(turso, companyId, ticketId) {
    if (!ticketId) return false;
    const r = await turso.execute({
        sql: 'SELECT 1 FROM support_tickets WHERE id = ? AND company_id = ? LIMIT 1',
        args: [ticketId, companyId],
    });
    return r.rows.length > 0;
}

async function supportTicketCreate(turso, companyId, session, { subject, category = 'general', initialMessage = '' }) {
    const ticketId = rid('ticket');
    const now = new Date().toISOString();
    await turso.execute({
        sql: `INSERT INTO support_tickets (id, company_id, user_id, subject, category, status, priority, created_at, updated_at, last_message_at)
              VALUES (?, ?, ?, ?, ?, 'open', 'normal', ?, ?, ?)`,
        args: [ticketId, companyId, session?.uid ?? null, subject, category, now, now, now],
    });
    if (initialMessage) {
        await turso.execute({
            sql: `INSERT INTO support_messages (id, ticket_id, sender_type, sender_id, sender_name, message, created_at)
                  VALUES (?, ?, 'client', ?, ?, ?, ?)`,
            args: [rid('msg'), ticketId, String(session?.uid ?? ''), session?.username || '', initialMessage, now],
        });
    }
    return { success: true, ticketId };
}

async function supportTicketsList(turso, companyId) {
    const result = await turso.execute({
        sql: `SELECT t.*, u.name as user_name,
                (SELECT COUNT(*) FROM support_messages WHERE ticket_id = t.id AND sender_type = 'admin' AND read_by_client = 0) as unread_count
              FROM support_tickets t LEFT JOIN users u ON t.user_id = u.id
              WHERE t.company_id = ? ORDER BY t.updated_at DESC`,
        args: [companyId],
    });
    return { success: true, tickets: result.rows || [] };
}

async function supportTicketMessages(turso, companyId, session, { ticketId }) {
    if (!(await ownsTicket(turso, companyId, ticketId))) return { success: false, error: 'Ticket no encontrado' };
    const [msgRes, attRes] = await turso.batch([
        { sql: 'SELECT m.* FROM support_messages m WHERE m.ticket_id = ? ORDER BY m.created_at ASC', args: [ticketId] },
        { sql: 'SELECT * FROM support_attachments WHERE ticket_id = ?', args: [ticketId] },
    ], 'read');
    const attachments = attRes.rows || [];
    const messages = (msgRes.rows || []).map(msg => ({ ...msg, attachments: attachments.filter(a => a.message_id === msg.id) }));
    return { success: true, messages };
}

async function supportMessageSend(turso, companyId, session, { ticketId, message }) {
    if (!(await ownsTicket(turso, companyId, ticketId))) return { success: false, error: 'Ticket no encontrado' };
    const messageId = rid('msg');
    const now = new Date().toISOString();
    await turso.execute({
        sql: `INSERT INTO support_messages (id, ticket_id, sender_type, sender_id, sender_name, message, created_at, read_by_admin)
              VALUES (?, ?, 'client', ?, ?, ?, ?, 0)`,
        args: [messageId, ticketId, String(session?.uid ?? ''), session?.username || '', message, now],
    });
    await turso.execute({
        sql: 'UPDATE support_tickets SET updated_at = ?, last_message_at = ?, unread_by_admin = unread_by_admin + 1 WHERE id = ? AND company_id = ?',
        args: [now, now, ticketId, companyId],
    });
    return { success: true, messageId };
}

async function supportMessagesMarkRead(turso, companyId, session, { ticketId }) {
    if (!(await ownsTicket(turso, companyId, ticketId))) return { success: false, error: 'Ticket no encontrado' };
    await turso.batch([
        { sql: "UPDATE support_messages SET read_by_client = 1 WHERE ticket_id = ? AND sender_type = 'admin' AND read_by_client = 0", args: [ticketId] },
        { sql: 'UPDATE support_tickets SET unread_by_client = 0 WHERE id = ? AND company_id = ?', args: [ticketId, companyId] },
    ]);
    return { success: true };
}

async function supportAttachmentUpload(turso, companyId, session, { ticketId, messageId, filename, fileType, fileSize, base64 }) {
    if (!(await ownsTicket(turso, companyId, ticketId))) return { success: false, error: 'Ticket no encontrado' };
    const attachmentId = rid('att');
    await turso.execute({
        sql: `INSERT INTO support_attachments (id, message_id, ticket_id, filename, file_type, file_url, file_size, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [attachmentId, messageId, ticketId, filename, fileType, base64, fileSize, new Date().toISOString()],
    });
    return { success: true, attachmentId, url: base64 };
}

async function supportMessageAttachments(turso, companyId, session, { messageId }) {
    // El adjunto se une por ticket → validar propiedad vía join
    const result = await turso.execute({
        sql: `SELECT a.* FROM support_attachments a
              JOIN support_tickets t ON t.id = a.ticket_id
              WHERE a.message_id = ? AND t.company_id = ?`,
        args: [messageId, companyId],
    });
    return { success: true, attachments: result.rows || [] };
}

export const supportActions = {
    supportTicketCreate, supportTicketsList, supportTicketMessages,
    supportMessageSend, supportMessagesMarkRead, supportAttachmentUpload, supportMessageAttachments,
};
