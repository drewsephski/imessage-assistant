import { z } from "zod";
export class CalendarError extends Error {
    httpStatus;
    name = "CalendarError";
    constructor(message, httpStatus) {
        super(message);
        this.httpStatus = httpStatus;
    }
}
const instant = z.iso.datetime({ offset: true });
const timeZone = z.string().max(100).regex(/^(?:UTC|[A-Za-z_]+\/[A-Za-z0-9_+/-]+)$/).refine((value) => {
    try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
    }
    catch {
        return false;
    }
}, "Use an IANA timezone, such as America/Chicago");
// Requiring an offset and matching it to the IANA zone rejects nonexistent DST times
// and prevents a UTC timestamp from silently becoming an unintended local appointment.
export const calendarEventSchema = z.strictObject({
    title: z.string().trim().min(1).max(200),
    start: instant,
    end: instant,
    timeZone,
    description: z.string().max(2000).optional(),
    location: z.string().max(300).optional(),
}).superRefine((event, ctx) => {
    const duration = Date.parse(event.end) - Date.parse(event.start);
    if (duration <= 0 || duration > 7 * 86400_000)
        ctx.addIssue({ code: "custom", message: "End must be after start and within seven days" });
    for (const field of ["start", "end"]) {
        try {
            const parts = new Intl.DateTimeFormat("en-CA", {
                timeZone: event.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
                hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
            }).formatToParts(new Date(event[field]));
            const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
            const local = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
            if (local !== event[field].slice(0, 19))
                ctx.addIssue({ code: "custom", path: [field], message: "Offset must match the timezone at this date" });
        }
        catch {
            ctx.addIssue({ code: "custom", path: [field], message: "Invalid date or timezone" });
        }
    }
});
export const calendarWindowSchema = z.strictObject({
    start: instant,
    end: instant,
}).refine(({ start, end }) => {
    const duration = Date.parse(end) - Date.parse(start);
    return duration > 0 && duration <= 31 * 86400_000;
}, "Choose a window of at most 31 days");
export const confirmationCode = (text) => /^confirm calendar ([a-f0-9]{12})$/i.exec(text.trim())?.[1]?.toLowerCase();
export const draftPreview = (event, code) => [
    `Calendar draft: ${event.title}`,
    `Start: ${event.start}`,
    `End: ${event.end}`,
    `Timezone: ${event.timeZone}`,
    ...(event.location ? [`Location: ${event.location}`] : []),
    ...(event.description ? [`Description: ${event.description}`] : []),
    "Calendar: your connected Google primary calendar. No guests will be invited.",
    `To create this event, reply exactly: confirm calendar ${code}`,
    "This draft expires in 15 minutes. To change anything, send a new request.",
].join("\n");
export const googleEventId = (draftId) => `assistant${draftId.replaceAll("-", "")}`;
