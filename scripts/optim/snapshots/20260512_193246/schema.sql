-- Snapshot schema · 2026-05-12T23:32:47.026Z
-- DB: libsql://poskem-db-jasongo.aws-us-east-1.turso.io

-- [index] idx_corrections_company_status (tbl: attendance_corrections)
CREATE INDEX idx_corrections_company_status ON attendance_corrections(company_id, status);

-- [index] idx_attendance_company_date (tbl: attendance_records)
CREATE INDEX idx_attendance_company_date ON attendance_records(company_id, date);

-- [index] idx_attendance_user_date (tbl: attendance_records)
CREATE INDEX idx_attendance_user_date ON attendance_records(user_id, date);

-- [index] idx_cash_movements_company (tbl: cash_movements)
CREATE INDEX idx_cash_movements_company ON cash_movements(company_id);

-- [index] idx_cash_movements_company_id (tbl: cash_movements)
CREATE INDEX idx_cash_movements_company_id ON cash_movements(company_id);

-- [index] idx_cash_movements_register (tbl: cash_movements)
CREATE INDEX idx_cash_movements_register ON cash_movements(register_id);

-- [index] idx_cash_registers_active (tbl: cash_registers)
CREATE INDEX idx_cash_registers_active ON cash_registers(company_id, status);

-- [index] idx_cash_registers_closure (tbl: cash_registers)
CREATE INDEX idx_cash_registers_closure 
                    ON cash_registers(company_id, opening_time DESC, status);

-- [index] idx_cash_registers_company (tbl: cash_registers)
CREATE INDEX idx_cash_registers_company ON cash_registers(company_id);

-- [index] idx_cash_registers_company_id (tbl: cash_registers)
CREATE INDEX idx_cash_registers_company_id ON cash_registers(company_id);

-- [index] idx_cash_registers_company_user (tbl: cash_registers)
CREATE INDEX idx_cash_registers_company_user ON cash_registers(company_id, user_id);

-- [index] idx_cash_registers_status_company (tbl: cash_registers)
CREATE INDEX idx_cash_registers_status_company ON cash_registers(status, company_id);

-- [index] idx_categories_company (tbl: categories)
CREATE INDEX idx_categories_company ON categories(company_id);

-- [index] idx_categories_company_id (tbl: categories)
CREATE INDEX idx_categories_company_id ON categories(company_id);

-- [index] idx_clients_company (tbl: clients)
CREATE INDEX idx_clients_company ON clients(company_id);

-- [index] idx_clients_company_id (tbl: clients)
CREATE INDEX idx_clients_company_id ON clients(company_id);

-- [index] idx_companies_status (tbl: companies)
CREATE INDEX idx_companies_status ON companies(status);

-- [index] idx_hourly_sales_company_date (tbl: hourly_sales_stats)
CREATE INDEX idx_hourly_sales_company_date 
ON hourly_sales_stats(company_id, date DESC, hour);

-- [index] idx_integration_logs_company_date (tbl: integration_sync_logs)
CREATE INDEX idx_integration_logs_company_date ON integration_sync_logs(company_id, created_at DESC);

-- [index] idx_integration_logs_event (tbl: integration_sync_logs)
CREATE INDEX idx_integration_logs_event ON integration_sync_logs(event, created_at DESC);

-- [index] idx_alerts_company_read (tbl: inventory_alerts)
CREATE INDEX idx_alerts_company_read ON inventory_alerts(company_id, is_read);

-- [index] idx_alerts_company_type (tbl: inventory_alerts)
CREATE INDEX idx_alerts_company_type ON inventory_alerts(company_id, alert_type);

-- [index] idx_inv_ctrl_items_ctrl (tbl: inventory_control_items)
CREATE INDEX idx_inv_ctrl_items_ctrl ON inventory_control_items(control_id);

-- [index] idx_inv_ctrl_company_status (tbl: inventory_controls)
CREATE INDEX idx_inv_ctrl_company_status ON inventory_controls(company_id, status);

-- [index] idx_absences_company_date (tbl: labor_absences)
CREATE INDEX idx_absences_company_date ON labor_absences(company_id, absence_date);

-- [index] idx_absences_user (tbl: labor_absences)
CREATE INDEX idx_absences_user ON labor_absences(user_id, absence_date);

-- [index] idx_payments_company (tbl: payments)
CREATE INDEX idx_payments_company ON payments(company_id);

-- [index] idx_payments_mercadopago (tbl: payments)
CREATE INDEX idx_payments_mercadopago ON payments(mercadopago_payment_id);

-- [index] idx_payments_status (tbl: payments)
CREATE INDEX idx_payments_status ON payments(status);

-- [index] idx_payroll_company_user (tbl: payroll_periods)
CREATE INDEX idx_payroll_company_user ON payroll_periods(company_id, user_id);

-- [index] idx_alert_settings_company (tbl: product_alert_settings)
CREATE INDEX idx_alert_settings_company ON product_alert_settings(company_id, is_active);

-- [index] idx_combo_items_combo (tbl: product_combo_items)
CREATE INDEX idx_combo_items_combo ON product_combo_items(combo_id);

-- [index] idx_combos_company_active (tbl: product_combos)
CREATE INDEX idx_combos_company_active ON product_combos(company_id, is_active);

-- [index] idx_product_daily_profit_lookup (tbl: product_daily_profit)
CREATE INDEX idx_product_daily_profit_lookup 
                    ON product_daily_profit(company_id, day, product_id);

-- [index] idx_product_daily_profit_top (tbl: product_daily_profit)
CREATE INDEX idx_product_daily_profit_top 
                    ON product_daily_profit(company_id, day, total_quantity DESC);

