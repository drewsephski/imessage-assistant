# Open loops: product decision

Research checked November 6, 2026. These are vendor descriptions and a product hypothesis, not customer validation or a claim of uniqueness.

## What the market already offers

[Poke](https://poke.com/) advertises messaging integrations, memory, scheduled tasks and proactive recipes. [Lindy](https://www.lindy.ai/) advertises client follow-ups, daily briefs and connected business workflows. [Ohai](https://www.ohai.ai/how-it-works/) describes household coordination and turning text, emails and uploaded documents into tasks and events. Messaging, reminders and general assistant positioning are already crowded.

[alfred_'s task documentation](https://get-alfred.ai/docs/tasks) describes accepting or dismissing tasks suggested from email, source links and reminders. Its [follow-up tracking description](https://get-alfred.ai/glossary/follow-up-tracking) describes automatically monitoring Gmail and Outlook conversations. Reviewed capture and waiting-on status are also established features. The presence or absence of a channel on a vendor page does not prove a market gap.

## Decision and competing ideas

The hypothesis is that independent client-service operators who avoid connecting their inbox will repeatedly use an explicitly saved follow-up register from their existing chats. The concrete product behavior is shared saved items, quoted source text, visible next action and whose turn it is, with application-rendered briefings and explicit user commands controlling state. Normal conversation transcripts remain separate.

The available council was Claude Opus 5.5 and GPT-6.1 Sol, both at high effort. Each independently rated the narrowed plan 7/10. A third provider was unavailable; this was not a full three-provider council. Both preferred a bounded follow-up workflow to broad memory or reminders. These are plan scores, not code-review scores.

Claude favored screenshot capture as a later differentiator. Sol favored plain-text capture and stronger mutation controls. The chosen increment uses text only: evidence must be an exact substring of the actual current user message. A model can propose an item; only a standalone user command can keep, change or forget it. This trades breadth and conversational flexibility for testable authorization and provenance. Pagination keeps every saved item accessible.

Durable reply recovery addresses a known reliability gap, but it needs its own design for partial delivery and uncertain provider outcomes. It remains separate. Saved loop state can be reread after a failed reply, but this change does not fix general reply delivery or promise exactly-once messaging. Generic personal memory was deferred because it broadens retained personal data without a similarly clear user outcome. Proactive reminders were deferred because they require scheduling, timezone preferences and opt-out-safe outbound behavior.

## Pilot decision gates

Proposed experiment: ten consenting solo operators over fourteen days, using an existing plan with enough messages. The five-message free allowance cannot support this experiment; billing behavior is unchanged.

- At least six save five real items across three days without founder correction.
- At least five request the briefing on four days during the second week.
- At least half of kept items are explicitly closed or change direction.
- At least half of kept items originate outside email, classified voluntarily at the exit review.
- At least four can name a specific item they otherwise would have missed.
- Zero cross-owner disclosures or unauthorized mutations.

These thresholds are product decisions, not published benchmarks. If fewer than three participants sustain capture by day seven, or most participants need automatic inbox monitoring, revise the hypothesis rather than adding integrations by default. Compare the workflow with each participant's existing notes/reminders habit. Do not infer willingness to pay from enthusiasm alone.

Before a pilot, verify the deployed schema, both messaging paths, deletion behavior and quotas with consenting test accounts. Keep the feature off and unadvertised until then. Production activation, recruitment and sending messages are separate rollout work, not part of this code merge.
