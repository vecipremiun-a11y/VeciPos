import { createClient } from "@libsql/client";

const url = "libsql://poskem-db-jasongo.aws-us-east-1.turso.io";
const authToken = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Njg5NDIwMTAsImlkIjoiNDYzNjhkMmUtOGQwZC00MjE2LWE2NDAtNTIxYmMzN2Q1ZmU0IiwicmlkIjoiOTBmYTJhN2QtNWUzYy00ZTI3LWI3NzYtNGM2NjAxNDVjMjQxIn0.34p8CQ5wVl2A7uJPxY3OnVAK4dUJM_Y-OnzpeiU7AwYGEkbNSE2y8Rx4c_Mgu00zdLMQTxW6Jc5xdIa4mJRFCA";

const client = createClient({
    url,
    authToken,
});

async function inspect() {
    try {
        console.log("--- TABLE INFO: users ---");
        const usersInfo = await client.execute("PRAGMA table_info(users)");
        console.table(usersInfo.rows);

        console.log("\n--- TABLE INFO: user_companies ---");
        const ucInfo = await client.execute("PRAGMA table_info(user_companies)");
        console.table(ucInfo.rows);

        console.log("\n--- USER ACCESS REPORT ---");
        const report = await client.execute(`
            SELECT u.id, u.username, u.name, u.company_id, uc.company_id as assigned_company, uc.role
            FROM users u
            LEFT JOIN user_companies uc ON u.id = uc.user_id
            ORDER BY u.id
            LIMIT 20
        `);
        console.table(report.rows);

    } catch (e) {
        console.error("Error:", e);
    }
}

inspect();
