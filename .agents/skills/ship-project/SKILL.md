---
name: ship-project
description: Commit, push, merge, and deploy this personal-assistant project when the user asks to ship changes or release everything.
---

# Ship project

Carry the requested release through validation, commit, push, PR merge, and production deployment without repeated confirmation. Invoking this skill to ship authorizes those actions within the user's stated scope. Creating or editing this skill does not itself request a release.

## Prepare and validate

- Read repository instructions, `package.json`, the diff, branch/upstream state, and deployment configuration. Fetch remote refs and identify the actual default branch and existing PR; do not assume `main` or a deployment target.
- Include all intended project changes when asked to ship everything, including untracked source files. Inspect every candidate before staging explicit paths. Exclude secrets, `.env*`, credentials, local artifacts, and unrelated work; preserve others' changes. Stop for clarification only if ownership or release scope cannot be established.
- Use pnpm (the declared package manager). Run `npx hono --help` before Hono work and use its CLI instead of starting a dev server.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Run relevant additional suites, including `pnpm test:db` for database behavior when a suitable test database is configured. Never point tests at production. Fix failures within scope and rerun affected checks; report blockers instead of bypassing them.
- Inspect build-generated changes and `git diff --check`. Review the staged diff for scope and secrets before committing. Never print secret values.

## Commit, push, and merge

- Make a concise descriptive commit; skip an empty commit. If on the default branch, create a release branch before committing. Reuse an appropriate existing branch/PR.
- Push normally; never force-push, reset others' work, bypass hooks, or disable branch protection. Create or update the PR against the actual default branch with a summary and validation results.
- In T3 Code, call `link_pull_request` with the full PR URL as the next tool call after creating or pushing to the PR.
- Confirm required checks and reviews pass for the current head, then merge using the repository's configured method. Resolve straightforward conflicts while preserving both sides and revalidate; stop for semantic conflicts requiring user judgment.
- If required checks or reviews remain pending, use T3 Code `watch_pull_request` and hand back the concrete pending state; resume to merge and deploy when they pass. Do not busy-poll or bypass requirements. Unwatch when handing control back without continued monitoring.

## Deploy and verify

- Inspect current Railway linkage, GitHub deployment automation, and `trigger.config.ts`. Use available provider tools or installed CLIs and their current help to confirm commands and targets. Never guess a project, service, environment, domain, or credential.
- Deploy the merged revision to the existing production Railway service and Trigger.dev project when their runtime/configuration changed. A request to deploy everything covers both runtimes; docs-only releases can skip deployment unless explicitly requested. Observe existing automatic deployments before starting duplicates. Record the merged SHA and ensure every deployed artifact comes from that revision.
- For schema changes, edit `src/db/schema.ts` and apply with `npm run db:push`; never use Drizzle migrations. Inspect the target and proposed schema operations first. Apply compatible additive changes before dependent deployments. Stop before destructive schema operations or incompatible rollout steps unless separately authorized.
- Never sync local environment files wholesale. When syncing Railway variables, exclude `TRIGGER_SECRET_KEY`: do not set, update, or delete it unless the user explicitly requested changing that exact variable. Obtain missing credentials through the available secure secret mechanism.
- Verify Railway deployment success, deployed revision, and the configured live health endpoint. Verify Trigger.dev production deployment success/version separately. Do not claim live message delivery, authentication, schedules, or billing are verified from build or health checks alone; use authorized non-destructive smoke checks where available.
- On failure, inspect logs and fix the cause within scope. Do not retry unchanged failures repeatedly, silently roll back, or report a partial rollout as complete. State which services are live and what remains blocked.

Report the commit/merged SHA, PR link, validation results, production deployment status for each runtime, and any remaining blocker. Distinguish local checks from live verification.