-- [index] idx_profit_company_day (tbl: product_daily_profit)
CREATE INDEX idx_profit_company_day ON product_daily_profit(company_id, day);

-- [index] idx_product_lots_company_id (tbl: product_lots)
CREATE INDEX idx_product_lots_company_id ON product_lots(company_id);

-- [index] idx_product_lots_company_product (tbl: product_lots)
CREATE INDEX idx_product_lots_company_product ON product_lots(company_id, product_id);

-- [index] idx_product_lots_company_qty (tbl: product_lots)
CREATE INDEX idx_product_lots_company_qty ON product_lots(company_id, quantity, expiry_date);

-- [index] idx_product_lots_expiry (tbl: product_lots)
CREATE INDEX idx_product_lots_expiry ON product_lots(expiry_date);

-- [index] idx_product_lots_fefo (tbl: product_lots)
CREATE INDEX idx_product_lots_fefo 
                    ON product_lots(product_id, expiry_date) 
                    WHERE quantity > 0;

-- [index] idx_product_lots_product (tbl: product_lots)
CREATE INDEX idx_product_lots_product ON product_lots(product_id, quantity);

-- [index] idx_product_movement_company (tbl: product_movement_stats)
CREATE INDEX idx_product_movement_company 
ON product_movement_stats(company_id, avg_daily_sales DESC);

-- [index] idx_product_movement_last_sale (tbl: product_movement_stats)
CREATE INDEX idx_product_movement_last_sale 
ON product_movement_stats(last_sale_date DESC);

-- [index] idx_products_category_company (tbl: products)
CREATE INDEX idx_products_category_company ON products(company_id, category, name);

-- [index] idx_products_company (tbl: products)
CREATE INDEX idx_products_company ON products(company_id);

-- [index] idx_products_company_id (tbl: products)
CREATE INDEX idx_products_company_id ON products(company_id);

-- [index] idx_products_company_salemode (tbl: products)
CREATE INDEX idx_products_company_salemode
                         ON products(company_id, sale_mode);

-- [index] idx_products_search (tbl: products)
CREATE INDEX idx_products_search ON products(company_id, name, sku);

-- [index] idx_products_stock_company (tbl: products)
CREATE INDEX idx_products_stock_company ON products(company_id, stock);

-- [index] idx_purchases_company (tbl: purchases)
CREATE INDEX idx_purchases_company ON purchases(company_id, date DESC);

-- [index] idx_purchases_company_date (tbl: purchases)
CREATE INDEX idx_purchases_company_date ON purchases(company_id, date);

-- [index] idx_purchases_company_id (tbl: purchases)
CREATE INDEX idx_purchases_company_id ON purchases(company_id);

-- [index] idx_role_permissions_unique (tbl: role_permissions)
CREATE UNIQUE INDEX idx_role_permissions_unique 
                    ON role_permissions(company_id, role, permission);

-- [index] idx_advances_company_user (tbl: salary_advances)
CREATE INDEX idx_advances_company_user ON salary_advances(company_id, user_id);

-- [index] idx_sales_client (tbl: sales)
CREATE INDEX idx_sales_client 
                    ON sales(client_id, company_id, date DESC) 
                    WHERE client_id IS NOT NULL;

-- [index] idx_sales_company_date (tbl: sales)
CREATE INDEX idx_sales_company_date ON sales(company_id, date);

-- [index] idx_sales_company_day_local (tbl: sales)
CREATE INDEX idx_sales_company_day_local ON sales(company_id, day_local);

-- [index] idx_sales_company_day_local_date (tbl: sales)
CREATE INDEX idx_sales_company_day_local_date ON sales(company_id, day_local, date DESC);

-- [index] idx_sales_company_id (tbl: sales)
CREATE INDEX idx_sales_company_id ON sales(company_id);

-- [index] idx_sales_company_id_desc (tbl: sales)
CREATE INDEX idx_sales_company_id_desc ON sales(company_id, id DESC);

-- [index] idx_sales_status (tbl: sales)
CREATE INDEX idx_sales_status 
                    ON sales(company_id, status, date DESC);

-- [index] idx_sales_user_date (tbl: sales)
CREATE INDEX idx_sales_user_date ON sales(user_id, date);

-- [index] idx_sales_user_date_company (tbl: sales)
CREATE INDEX idx_sales_user_date_company ON sales(user_id, date, company_id, payment_method);

-- [index] idx_sales_daily_summary_company (tbl: sales_daily_summary)
CREATE INDEX idx_sales_daily_summary_company ON sales_daily_summary(company_id);

-- [index] idx_sales_daily_summary_company_day (tbl: sales_daily_summary)
CREATE INDEX idx_sales_daily_summary_company_day 
ON sales_daily_summary(company_id, day);

-- [index] idx_sii_cafs_lookup (tbl: sii_cafs)
CREATE INDEX idx_sii_cafs_lookup ON sii_cafs(company_id, tipo_dte, estado);

-- [index] idx_sii_dtes_estado (tbl: sii_dtes)
CREATE INDEX idx_sii_dtes_estado ON sii_dtes(company_id, estado);

-- [index] idx_sii_dtes_folio (tbl: sii_dtes)
CREATE INDEX idx_sii_dtes_folio ON sii_dtes(company_id, tipo_dte, folio);

-- [index] idx_sii_dtes_sale (tbl: sii_dtes)
CREATE INDEX idx_sii_dtes_sale ON sii_dtes(company_id, sale_id);

-- [index] idx_sii_off_lookup (tbl: sii_offline_folios)
CREATE INDEX idx_sii_off_lookup ON sii_offline_folios(company_id, tipo_dte, status);

