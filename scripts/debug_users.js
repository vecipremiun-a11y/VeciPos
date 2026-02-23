import { createClient } from "@libsql/client";
import dotenv from 'dotenv';
dotenv.config();

const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

async function debug() {
    try {
        console.log("--- COMPANIES ---");
        const companies = await turso.execute("SELECT * FROM companies");
        console.table(companies.rows);

        console.log("\n--- USERS ---");
        const users = await turso.execute("SELECT id, name, username, role, company_id, has_labor_profile FROM users");
        console.table(users.rows);

        console.log("\n--- SUPER ADMIN ---");
        const superAdmin = await turso.execute("SELECT * FROM users WHERE username = 'Super_admin' OR name LIKE '%Super%'");
        console.table(superAdmin.rows);

        console.log("\n--- USER COMPANIES ---");
        const userCompanies = await turso.execute("SELECT * FROM user_companies");
        console.table(userCompanies.rows);
    } catch (e) {
        console.error("Debug failed:", e);
    }
}

debug();
