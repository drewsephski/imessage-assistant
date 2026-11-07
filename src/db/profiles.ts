import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  emptyProfile,
  type Forget,
  MemoryError,
  type Profile,
  type Remember,
} from "../memory/domain.js";
import { requireActiveExecution } from "./execution.js";
import * as schema from "./schema.js";
import type { TaskExecution } from "./tasks.js";

const { userProfiles, PROFILE_NOTE_LIMIT } = schema;
type Database = NodePgDatabase<typeof schema>;

export type RememberResult = { saved: Remember["kind"]; value: string; duplicate?: boolean };
export type ForgetResult = { forgot: Forget["kind"]; found: boolean };

const toProfile = (row: typeof userProfiles.$inferSelect | undefined): Profile =>
  row
    ? { timeZone: row.timeZone, displayName: row.displayName, notes: row.notes }
    : emptyProfile;

export const createProfileStore = (db: Database) => {
  // Reads need no fence: the owner id comes from the authenticated task, and the result only
  // ever goes into that owner's own system prompt.
  const read = async (clerkUserId: string) => {
    const [row] = await db.select().from(userProfiles).where(eq(userProfiles.clerkUserId, clerkUserId));
    return toProfile(row);
  };

  // Writes run once per owner at a time, fenced on the live attempt, so two channels saving at
  // once can't drop each other's note.
  const write = <T>(execution: TaskExecution, work: (current: Profile) => { next: Profile; result: T }) =>
    db.transaction(async (tx) => {
      await requireActiveExecution(tx, execution);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`user-profile:${execution.clerkUserId}`}, 0))`,
      );
      const [row] = await tx
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.clerkUserId, execution.clerkUserId))
        .for("update");
      const { next, result } = work(toProfile(row));
      await tx
        .insert(userProfiles)
        .values({ clerkUserId: execution.clerkUserId, ...next })
        .onConflictDoUpdate({
          target: userProfiles.clerkUserId,
          set: { ...next, updatedAt: new Date() },
        });
      return result;
    });

  return {
    get: read,

    async remember(execution: TaskExecution, item: Remember) {
      return write<RememberResult>(execution, (current) => {
        switch (item.kind) {
          case "timezone":
            return { next: { ...current, timeZone: item.value }, result: { saved: "timezone", value: item.value } };
          case "name":
            return { next: { ...current, displayName: item.value }, result: { saved: "name", value: item.value } };
          case "note": {
            if (current.notes.some((note) => note.toLowerCase() === item.value.toLowerCase()))
              return { next: current, result: { saved: "note", value: item.value, duplicate: true } };
            if (current.notes.length >= PROFILE_NOTE_LIMIT)
              throw new MemoryError(
                `I can keep ${PROFILE_NOTE_LIMIT} notes at most. Ask the user which one to forget first.`,
              );
            return {
              next: { ...current, notes: [...current.notes, item.value] },
              result: { saved: "note", value: item.value },
            };
          }
        }
      });
    },

    async forget(execution: TaskExecution, item: Forget) {
      return write<ForgetResult>(execution, (current) => {
        switch (item.kind) {
          case "timezone":
            return { next: { ...current, timeZone: null }, result: { forgot: "timezone", found: current.timeZone !== null } };
          case "name":
            return { next: { ...current, displayName: null }, result: { forgot: "name", found: current.displayName !== null } };
          case "note": {
            const notes = current.notes.filter((note) => note.toLowerCase() !== item.value.toLowerCase());
            return { next: { ...current, notes }, result: { forgot: "note", found: notes.length !== current.notes.length } };
          }
          case "everything":
            return {
              next: emptyProfile,
              result: {
                forgot: "everything",
                found: current.timeZone !== null || current.displayName !== null || current.notes.length > 0,
              },
            };
        }
      });
    },
  };
};

export type ProfileStore = ReturnType<typeof createProfileStore>;