-- [index] idx_sii_off_user (tbl: sii_offline_folios)
CREATE INDEX idx_sii_off_user ON sii_offline_folios(company_id, reserved_for_user_id, status);

-- [index] idx_sii_rcof_lookup (tbl: sii_rcof)
CREATE INDEX idx_sii_rcof_lookup ON sii_rcof(company_id, fecha);

-- [index] idx_stock_adj_product (tbl: stock_adjustments)
CREATE INDEX idx_stock_adj_product ON stock_adjustments(company_id, product_id);

-- [index] idx_subscriptions_company (tbl: subscriptions)
CREATE INDEX idx_subscriptions_company ON subscriptions(company_id);

-- [index] idx_subscriptions_status (tbl: subscriptions)
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

-- [index] idx_supplier_purchase_company_date (tbl: supplier_purchase_summary)
CREATE INDEX idx_supplier_purchase_company_date 
ON supplier_purchase_summary(company_id, date DESC);

-- [index] idx_supplier_purchase_supplier (tbl: supplier_purchase_summary)
CREATE INDEX idx_supplier_purchase_supplier 
ON supplier_purchase_summary(supplier_id, date DESC);

-- [index] idx_suppliers_company (tbl: suppliers)
CREATE INDEX idx_suppliers_company ON suppliers(company_id);

-- [index] idx_suppliers_company_id (tbl: suppliers)
CREATE INDEX idx_suppliers_company_id ON suppliers(company_id);

-- [index] idx_attachments_ticket (tbl: support_attachments)
CREATE INDEX idx_attachments_ticket ON support_attachments(ticket_id);

-- [index] idx_messages_ticket (tbl: support_messages)
CREATE INDEX idx_messages_ticket ON support_messages(ticket_id, created_at);

-- [index] idx_notes_ticket (tbl: support_notes)
CREATE INDEX idx_notes_ticket ON support_notes(ticket_id, created_at);

-- [index] idx_suspended_sales_company_status (tbl: suspended_sales)
CREATE INDEX idx_suspended_sales_company_status ON suspended_sales(company_id, status, suspended_at DESC);

-- [index] idx_suspended_sales_user (tbl: suspended_sales)
CREATE INDEX idx_suspended_sales_user ON suspended_sales(user_id, status);

-- [index] idx_users_company (tbl: users)
CREATE INDEX idx_users_company ON users(company_id);

-- [index] idx_users_company_id (tbl: users)
CREATE INDEX idx_users_company_id ON users(company_id);

-- [index] idx_vacations_company (tbl: vacation_requests)
CREATE INDEX idx_vacations_company ON vacation_requests(company_id, start_date);

-- [index] idx_vendor_daily_perf (tbl: vendor_daily_performance)
CREATE INDEX idx_vendor_daily_perf ON vendor_daily_performance(company_id, date DESC);

-- [index] idx_vendor_perf_company_date (tbl: vendor_daily_performance)
CREATE INDEX idx_vendor_perf_company_date 
ON vendor_daily_performance(company_id, date DESC);

-- [index] idx_vendor_perf_user (tbl: vendor_daily_performance)
CREATE INDEX idx_vendor_perf_user 
ON vendor_daily_performance(user_id, date DESC);

-- [index] idx_shifts_company_date (tbl: work_shifts)
CREATE INDEX idx_shifts_company_date ON work_shifts(company_id, shift_date);

-- [table] attendance_corrections (tbl: attendance_corrections)
CREATE TABLE attendance_corrections (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            original_record_id INTEGER,
                            correction_type TEXT NOT NULL,
                            original_at TEXT,
                            requested_at TEXT,
                            requested_date TEXT NOT NULL,
                            reason TEXT NOT NULL,
                            status TEXT DEFAULT 'pending',
                            reviewed_by INTEGER,
                            reviewed_at TEXT,
                            reviewer_notes TEXT,
                            created_at TEXT NOT NULL,
                            FOREIGN KEY (user_id) REFERENCES users(id)
                        );

-- [table] attendance_records (tbl: attendance_records)
CREATE TABLE attendance_records (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            type TEXT NOT NULL,
                            recorded_at TEXT NOT NULL,
                            date TEXT NOT NULL,
                            source TEXT DEFAULT 'kiosk',
                            device_label TEXT,
                            branch TEXT,
                            recorded_by INTEGER,
                            notes TEXT,
                            is_corrected INTEGER DEFAULT 0,
                            FOREIGN KEY (user_id) REFERENCES users(id)
                        );

-- [table] audit_logs (tbl: audit_logs)
CREATE TABLE audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id TEXT,
                    user_id INTEGER,
                    action TEXT,
                    entity TEXT,
                    details TEXT,
                    created_at TEXT
                );

-- [table] bank_accounts (tbl: bank_accounts)
CREATE TABLE bank_accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id TEXT,
                    bank_name TEXT,
                    account_number TEXT,
                    account_type TEXT,
                    owner_name TEXT,
                    rut TEXT,
                    email TEXT,
                    is_active INTEGER DEFAULT 1,
                    created_at TEXT,
                    FOREIGN KEY(company_id) REFERENCES companies(id)
                );

-- [table] cash_movements (tbl: cash_movements)
CREATE TABLE cash_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, register_id INTEGER, type TEXT, amount REAL, reason TEXT, date TEXT, company_id TEXT DEFAULT 'default');

-- [table] cash_registers (tbl: cash_registers)
CREATE TABLE cash_registers (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, opening_amount REAL, opening_time TEXT, closing_time TEXT, status TEXT DEFAULT 'open', final_amount REAL, observations TEXT, difference REAL, company_id TEXT DEFAULT 'default');

