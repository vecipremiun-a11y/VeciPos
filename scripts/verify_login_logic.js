import { createClient } from "@libsql/client";

const url = "libsql://poskem-db-jasongo.aws-us-east-1.turso.io";
const authToken = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Njg5NDIwMTAsImlkIjoiNDYzNjhkMmUtOGQwZC00MjE2LWE2NDAtNTIxYmMzN2Q1ZmU0IiwicmlkIjoiOTBmYTJhN2QtNWUzYy00ZTI3LWI3NzYtNGM2NjAxNDVjMjQxIn0.34p8CQ5wVl2A7uJPxY3OnVAK4dUJM_Y-OnzpeiU7AwYGEkbNSE2y8Rx4c_Mgu00zdLMQTxW6Jc5xdIa4mJRFCA";

const client = createClient({
    url,
    authToken,
});

async function simulateLogin(username) {
    console.log(`\n🔐 Simulating Login for: ${username}`);
    try {
        // 1. Fetch User
        const userRes = await client.execute({
            sql: "SELECT * FROM users WHERE username = ?",
            args: [username]
        });

        if (userRes.rows.length === 0) {
            console.log("❌ User not found");
            return;
        }

        const user = userRes.rows[0];
        console.log(`👤 User Found: ID=${user.id}, CompanyID=${user.company_id}`);

        // 2. Fetch Companies
        const companiesRes = await client.execute({
            sql: `SELECT c.id, c.name, c.timezone, uc.role 
                  FROM user_companies uc
                  JOIN companies c ON uc.company_id = c.id
                  WHERE uc.user_id = ? AND c.status = 'active'
                  ORDER BY c.id`,
            args: [user.id]
        });

        const userCompanies = companiesRes.rows;
        console.log(`🏢 Available Companies (${userCompanies.length}):`, userCompanies.map(c => c.id));

        // 3. PRIORITY LOGIC (Replicating useStore.js)
        let activeCompanyId;

        console.log("🤔 Determining Active Company...");

        // Priority 1: User Home Company
        if (user.company_id && userCompanies.some(c => c.id === user.company_id)) {
            activeCompanyId = user.company_id;
            console.log(`✅ [PRIORITY 1 MATCH] Using user home company: ${user.company_id}`);
        } else {
            console.log(`❌ [PRIORITY 1 SKIP] User has no company_id or it's not in available list.`);

            // Priority 2: LocalStorage (Simulated as null here, or we can mock it)
            const mockLocalStorage = null; // 'veci-2'; 
            if (mockLocalStorage && userCompanies.some(c => c.id === mockLocalStorage)) {
                activeCompanyId = mockLocalStorage;
                console.log(`✅ [PRIORITY 2 MATCH] Using stored company: ${mockLocalStorage}`);
            } else {
                // Priority 3: First Available
                if (userCompanies.length > 0) {
                    activeCompanyId = userCompanies[0].id;
                    console.log(`✅ [PRIORITY 3 FALLBACK] Using first assigned company: ${activeCompanyId}`);
                } else {
                    console.log("❌ No companies available.");
                }
            }
        }

        console.log(`\n🎉 FINAL RESULT: Active Company would be set to '${activeCompanyId}'`);

    } catch (e) {
        console.error("Error:", e);
    }
}

simulateLogin('jamile');
