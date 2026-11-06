import type { CalendarStore } from "../db/calendar.js";
import type { TaskExecution } from "../db/tasks.js";
import { CalendarError, calendarEventSchema, calendarWindowSchema, confirmationCode, draftPreview, type CalendarEvent } from "./calendar.js";
import type { CalendarProvider } from "./composio-calendar.js";

export const createCalendarService = (store: CalendarStore, provider: CalendarProvider) => {
  const connected = async (execution: TaskExecution) => {
    const connection = await store.connection(execution);
    if (!connection || connection.authConfigId !== provider.authConfigId)
      throw new CalendarError("Connect your Google Calendar first.");
    if (await provider.status(execution.clerkUserId, connection.accountId) !== "ACTIVE")
      throw new CalendarError("Your calendar is not connected. Finish authorization or reconnect first.");
    return connection;
  };
  return {
    async connect(execution: TaskExecution) {
      const existing = await store.connection(execution);
      if (existing?.authConfigId === provider.authConfigId) {
        const status = await provider.status(execution.clerkUserId, existing.accountId);
        if (status === "ACTIVE") return { status: "connected" as const };
        if (["INITIALIZING", "INITIATED", "INACTIVE"].includes(status) && Date.now() - existing.createdAt.getTime() < 10 * 60_000)
          return { status: "pending" as const, message: "Open the calendar connection link already sent in this chat. If it expired, ask again in ten minutes." };
      }
      const link = await provider.link(execution.clerkUserId);
      const saved = await store.saveConnection(execution, link.accountId, provider.authConfigId, existing?.accountId);
      if (!saved) return {
        status: "pending" as const,
        message: "Another calendar connection request is already in progress. Use the connection link from that request, then check calendar status here.",
      };
      return { status: "authorization_required" as const, url: link.url,
        message: "Open this link to connect Google Calendar, then return here and send your calendar request again." };
    },
    async status(execution: TaskExecution) {
      const connection = await store.connection(execution);
      if (!connection || connection.authConfigId !== provider.authConfigId) return { status: "not_connected" };
      const status = await provider.status(execution.clerkUserId, connection.accountId);
      return { status: status === "ACTIVE" ? "connected" : "authorization_required" };
    },
    async list(execution: TaskExecution, window: { start: string; end: string }) {
      const { start, end } = calendarWindowSchema.parse(window);
      const connection = await connected(execution);
      return provider.list(execution.clerkUserId, connection.accountId, start, end);
    },
    async prepare(execution: TaskExecution, input: CalendarEvent) {
      const event = calendarEventSchema.parse(input);
      const connection = await connected(execution);
      const draft = await store.draft(execution, connection.accountId, event);
      if (draft.expiresAt.getTime() <= Date.now())
        throw new CalendarError("This draft expired. Please send a new request.");
      return { status: "awaiting_confirmation", preview: draftPreview(draft.event, draft.confirmationCode) };
    },
    async confirm(execution: TaskExecution, actualUserText: string) {
      const code = confirmationCode(actualUserText);
      if (!code) throw new CalendarError("Reply with the exact confirmation phrase shown in your calendar draft.");
      const draft = await store.findDraft(execution, code);
      if (!draft || draft.sourceTaskId === execution.taskId)
        throw new CalendarError("No matching calendar draft was found. Ask me to prepare one first.");
      if (!draft.submittedAt && draft.expiresAt.getTime() <= Date.now())
        throw new CalendarError("This draft expired. Please make a new one.");
      const connection = await connected(execution);
      if (connection.accountId !== draft.accountId)
        throw new CalendarError("Your calendar connection changed. Please make a new draft.");
      if (!draft.submittedAt) {
        const created = await provider.create(execution.clerkUserId, draft.accountId, draft.id, draft.event,
          () => store.claim(execution, draft.id, draft.accountId));
        if (created) return { status: "created", event: created };
      }
      // A timeout/worker crash after the marker is uncertain. Never replay the POST, even
      // when GET currently returns 404: the first write may still be propagating.
      const found = await provider.get(execution.clerkUserId, draft.accountId, draft.id);
      return found ? { status: "created", event: found } : {
        status: "uncertain",
        message: "I could not confirm whether this event was created. Check your calendar. You can send the same confirmation again to check; it will not create a second event.",
      };
    },
  };
};
