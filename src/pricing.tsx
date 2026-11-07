import { html, raw } from "hono/html";
import { MESSAGE_LIMITS } from "./billing.js";

// The public page at /pricing. The cards and the checkout drawer are Clerk's: plans and prices come
// from Clerk Billing at load time, so this page only frames them and has no prices of its own.
// clerk-js has no server rendering here, so everything Clerk draws happens in the browser.

export type PricingConfig = {
  publishableKey: string;
  // The Clerk Frontend API host, which also serves the versions of clerk-js and its UI
  frontendApi: string;
  // The product's name in the title and header; "Assistant" until one is configured
  productName?: string;
};

const css = `
:root {
  color-scheme: light dark;
  --ground: #FAFAFF;
  --ink: #16123F;
  --muted: #5A5785;
  --line: #E1E0F2;
  --link: #0F55E6;
  --display: "Gabarito", ui-rounded, system-ui, sans-serif;
  --body: "Wix Madefor Text", ui-sans-serif, system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root { --ground: #110E33; --ink: #F3F2FF; --muted: #B4B2DA; --line: #322E63; --link: #8FB2FF; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--ground); color: var(--ink); font: 400 1rem/1.55 var(--body); }
a { color: var(--link); }
.wrap { width: min(100% - 2.5rem, 68rem); margin-inline: auto; }
.top { display: flex; align-items: center; justify-content: space-between; min-height: 4.5rem; }
.mark { font: 700 1.25rem var(--display); color: inherit; text-decoration: none; }
#account { display: flex; align-items: center; min-height: 2rem; }
.intro { padding-block: 2.5rem 2.25rem; text-align: center; }
h1 { margin: 0; font: 800 clamp(2.25rem, 6vw, 3.5rem)/1.05 var(--display); letter-spacing: -0.01em; text-wrap: balance; }
.intro p { margin: 0.9rem auto 0; max-width: 34rem; font-size: 1.125rem; color: var(--muted); text-wrap: pretty; }
#pricing-table { min-height: 20rem; }
.status { margin: 0; padding-block: 8rem; text-align: center; color: var(--muted); }
.notes { max-width: 40rem; margin: 2.5rem auto 4rem; color: var(--muted); font-size: 0.9375rem; }
.notes p { margin: 0 0 0.6rem; text-wrap: pretty; }
`;

// Clerk's components take concrete colors, so they follow the system theme as of page load
const script = `
window.addEventListener("load", async () => {
  const table = document.getElementById("pricing-table");
  const account = document.getElementById("account");
  const failed = () => {
    table.innerHTML = '<p class="status">Plans couldn’t load. Refresh the page to try again.</p>';
  };
  if (!window.Clerk) return failed();
  try {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    await Clerk.load({
      ui: { ClerkUI: window.__internal_ClerkUICtor },
      appearance: {
        variables: {
          colorPrimary: dark ? "#8FB2FF" : "#1463FF",
          colorPrimaryForeground: dark ? "#110E33" : "#FFFFFF",
          colorBackground: dark ? "#1B1747" : "#FFFFFF",
          colorForeground: dark ? "#F3F2FF" : "#16123F",
          colorMutedForeground: dark ? "#B4B2DA" : "#5A5785",
          colorNeutral: dark ? "#F3F2FF" : "#16123F",
          colorInput: dark ? "#110E33" : "#FFFFFF",
          colorInputForeground: dark ? "#F3F2FF" : "#16123F",
          fontFamily: '"Wix Madefor Text", ui-sans-serif, system-ui, sans-serif',
          borderRadius: "0.875rem",
        },
      },
    });
    table.replaceChildren();
    Clerk.mountPricingTable(table, { highlightedPlan: "plus", ctaPosition: "bottom" });
    if (Clerk.isSignedIn) {
      Clerk.mountUserButton(account);
    } else {
      const signIn = document.createElement("a");
      signIn.href = "#";
      signIn.textContent = "Sign in";
      signIn.addEventListener("click", (event) => {
        event.preventDefault();
        Clerk.redirectToSignIn({ signInForceRedirectUrl: location.href });
      });
      account.replaceChildren(signIn);
    }
  } catch {
    failed();
  }
});
`;

const description = `Start free with ${MESSAGE_LIMITS.free} messages a month. Upgrade when you need more.`;

const Page = ({ publishableKey, frontendApi, productName }: PricingConfig) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Pricing | {productName?.trim() || "Assistant"}</title>
      <meta name="description" content={description} />
      <meta name="theme-color" content="#FAFAFF" media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content="#110E33" media="(prefers-color-scheme: dark)" />
      <link
        rel="icon"
        href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%231463FF' d='M12 2.5c5.6 0 10 3.9 10 8.9s-4.4 8.9-10 8.9c-1.1 0-2.2-.2-3.2-.4-1.3 1.3-3 2-5 2.1 1.1-1.1 1.7-2.5 1.7-4C3.4 16.3 2 14 2 11.4c0-5 4.4-8.9 10-8.9Z'/%3E%3C/svg%3E"
      />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Gabarito:wght@500..900&family=Wix+Madefor+Text:wght@400..700&display=swap"
      />
      <style>{raw(css)}</style>
      <script
        defer
        crossorigin="anonymous"
        src={`https://${frontendApi}/npm/@clerk/ui@1/dist/ui.browser.js`}
      />
      <script
        defer
        crossorigin="anonymous"
        data-clerk-publishable-key={publishableKey}
        src={`https://${frontendApi}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`}
      />
    </head>
    <body>
      <header class="wrap top">
        <a class="mark" href="/">
          {productName?.trim() || "Assistant"}
        </a>
        <div id="account" />
      </header>
      <main class="wrap">
        <section class="intro">
          <h1>Pick how much you’ll text it.</h1>
          <p>{description}</p>
        </section>
        <div id="pricing-table">
          <p class="status">Loading plans…</p>
          <noscript>
            <p class="status">Plans need JavaScript to load.</p>
          </noscript>
        </div>
        <section class="notes" aria-label="How messages are counted">
          <p>
            Each text you send counts as one message, however much work it takes to answer. Counts
            reset on the first of each month, UTC.
          </p>
          <p>Usage limits apply, so a large or costly request may be stopped.</p>
          <p>After you upgrade, go back to your chat and send your request again.</p>
        </section>
      </main>
      <script>{raw(script)}</script>
    </body>
  </html>
);

export const pricingPage = (config: PricingConfig) => html`<!doctype html>${(<Page {...config} />)}`;
