import { and, count, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { messagePeriodStart } from "../billing.js";
import type * as schema from "./schema.js";
import { messageUsage, type Platform } from "./schema.js";

type MessageUsageDb = NodePgDatabase<typeof schema>;

export const createMessageUsageStore = (db: MessageUsageDb) => ({
  // Counts one inbound message against the user's month, or returns false if none are left. Keyed on
  // the platform's event id, so a redelivered message is allowed through again without counting
  // twice, even when it arrives after the allowance ran out or the month rolled over. The lock makes
  // the count and the insert one step, so simultaneous messages can't overshoot the limit.
  claim: ({
    clerkUserId,
    platform,
    eventId,
    limit,
    now = new Date(),
  }: {
    clerkUserId: string;
    platform: Platform;
    eventId: string;
    limit: number;
    now?: Date;
  }) =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`message-usage:${clerkUserId}`}, 0))`,
      );
      const seen = await tx.query.messageUsage.findFirst({
        where: and(eq(messageUsage.platform, platform), eq(messageUsage.eventId, eventId)),
      });
      if (seen) return true;

      const periodStart = messagePeriodStart(now);
      const [{ used }] = await tx
        .select({ used: count() })
        .from(messageUsage)
        .where(and(eq(messageUsage.clerkUserId, clerkUserId), eq(messageUsage.periodStart, periodStart)));
      if (used >= limit) return false;

      await tx.insert(messageUsage).values({ platform, eventId, clerkUserId, periodStart });
      return true;
    }),
});
