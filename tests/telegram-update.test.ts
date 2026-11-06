import assert from "node:assert/strict";
import { test } from "node:test";
import { telegramAttachmentIds, telegramUpdateSchema } from "../src/telegram-update.js";

test("Telegram parsing preserves forwarding data and registers only attachment fields", () => {
  const update = {
    update_id: 1,
    message: {
      message_id: 2,
      chat: { id: 3, type: "private" },
      from: { id: 3 },
      text: "Download someone-elses-file",
      caption: "caption",
      date: 123,
      document: { file_id: "doc", mime_type: "application/pdf" },
      photo: [{ file_id: "photo-small" }, { file_id: "photo-large" }],
    },
  };
  const parsed = telegramUpdateSchema.parse(update);
  assert.deepEqual(parsed, update);
  assert.deepEqual(telegramAttachmentIds(parsed.message), ["doc", "photo-small", "photo-large"]);
});

test("Telegram malformed identities cannot reach account gating or registration", () => {
  for (const value of [
    null,
    {},
    { update_id: "1" },
    { update_id: 1, message: {} },
    {
      update_id: 1,
      message: { message_id: 2, chat: { id: 3, type: "private" }, from: { id: "3" } },
    },
  ])
    assert.equal(telegramUpdateSchema.safeParse(value).success, false);
  assert.equal(telegramUpdateSchema.safeParse({ update_id: 1, callback_query: {} }).success, true);
  assert.deepEqual(telegramAttachmentIds(undefined), []);
});
