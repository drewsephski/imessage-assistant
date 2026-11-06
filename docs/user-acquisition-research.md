# User acquisition research and a first-customer plan

Researched November 6, 2026. This is desk research using the product's source code and vendors' own pages. No interviews, customer usage analysis, market-size study, ad test, or paid conversion experiment was conducted. Vendor statements describe advertised capabilities, not independently tested performance. Prices are the public monthly USD prices observed on this date and may change.

## Recommendation

Start with ten solo consultants or freelancers who already use an iPhone and Google Calendar, and who repeatedly turn client messages into appointments and follow-up documents. Test one promise: **“Text the details. Review the calendar entry. Get the follow-up file back.”** Treat this audience and promise as hypotheses until people repeatedly use and pay for them.

The product can combine a familiar messaging channel with research and file work. That is useful, but neither texting an assistant nor adding calendar events is a unique market position. A narrow workflow, reliable completion, easy recovery, and direct founder support are a more credible initial offer than “an assistant that can do anything.” Do not advertise the calendar promise until the chosen integration is configured and an actual iMessage-to-calendar flow succeeds.

## What the repository establishes

This assessment describes the checkout before this work's new integrations and frontend changes, not a verified production deployment.

- `src/channel-gate.ts` requires a linked Clerk account and active Pro entitlement before agent work. The first incoming request starts account linking but is not retained for automatic replay. `src/trigger/link-account.ts` asks the user to send their request again after linking. This adds friction before the first useful result.
- `src/trigger/channel-agent.ts` wires live-web and computer tools into durable conversations on iMessage and Telegram. No direct calendar connector was wired at research start. Conversations are channel-specific; computers are keyed to the Clerk user.
- `src/landing.tsx` is a public acquisition surface with configurable channel buttons and a billing link. At research start it did not display a concrete plan price, usage allowance, privacy/retention explanation covering all providers, account deletion flow, or a real customer case study. Its examples were explicitly illustrative, including signing a lease and travel/ticket prices; they were not evidence of successful customer tasks.
- The task and spending ledgers provide a foundation for measuring completion, failure, API acceptance of replies, and cost. They do not establish customer satisfaction, human receipt, retention, or willingness to pay. `docs/product-foundations.md` explicitly separates local verification from hosted rollout and lists durable files and onboarding as unfinished increments.
- No customer count, acquisition cost, retention rate, revenue, or production conversion funnel was established by this research. Do not interpret their absence from these files as proof the business has no users.

## Competitive evidence

Use current direct pages rather than search-result prices. Lindy search snippets returned conflicting older prices; the direct page below showed a newer Team offer. Similarly, a separate `getohai.com` site appeared in search; this report uses `ohai.ai` and does not assume the two are the same business.

