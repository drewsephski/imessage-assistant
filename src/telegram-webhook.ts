import * as Sentry from "@sentry/node";
import { Hono } from "hono";
import { forwardToTrigger, gateInbound, secretMatches, upgradeMessage } from "./channel-gate.js";
import { log } from "./log.js";
import { telegramAttachmentIds, telegramUpdateSchema } from "./telegram-update.js";
import { attachmentStore } from "./trigger/attachments.js";

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

// Telegram's webhook lands here first, and only private-chat messages that pass the channel gate
// are forwarded to the Trigger.dev endpoint
export const telegramWebhook = new Hono().post("/", async (c) => {
  if (!secretMatches(c.req.header(SECRET_HEADER), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    // Either a misconfigured secret (every message stops reaching the agent) or someone probing
    log.warn("Webhook rejected: secret mismatch", { "channel.platform": "telegram" });
    return c.text("Unauthorized", 401);
  }

  const parsed = telegramUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.text("Invalid update", 400);
  const update = parsed.data;
  const message = update.message;
  // Private chats only; other updates are acknowledged so Telegram doesn't redeliver them
  if (!message?.from || message.chat.type !== "private") {
    return c.body(null, 200);
  }

  let gate: Awaited<ReturnType<typeof gateInbound>>;
  try {
    gate = await gateInbound({
      platform: "telegram",
      externalUserId: String(message.from.id),
      chatId: String(message.chat.id),
    });
  } catch (error) {
    // Telegram redelivers on a non-2xx, so a Clerk outage retries instead of dropping the message
    Sentry.captureException(error);
    log.error("Channel gate failed", {
      "channel.platform": "telegram",
      "channel.event_id": update.update_id,
    });
    return c.text("Upstream error", 502);
  }

  log.info("Channel message gated", {
    "channel.platform": "telegram",
    "channel.event_id": update.update_id,
    "channel.gate_status": gate.status,
  });

  switch (gate.status) {
    case "linking":
      return c.body(null, 200);
    case "upgrade":
      // Replying in the webhook response makes Telegram send the message, with no extra API call
      return c.json({ method: "sendMessage", chat_id: message.chat.id, text: upgradeMessage() });
    case "allowed": {
      // Only signed, gated provider attachment fields establish ownership. Text
      // containing a file ID (or a model tool argument) never grants access.
      await attachmentStore.register({
        clerkUserId: gate.clerkUserId,
        platform: "telegram",
        fileIds: telegramAttachmentIds(message),
      });
      const forwarded = await forwardToTrigger({
        platform: "telegram",
        url: process.env.TRIGGER_TELEGRAM_WEBHOOK_URL!,
        secretHeader: SECRET_HEADER,
        secret: process.env.TRIGGER_TELEGRAM_WEBHOOK_SECRET!,
        body: { ...update, clerkUserId: gate.clerkUserId },
      });
      return forwarded ? c.body(null, 200) : c.text("Upstream error", 502);
    }
  }
});
