import { timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/node";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { hasProPlan, upgradeUrl } from "./billing.js";
import { findChannelLink, linkIdempotencyKey } from "./db/channel-links.js";
import { log } from "./log.js";
// What every channel webhook does once it has verified and parsed a platform's message: only
// messages from users linked to a Clerk account on the Pro plan reach the agent. Unlinked users are
// sent a sign-in link, linked users without Pro an upgrade link
export const secretMatches = (received, expected) => {
    if (!received || !expected)
        return false;
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
};
export const upgradeMessage = () => [
    "The assistant is available on the Pro plan.",
    "",
    `Upgrade here, then send me a message again: ${upgradeUrl()}`,
].join("\n");
// Throws when the plan check fails, so the webhook can answer with a non-2xx and the platform
// redelivers instead of the message being dropped
export const gateInbound = async ({ platform, externalUserId, chatId, }) => {
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
    return (await hasProPlan(link.clerkUserId))
        ? { status: "allowed", clerkUserId: link.clerkUserId }
        : { status: "upgrade" };
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
