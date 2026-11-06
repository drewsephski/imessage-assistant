import Linq, { APIError } from "@linqapp/sdk";
import { spendingNotice, spendOperation } from "../spending/runtime.js";
import { downloadBytes } from "./download.js";
// Thin wrappers over the Linq API (iMessage). Sends go to an existing chat id, so replies leave from
// the line the user wrote to and Linq's own line selection is never bypassed with a pinned `from`
// Reads LINQ_API_V3_API_KEY on first use, so task indexing works without it
let linq;
const client = () => (linq ??= new Linq({ maxRetries: 0 }));
// The text of an inbound message. One bubble can hold several text runs, and a pasted URL arrives
// as a separate link part
export const messageText = (parts) => parts
    .flatMap((part) => (part.type === "text" || part.type === "link" ? [part.value] : []))
    .join("\n");
// Verifies a webhook's Standard Webhooks signature against LINQ_WEBHOOK_SECRET and parses it.
// Throws on a bad signature or a stale timestamp. Needs the raw body, not re-serialized JSON
export const unwrapWebhook = (rawBody, headers) => client().webhooks.unwrap(rawBody, { headers });
// Linq rejects every send to a recipient who texted STOP (or another opt-out keyword) with 403 and
// this code, before anything is queued. It must not be retried, from this or any other line
const OPTED_OUT_CODE = 2024;
export const isOptedOutError = (error) => {
    if (!(error instanceof APIError) || error.status !== 403)
        return false;
    // The code sits on the error body, which some responses nest one level deeper
    const nested = error.error?.error?.code;
    return error.code === OPTED_OUT_CODE || nested === OPTED_OUT_CODE;
};
// The exact keywords that make Linq opt a recipient out: whole message, case-sensitive, plus
// "opt out" in any casing, spaced, hyphenated or not
const OPT_OUT_KEYWORDS = new Set(["STOP", "UNSUBSCRIBE", "OPTOUT", "CANCEL", "END", "QUIT"]);
export const isOptOutKeyword = (text) => {
    const trimmed = text.trim();
    return OPT_OUT_KEYWORDS.has(trimmed) || /^opt[\s-]?out$/i.test(trimmed);
};
export const sendMessage = async (chatId, text) => spendOperation("messaging:linq:sendMessage", async () => {
    const { message } = await client().chats.messages.send(chatId, {
        message: { parts: [{ type: "text", value: text }] },
    });
    return message.id;
}, spendingNotice() !== undefined && text === spendingNotice());
// Read receipt and typing bubble while a turn runs. The bubble clears itself when a message is sent
// or about 90 seconds after it was started
export const markRead = (chatId) => spendOperation("messaging:linq:markRead", () => client().chats.markAsRead(chatId));
export const startTyping = (chatId) => spendOperation("messaging:linq:startTyping", () => client().chats.typing.start(chatId));
export const stopTyping = (chatId) => spendOperation("messaging:linq:stopTyping", () => client().chats.typing.stop(chatId));
// Linq stores inbound and pre-uploaded files up to 100 MB. Downloads are held in memory on the way
// to the model or the computer, so they stop at 50 MB
export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const downloadAttachment = async (attachmentId) => spendOperation("storage:linq:download", async () => {
    // Retrieving the attachment returns a fresh download URL, which also covers lines on Linq's
    // ephemeral tier, whose signed URLs expire after 15 minutes
    const attachment = await client().attachments.retrieve(attachmentId);
    if (!attachment.download_url) {
        throw new Error(`Attachment ${attachmentId} has no download URL (status: ${attachment.status})`);
    }
    return downloadBytes(attachment.download_url, MAX_DOWNLOAD_BYTES);
});
// Upload types Linq accepts that the computer tools produce; anything else is rejected by the API
const UPLOADABLE = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/heic",
    "application/pdf",
    "text/plain",
    "text/csv",
    "text/html",
    "text/markdown",
    "application/json",
    "application/zip",
    "audio/mpeg",
    "video/mp4",
]);
// Files are pre-uploaded (the only way past 10 MB), then sent as a media part in the chat
export const sendFile = async (chatId, file, caption) => spendOperation("messaging:linq:sendFile", async () => {
    if (!UPLOADABLE.has(file.mediaType)) {
        throw new Error(`iMessage can't carry ${file.mediaType} files. Zip the file, or convert it to a PDF, image or text file, and send that instead.`);
    }
    const upload = await client().attachments.create({
        content_type: file.mediaType,
        filename: file.filename,
        size_bytes: file.data.byteLength,
    });
    const put = await fetch(upload.upload_url, {
        method: upload.http_method,
        headers: upload.required_headers,
        body: file.data,
    });
    if (!put.ok) {
        throw new Error(`Attachment upload failed: ${put.status} ${await put.text()}`);
    }
    const { message } = await client().chats.messages.send(chatId, {
        message: {
            parts: [
                { type: "media", attachment_id: upload.attachment_id },
                ...(caption ? [{ type: "text", value: caption }] : []),
            ],
        },
    });
    return message.id;
});