-- [table] categories (tbl: categories)
CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
, show_in_pos BOOLEAN DEFAULT 1, company_id TEXT DEFAULT 'default', show_in_preorders BOOLEAN DEFAULT 1);

-- [table] clients (tbl: clients)
CREATE TABLE clients (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        rut TEXT,
                        phone TEXT,
                        email TEXT,
                        address TEXT,
                        created_at TEXT
                    , company_id TEXT DEFAULT 'default', credit_limit REAL DEFAULT 0, credit_period_days INTEGER DEFAULT 30, credit_enabled INTEGER DEFAULT 1, client_status TEXT DEFAULT 'active', total_debt REAL DEFAULT 0, pending_sales_count INTEGER DEFAULT 0, overdue_count INTEGER DEFAULT 0, razon_social TEXT DEFAULT '', giro TEXT DEFAULT '', comuna TEXT DEFAULT '', ciudad TEXT DEFAULT '');

-- [table] companies (tbl: companies)
CREATE TABLE companies (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    status TEXT DEFAULT 'active', -- active, suspended, deleted
                    created_at TEXT
                , timezone TEXT NOT NULL DEFAULT 'America/Santiago', country_code TEXT, currency TEXT, inventory_adjustment_mode INTEGER DEFAULT 0, plan TEXT DEFAULT 'basic', subscription_id TEXT, trial_ends_at TEXT, receipt_business_name TEXT, receipt_address TEXT, receipt_tax_id TEXT, receipt_phone TEXT, receipt_email TEXT, receipt_header_message TEXT, receipt_footer_message TEXT, receipt_show_tax_id INTEGER DEFAULT 1, receipt_show_phone INTEGER DEFAULT 1, receipt_show_email INTEGER DEFAULT 1, legal_name TEXT, full_address TEXT, tax_id_legal TEXT, phone_main TEXT, email_main TEXT, city TEXT, country TEXT DEFAULT 'Chile', postal_code TEXT, website TEXT, business_type TEXT, payment_methods TEXT, credit_block_mode TEXT DEFAULT 'warn');

-- [table] company_modules (tbl: company_modules)
CREATE TABLE company_modules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    module_key TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    updated_at TEXT,
    UNIQUE(company_id, module_key)
);

-- [table] custom_roles (tbl: custom_roles)
CREATE TABLE custom_roles (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        company_id TEXT NOT NULL,
                        role_name TEXT NOT NULL,
                        description TEXT,
                        color TEXT DEFAULT '#6366f1',
                        is_system INTEGER DEFAULT 0,
                        created_at TEXT,
                        UNIQUE(company_id, role_name)
                    );

-- [table] hourly_sales_stats (tbl: hourly_sales_stats)
CREATE TABLE hourly_sales_stats (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    date TEXT NOT NULL,
    hour INTEGER NOT NULL, -- 0-23
    
    -- Métricas
    total_sales INTEGER DEFAULT 0,
    total_amount REAL DEFAULT 0,
    
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    
    UNIQUE(company_id, date, hour)
);

-- [table] integration_sync_logs (tbl: integration_sync_logs)
CREATE TABLE integration_sync_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id TEXT,
            direction TEXT,
            event TEXT,
            status TEXT,
            message TEXT,
            payload TEXT,
            response TEXT,
            error TEXT,
            created_at TEXT
        );

-- [table] inventory_alerts (tbl: inventory_alerts)
CREATE TABLE inventory_alerts (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            product_id INTEGER,
                            product_name TEXT,
                            alert_type TEXT NOT NULL,
                            priority TEXT DEFAULT 'normal',
                            title TEXT NOT NULL,
                            message TEXT NOT NULL,
                            current_stock REAL,
                            threshold REAL,
                            days_remaining REAL,
                            is_read INTEGER DEFAULT 0,
                            channel TEXT DEFAULT 'system',
                            sent INTEGER DEFAULT 0,
                            sent_at TEXT,
                            created_at TEXT
                        );

-- [table] inventory_control_items (tbl: inventory_control_items)
CREATE TABLE inventory_control_items (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            control_id INTEGER NOT NULL,
                            product_id INTEGER NOT NULL,
                            product_name TEXT NOT NULL,
                            product_sku TEXT,
                            system_stock REAL NOT NULL,
                            counted_stock REAL NOT NULL,
                            difference REAL NOT NULL,
                            cost REAL DEFAULT 0,
                            counted_at TEXT NOT NULL,
                            updated_at TEXT,
                            UNIQUE(control_id, product_id)
                        );

-- [table] inventory_controls (tbl: inventory_controls)
CREATE TABLE inventory_controls (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            user_name TEXT,
                            name TEXT NOT NULL,
                            type TEXT NOT NULL DEFAULT 'free',
                            category TEXT,
                            status TEXT DEFAULT 'in_progress',
                            total_products INTEGER DEFAULT 0,
                            counted_products INTEGER DEFAULT 0,
                            notes TEXT,
                            started_at TEXT NOT NULL,
                            completed_at TEXT,
                            created_at TEXT
                        );

-- [table] inventory_losses (tbl: inventory_losses)
CREATE TABLE inventory_losses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id TEXT,
                    lot_id INTEGER,
                    product_id INTEGER,
                    product_name TEXT,
                    product_sku TEXT,
                    batch_number TEXT,
                    expiry_date TEXT,
                    quantity REAL,
                    cost_per_unit REAL,
                    total_loss REAL,
                    reason TEXT DEFAULT 'expired',
                    notes TEXT,
                    user_id TEXT,
                    created_at TEXT
                );

