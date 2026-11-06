// User plans in Clerk Billing (Dashboard → Billing → Plans → User Plans). Prices and the cards on
// /pricing live in Clerk; how many messages each plan allows is enforced here, so a change to a
// limit also needs its `messages_*` feature updated in Clerk, which is what the cards show.
export const MESSAGE_LIMITS = { free: 5, plus: 100, pro: 300 };
const PAID_PLANS = ["pro", "plus"];
// Webhook requests carry no Clerk session, so `has({ plan })` isn't available; the plan is read
// from the Backend API by the Clerk user id the chat account is linked to instead
export const activePlan = async (clerkUserId) => {
    const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}/billing/subscription`, { headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` } });
    // No subscription at all, e.g. a user created before Billing was enabled
    if (res.status === 404)
        return "free";
    if (!res.ok) {
        throw new Error(`Subscription lookup failed: ${res.status} ${await res.text()}`);
    }
    return planFromSubscription((await res.json()));
};
// A canceled paid item stays `active` until its period ends; upcoming (scheduled) items don't count.
// The largest plan wins while a switch between plans leaves more than one item active.
export const planFromSubscription = (subscription) => {
    const active = subscription.subscription_items.filter((item) => item.status === "active");
    return PAID_PLANS.find((plan) => active.some((item) => item.plan.slug === plan)) ?? "free";
};
// Allowances run on UTC calendar months, whatever day a subscription started
export const messagePeriodStart = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const nextPeriodStart = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
// What the assistant replies once an account's allowance for the month is used up
export const limitMessage = (plan, now, upgradeLink) => {
    const resets = new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        timeZone: "UTC",
    }).format(nextPeriodStart(now));
    const used = `You've used all ${MESSAGE_LIMITS[plan]} messages on your ${plan === "free" ? "free" : plan === "plus" ? "Plus" : "Pro"} plan this month. They reset on ${resets}.`;
    return plan === "pro"
        ? used
        : [used, "", `For more now, upgrade here, then send me a message again: ${upgradeLink}`].join("\n");
};
// The Frontend API's host is encoded in the publishable key: pk_<env>_base64("<host>$")
export const clerkFrontendApi = (publishableKey) => Buffer.from(publishableKey.split("_")[2], "base64").toString().replace(/\$$/, "");
// The hosted Account Portal lives next to the Frontend API: `<slug>.clerk.accounts.dev` →
// `<slug>.accounts.dev` in development, `clerk.<domain>` → `accounts.<domain>` in production
const accountPortalUrl = () => {
    const frontendApi = clerkFrontendApi(process.env.CLERK_PUBLISHABLE_KEY);
    const host = frontendApi.endsWith(".clerk.accounts.dev")
        ? frontendApi.replace(/\.clerk\.accounts\.dev$/, ".accounts.dev")
        : frontendApi.replace(/^clerk\./, "accounts.");
    return `https://${host}`;
};
// The Billing tab of the Account Portal's user profile: the subscription, invoices and payment methods
export const accountUrl = () => `${accountPortalUrl()}/user/billing`;
// Where chat replies send people to upgrade. Railway sets the domain on any service that has one;
// anywhere else (local development) the Account Portal's own plan list is the next best page
export const upgradeUrl = () => {
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
    return domain ? `https://${domain}/pricing` : accountUrl();
};
