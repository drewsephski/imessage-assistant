import { createAttachmentStore, loadOwnedAttachment } from "../db/attachments.js";
import { db } from "../db/index.js";
import type { Platform } from "../db/schema.js";

export const attachmentStore = createAttachmentStore(db);
export const ownedAttachmentLoader =
  (platform: Platform, owner: string | undefined, load: (id: string) => Promise<Uint8Array>) =>
  (id: string) =>
    loadOwnedAttachment(attachmentStore, owner, platform, id, load);
