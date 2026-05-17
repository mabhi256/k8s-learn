import express from "express";
import { checkDB, dbReady, pool } from "./db.js";
import usersRouter from "./users.js";

const app = express()
app.use(express.json())

app.get("/health", (_req, res) => res.json({ status: "ok", db: dbReady }));
app.use("/users", usersRouter);

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log(`users-api listening on :${PORT}`)
    checkDB().catch((err) => {
        console.error("DB Check failed:", err.message)
        shutdown()
    })
})

async function shutdown() {
    console.log("...shutting down")
    await pool.end()
    process.exit(1)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
