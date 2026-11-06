import { createAttachmentStore, loadOwnedAttachment } from "../db/attachments.js";
import { db } from "../db/index.js";
export const attachmentStore = createAttachmentStore(db);
export const ownedAttachmentLoader = (platform, owner, load) => (id) => loadOwnedAttachment(attachmentStore, owner, platform, id, load);