-- [table] labor_absences (tbl: labor_absences)
CREATE TABLE labor_absences (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            absence_date TEXT NOT NULL,
                            type TEXT NOT NULL,
                            status TEXT DEFAULT 'approved',
                            notes TEXT,
                            approved_by INTEGER,
                            created_at TEXT NOT NULL, half_day INTEGER DEFAULT 0, half_day_period TEXT DEFAULT NULL, hours REAL DEFAULT NULL, group_id TEXT DEFAULT NULL,
                            FOREIGN KEY (user_id) REFERENCES users(id)
                        );

-- [table] payment_methods_config (tbl: payment_methods_config)
CREATE TABLE payment_methods_config (
                    company_id TEXT PRIMARY KEY,
                    cash_enabled INTEGER DEFAULT 1,
                    card_enabled INTEGER DEFAULT 1,
                    transfer_enabled INTEGER DEFAULT 1,
                    credit_enabled INTEGER DEFAULT 1,
                    mixed_enabled INTEGER DEFAULT 1,
                    FOREIGN KEY(company_id) REFERENCES companies(id)
                );

-- [table] payment_terminals (tbl: payment_terminals)
CREATE TABLE payment_terminals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id TEXT,
                    name TEXT,
                    code TEXT,
                    is_active INTEGER DEFAULT 1,
                    created_at TEXT, color TEXT DEFAULT '#3B82F6',
                    FOREIGN KEY(company_id) REFERENCES companies(id)
                );

-- [table] payments (tbl: payments)
CREATE TABLE payments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    subscription_id TEXT,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'CLP',
    status TEXT DEFAULT 'pending',
    mercadopago_payment_id TEXT,
    mercadopago_preference_id TEXT,
    payment_method TEXT,
    payer_email TEXT,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (company_id) REFERENCES companies(id),
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);

-- [table] payroll_payments (tbl: payroll_payments)
CREATE TABLE payroll_payments (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            period_id INTEGER,
                            amount_paid REAL NOT NULL,
                            payment_date TEXT NOT NULL,
                            pay_method TEXT DEFAULT 'cash',
                            status TEXT DEFAULT 'paid',
                            notes TEXT,
                            created_by INTEGER,
                            created_at TEXT NOT NULL,
                            FOREIGN KEY (user_id) REFERENCES users(id)
                        );

-- [table] payroll_periods (tbl: payroll_periods)
CREATE TABLE payroll_periods (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            period_label TEXT NOT NULL,
                            period_start TEXT NOT NULL,
                            period_end TEXT NOT NULL,
                            hours_worked REAL DEFAULT 0,
                            days_absent INTEGER DEFAULT 0,
                            late_count INTEGER DEFAULT 0,
                            late_minutes INTEGER DEFAULT 0,
                            extra_hours REAL DEFAULT 0,
                            manual_bonus REAL DEFAULT 0,
                            manual_discount REAL DEFAULT 0,
                            advances_discounted REAL DEFAULT 0,
                            base_amount REAL DEFAULT 0,
                            total_to_pay REAL DEFAULT 0,
                            is_closed INTEGER DEFAULT 0,
                            notes TEXT,
                            created_by INTEGER,
                            created_at TEXT NOT NULL,
                            closed_at TEXT,
                            FOREIGN KEY (user_id) REFERENCES users(id)
                        );

-- [table] personal_config (tbl: personal_config)
CREATE TABLE personal_config (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL UNIQUE,
                            late_tolerance_minutes INTEGER DEFAULT 10,
                            kiosk_device_label TEXT DEFAULT 'Kiosco Principal',
                            created_at TEXT,
                            updated_at TEXT
                        );

-- [table] preorder_items (tbl: preorder_items)
CREATE TABLE preorder_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    preorder_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    qty REAL DEFAULT 1,
    unit TEXT DEFAULT 'Und',
    unit_price REAL DEFAULT 0,
    line_total REAL DEFAULT 0,
    note TEXT, billing_unit TEXT DEFAULT 'unit', price_per_kg REAL DEFAULT 0, gram_per_unit REAL DEFAULT 0, estimated_total REAL DEFAULT 0, real_weight_kg REAL, real_total REAL,
    FOREIGN KEY (preorder_id) REFERENCES preorders(id) ON DELETE CASCADE
);

-- [table] preorder_payments (tbl: preorder_payments)
CREATE TABLE preorder_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    preorder_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    method TEXT DEFAULT 'Efectivo',
    type TEXT DEFAULT 'deposit',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (preorder_id) REFERENCES preorders(id) ON DELETE CASCADE
);

-- [table] preorders (tbl: preorders)
CREATE TABLE preorders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    client_id INTEGER,
    client_name TEXT,
    client_phone TEXT,
    due_date TEXT NOT NULL,
    due_time TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    total_amount REAL DEFAULT 0,
    deposit_amount REAL DEFAULT 0,
    remaining_amount REAL DEFAULT 0,
    delivery_type TEXT DEFAULT 'pickup',
    delivery_address TEXT,
    notes TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
, estimated_total REAL DEFAULT 0, real_total REAL);

-- [table] preventas (tbl: preventas)
CREATE TABLE preventas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id TEXT NOT NULL,
                code TEXT NOT NULL,
                items TEXT NOT NULL,
                client_data TEXT,
                total REAL NOT NULL DEFAULT 0,
                created_by INTEGER,
                created_by_name TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                completed_by INTEGER,
                completed_at TEXT,
                sale_id INTEGER,
                created_at TEXT NOT NULL,
                UNIQUE(company_id, code)
            );

