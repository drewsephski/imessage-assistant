import assert from "node:assert/strict";
import { test } from "node:test";
import { AttachmentDownloadError, downloadBytes } from "../src/trigger/download.js";

const responseFrom =
  (response: Response): typeof fetch =>
  async () =>
    response;

test("attachment downloads accept an exact limit and join streamed chunks", async () => {
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      },
    }),
  );
  assert.deepEqual(
    await downloadBytes("https://example.invalid", 4, responseFrom(response)),
    new Uint8Array([1, 2, 3, 4]),
  );
});

test("oversized advertised attachments cancel before reading", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { "content-length": "100" } },
  );
  await assert.rejects(
    downloadBytes("https://example.invalid", 4, responseFrom(response)),
    /exceeds the 4-byte/,
  );
  assert.equal(cancelled, true);
});

for (const advertisedSize of [undefined, "1"]) {
  test(`actual download limit applies with ${advertisedSize ? "incorrect" : "missing"} content-length`, async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4, 5]));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: advertisedSize ? { "content-length": advertisedSize } : {} },
    );
    await assert.rejects(
      downloadBytes("https://example.invalid", 4, responseFrom(response)),
      /exceeds the 4-byte/,
    );
    assert.equal(cancelled, true);
  });
}

test("download failures never expose provider bodies, URLs, or underlying causes", async () => {
  const url = "https://example.invalid/secret-token";
  await assert.rejects(
    downloadBytes(url, 4, responseFrom(new Response("private", { status: 403 }))),
    { message: "Attachment download failed (403)" },
  );
  const failedFetch: typeof fetch = async () => {
    throw new Error(url);
  };
  await assert.rejects(downloadBytes(url, 4, failedFetch), (error: unknown) => {
    assert.ok(error instanceof AttachmentDownloadError);
    assert.equal(error.cause, undefined);
    assert.equal(error.message.includes("secret-token"), false);
    return true;
  });
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error(url));
      },
    }),
  );
  await assert.rejects(downloadBytes(url, 4, responseFrom(response)), {
    message: "Attachment download failed or timed out. Please try again.",
  });
});

test("invalid download limits make no request", async () => {
  const unexpectedFetch: typeof fetch = async () => {
    assert.fail("must not fetch");
  };
  for (const limit of [0, -1, Infinity, 1.5]) {
    await assert.rejects(
      downloadBytes("https://example.invalid", limit, unexpectedFetch),
      /Invalid attachment size limit/,
    );
  }
});
