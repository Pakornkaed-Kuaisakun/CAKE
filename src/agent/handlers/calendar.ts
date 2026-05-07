import type { AIProvider, ChatResult } from "../../providers/types.js";
import {
  listUpcoming,
  createEvent,
  deleteEvent,
} from "../../modules/calendar/index.js";
import { exactEvent } from "../calendarHelper/exactEvent.js";
import { text } from "../utils/text.js";

export async function handleCalendarList(
  _provider: AIProvider,
  _input: string,
  _model?: string,
): Promise<ChatResult> {
  const events = await listUpcoming(10);
  if (events.length === 0) return text("No upcoming events found.");
  const out = events
    .map(
      (e) =>
        `  • ${e.summary} [${e.id}]\n    Start: ${new Date(e.start).toLocaleString()}\n    End: ${new Date(e.end).toLocaleString()}\n`,
    )
    .join("\n");
  return text(`[CALENDAR] Upcoming events:\n${out}`);
}

export async function handleCalendarCreate(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  const raw = await exactEvent(provider, input, model);
  let event: any;

  try {
    const cleaned = raw.text.replace(/```json|```/g, "").trim();
    event = JSON.parse(cleaned);
  } catch (err) {
    return { text: `Failed to parse event data.\n\nAI response:\n${raw.text}` };
  }

  if (!event)
    return { text: `I couldn't understand the event details.\n\n${raw.text}` };

  const { summary, start, end, description } = event;
  const startStr =
    typeof start === "object" ? start?.datetime || start?.dateTime : start;
  const endStr = typeof end === "object" ? end?.datetime || end?.dateTime : end;

  if (!summary || !startStr)
    return { text: `Missing required fields (summary / start).` };

  let startDate = new Date(startStr);
  let endDate = endStr
    ? new Date(endStr)
    : new Date(startDate.getTime() + 60 * 60 * 1000);

  if (isNaN(startDate.getTime()))
    return { text: `Invalid start time format: ${startStr}` };
  if (isNaN(endDate.getTime()))
    return { text: `Invalid end time format: ${endStr}` };
  if (endDate <= startDate)
    return { text: "End time must be after start time" };

  try {
    const link = await createEvent({
      summary: String(summary),
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      description: description ? String(description) : undefined,
    });

    return {
      text: `✅ Event created: ${summary}\n ${startDate.toLocaleString()}\n ${link}`,
    };
  } catch (err: any) {
    return { text: `Failed to create event.\n${err.message}` };
  }
}

export async function handleCalendarRemove(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const match = input.match(/\b[0-9a-f]{24}\b/);
  if (!match) return text("Please provide a valid Event ID.");

  const eventId = match[0];

  try {
    await deleteEvent(eventId);
    return text(`✅ Event deleted: ${eventId}`);
  } catch (err: any) {
    return { text: `Failed to delete event.\n${err.message}` };
  }
}
