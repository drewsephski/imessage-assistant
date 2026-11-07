import { z } from "zod";

// Pure rules for reminders: what counts as a valid time, and how a reminder reads in a chat.
// Nothing here touches the database or a provider.

export const REMINDER_MESSAGE_LIMIT = 500;
export const MAX_SCHEDULED_PER_USER = 50;
// At least a minute out, so "remind me now" is a reply rather than a delivery; at most a year
export const MIN_LEAD_MS = 60_000;
export const MAX_LEAD_MS = 366 * 24 * 60 * 60_000;

export class ReminderError extends Error {
  override name = "ReminderError";
}

// Region/City names and UTC only. ICU also accepts abbreviations such as "CST", which are
// ambiguous (Central or China Standard Time), so those are refused.
export const isTimeZone = (value: string) => {
  if (value.length > 64 || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+$|^UTC$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

// ISO 8601 with an explicit offset, so the model has to commit to a wall-clock time
const OFFSET_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/;

// The zone's UTC offset at an instant, in minutes east of UTC
export const zoneOffsetMinutes = (instant: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
};

const parseOffsetMinutes = (text: string) => {
  const offset = /(Z|[+-]\d{2}:\d{2})$/.exec(text)?.[1] ?? "Z";
  if (offset === "Z") return 0;
  const sign = offset.startsWith("-") ? -1 : 1;
  return sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
};

export const reminderInputSchema = z.strictObject({
  message: z.string().trim().min(1).max(REMINDER_MESSAGE_LIMIT),
  dueAt: z.string().regex(OFFSET_TIME, "dueAt must be ISO 8601 with an explicit UTC offset"),
  timeZone: z.string().refine(isTimeZone, "timeZone must be a valid IANA zone"),
});
export type ReminderInput = z.infer<typeof reminderInputSchema>;

// Turns the model's input into an instant, rejecting times that can't be right: an offset that
// doesn't belong to the zone at that moment means the model guessed, and a reminder in the past
// or years out is almost always a misread date.
export const resolveDueAt = (input: ReminderInput, now: Date) => {
  const dueAt = new Date(input.dueAt);
  if (Number.isNaN(dueAt.getTime())) throw new ReminderError("That time couldn't be read.");
  if (parseOffsetMinutes(input.dueAt) !== zoneOffsetMinutes(dueAt, input.timeZone)) {
    throw new ReminderError(
      `The UTC offset in ${input.dueAt} isn't ${input.timeZone}'s offset at that time. Recompute the time in that zone.`,
    );
  }
  const lead = dueAt.getTime() - now.getTime();
  if (lead < MIN_LEAD_MS) throw new ReminderError("A reminder has to be at least a minute from now.");
  if (lead > MAX_LEAD_MS) throw new ReminderError("A reminder can be at most a year from now.");
  return dueAt;
};

// "Thu, Nov 6, 2026, 9:00 AM (America/Chicago)"
export const formatWhen = (instant: Date, timeZone: string) =>
  `${new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant)} (${timeZone})`;

export type ReminderRecord = {
  id: string;
  message: string;
  dueAt: Date;
  timeZone: string;
  status: "scheduled" | "sent" | "canceled" | "failed";
};

export const renderReminderList = (records: ReminderRecord[]) =>
  records.length === 0
    ? "No reminders are scheduled."
    : records
        .map((record) => `${formatWhen(record.dueAt, record.timeZone)}: ${record.message} [id ${record.id}]`)
        .join("\n");

// What actually lands in the chat. The first line marks it as something the assistant sent on its
// own, so it isn't mistaken for a reply to a message the person doesn't remember sending.
export const renderReminderDelivery = (message: string) => `Reminder: ${message}`;