-- [table] product_alert_settings (tbl: product_alert_settings)
CREATE TABLE product_alert_settings (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            product_id INTEGER NOT NULL,
                            min_stock REAL NOT NULL DEFAULT 5,
                            critical_stock REAL NOT NULL DEFAULT 2,
                            priority TEXT DEFAULT 'normal',
                            notify_system INTEGER DEFAULT 1,
                            notify_whatsapp INTEGER DEFAULT 0,
                            is_active INTEGER DEFAULT 1,
                            cooldown_hours INTEGER DEFAULT 6,
                            last_notified_at TEXT,
                            created_at TEXT,
                            UNIQUE(company_id, product_id)
                        );

-- [table] product_combo_items (tbl: product_combo_items)
CREATE TABLE product_combo_items (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            combo_id INTEGER NOT NULL,
                            product_id INTEGER NOT NULL,
                            product_name TEXT NOT NULL,
                            product_sku TEXT,
                            quantity REAL NOT NULL DEFAULT 1,
                            cost REAL DEFAULT 0,
                            FOREIGN KEY(combo_id) REFERENCES product_combos(id) ON DELETE CASCADE
                        );

-- [table] product_combos (tbl: product_combos)
CREATE TABLE product_combos (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            name TEXT NOT NULL,
                            sku TEXT,
                            price REAL NOT NULL,
                            cost REAL DEFAULT 0,
                            image TEXT,
                            description TEXT,
                            is_active INTEGER DEFAULT 1,
                            has_dates INTEGER DEFAULT 0,
                            start_date TEXT,
                            end_date TEXT,
                            tax_rate REAL DEFAULT 0,
                            created_at TEXT,
                            updated_at TEXT
                        );

-- [table] product_daily_profit (tbl: product_daily_profit)
CREATE TABLE product_daily_profit (
    company_id TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    day TEXT NOT NULL,  
    total_quantity INTEGER NOT NULL DEFAULT 0,
    total_revenue REAL NOT NULL DEFAULT 0,
    total_cost REAL NOT NULL DEFAULT 0,
    total_tax REAL NOT NULL DEFAULT 0,
    total_profit REAL NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (company_id, product_id, day)
);

-- [table] product_lots (tbl: product_lots)
CREATE TABLE product_lots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    product_id INTEGER,
                    batch_number TEXT,
                    expiry_date TEXT,
                    quantity REAL,
                    cost REAL,
                    supplier_name TEXT,
                    created_at TEXT,
                    status TEXT DEFAULT 'active'
                , company_id TEXT DEFAULT 'default', purchase_id INTEGER, initial_quantity REAL);

-- [table] product_movement_stats (tbl: product_movement_stats)
CREATE TABLE product_movement_stats (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    product_name TEXT,
    
    -- Totales acumulados
    total_sold_all_time INTEGER DEFAULT 0,
    total_revenue_all_time REAL DEFAULT 0,
    
    -- Últimos 7 días
    sold_last_7_days INTEGER DEFAULT 0,
    revenue_last_7_days REAL DEFAULT 0,
    
    -- Últimos 30 días
    sold_last_30_days INTEGER DEFAULT 0,
    revenue_last_30_days REAL DEFAULT 0,
    
    -- Velocidad de venta (unidades por día)
    avg_daily_sales REAL DEFAULT 0,
    
    -- Última venta
    last_sale_date TEXT,
    
    updated_at TEXT NOT NULL,
    
    UNIQUE(company_id, product_id)
);

-- [table] products (tbl: products)
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  stock INTEGER NOT NULL,
  category TEXT NOT NULL,
  sku TEXT NOT NULL,
  image TEXT,
  cost REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  unit TEXT DEFAULT 'Und',
  supplier TEXT,
  pending_adjustment BOOLEAN DEFAULT 0,
  is_offer BOOLEAN DEFAULT 0,
  offer_price REAL DEFAULT 0,
  price_ranges TEXT DEFAULT '[]',
  scale_group_id TEXT,
  company_id TEXT DEFAULT 'default', original_price REAL, sale_mode TEXT DEFAULT 'sale_only', allow_item_notes BOOLEAN DEFAULT 0, preorder_unit TEXT DEFAULT NULL, preorder_billing_unit TEXT DEFAULT 'unit', preorder_price_per_kg REAL DEFAULT 0, preorder_gram_per_unit REAL DEFAULT 0, preorder_use_base_price BOOLEAN DEFAULT 1, units_per_box INTEGER DEFAULT 0,
  UNIQUE(sku, company_id)
);

-- [table] purchases (tbl: purchases)
CREATE TABLE purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER,
    supplier_name TEXT,
    invoice_number TEXT,
    date DATETIME,
    total REAL,
    items TEXT,
    status TEXT DEFAULT 'completed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_id INTEGER
, is_credit INTEGER DEFAULT 0, credit_days INTEGER, expiry_date TEXT, deposit REAL DEFAULT 0, payment_method TEXT, company_id TEXT DEFAULT 'default', amount_paid REAL DEFAULT 0, payment_date TEXT, payment_observation TEXT, payment_document TEXT, observation TEXT, document TEXT);

-- [table] role_permissions (tbl: role_permissions)
CREATE TABLE role_permissions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    permission TEXT NOT NULL,
                    granted INTEGER DEFAULT 1,
                    UNIQUE(company_id, role, permission)
                );

-- [table] roles (tbl: roles)
CREATE TABLE roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    is_system BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, name)
);

