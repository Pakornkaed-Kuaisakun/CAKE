import { google } from "googleapis";
import { getAuthorizedClient } from "./auth.js";

export interface CalendarEvent {
  id?: string;
  summary: string;
  start: string;
  end: string;
  description?: string;
}

function calendar() {
  return google.calendar({ version: "v3", auth: getAuthorizedClient() });
}

export async function listUpcoming(maxResults = 10): Promise<CalendarEvent[]> {
  const res = await calendar().events.list({
    calendarId: "primary",
    timeMin: new Date().toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
  });

  return (res.data.items ?? []).map((e) => ({
    id: e.id ?? undefined,
    summary: e.summary ?? "No title",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    description: e.description ?? undefined,
  }));
}

export async function createEvent(event: CalendarEvent): Promise<string> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const res = await calendar().events.insert({
    calendarId: "primary",
    requestBody: {
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.start, timeZone: tz },
      end: { dateTime: event.end, timeZone: tz },
    },
  });

  return res.data.htmlLink ?? "Event created";
}

export async function deleteEvent(eventId: string): Promise<void> {
  await calendar().events.delete({ calendarId: "primary", eventId });
}
