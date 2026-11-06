// Types the model can read inline (Claude: images up to 5 MB once base64 encoded, PDFs, plain text).
// Anything else still reaches the computer through loadAttachment
const MODEL_READABLE = {
    "image/jpeg": 3_750_000,
    "image/png": 3_750_000,
    "image/gif": 3_750_000,
    "image/webp": 3_750_000,
    "application/pdf": Infinity,
    "text/plain": 1_000_000,
};
export const formatSize = (bytes) => bytes === undefined
    ? "size unknown"
    : bytes < 1024 * 1024
        ? `${(bytes / 1024).toFixed(1)} KB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
// Inbound files become token-free https URLs on a reserved domain: the transcript keeps the URL,
// and the channel's download() turns it back into bytes through the platform API whenever the
// model reads it
export const channelFileUrls = (platform) => {
    const prefix = `https://${platform}.invalid/files/`;
    return {
        toUrl: (fileId) => `${prefix}${encodeURIComponent(fileId)}`,
        // The file id, or null for a URL this channel doesn't own
        fromUrl: (url) => url.href.startsWith(prefix) ? decodeURIComponent(url.href.slice(prefix.length)) : null,
    };
};
// Builds the user message for a turn: a note per attachment (with the id loadAttachment takes),
// the file itself when the model can read it, then the text
export const toUserMessage = ({ platform, text, attachments, maxDownloadBytes, }) => {
    const { toUrl } = channelFileUrls(platform);
    const parts = [];
    for (const attachment of attachments) {
        const tooLarge = attachment.size !== undefined && attachment.size > maxDownloadBytes;
        parts.push({
            type: "text",
            text: tooLarge
                ? `[Attached file "${attachment.filename}" (${formatSize(attachment.size)}) is over the ${formatSize(maxDownloadBytes)} limit and can't be opened. Ask the user for a smaller file or a link.]`
                : `[Attached file "${attachment.filename}" (${attachment.mediaType}, ${formatSize(attachment.size)}), attachment id: ${attachment.id}]`,
        });
        const limit = Math.min(MODEL_READABLE[attachment.mediaType] ?? -1, maxDownloadBytes);
        if (!tooLarge && (attachment.size ?? Infinity) <= limit) {
            parts.push({
                type: "file",
                url: toUrl(attachment.id),
                mediaType: attachment.mediaType,
                filename: attachment.filename,
            });
        }
    }
    if (text) {
        parts.push({ type: "text", text });
    }
    return { id: "", role: "user", parts };
};
// Breaks long replies on line boundaries for platforms with a message length cap
export const splitMessage = (text, maxLength) => {
    const chunks = [];
    let rest = text;
    while (rest.length > maxLength) {
        const cut = rest.lastIndexOf("\n", maxLength);
        const end = cut > 0 ? cut : maxLength;
        chunks.push(rest.slice(0, end));
        rest = rest.slice(end).replace(/^\n+/, "");
    }
    chunks.push(rest);
    return chunks;
};
