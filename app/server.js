const express = require("express");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.urlencoded({ extended: false, limit: "10kb" }));

const pool = new Pool({
  host: process.env.DB_HOST || "db",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "notesdb",
  user: process.env.DB_USER || "notesapp",
  password: process.env.DB_PASSWORD,
  max: 10,
  connectionTimeoutMillis: 3000
});

let dbReady = false;

async function initializeDatabase() {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS notes (
          id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          content VARCHAR(500) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      dbReady = true;
      console.log("Database is ready");
      return;
    } catch (error) {
      console.error(`Database attempt ${attempt}/30 failed: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.error("Database initialization failed");
  process.exit(1);
}

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/ready", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ready", database: "connected" });
  } catch {
    res.status(503).json({ status: "not_ready" });
  }
});

app.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, content, created_at FROM notes ORDER BY id DESC"
    );

    const notes = result.rows.map(note => `
      <li>
        <span>${escapeHtml(note.content)}</span>
        <small>${escapeHtml(new Date(note.created_at).toLocaleString())}</small>
        <form method="POST" action="/notes/${note.id}/delete">
          <button type="submit">Delete</button>
        </form>
      </li>
    `).join("");

    res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Docker Notes</title>
  <style>
    body { font: 16px system-ui,sans-serif; max-width: 760px; margin: 40px auto; padding: 0 18px; color: #172033; }
    h1 { color: #1264a3; }
    .panel { padding: 20px; border: 1px solid #d9e2ec; border-radius: 12px; }
    input { box-sizing: border-box; width: 100%; padding: 12px; margin: 10px 0; }
    button { padding: 9px 14px; cursor: pointer; }
    li { padding: 14px 0; border-bottom: 1px solid #ddd; }
    small { display: block; color: #667085; margin: 6px 0; }
    .status { color: #18794e; }
  </style>
</head>
<body>
  <h1>Docker Notes</h1>
  <p>A two-tier application powered by Node.js and PostgreSQL.</p>
  <div class="panel">
    <h2>Add a note</h2>
    <form method="POST" action="/notes">
      <label for="content">Note content</label>
      <input id="content" name="content" maxlength="500" required>
      <button type="submit">Save note</button>
    </form>
  </div>
  <h2>Saved notes (${result.rows.length})</h2>
  <ul>${notes || "<li>No notes yet. Add your first note above.</li>"}</ul>
  <p class="status">Application is running</p>
</body>
</html>`);
  } catch (error) {
    console.error("Unable to load notes:", error.message);
    res.status(500).send("Unable to load notes. Check application logs.");
  }
});

app.post("/notes", async (req, res) => {
  const content = typeof req.body.content === "string"
    ? req.body.content.trim()
    : "";

  if (!content || content.length > 500) {
    return res.status(400).send("Note must contain 1 to 500 characters.");
  }

  try {
    await pool.query("INSERT INTO notes (content) VALUES ($1)", [content]);
    res.redirect("/");
  } catch (error) {
    console.error("Unable to save note:", error.message);
    res.status(500).send("Unable to save note. Check application logs.");
  }
});

app.post("/notes/:id/delete", async (req, res) => {
  if (!/^[1-9][0-9]*$/.test(req.params.id)) {
    return res.status(400).send("Invalid note ID.");
  }

  try {
    await pool.query("DELETE FROM notes WHERE id = $1", [req.params.id]);
    res.redirect("/");
  } catch (error) {
    console.error("Unable to delete note:", error.message);
    res.status(500).send("Unable to delete note. Check application logs.");
  }
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

initializeDatabase().then(() => {
  app.listen(port, "0.0.0.0", () => {
    console.log(`Notes application listening on port ${port}`);
  });
});

async function shutdown() {
  await pool.end().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
