import fs from 'fs';
import csv from 'csv-parser';
import { createClient } from "@libsql/client";
import dotenv from 'dotenv';

dotenv.config();

const url = process.env.VITE_TURSO_DATABASE_URL;
const authToken = process.env.VITE_TURSO_AUTH_TOKEN;

if (!url || !authToken) {
    console.error("Missing VITE_TURSO_DATABASE_URL or VITE_TURSO_AUTH_TOKEN in .env");
    process.exit(1);
}

const client = createClient({
    url,
    authToken,
});

const results = [];
const csvPath = 'C:\\Users\\kennp\\OneDrive\\Escritorio\\productos.csv';

console.log(`Reading CSV from ${csvPath}...`);

fs.createReadStream(csvPath)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
        console.log(`Parsed ${results.length} rows.`);
        if (results.length > 0) {
            console.log("First row keys:", Object.keys(results[0]));
            console.log("First row sample:", results[0]);
        }

        const BATCH_SIZE = 50;

        // We need to clean keys if they have quotes explicitly included in the key name by the parser
        // But standard CSV parsers handle "header" correctly.
        // Let's assume standard behavior. 

        for (let i = 0; i < results.length; i += BATCH_SIZE) {
            const batch = results.slice(i, i + BATCH_SIZE);
            const values = [];
            const placeholders = [];

            for (const row of batch) {
                // Helper to get value even if key has extra quotes or whitespace
                const getValue = (key) => {
                    return row[key] || row[`"${key}"`] || row[key.trim()] || null;
                };

                // Map fields based on CSV header: id, nombre, codigo_barras, precio, costo, imagen_blob, iva
                const id = parseInt(getValue('id'));
                const name = getValue('nombre');
                const sku = getValue('codigo_barras');
                const price = parseFloat(getValue('precio'));
                const cost = parseFloat(getValue('costo'));
                const image = getValue('imagen_blob');
                const tax_rate = parseFloat(getValue('iva'));

                // Validate essential fields
                if (!id || !name) {
                    // console.warn('Skipping invalid row:', row);
                    // continue; 
                    // Actually we should try to insert even if some data is weird, unless ID is missing.
                    if (!id) continue;
                }

                placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?)');
                values.push(
                    id,
                    name,
                    price || 0,
                    0, // stock default
                    'General', // category default
                    sku || '',
                    image || '',
                    cost || 0,
                    tax_rate || 0
                );
            }

            if (values.length === 0) continue;

            const sql = `INSERT OR REPLACE INTO products (id, name, price, stock, category, sku, image, cost, tax_rate) VALUES ${placeholders.join(', ')}`;

            try {
                await client.execute({ sql, args: values });
                console.log(`Processed rows ${i + 1} to ${i + batch.length}`);
            } catch (e) {
                console.error(`Error processing batch starting at ${i}:`, e.message);
            }
        }

        console.log('Import completed.');
    });
