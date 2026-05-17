import express from "express";
import { checkDB, dbReady, pool } from "./db.js";
import usersRouter from "./users.js";

const app = express()
app.use(express.json())

app.get("/live", (_req, res) => res.json({ status: "ok" }));
app.get("/health", (_req, res) => {
  if (!dbReady) return res.status(503).json({ status: "starting", db: false });
  res.json({ status: "ok", db: true });
});
app.use("/users", usersRouter);

const PORT = process.env.PORT || 3000

// async so that /live works immediately
app.listen(PORT, async () => {
    console.log(`users-api listening on :${PORT}`)

    // simulate heavy startup work (cache warm-up, model loading, etc.)
    console.log("Running heavy startup tasks...")
    await new Promise((resolve) => setTimeout(resolve, 15_000))
    console.log("Heavy startup tasks complete")

    // set dbReady true after completing the startup task
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
