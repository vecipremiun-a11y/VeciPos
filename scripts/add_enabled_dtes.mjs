// Script to add enabled_dtes column to sii_config table
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config();

const db = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

async function main() {
    try {
        await db.execute(`ALTER TABLE sii_config ADD COLUMN enabled_dtes TEXT DEFAULT '[]'`);
        console.log('✅ Column enabled_dtes added to sii_config');
    } catch (err) {
        if (err.message?.includes('duplicate column') || err.message?.includes('already exists')) {
            console.log('ℹ️ Column enabled_dtes already exists');
        } else {
            console.error('❌ Error:', err.message);
        }
    }

    try {
        await db.execute(`ALTER TABLE sii_config ADD COLUMN default_dte INTEGER DEFAULT 39`);
        console.log('✅ Column default_dte added to sii_config');
    } catch (err) {
        if (err.message?.includes('duplicate column') || err.message?.includes('already exists')) {
            console.log('ℹ️ Column default_dte already exists');
        } else {
            console.error('❌ Error:', err.message);
        }
    }

    // Set default value for existing rows
    try {
        await db.execute({
            sql: `UPDATE sii_config SET enabled_dtes = ?`,
            args: [JSON.stringify([0, 39, 33, 34])]
        });
        console.log('✅ Default enabled_dtes set to [0,39,33,34] for existing rows');
    } catch (err) {
        console.error('❌ Error setting defaults:', err.message);
    }
    // Verify
    try {
        const result = await db.execute('SELECT company_id, enabled_dtes, default_dte, is_active FROM sii_config');
        result.rows.forEach(r => console.log(`  Company: ${r.company_id} | enabled: ${r.enabled_dtes} | default: ${r.default_dte} | active: ${r.is_active}`));
    } catch (err) {
        console.error('Verify error:', err.message);
    }
}

main();
