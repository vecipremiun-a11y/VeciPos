import dotenv from 'dotenv';
import { createClient } from '@libsql/client';

dotenv.config({ path: '.env.local' });
dotenv.config();

const client = createClient({
  url: process.env.VITE_TURSO_DATABASE_URL,
  authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

const now = new Date().toISOString();
await client.execute({
  sql: `
    UPDATE tienda_config
    SET tienda_url = ?,
        api_key = ?,
        api_secret = ?,
        webhook_secret = ?,
        is_active = 1,
        updated_at = ?
    WHERE company_id = ?
  `,
  args: [
    'https://miniveci-gamma.vercel.app/',
    'mvc_d6eb03e53cd24bada14ab15fa6874928',
    'mvs_9af301bdc1734031a188853e12885a383a0f385471af4abe88b1b6b1b3763d12',
    'MiniVeci_Segura_2026',
    now,
    'default',
  ],
});

const verify = await client.execute({
  sql: `
    SELECT company_id, tienda_url, api_key,
           substr(api_secret, 1, 8) || '...' as api_secret_preview,
           webhook_secret, is_active, updated_at
    FROM tienda_config
    WHERE company_id = ?
  `,
  args: ['default'],
});

console.log(JSON.stringify(verify.rows || [], null, 2));
