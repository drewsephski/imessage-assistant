import { sql } from "drizzle-orm";
import { check, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { Platform } from "./schema.js";

// Registration proves a verified channel delivered this reference to this owner.
// References are not stored file bytes and do not guarantee provider retention.
export const receivedAttachments = pgTable(
  "received_attachments",
  {
    clerkUserId: text("clerk_user_id").notNull(),
    platform: text("platform").$type<Platform>().notNull(),
    externalFileId: text("external_file_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.clerkUserId, table.platform, table.externalFileId] }),
    check("received_attachments_platform_check", sql`${table.platform} in ('telegram', 'linq')`),
  ],
);
