import "./tracing"; // ← MUST be the very first import

import { trace } from "@opentelemetry/api";
import express, { NextFunction, Request, Response } from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { checkDB, pool } from "./db";
import { metricsMiddleware, register } from "./metrics";
import usersRouter from "./users";

const logger = pino({
    level: process.env.LOG_LEVEL ?? "info",
    formatters: {
        level: (label) => ({ level: label }),
    },
    mixin() {
        const ctx = trace.getActiveSpan()?.spanContext();
        return ctx ? { trace_id: ctx.traceId } : {};
    },
});
const app = express()
app.use(pinoHttp({
    logger,
    customProps: (_req, _res) => ({ protocol: "http" }),
    autoLogging: {
        // ignore application level logs containing these URLs
        ignore: (req) => ["/health", "/live", "/metrics"].includes(req.path ?? ""),
    },
}))
app.use(express.json())
app.use(metricsMiddleware);

let startupDone = false;

function requireDB(_req: Request, res: Response, next: NextFunction) {
    if (!startupDone) return res.status(503).json({ error: "db not ready" });
    next();
}

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

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
    logger.info(`users-api listening on :${PORT}`)

    // simulate heavy startup work (cache warm-up, model loading, etc.)
    logger.info("Running heavy startup tasks...")
    await new Promise((resolve) => setTimeout(resolve, 15_000))
    logger.info("Heavy startup tasks complete")

    checkDB()
        .then(() => { startupDone = true; })
        .catch((err) => {
            logger.error({ err: err.message }, "DB Check failed")
            shutdown()
        })
})

async function shutdown() {
    logger.info("...shutting down")
    await pool.end()
    process.exit(1)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
