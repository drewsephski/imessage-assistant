import { timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/node";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { activePlan, limitMessage, MESSAGE_LIMITS, upgradeUrl } from "./billing.js";
import { findChannelLink, linkIdempotencyKey } from "./db/channel-links.js";
import { db } from "./db/index.js";
import { createMessageUsageStore } from "./db/message-usage.js";
import { log } from "./log.js";
// What every channel webhook does once it has verified and parsed a platform's message: only
// messages from users linked to a Clerk account with allowance left this month reach the agent.
// Unlinked users are sent a sign-in link, users who have run out are told when it resets and offered
// an upgrade
const messageUsage = createMessageUsageStore(db);
export const secretMatches = (received, expected) => {
    if (!received || !expected)
        return false;
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
};
// Throws when the plan or usage check fails, so the webhook can answer with a non-2xx and the
// platform redelivers instead of the message being dropped
export const gateInbound = async ({ platform, externalUserId, chatId, eventId, }) => {
    const link = await findChannelLink(platform, externalUserId);
    if (!link) {
        await tasks.trigger("link-channel-account", { platform, externalUserId, chatId }, {
            idempotencyKey: await idempotencyKeys.create(linkIdempotencyKey(platform, externalUserId), {
                scope: "global",
            }),
            // Matches the device code's lifetime; the run also clears the key as soon as it ends
            idempotencyKeyTTL: "10m",
            tags: [`${platform}-user:${externalUserId}`],
        });
        return { status: "linking" };
    }
    // Opaque Clerk id only: attributes this request's logs, errors and spans to the user
    Sentry.setUser({ id: link.clerkUserId });
    const plan = await activePlan(link.clerkUserId);
    const allowed = await messageUsage.claim({
        clerkUserId: link.clerkUserId,
        platform,
        eventId,
        limit: MESSAGE_LIMITS[plan],
    });
    return allowed
        ? { status: "allowed", clerkUserId: link.clerkUserId }
        : { status: "limit", reply: limitMessage(plan, new Date(), upgradeUrl()) };
};
// Hands an allowed message to the channel's Trigger.dev webhook endpoint, with the Clerk user id
// attached. Returns false on failure so the webhook answers non-2xx and the platform redelivers;
// the Trigger endpoint dedupes redeliveries on the platform's own event id
export const forwardToTrigger = async ({ platform, url, secretHeader, secret, body, }) => {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", [secretHeader]: secret },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        // The URL and response body aren't logged: the endpoint URL is credential-like, and the body can
        // echo the request back. The status says whether it's auth (401/403), routing (404) or an outage
        log.error("Forwarding to Trigger.dev failed", {
            "channel.platform": platform,
            "http.response.status_code": res.status,
        });
    }
    return res.ok;
};
