// Carga inicial de la app server-side (Fase 1 · Paso 35).
// `bootstrap` = el batch de metadata que fetchInitialData hacía directo contra
// Turso (12 lecturas en 1 round-trip). `userCompanies` = empresas del usuario
// (scope de sesión, sin companyId — se usa en recarga de página / selector).
// SEGURIDAD: el listado de usuarios ya NO devuelve el hash de contraseña.

// Empresas del usuario de la sesión (nunca de otro uid). MISMO filtro de estado
// que /api/auth/login: incluye trial/past_due/blocked además de active, para que
// una empresa en prueba o vencida NO desaparezca del selector tras recargar la
// página (antes filtraba solo 'active' → las trials creadas se volvían inentrables).
async function userCompanies(turso, session) {
    const r = await turso.execute({
        sql: `SELECT c.id, c.name, c.timezone, c.inventory_adjustment_mode, c.currency, c.credit_block_mode, uc.role
              FROM user_companies uc
              JOIN companies c ON uc.company_id = c.id
              WHERE uc.user_id = ? AND c.status IN ('active', 'trial', 'past_due', 'blocked')`,
        args: [session?.uid ?? null],
    });
    return { success: true, companies: r.rows };
}

// Metadata completa de la empresa activa (mismo set que cargaba el navegador).
async function bootstrap(turso, companyId) {
    const results = await turso.batch([
        // Primero se recortan los 200 lotes, DESPUÉS se les busca el nombre.
        //
        // Escrito al revés —join y después LIMIT— esta sola consulta se llevaba
        // todo el tiempo de entrada al sistema. El plan lo explica: el ORDER BY
        // no lo cubre ningún índice, así que SQLite tiene que armar la lista
        // entera antes de cortarla, y para armarla busca el producto de CADA
        // uno de los 3.883 lotes con stock. Cada una de esas búsquedas lee la
        // fila completa del producto, con la foto en base64 adentro: unos 150 MB
        // para devolver 200 filas de 0,05 MB.
        //
        // Medido el 14-ago-2026 contra la base real: 11-15 s la primera vez
        // (caché frío), ~2 s despues. Con el recorte adentro, 157 ms — se
        // ordenan 3.883 filas de lotes, que son chicas y no tienen foto, y solo
        // se buscan 200 productos. Mismas filas y mismo orden, verificado.
        //
        // Esto corría en CADA arranque de la app, para todos, aunque los lotes
        // solo los muestre el panel "por vencer" del Dashboard.
        { sql: `SELECT pl.id, pl.product_id, pl.batch_number, pl.expiry_date, pl.quantity, pl.cost, pl.supplier_name, pl.created_at, pl.status, pl.company_id, p.name AS product_name, p.unit AS product_unit
                  FROM (SELECT * FROM product_lots
                        WHERE company_id = ? AND quantity > 0
                        ORDER BY expiry_date ASC LIMIT 200) pl
                  LEFT JOIN products p ON p.id = pl.product_id`, args: [companyId] },
        { sql: 'SELECT * FROM categories WHERE company_id = ? ORDER BY name ASC', args: [companyId] },
        { sql: 'SELECT * FROM suppliers WHERE company_id = ? ORDER BY name ASC', args: [companyId] },
        { sql: 'SELECT u.*, uc.role AS company_role FROM users u LEFT JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ? WHERE u.company_id = ?', args: [companyId, companyId] },
        { sql: 'SELECT * FROM clients WHERE company_id = ? ORDER BY name ASC', args: [companyId] },
        { sql: 'SELECT * FROM role_permissions WHERE company_id = ?', args: [companyId] },
        { sql: 'SELECT * FROM tax_rates WHERE company_id = ?', args: [companyId] },
        { sql: 'SELECT * FROM company_modules WHERE company_id = ?', args: [companyId] },
        { sql: 'SELECT * FROM company_apps WHERE company_id = ?', args: [companyId] },
        { sql: 'SELECT * FROM payment_methods_config WHERE company_id = ?', args: [companyId] },
        { sql: 'SELECT * FROM payment_terminals WHERE company_id = ? AND is_active = 1', args: [companyId] },
        { sql: 'SELECT * FROM bank_accounts WHERE company_id = ? AND is_active = 1', args: [companyId] },
        { sql: 'SELECT inventory_adjustment_mode, currency, credit_block_mode, plan, status, trial_ends_at FROM companies WHERE id = ?', args: [companyId] },
    ], 'read');

    const [productLotsRes, categoriesRes, suppliersRes, usersRes, clientsRes, permissionsRes, taxesRes, modulesRes, appsRes, payConfigRes, payTerminalsRes, bankAccountsRes, companyConfigRes] = results;

    // Asegurar config de medios de pago (default si no existe) — idempotente.
    let paymentMethodsConfig = payConfigRes.rows[0];
    if (!paymentMethodsConfig) {
        try { await turso.execute({ sql: 'INSERT INTO payment_methods_config (company_id) VALUES (?)', args: [companyId] }); } catch { /* carrera / ya existe */ }
        paymentMethodsConfig = { company_id: companyId, cash_enabled: 1, card_enabled: 1, transfer_enabled: 1, credit_enabled: 1, mixed_enabled: 1 };
    }

    // El listado de usuarios NUNCA lleva el hash de contraseña al navegador.
    const users = usersRes.rows.map(({ password: _pw, ...u }) => u);

    return {
        success: true,
        productLots: productLotsRes.rows,
        categories: categoriesRes.rows,
        suppliers: suppliersRes.rows,
        users,
        clients: clientsRes.rows,
        rolePermissions: permissionsRes.rows,
        taxRates: taxesRes.rows,
        companyModules: modulesRes.rows,
        companyApps: appsRes.rows,
        paymentMethodsConfig,
        paymentTerminals: payTerminalsRes.rows,
        bankAccounts: bankAccountsRes.rows,
        companyConfig: companyConfigRes.rows[0] || null,
    };
}

