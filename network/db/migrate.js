import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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
const migrationUrl = new URL("./001_initial.sql", import.meta.url);
const sql = await readFile(fileURLToPath(migrationUrl), "utf8");
const client = await pool.connect();

try {
  await client.query("SELECT pg_advisory_lock(784321905)");
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log("HASA BOT NETWORK database schema is up to date.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.query("SELECT pg_advisory_unlock(784321905)").catch(() => {});
  client.release();
  await pool.end();
}
