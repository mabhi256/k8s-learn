import { Pool } from "pg";

export const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
})

export async function checkDB() {
    await pool.query("SELECT 1");
}
