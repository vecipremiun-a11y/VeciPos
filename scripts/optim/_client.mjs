// Cliente Turso compartido para scripts de optimización.
// Lee credenciales de .env.local (prioridad) o .env.
//
// IMPORTANTE: Estos scripts son herramientas standalone. NO se importan desde
// el bundle de la app (Vite/React). NO afectan el runtime del POS.

import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function loadEnvFile(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[m[1]] = val;
    }
    return out;
  } catch {
    return null;
  }
}

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), '..', '..');
const envLocal = loadEnvFile(path.join(root, '.env.local')) || {};
const envBase = loadEnvFile(path.join(root, '.env')) || {};
const env = { ...envBase, ...envLocal, ...process.env };

const url = env.VITE_TURSO_DATABASE_URL || env.TURSO_DATABASE_URL;
const authToken = env.VITE_TURSO_AUTH_TOKEN || env.TURSO_AUTH_TOKEN;

if (!url) {
  console.error('Falta VITE_TURSO_DATABASE_URL en .env / .env.local');
  process.exit(1);
}

export const db = createClient({ url, authToken });
export const dbUrl = url;

export function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '_' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

export const SNAPSHOTS_DIR = path.join(root, 'scripts', 'optim', 'snapshots');
export const REPORTS_DIR = path.join(root, 'scripts', 'optim', 'reports');
