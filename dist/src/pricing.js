import { jsx as _jsx, jsxs as _jsxs } from "hono/jsx/jsx-runtime";
import { html, raw } from "hono/html";
import { MESSAGE_LIMITS } from "./billing.js";
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
const Page = ({ publishableKey, frontendApi }) => (_jsxs("html", { lang: "en", children: [_jsxs("head", { children: [_jsx("meta", { charset: "utf-8" }), _jsx("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }), _jsx("title", { children: "Pricing | Assistant" }), _jsx("meta", { name: "description", content: description }), _jsx("meta", { name: "theme-color", content: "#FAFAFF", media: "(prefers-color-scheme: light)" }), _jsx("meta", { name: "theme-color", content: "#110E33", media: "(prefers-color-scheme: dark)" }), _jsx("link", { rel: "icon", href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%231463FF' d='M12 2.5c5.6 0 10 3.9 10 8.9s-4.4 8.9-10 8.9c-1.1 0-2.2-.2-3.2-.4-1.3 1.3-3 2-5 2.1 1.1-1.1 1.7-2.5 1.7-4C3.4 16.3 2 14 2 11.4c0-5 4.4-8.9 10-8.9Z'/%3E%3C/svg%3E" }), _jsx("link", { rel: "preconnect", href: "https://fonts.googleapis.com" }), _jsx("link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }), _jsx("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Gabarito:wght@500..900&family=Wix+Madefor+Text:wght@400..700&display=swap" }), _jsx("style", { children: raw(css) }), _jsx("script", { defer: true, crossorigin: "anonymous", src: `https://${frontendApi}/npm/@clerk/ui@1/dist/ui.browser.js` }), _jsx("script", { defer: true, crossorigin: "anonymous", "data-clerk-publishable-key": publishableKey, src: `https://${frontendApi}/npm/@clerk/clerk-js@6/dist/clerk.browser.js` })] }), _jsxs("body", { children: [_jsxs("header", { class: "wrap top", children: [_jsx("a", { class: "mark", href: "/", children: "Assistant" }), _jsx("div", { id: "account" })] }), _jsxs("main", { class: "wrap", children: [_jsxs("section", { class: "intro", children: [_jsx("h1", { children: "Pick how much you\u2019ll text it." }), _jsx("p", { children: description })] }), _jsxs("div", { id: "pricing-table", children: [_jsx("p", { class: "status", children: "Loading plans\u2026" }), _jsx("noscript", { children: _jsx("p", { class: "status", children: "Plans need JavaScript to load." }) })] }), _jsxs("section", { class: "notes", "aria-label": "How messages are counted", children: [_jsx("p", { children: "Each text you send counts as one message, however much work it takes to answer. Counts reset on the first of each month, UTC." }), _jsx("p", { children: "Usage limits apply, so a large or costly request may be stopped." }), _jsx("p", { children: "After you upgrade, go back to your chat and send your request again." })] })] }), _jsx("script", { children: raw(script) })] })] }));
export const pricingPage = (config) => html `<!doctype html>${(_jsx(Page, { ...config }))}`;
