import { z } from "zod";
import { CalendarError, type CalendarEvent, googleEventId } from "./calendar.js";

const API = "https://backend.composio.dev/api/v3.1";
export type CalendarConfig = { apiKey: string; authConfigId: string };
export const calendarConfig = (): CalendarConfig | undefined => {
  const apiKey = process.env.COMPOSIO_API_KEY?.trim();
  const authConfigId = process.env.COMPOSIO_GOOGLE_CALENDAR_AUTH_CONFIG_ID?.trim();
  return apiKey && authConfigId ? { apiKey, authConfigId } : undefined;
};

const accountSchema = z.object({
  id: z.string(), user_id: z.string(), status: z.string(),
  toolkit: z.object({ slug: z.string() }),
  auth_config: z.object({ id: z.string(), is_disabled: z.boolean().optional() }),
  is_disabled: z.boolean().optional(),
  experimental: z.object({ account_type: z.string().optional() }).optional(),
});
const eventSchema = z.object({
  id: z.string(), status: z.string().optional(), summary: z.string().optional(),
  htmlLink: z.string().optional(),
  start: z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() }).optional(),
  end: z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() }).optional(),
  extendedProperties: z.object({ private: z.record(z.string(), z.string()).optional() }).optional(),
});
type GoogleEvent = z.infer<typeof eventSchema>;
type ProxyResult = { status: number; data: unknown };
type Charge = <T>(operation: string, work: () => Promise<T>) => Promise<T>;

// Fixed operations only: callers cannot select a host, endpoint, account owner, or headers.
// No SDK means no hidden retry of a side-effecting POST and no extra dependency.
export const createComposioCalendar = (
  config: CalendarConfig,
  charge: Charge,
  transport: typeof fetch = fetch,
  signal?: AbortSignal,
) => {
  const request = async (path: string, method: "GET" | "POST", body?: unknown): Promise<unknown> => {
    let response: Response;
    try {
      response = await transport(`${API}${path}`, {
        method, redirect: "error",
        headers: { "x-api-key": config.apiKey, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
      });
    } catch {
      throw new CalendarError("Calendar service did not respond. Check status before trying again.");
    }
    if (!response.ok)
      throw new CalendarError(`Calendar service request failed (${response.status}). Reconnect if access was revoked.`, response.status);
    try {
      // Do not include raw provider errors, auth state, or credentials in errors/tool results.
      return await response.json();
    } catch { throw new CalendarError("Calendar service returned an unreadable response."); }
  };
  const parse = <T>(schema: z.ZodType<T>, data: unknown): T => {
    const result = schema.safeParse(data);
    if (!result.success) throw new CalendarError("Calendar service returned an unexpected response.");
    return result.data;
  };
  const proxy = async (
    owner: string, accountId: string, method: "GET" | "POST", endpoint: string, body?: unknown,
  ): Promise<ProxyResult> => parse(z.object({ status: z.number().int(), data: z.unknown() }),
    await request("/tools/execute/proxy", "POST", {
      user_id: owner, connected_account_id: accountId, method, endpoint,
      ...(body === undefined ? {} : { body }),
    }));
  const checkedEvent = (data: unknown, draftId: string): GoogleEvent => {
    const event = parse(eventSchema, data);
    if (event.id !== googleEventId(draftId) ||
      event.extendedProperties?.private?.assistantDraftId !== draftId || event.status === "cancelled")
      throw new CalendarError("The calendar result could not be verified. Check your calendar before making another draft.");
    return event;
  };
  const publicEvent = (event: GoogleEvent) => ({
    title: event.summary ?? "Untitled event", start: event.start, end: event.end,
    // Only Google Calendar links may reach the user; provider content remains untrusted.
    url: event.htmlLink && /^https:\/\/(?:www\.)?google\.com\/calendar\//.test(event.htmlLink)
      ? event.htmlLink : undefined,
  });
  return {
    authConfigId: config.authConfigId,
    link: (owner: string) => charge("integration:calendar.connect", async () => {
      const result = parse(z.object({ connected_account_id: z.string().min(1), redirect_url: z.string().url() }),
        await request("/connected_accounts/link", "POST", {
          user_id: owner, auth_config_id: config.authConfigId,
        }));
      const url = new URL(result.redirect_url);
      if (url.protocol !== "https:" || url.hostname !== "connect.composio.dev" || url.username || url.password)
        throw new CalendarError("Calendar service returned an invalid connection link.");
      return { accountId: result.connected_account_id, url: result.redirect_url };
    }),
    status: (owner: string, accountId: string) => charge("integration:calendar.status", async () => {
      let data: unknown;
      try { data = await request(`/connected_accounts/${encodeURIComponent(accountId)}`, "GET"); }
      catch (error) {
        if (error instanceof CalendarError && error.httpStatus === 404) return "MISSING";
        throw error;
      }
      const result = parse(accountSchema, data);
      if (result.id !== accountId || result.user_id !== owner || result.toolkit.slug !== "googlecalendar" ||
        result.auth_config.id !== config.authConfigId || result.experimental?.account_type === "SHARED")
        throw new CalendarError("Calendar connection ownership could not be verified.");
      return result.is_disabled || result.auth_config.is_disabled ? "DISABLED" : result.status;
    }),
    list: (owner: string, accountId: string, start: string, end: string) =>
      charge("integration:calendar.read", async () => {
        const query = new URLSearchParams({
          timeMin: start, timeMax: end, maxResults: "25", singleEvents: "true", orderBy: "startTime",
          fields: "items(id,status,summary,start,end,htmlLink),nextPageToken",
        });
        const response = await proxy(owner, accountId, "GET", `/calendars/primary/events?${query}`);
        if (response.status !== 200) throw new CalendarError(`Calendar read failed (${response.status}).`);
        const data = parse(z.object({ items: z.array(eventSchema).max(25).optional(), nextPageToken: z.string().optional() }), response.data);
        return { events: (data.items ?? []).map(publicEvent), truncated: Boolean(data.nextPageToken) };
      }),
    get: (owner: string, accountId: string, draftId: string) =>
      charge("integration:calendar.read", async () => {
        const response = await proxy(owner, accountId, "GET", `/calendars/primary/events/${googleEventId(draftId)}`);
        if (response.status === 404 || response.status === 410) return null;
        if (response.status !== 200) throw new CalendarError(`Calendar verification failed (${response.status}).`);
        return publicEvent(checkedEvent(response.data, draftId));
      }),
    create: (owner: string, accountId: string, draftId: string, event: CalendarEvent, claim: () => Promise<boolean>) =>
      charge("integration:calendar.create", async () => {
        // Reserve spending before committing the one-shot submission marker. A denied
        // allowance must not consume confirmation. Once marked, uncertain writes are read-only.
        if (!await claim()) return null;
        const response = await proxy(owner, accountId, "POST", "/calendars/primary/events?sendUpdates=none", {
          id: googleEventId(draftId), summary: event.title,
          start: { dateTime: event.start, timeZone: event.timeZone },
          end: { dateTime: event.end, timeZone: event.timeZone },
          ...(event.description ? { description: event.description } : {}),
          ...(event.location ? { location: event.location } : {}),
          extendedProperties: { private: { assistantDraftId: draftId } },
        });
        if (response.status === 409) return null;
        if (response.status !== 200 && response.status !== 201)
          throw new CalendarError(`Calendar creation was not confirmed (${response.status}). Check status before trying again.`);
        return publicEvent(checkedEvent(response.data, draftId));
      }),
  };
};
export type CalendarProvider = ReturnType<typeof createComposioCalendar>;
