import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../../src/db/schema.js";
import { createTaskStore } from "../../src/db/tasks.js";

// Never fall back to DATABASE_URL or load .env. These tests write only to an explicit,
// local throwaway database; applying its schema uses the normal db:push command.
export const testDatabase = () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString)
    throw new Error(
      "Set TEST_DATABASE_URL to a local assistant_test_* database and apply db:push first",
    );
  const url = new URL(connectionString);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !/^\/assistant_test_[a-z0-9_]+$/.test(url.pathname)
  ) {
    throw new Error("Database tests require a local assistant_test_* database");
  }
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  return { pool, db, store: createTaskStore(db) };
};
