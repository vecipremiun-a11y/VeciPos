// One-time script to add inventory_adjustment_mode column
// Run this in browser console once, then delete this file

import { turso } from '../lib/turso';

async function addInventoryColumn() {
    try {
        console.log('Checking if column exists...');

        const companyInfo = await turso.execute(`PRAGMA table_info(companies)`);
        const hasInventoryMode = companyInfo.rows.some(col => col.name === 'inventory_adjustment_mode');

        if (!hasInventoryMode) {
            console.log('Adding inventory_adjustment_mode column...');
            await turso.execute(`ALTER TABLE companies ADD COLUMN inventory_adjustment_mode INTEGER DEFAULT 0`);
            console.log('✅ Column added successfully!');
        } else {
            console.log('✅ Column already exists!');
        }

        alert('Migration completed! Please reload the page.');
    } catch (e) {
        console.error('Migration error:', e);
        alert('Error: ' + e.message);
    }
}

// Auto-execute
addInventoryColumn();
