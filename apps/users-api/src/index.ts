import express, { Request, Response, NextFunction } from "express";
import { checkDB, pool } from "./db";
import usersRouter from "./users";

const app = express()
app.use(express.json())

let startupDone = false;

function requireDB(_req: Request, res: Response, next: NextFunction) {
    if (!startupDone) return res.status(503).json({ error: "db not ready" });
    next();
}

app.get("/live", (_req, res) => res.json({ status: "ok" }));
app.get("/health", async (_req, res) => {
    if (!startupDone) return res.status(503).json({ status: "starting", db: false });
    try {
        await pool.query("SELECT 1");
        res.json({ status: "ok", db: true });
    } catch {
        res.status(503).json({ status: "degraded", db: false });
    }
});
app.use("/users", requireDB, usersRouter);

const PORT = process.env.PORT || 3000

// async so that /live works immediately
app.listen(PORT, async () => {
    console.log(`users-api listening on :${PORT}`)

    // simulate heavy startup work (cache warm-up, model loading, etc.)
    console.log("Running heavy startup tasks...")
    await new Promise((resolve) => setTimeout(resolve, 15_000))
    console.log("Heavy startup tasks complete")

    checkDB()
        .then(() => { startupDone = true; })
        .catch((err) => {
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