| Product | What its own site currently advertises | Price observed | Implication for this product |
| --- | --- | --- | --- |
| Poke | Messages, WhatsApp and Telegram; email/calendar connections; reminders, proactive automations, reusable recipes | Free tier; Pro $19/month; Ultra $199/month | The closest channel overlap. “No app to install” or “calendar by text” alone will not establish differentiation. [Official product and pricing page](https://poke.com/) |
| Lindy | iMessage and Slack, calendar/inbox work, computer use, connected tools, and approvals for actions with external impact | $50 introductory credits lasting seven days; Team from $49.99/month per active user for 5,000 credits | Broad professional-assistant positioning is crowded. Transparent usage and approval behavior are useful reference points, not proof of superior reliability. [Official pricing](https://www.lindy.ai/pricing) |
| Ohai | Household coordination, calendar connections, screenshots/PDFs/email into events and tasks, shared circles, reminders | Individual $9.99/month; Duo $19.99; Group $29.99; trial advertised | Families are a plausible audience but require shared calendars, multiple people, and household workflows the repository does not yet provide. [Official how-it-works and pricing FAQ](https://www.ohai.ai/how-it-works/) |
| Aura | Text and call, email/calendar handling, connected apps, proactive updates and branded assistants | Basic $20/month; larger plans also listed | “Executive assistant you can text” is already used by another vendor; competing on this broad phrase would require stronger proof and breadth. [Official product page](https://www.moreaura.ai/) |
| Dola | The branded social-link page describes a calendar assistant and points to heydola.com | Not verified | Both heydola.com fetch attempts failed. Do not use older third-party claims to assert today's pricing, supported channels, or service availability. Keep it on the watch list. [Branded link page](https://linktr.ee/heydola) |

These pages demonstrate available competing offers. They do **not** establish total demand, market share, paid-user numbers, satisfaction, or a market gap that customers will pay to fill.

## Audience hypotheses, in priority order

| Priority | Audience to test | Concrete recurring job | Why test it / what would disprove it |
| --- | --- | --- | --- |
| 1 | Independent consultants, designers and other solo client-service professionals using iPhone + Google Calendar | Convert a client message or screenshot into a reviewed appointment; turn notes or supplied documents into a deliverable sent back in chat | Matches the intended calendar work and existing file tools without needing a team product. Disprove it if people already complete the task faster with their normal calendar/AI app or will not connect their calendar. |
| 2 | Solo local-service operators who schedule their own work | Capture a requested visit and produce a simple job checklist | Potentially concrete value, but discovery must establish whether their real need is dispatch, customer messaging or a CRM. If so, the current product is too narrow; do not promise an operations suite. |
| 3 | Adult household organizers | Turn a screenshot of an activity schedule into reviewed events | Ohai's offer makes the use case credible as a category, not validated for this product. Defer broad family positioning until shared-calendar behavior, privacy explanations and account controls are ready. |
| 4 | Technical early adopters on Telegram | Research and file-processing tasks through chat | Useful for debugging and testing tool breadth, but their enthusiasm may not predict payment from the first target audience. Track them as a separate cohort. |

Do not initially target regulated professional workflows, claim ADHD treatment or accessibility outcomes, or use document signing as the primary proof point. These introduce expectations the current implementation and this research have not validated.

## Positioning to test

**Primary landing-page hypothesis:** “Turn a client text into your next step.” Explain the actual path below it: send the details, review the proposed date/time/timezone, then receive a confirmation and event link after creation. Show the required Google Calendar connection and whether Pro is required before someone starts.

**Secondary proof:** one real, consented example of a useful file returned through chat, such as a meeting checklist or an organized expense spreadsheet. Label synthetic demos as demos. Use actual completion footage and timestamps only after the workflow succeeds; do not reuse illustrative prices or completed-event claims as customer evidence.

**What to avoid:** generic “AI employee” language, unlimited usage, “works with every app,” autonomous purchasing/booking/signing claims, or claiming conversation memory automatically merges across channels. Avoid presenting competitor feature gaps as confirmed weaknesses; we reviewed marketing pages, not full products.

## Acquisition channels and practical experiments

All counts, budgets and pass/fail gates below are proposed operating choices for a small pilot, not industry benchmarks or forecasts. No outreach, posting, payments or publishing has been performed.

### 1. Founder-led introductions and hands-on onboarding

Ask existing professional contacts for introductions to people who fit the first audience, then invite them to a short workflow interview and an optional pilot. Avoid assuming the founder already has access to any particular community or customer list. A candidate invitation:

> I'm testing a text-based assistant for turning client messages into calendar entries and follow-up files. Could you show me how you handled one of those tasks last week? If it fits, I'd like to help you try it on a small real task.

Interview the workflow before pitching: What happened the last time? Which steps took effort? How often does it happen? What tools did they use? What would make them refuse calendar access? Have them show a redacted example if comfortable. Ask what they actually pay for today rather than whether they hypothetically “would use AI.”

Recruit up to ten pilot users, observe their first task, and record where they abandon linking, subscription, connection or confirmation. Founder assistance must be recorded separately from self-serve success. This manual approach is consistent with YC's advice to recruit and learn directly before scaling; that advice is a strategy reference, not evidence this product will grow. [YC's essential startup advice](https://www.ycombinator.com/blog/ycs-essential-startup-advice/)

### 2. Small professional communities and local coworking groups

Pick two communities where members fit the chosen workflow, not broad AI audiences. Ask the organizer about a short demo or research invitation; post only where permitted, clearly identify the founder, and invite volunteers. Use a fresh synthetic example rather than a customer's private conversation. Do not scrape members or automate private messages.

For Reddit specifically, current policy prohibits repeated or unsolicited mass engagement and recommends checking each community's rules. There is no basis here to promise that a particular subreddit allows promotion. Treat Reddit as a place to contribute useful answers and recruit only with permission, not a bulk acquisition engine. [Reddit's spam policy](https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam)

### 3. Short workflow demonstrations on the founder's own channels

Publish three distinct 30–60 second demonstrations only after live verification: text to calendar; screenshot to reviewed event; notes to returned checklist. Use one call to action to try that exact workflow. Track source and successful first tasks, not impressions. Compare which demonstration brings users who return. Do not infer demand from likes or views.

### 4. Referrals after a successful repeat task

Ask returning users whether they know one person with the same problem. Offer help onboarding that person. Delay incentives until referrals happen naturally and costs are known. Do not add automatic invitations to a user's contacts or reward reviews/testimonials without appropriate disclosure.

### 5. Product Hunt and search content after the pilot

Product Hunt can be a later demonstration and feedback event. It is free to launch, creators can submit their own product, and homepage featuring is discretionary; none of this guarantees activated users. Use it after a coherent demo and repeat usage exist, and do not buy upvotes. [Product Hunt's current launch guidance](https://help.producthunt.com/en/articles/17734306-1-how-product-hunt-works)

Write two useful pages around the exact successful workflow, such as creating a Google Calendar event from an iMessage or turning a screenshot into a reviewed appointment. Include genuine limitations and screenshots. This is a proposed search experiment; no keyword volume, ranking difficulty or expected traffic was measured. Avoid a mass-generated competitor-comparison site.

Paid ads are not the first experiment. They become informative after a measurable signup-to-success path and repeat usage exist. Any later test needs an explicit spending cap and a cost-per-activated-user target derived from actual contribution margin, not competitor subscription prices.

## A 30-day plan

| Window | Action | Proposed gate and decision |
| --- | --- | --- |
| Days 1–7 | Finish real channel/calendar proof, publish accurate setup/usage information, run six workflow interviews from up to twenty relevant personal invitations | If fewer than four interviewees describe the same recurring job with a recent example, revise the segment before building more integrations. Track invitations and nonresponses; do not count all twenty as interviews. |
| Days 8–14 | Onboard up to ten consenting pilots, observe one task each, record every failure and manual intervention | Aim for eight of ten to finish one supported task within ten minutes after they begin onboarding. This is a pilot quality gate, not a conversion benchmark. If the flow fails, repair it before recruiting another batch. |
| Days 15–21 | Run three demonstrations and two permitted community sessions/posts; ask successful pilots for one referral; observe repeat use | Aim for at least five of the first ten activated users to complete tasks on two different days in the following seven days, without a founder prompting each task. If fewer do, investigate whether the task recurs and whether results are trusted. |
| Days 22–30 | Offer a clearly bounded paid pilot and review costs, support burden and repeat use | Seek three actual voluntary paid continuations among ten activated pilots. Do not count a survey answer, discount promise or test subscription as payment. If payment or repeat usage is weak, change the workflow/segment before expanding channels. |

Use zero paid-media spend initially. A proposed optional cash ceiling is $150 for participant thank-you payments or a small approved community experiment, excluding existing hosting/provider costs; this is a budget recommendation, not an authorized expenditure or vendor quote. Cap pilot provider usage separately using the implemented spending policy. Founder time and support effort must be recorded even when the cash budget is small.

Do not pick the product's paid price by undercutting the table above. Measure model, search, messaging, computer, connector and support costs for the pilot workflow, then choose a bounded offer with a clear allowance. If testing a lower-priced offer, restrict expensive operations accordingly. A $19 competitor plan does not prove this implementation can profitably deliver the same service for $19.

## Measurement and launch prerequisites

Define an activated user as one who completes a supported task and can verify the result: for a calendar task, a provider-confirmed event ID/link and correct time; for a file task, a successfully received/openable artifact. A chat response or a ledger row alone does not meet that definition.

Record aggregate funnel events with opaque account IDs: acquisition source, channel start, account link completion, entitlement ready, connector completion, first verified task, failure category, repeat task and paid continuation. Keep raw messages, phone numbers, event titles, tokens and document contents out of acquisition analytics. A channel-button click is not a linked user; model completion is not external action completion; messaging API acceptance is not proof of human receipt.

Before broader recruitment, make these visible and functional:

1. Honest onboarding: explain account linking, plan/allowance and calendar consent, and preserve or explicitly request resending the initial task.
2. Correct scheduling: explicit timezone and date handling, a reviewable proposed action, duplicate protection, clear failure/retry outcomes, and a way to inspect the created event.
3. Trust and control: a brief explanation of what messages/files/calendar data are processed and retained, which providers receive them, how to disconnect and delete data, and how to reach support. Do not promise encryption, no training or deletion across providers until implementation and provider terms support those claims.
4. Clear plan economics: published price/allowance and what happens when exhausted. Offer a bounded trial only if entitlement and spending enforcement support it; the current Pro gate must not be described as a free trial by marketing alone.
5. Operational proof: a real successful task on each advertised channel, revoked-calendar access behavior, failed delivery recovery, and the distinction between temporary computer files and durable storage.

## Decisions this research cannot settle

- Whether the chosen audience will connect a calendar, trust the results, return, or pay. Only observed use and actual payment can answer those questions.
- Whether Composio or a direct connector creates a better customer experience. Compare the implemented connection, revocation and recovery paths; catalog size alone does not answer that question.
- The product's safe price or scalable acquisition cost. Neither production unit economics nor customer lifetime value was measured.
- Competitor reliability or superiority. The comparison is grounded in current first-party pages, not hands-on comparative tests.

Prioritize verified first-task success, then repeat usage in one audience, then paid continuation. Add another integration when repeated user requests identify the next blocked job, rather than adding a broad catalog to compensate for an unclear use case.
