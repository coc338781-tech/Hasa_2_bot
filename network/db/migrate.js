import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run database migrations");
}

const { Pool } = await import("pg");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5_000,
  application_name: "hasa-bot-network-migrations"
});
const directory = fileURLToPath(new URL(".", import.meta.url));
const client = await pool.connect();

try {
  await client.query("SELECT pg_advisory_lock(784321905)");
  await client.query("BEGIN");
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await client.query("COMMIT");

  const files = (await readdir(directory))
    .filter(name => /^\d{3}_[a-z0-9_-]+\.sql$/.test(name))
    .sort();

  for (const filename of files) {
    const alreadyApplied = await client.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1",
      [filename]
    );
    if (alreadyApplied.rowCount) continue;

    const sql = await readFile(join(directory, filename), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [filename]);
      await client.query("COMMIT");
      console.log(`Applied migration ${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  console.log("HASA BOT NETWORK database schema is up to date.");
} finally {
  await client.query("SELECT pg_advisory_unlock(784321905)").catch(() => {});
  client.release();
  await pool.end();
}
