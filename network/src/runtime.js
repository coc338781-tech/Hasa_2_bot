import { createPostgresAgentStore } from "./postgres-agent-store.js";
import { createPostgresCustomerStore } from "./postgres-customer-store.js";

export async function createConfiguredAgentStore() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return { store: null, customerStore: null, close: null };
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "hasa-bot-network-api"
  });
  await pool.query("SELECT 1");
  return {
    store: createPostgresAgentStore(pool),
    customerStore: createPostgresCustomerStore(pool),
    close: () => pool.end()
  };
}
