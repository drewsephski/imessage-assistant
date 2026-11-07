import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
import type { TaskExecution } from "./tasks.js";

type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

// Thrown with a message that is safe to show the user and carries no stored data
export class InactiveExecutionError extends Error {
  override name = "InactiveExecutionError";
  constructor() {
    super("This request is no longer active. Please send a new message.");
  }
}

// A tool may only read or write a user's data while its own attempt is the task's current, still
// running attempt. A stale retry, a stopped turn or a forged owner gets nothing. Locks the task row
// so the fence holds for the rest of the transaction.
export const requireActiveExecution = async (tx: Transaction, execution: TaskExecution) => {
  const [task] = await tx
    .select({ platform: schema.assistantTasks.platform })
    .from(schema.assistantTasks)
    .where(
      and(
        eq(schema.assistantTasks.id, execution.taskId),
        eq(schema.assistantTasks.clerkUserId, execution.clerkUserId),
        eq(schema.assistantTasks.currentAttemptId, execution.attemptId),
      ),
    )
    .for("update");
  const [attempt] = task
    ? await tx
        .select({ id: schema.taskAttempts.id })
        .from(schema.taskAttempts)
        .where(
          and(
            eq(schema.taskAttempts.id, execution.attemptId),
            eq(schema.taskAttempts.taskId, execution.taskId),
            eq(schema.taskAttempts.status, "running"),
          ),
        )
        .for("update")
    : [];
  if (!task || !attempt) throw new InactiveExecutionError();
  return { platform: task.platform };
};
