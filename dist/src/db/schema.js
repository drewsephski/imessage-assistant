import { sql } from "drizzle-orm";
export { receivedAttachments } from "./attachments-schema.js";
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, } from "drizzle-orm/pg-core";
// Every chat platform the assistant is reachable on. `linq` is iMessage through Linq
export const PLATFORMS = ["telegram", "linq"];
// Links a user's identity on a chat platform to their Clerk user, so inbound messages
// can be scoped to (and rejected for anyone but) a linked account
export const channelIdentifiers = pgTable("channel_identifiers", {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: text("platform", { enum: PLATFORMS }).notNull(),
    // The platform's own user id: Telegram's `from.id`, or the iMessage sender handle (an E.164
    // phone number or an Apple ID email) for Linq
    externalUserId: text("external_user_id").notNull(),
    clerkUserId: text("clerk_user_id").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex("channel_identifiers_platform_external_user_id_idx").on(table.platform, table.externalUserId),
]);
// OAuth tokens stay with Composio. Only the server-created account mapping is stored here.
export const calendarConnections = pgTable("calendar_connections", {
    clerkUserId: text("clerk_user_id").primaryKey(),
    accountId: text("account_id").notNull().unique(),
    authConfigId: text("auth_config_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
// Limits are server-owned; neither the model nor a customer-facing endpoint can change them.
export const spendingControls = pgTable("spending_controls", {
    id: text("id").primaryKey(),
    monthlyMicrousd: bigint("monthly_microusd", { mode: "bigint" }).notNull(),
    paused: boolean("paused").notNull().default(false),
}, (table) => [check("spending_controls_limit_check", sql `${table.monthlyMicrousd} >= 0`)]);
export const TASK_STATUSES = ["running", "completed", "failed", "interrupted"];
export const DELIVERY_STATUSES = [
    "pending",
    "accepted",
    "failed",
    "suppressed",
    "not_applicable",
];
// Logical requests survive worker retries. Store identifiers only, never the prompt or files.
export const assistantTasks = pgTable("assistant_tasks", {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    platform: text("platform", { enum: PLATFORMS }).notNull(),
    // Trigger.dev's chat/message IDs, not phone numbers or platform chat handles.
    chatId: text("chat_id").notNull(),
    messageId: text("message_id").notNull(),
    currentAttemptId: uuid("current_attempt_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex("assistant_tasks_request_idx").on(table.clerkUserId, table.platform, table.chatId, table.messageId),
    index("assistant_tasks_owner_created_idx").on(table.clerkUserId, table.createdAt.desc(), table.id),
    check("assistant_tasks_platform_check", sql `${table.platform} in ('telegram', 'linq')`),
]);
export const calendarDrafts = pgTable("calendar_drafts", {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    sourceTaskId: uuid("source_task_id").notNull().unique()
        .references(() => assistantTasks.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    confirmationCode: text("confirmation_code").notNull(),
    // Immutable event details, retained for recovery of an uncertain provider write.
    event: jsonb("event").$type().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex("calendar_drafts_owner_code_idx").on(table.clerkUserId, table.confirmationCode),
    index("calendar_drafts_expiry_idx").on(table.expiresAt),
]);
// Each execution keeps its own usage; a retry must not erase the previous attempt's cost.
// The attempt ID is also a fencing token used by every lifecycle update.
export const taskAttempts = pgTable("task_attempts", {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
        .notNull()
        .references(() => assistantTasks.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    runAttempt: integer("run_attempt").notNull(),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("running"),
    deliveryStatus: text("delivery_status", { enum: DELIVERY_STATUSES })
        .notNull()
        .default("pending"),
    // Sanitized codes only. Provider exception messages may contain private user data.
    finishReason: text("finish_reason"),
    interruptionReason: text("interruption_reason"),
    stepCount: integer("step_count").notNull().default(0),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }),
    cachedInputTokens: bigint("cached_input_tokens", { mode: "number" }),
    outputTokens: bigint("output_tokens", { mode: "number" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
    uniqueIndex("task_attempts_execution_idx").on(table.taskId, table.runId, table.runAttempt),
    index("task_attempts_deadline_idx")
        .on(table.deadlineAt)
        .where(sql `${table.status} = 'running'`),
    check("task_attempts_status_check", sql `${table.status} in ('running', 'completed', 'failed', 'interrupted')`),
    check("task_attempts_delivery_check", sql `${table.deliveryStatus} in ('pending', 'accepted', 'failed', 'suppressed', 'not_applicable')`),
    check("task_attempts_counts_check", sql `${table.runAttempt} > 0 and ${table.stepCount} >= 0 and ${table.toolCallCount} >= 0 and (${table.inputTokens} is null or ${table.inputTokens} >= 0) and (${table.cachedInputTokens} is null or ${table.cachedInputTokens} >= 0) and (${table.outputTokens} is null or ${table.outputTokens} >= 0)`),
    check("task_attempts_finished_check", sql `(${table.status} = 'running') = (${table.finishedAt} is null)`),
    check("task_attempts_deadline_check", sql `${table.deadlineAt} > ${table.startedAt}`),
]);
export const SPENDING_CATEGORIES = ["model", "web", "computer", "messaging", "storage", "integration"];
// These records deliberately RESTRICT task/attempt deletion. Removing a task must never
// restore spending capacity by erasing its liabilities. Amounts are integer millionths of USD.
export const spendingReservations = pgTable("spending_reservations", {
    id: uuid("id").primaryKey().defaultRandom(),
    controlId: text("control_id")
        .notNull()
        .references(() => spendingControls.id),
    taskId: uuid("task_id").references(() => assistantTasks.id),
    attemptId: uuid("attempt_id").references(() => taskAttempts.id),
    operationKey: text("operation_key").notNull(),
    category: text("category", { enum: SPENDING_CATEGORIES }).notNull(),
    operation: text("operation").notNull(),
    policyVersion: text("policy_version").notNull(),
    maximumMicrousd: bigint("maximum_microusd", { mode: "bigint" }).notNull(),
    actualMicrousd: bigint("actual_microusd", { mode: "bigint" }),
    status: text("status", { enum: ["reserved", "uncertain", "settled"] })
        .notNull()
        .default("reserved"),
    // Provider receipt/invoice reference only, never a secret, request body, or authenticated URL.
    settlementReference: text("settlement_reference"),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    resourceKey: text("resource_key"),
    resourceExpiresAt: timestamp("resource_expires_at", { withTimezone: true }),
    resourceStoppedAt: timestamp("resource_stopped_at", { withTimezone: true }),
    resourceStopAttemptedAt: timestamp("resource_stop_attempted_at", { withTimezone: true }),
}, (table) => [
    uniqueIndex("spending_reservations_operation_idx").on(table.controlId, table.operationKey),
    index("spending_reservations_owner_period_idx").on(table.controlId, table.periodStart),
    index("spending_reservations_period_idx").on(table.periodStart),
    index("spending_reservations_task_idx").on(table.taskId),
    index("spending_reservations_unresolved_idx")
        .on(table.status)
        .where(sql `${table.status} <> 'settled'`),
    index("spending_reservations_resource_idx")
        .on(table.resourceKey)
        .where(sql `${table.resourceKey} is not null and ${table.resourceStoppedAt} is null`),
    check(
    // A new name makes db:push replace the old constraint; this Drizzle version
    // does not detect an expression-only change on an existing check constraint.
    "spending_reservations_category_v2_check", sql `${table.category} in ('model', 'web', 'computer', 'messaging', 'storage', 'integration')`),
    check("spending_reservations_money_check", sql `${table.maximumMicrousd} >= 0 and (${table.actualMicrousd} is null or ${table.actualMicrousd} >= 0)`),
    check("spending_reservations_status_check", sql `${table.status} in ('reserved', 'uncertain', 'settled')`),
    check("spending_reservations_settlement_check", sql `(${table.status} = 'settled') = (${table.actualMicrousd} is not null and ${table.settlementReference} is not null)`),
    check("spending_reservations_task_check", sql `(${table.taskId} is null) = (${table.attemptId} is null)`),
    check("spending_reservations_resource_check", sql `(${table.resourceKey} is null) = (${table.resourceExpiresAt} is null)`),
]);
