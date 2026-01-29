import { createClient } from "@libsql/client";
import dotenv from 'dotenv';
dotenv.config();

const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

async function check() {
    try {
        console.log("Checking DB...");
        const res = await turso.execute("SELECT * FROM products LIMIT 5");
        console.log("Products found:", res.rows.length);
        if (res.rows.length > 0) {
            console.log("Sample:", res.rows[0]);
        } else {
            console.log("No products found! Table might be empty or filtered.");
        }

        const count = await turso.execute("SELECT count(*) as c FROM products");
        console.log("Total count:", count.rows[0]);

    } catch (e) {
        console.error("DB Check Failed:", e);
    }
}

check();
