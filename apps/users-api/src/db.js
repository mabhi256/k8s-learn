import { Pool } from "pg";

export const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
})

export let dbReady = false;

export async function checkDB() {
    await pool.query("SELECT 1");
    dbReady = true;
    console.log("DB ready")
}

export function requireDB(req, res, next) {
    if (!dbReady) return res.status(503).json({ error: "db not ready" })
    next()
}
