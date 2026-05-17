import { Router } from "express";
import { pool } from "./db.js";

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
    if (!name || !email) return res.status(422).json({ error: "user name and email required" })
    const { rows } = await pool.query(
        "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *",
        [name, email]
    );
    res.status(201).json(rows[0])
})

router.delete("/:id", async (req, res) => {
    await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
    res.sendStatus(204)
})

export default router;