-- [table] salary_advances (tbl: salary_advances)
CREATE TABLE salary_advances (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            amount REAL NOT NULL,
                            advance_date TEXT NOT NULL,
                            reason TEXT,
                            pay_method TEXT DEFAULT 'cash',
                            status TEXT DEFAULT 'pending',
                            period_id INTEGER,
                            created_by INTEGER,
                            created_at TEXT NOT NULL,
                            FOREIGN KEY (user_id) REFERENCES users(id)
                        );

-- [table] sale_returns (tbl: sale_returns)
CREATE TABLE sale_returns (
                id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL, sale_id INTEGER NOT NULL,
                user_id INTEGER, reason TEXT NOT NULL, items TEXT NOT NULL, total REAL NOT NULL, created_at TEXT NOT NULL
            );

-- [table] sales (tbl: sales)
CREATE TABLE sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  total REAL NOT NULL,
  summary TEXT,
  items TEXT -- Storing JSON string for simplicity in this MVP
, payment_method TEXT, payment_details TEXT, user_id INTEGER, status TEXT DEFAULT 'completed', observation TEXT, has_negative_stock BOOLEAN DEFAULT 0, client_id INTEGER, client_name TEXT, company_id TEXT DEFAULT 'default', day_local TEXT, payment_due_date TEXT, amount_paid REAL DEFAULT 0);

-- [table] sales_daily_summary (tbl: sales_daily_summary)
CREATE TABLE sales_daily_summary (
    company_id TEXT NOT NULL,
    day TEXT NOT NULL,
    total_sales REAL NOT NULL DEFAULT 0,
    total_orders INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (company_id, day)
);

-- [table] sii_cafs (tbl: sii_cafs)
CREATE TABLE sii_cafs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id TEXT NOT NULL, tipo_dte INTEGER NOT NULL,
            folio_desde INTEGER NOT NULL, folio_hasta INTEGER NOT NULL,
            folio_actual INTEGER NOT NULL, caf_xml TEXT NOT NULL,
            caf_fingerprint TEXT, estado TEXT DEFAULT 'active',
            created_at TEXT, updated_at TEXT
        );

-- [table] sii_config (tbl: sii_config)
CREATE TABLE sii_config (
            company_id TEXT PRIMARY KEY,
            rut_emisor TEXT NOT NULL DEFAULT '',
            razon_social TEXT NOT NULL DEFAULT '',
            giro TEXT NOT NULL DEFAULT '',
            direccion TEXT, comuna TEXT, ciudad TEXT, acteco TEXT,
            certificado_pfx TEXT, certificado_password TEXT,
            ambiente TEXT DEFAULT 'certificacion',
            sii_resolution_number TEXT, sii_resolution_date TEXT,
            auto_emit INTEGER DEFAULT 1, is_active INTEGER DEFAULT 0,
            created_at TEXT, updated_at TEXT
        , enabled_dtes TEXT DEFAULT '[]', default_dte INTEGER DEFAULT 39);

-- [table] sii_dtes (tbl: sii_dtes)
CREATE TABLE sii_dtes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id TEXT NOT NULL, sale_id INTEGER,
            tipo_dte INTEGER NOT NULL, folio INTEGER NOT NULL,
            rut_receptor TEXT, razon_social_receptor TEXT,
            monto_total INTEGER, monto_neto INTEGER, monto_iva INTEGER,
            xml_firmado TEXT, track_id TEXT,
            estado TEXT DEFAULT 'pending', sii_response TEXT,
            created_at TEXT, updated_at TEXT
        );

-- [table] sii_offline_folios (tbl: sii_offline_folios)
CREATE TABLE sii_offline_folios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id TEXT NOT NULL,
            tipo_dte INTEGER NOT NULL,
            folio INTEGER NOT NULL,
            caf_id INTEGER NOT NULL,
            reserved_for_user_id TEXT,
            status TEXT NOT NULL DEFAULT 'reserved',
            sale_id INTEGER,
            sale_temp_id TEXT,
            reserved_at TEXT,
            used_at TEXT,
            UNIQUE(company_id, tipo_dte, folio)
        );

-- [table] sii_rcof (tbl: sii_rcof)
CREATE TABLE sii_rcof (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id TEXT NOT NULL, fecha TEXT NOT NULL,
            xml TEXT, track_id TEXT, estado TEXT DEFAULT 'pending', created_at TEXT
        );

-- [table] stock_adjustments (tbl: stock_adjustments)
CREATE TABLE stock_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id TEXT NOT NULL,
        product_id INTEGER NOT NULL,
        user_id INTEGER,
        user_name TEXT,
        old_stock REAL NOT NULL,
        new_stock REAL NOT NULL,
        difference REAL NOT NULL,
        reason TEXT DEFAULT 'manual',
        created_at TEXT NOT NULL
    );

-- [table] subscription_plans (tbl: subscription_plans)
CREATE TABLE subscription_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    currency TEXT DEFAULT 'CLP',
    frequency TEXT NOT NULL,
    description TEXT,
    features TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- [table] subscriptions (tbl: subscriptions)
CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'CLP',
    current_period_start TEXT,
    current_period_end TEXT,
    trial_end TEXT,
    cancelled_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (company_id) REFERENCES companies(id),
    FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
);

-- [table] supplier_orders (tbl: supplier_orders)
CREATE TABLE supplier_orders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id TEXT,
                    user_id TEXT,
                    supplier_id INTEGER,
                    supplier_name TEXT,
                    seller_name TEXT,
                    total_amount REAL,
                    items TEXT,
                    status TEXT DEFAULT 'pending',
                    created_at TEXT,
                    expected_delivery_date TEXT,
                    FOREIGN KEY(company_id) REFERENCES companies(id)
                );

