import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import * as schema from "./schema.js";

const registration = z.object({
  clerkUserId: z.string().min(1),
  platform: z.enum(schema.PLATFORMS),
  fileIds: z.array(z.string().min(1).max(2048)).max(100),
});

export const createAttachmentStore = (db: NodePgDatabase<typeof schema>) => ({
  async register(input: z.infer<typeof registration>) {
    const { clerkUserId, platform, fileIds } = registration.parse(input);
    if (!fileIds.length) return;
    await db
      .insert(schema.receivedAttachments)
      .values(
        [...new Set(fileIds)].map((externalFileId) => ({ clerkUserId, platform, externalFileId })),
      )
      .onConflictDoNothing();
  },
  async owns(clerkUserId: string, platform: schema.Platform, externalFileId: string) {
    const [row] = await db
      .select({ id: schema.receivedAttachments.externalFileId })
      .from(schema.receivedAttachments)
      .where(
        and(
          eq(schema.receivedAttachments.clerkUserId, clerkUserId),
          eq(schema.receivedAttachments.platform, platform),
          eq(schema.receivedAttachments.externalFileId, externalFileId),
        ),
      )
      .limit(1);
    return row !== undefined;
  },
});

export type AttachmentStore = ReturnType<typeof createAttachmentStore>;

export const loadOwnedAttachment = async (
  store: AttachmentStore,
  owner: string | undefined,
  platform: schema.Platform,
  fileId: string,
  load: (id: string) => Promise<Uint8Array>,
) => {
  if (!owner || !(await store.owns(owner, platform, fileId))) {
    throw new Error(
      "This file isn't available for your account. Please attach it again in this chat.",
    );
  }
  return load(fileId);
};