// Reconstruye la sesión a partir de la cookie, sin pedir contraseña.
//
// La cookie de sesión es del NAVEGADOR, no de la pestaña. Si en una pestaña se
// inicia sesión con otro usuario, las demás quedan mostrando al anterior. Con esto
// esas pestañas pueden adoptar en silencio la cuenta que realmente tiene la sesión,
// en vez de quedarse pegadas en una cuenta que ya se cerró.
//
// Devuelve la misma forma que /api/auth/login (usuario sin contraseña, empresas y
// empresa activa) para que el cliente reutilice el mismo camino de arranque.
async function sessionUser(turso, session) {
    const uid = session?.uid ?? null;
    if (!uid) return { success: false, error: 'Sin sesión' };

    const [userRes, companiesRes] = await turso.batch([
        { sql: 'SELECT * FROM users WHERE id = ?', args: [uid] },
        {
            sql: `SELECT c.id, c.name, c.timezone, c.inventory_adjustment_mode, c.currency,
                         c.credit_block_mode, uc.role, c.status, c.trial_ends_at,
                         c.subscription_id, c.access_until
                  FROM user_companies uc
                  JOIN companies c ON uc.company_id = c.id
                  WHERE uc.user_id = ? AND c.status IN ('active', 'trial', 'past_due', 'blocked')
                  ORDER BY c.id`,
            args: [uid],
        },
    ], 'read');

    if (userRes.rows.length === 0) return { success: false, error: 'Usuario no encontrado' };
    const { password: _pw, ...user } = userRes.rows[0]; // nunca devolver el hash
    const companies = companiesRes.rows;
    if (companies.length === 0) return { success: false, error: 'Este usuario no tiene empresas asignadas.' };

    // Misma resolución de empresa activa que el login: home → primera.
    const activeCompanyId = (user.company_id && companies.some(c => c.id === user.company_id))
        ? user.company_id
        : companies[0].id;

    return { success: true, user, companies, activeCompanyId };
}

export const bootstrapActions = { bootstrap, userCompanies, sessionUser };