-- [table] supplier_purchase_summary (tbl: supplier_purchase_summary)
CREATE TABLE supplier_purchase_summary (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    supplier_id INTEGER NOT NULL,
    supplier_name TEXT,
    date TEXT NOT NULL,
    
    -- Compras
    total_purchases INTEGER DEFAULT 0,
    total_amount REAL DEFAULT 0,
    total_items INTEGER DEFAULT 0,
    
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    
    UNIQUE(company_id, supplier_id, date)
);

-- [table] suppliers (tbl: suppliers)
CREATE TABLE suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
, company_id TEXT DEFAULT 'default', seller_name TEXT, order_days TEXT, delivery_days TEXT);

-- [table] support_attachments (tbl: support_attachments)
CREATE TABLE support_attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    ticket_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT,
    file_url TEXT NOT NULL,
    file_size INTEGER,
    created_at TEXT NOT NULL
);

-- [table] support_messages (tbl: support_messages)
CREATE TABLE support_messages (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    sender_type TEXT NOT NULL,
    sender_id TEXT,
    sender_name TEXT,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    is_internal_note INTEGER DEFAULT 0,
    read_by_client INTEGER DEFAULT 0,
    read_by_admin INTEGER DEFAULT 0
);

-- [table] support_notes (tbl: support_notes)
CREATE TABLE support_notes (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    admin_id TEXT NOT NULL,
    admin_name TEXT,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- [table] support_tickets (tbl: support_tickets)
CREATE TABLE support_tickets (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id INTEGER,
    subject TEXT,
    category TEXT DEFAULT 'general',
    status TEXT DEFAULT 'open',
    priority TEXT DEFAULT 'normal',
    assigned_to TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT,
    last_message_at TEXT,
    unread_by_client INTEGER DEFAULT 0,
    unread_by_admin INTEGER DEFAULT 1
);

-- [table] suspended_sales (tbl: suspended_sales)
CREATE TABLE suspended_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    items TEXT NOT NULL,
    client_data TEXT,
    subtotal REAL DEFAULT 0,
    tax REAL DEFAULT 0,
    total REAL NOT NULL,
    items_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'suspended',
    suspended_at TEXT NOT NULL,
    recovered_at TEXT,
    recovered_by TEXT,
    created_at TEXT NOT NULL
);

-- [table] system_settings (tbl: system_settings)
CREATE TABLE system_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );

-- [table] tax_rates (tbl: tax_rates)
CREATE TABLE tax_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    rate REAL NOT NULL, -- Porcentaje (ej: 19.0)
    is_default BOOLEAN DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- [table] tienda_config (tbl: tienda_config)
CREATE TABLE tienda_config (
            company_id TEXT PRIMARY KEY,
            tienda_url TEXT,
            api_key TEXT,
            api_secret TEXT,
            webhook_secret TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TEXT,
            updated_at TEXT
        , api_consumer_key TEXT, api_consumer_secret TEXT);

-- [table] user_companies (tbl: user_companies)
CREATE TABLE user_companies (
                    user_id INTEGER,
                    company_id TEXT,
                    role TEXT,
                    PRIMARY KEY (user_id, company_id)
                );

-- [table] users (tbl: users)
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL
, company_id TEXT DEFAULT 'default', has_labor_profile INTEGER DEFAULT 0, labor_position TEXT, labor_branch TEXT, labor_start_date TEXT, labor_status TEXT DEFAULT 'active', labor_pin TEXT, pay_type TEXT DEFAULT 'monthly', pay_method TEXT DEFAULT 'cash', pay_day TEXT, pay_base_amount REAL DEFAULT 0, pay_fixed_bonus REAL DEFAULT 0, pay_fixed_discount REAL DEFAULT 0, pay_bank_name TEXT, pay_bank_account TEXT, pay_bank_account_type TEXT, pay_bank_owner TEXT);

-- [table] vacation_balances (tbl: vacation_balances)
CREATE TABLE vacation_balances (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL UNIQUE,
                            initial_balance REAL DEFAULT 0,
                            accrued_days REAL DEFAULT 0,
                            used_days REAL DEFAULT 0,
                            FOREIGN KEY (user_id) REFERENCES users(id)
                        );

-- [table] vacation_requests (tbl: vacation_requests)
CREATE TABLE vacation_requests (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            start_date TEXT NOT NULL,
                            end_date TEXT NOT NULL,
                            total_days INTEGER NOT NULL,
                            status TEXT DEFAULT 'pending',
                            notes TEXT,
                            reviewed_by INTEGER,
                            reviewed_at TEXT,
                            created_at TEXT NOT NULL,
                            FOREIGN KEY (user_id) REFERENCES users(id)
                        );

-- [table] vendor_daily_performance (tbl: vendor_daily_performance)
CREATE TABLE vendor_daily_performance (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    user_name TEXT,
    date TEXT NOT NULL,
    
    -- Métricas de ventas
    total_sales INTEGER DEFAULT 0,
    total_amount REAL DEFAULT 0,
    total_profit REAL DEFAULT 0,
    avg_ticket REAL DEFAULT 0,
    
    -- Items
    total_items_sold INTEGER DEFAULT 0,
    
    -- Tiempo trabajado (opcional para calcular productividad)
    first_sale_time TEXT,
    last_sale_time TEXT,
    
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    
    UNIQUE(company_id, user_id, date)
);

-- [table] work_shifts (tbl: work_shifts)
CREATE TABLE work_shifts (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            shift_date TEXT NOT NULL,
                            start_time TEXT NOT NULL,
                            end_time TEXT NOT NULL,
                            branch TEXT,
                            notes TEXT,
                            created_by INTEGER,
                            created_at TEXT NOT NULL,
                            UNIQUE(user_id, shift_date)
                        );
