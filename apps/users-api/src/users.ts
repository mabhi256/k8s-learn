import { Router } from "express";
import { Action } from "../generated/notify.js";
import { pool } from "./db";
import { notify } from "./notifyClient";

const router = Router();

router.get("/", async (_req, res) => {
    const { rows } = await pool.query("SELECT * FROM users ORDER BY id");
    res.json(rows)
})

router.get("/:id", async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "user not found" })
    res.json(rows)
})

router.post("/", async (req, res) => {
    const { name, email } = req.body
    req.log.debug({ name, email }, "creating user");
    if (!name || !email) return res.status(422).json({ error: "user name and email required" })
    const { rows } = await pool.query(
        "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *",
        [name, email]
    );

    if (!rows[0]) {
       res.sendStatus(409)
       return
    }
    const user = rows[0];
    notify(user.id, user.email, Action.CREATE).catch(
        err => console.error("notify failed:", err.message)
    );
    res.status(201).json(rows[0])
})

router.delete("/:id", async (req, res) => {
    const id = req.params.id
    req.log.debug({ id }, "deleting user");
    const { rows } = await pool.query("DELETE FROM users WHERE id = $1 RETURNING *", [id]);
    if (!rows[0]) {
       res.sendStatus(404)
       return
    }
    
    const user = rows[0];
    notify(user.id, user.email, Action.DELETE).catch(
        err => console.error("notify failed:", err.message)
    );
    res.sendStatus(204)
})

export default router;
