import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { z } from "zod";
import * as schema from "../src/db/schema.js";
import { createSpendingStore, userControlId } from "../src/db/spending.js";

// Trusted local operator utility. It is not exposed to agent tools or HTTP callers.
const usage =
  "Usage: pnpm spending status|pause|unpause <global|service|user-id>; pnpm spending limit <target> <integer-microUSD>; pnpm spending settle <target> <reservation-id> <integer-microUSD> <receipt-reference>";
const amount = (value: string | undefined) =>
  BigInt(
    z
      .string()
      .regex(/^(0|[1-9]\d{0,14})$/)
      .parse(value),
  );
const [command, target, ...args] = process.argv.slice(2);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });
const store = createSpendingStore(db);
const print = (value: unknown) =>
  console.log(
    JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item), 2),
  );

try {
  const targetId = z
    .string()
    .regex(/^[a-zA-Z0-9._:-]{1,128}$/)
    .parse(target);
  const controlId =
    targetId === "global" || targetId === "service" ? targetId : userControlId(targetId);
  if (!process.env.DATABASE_URL) throw new Error("Database configuration required");
  if (command === "limit" && args.length === 1) {
    const monthlyMicrousd = amount(args[0]);
    await db
      .insert(schema.spendingControls)
      .values({ id: controlId, monthlyMicrousd })
      .onConflictDoUpdate({ target: schema.spendingControls.id, set: { monthlyMicrousd } });
    print({ controlId, monthlyMicrousd });
  } else if ((command === "pause" || command === "unpause") && args.length === 0) {
    const paused = command === "pause";
    await db
      .insert(schema.spendingControls)
      .values({ id: controlId, monthlyMicrousd: 0n, paused })
      .onConflictDoUpdate({ target: schema.spendingControls.id, set: { paused } });
    print({ controlId, paused });
  } else if (command === "status" && args.length === 0) {
    const [control] = await db
      .select()
      .from(schema.spendingControls)
      .where(eq(schema.spendingControls.id, controlId));
    const recent = await db
      .select()
      .from(schema.spendingReservations)
      .where(
        controlId === "global" ? undefined : eq(schema.spendingReservations.controlId, controlId),
      )
      .orderBy(desc(schema.spendingReservations.createdAt))
      .limit(20);
    print({
      control: control ?? null,
      exposedMicrousd: await store.totalExposure(
        new Date(),
        controlId === "global" ? undefined : controlId,
      ),
      recent,
    });
  } else if (command === "settle" && args.length === 3) {
    const id = z.uuid().parse(args[0]);
    await store.settle(controlId, id, amount(args[1]), args[2] ?? "");
    print({ controlId, reservationId: id, settled: true });
  } else {
    console.error(usage);
    process.exitCode = 1;
  }
} catch {
  // Database errors and schema validation can include connection values or raw arguments.
  console.error(
    "Spending command failed. Check the arguments, database connection, and existing settlement state.",
  );
  console.error(usage);
  process.exitCode = 1;
} finally {
  await pool.end();
}
