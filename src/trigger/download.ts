// Enforce limits on the received bytes, including chunked responses and incorrect
// provider metadata. Never include signed URLs or bot tokens in thrown errors.
export class AttachmentDownloadError extends Error {
  override name = "AttachmentDownloadError";
}

export const downloadBytes = async (
  url: string,
  maxBytes: number,
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array> => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new AttachmentDownloadError("Invalid attachment size limit");
  }
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AttachmentDownloadError(`Attachment download failed (${response.status})`);
    }
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel();
      throw new AttachmentDownloadError(`Attachment exceeds the ${maxBytes}-byte download limit`);
    }
    if (!response.body) throw new AttachmentDownloadError("Attachment download returned no data");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new AttachmentDownloadError(
            `Attachment exceeds the ${maxBytes}-byte download limit`,
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } catch (error) {
    if (error instanceof AttachmentDownloadError) throw error;
    // Fetch/stream errors can contain the credential-bearing URL in their cause.
    throw new AttachmentDownloadError("Attachment download failed or timed out. Please try again.");
  }
};
