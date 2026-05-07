import type { AIProvider } from "../../providers/types.js";
import type { RawEmail } from "./imap.js";

export interface EmailSummary {
  subject: string;
  from: string;
  date: string;
  summary: string;
}

export async function summarizeEmail(
  provider: AIProvider,
  email: RawEmail,
  model?: string,
): Promise<EmailSummary> {
  const prompt = `Summarize this email in 2-3 sentences:\n\nSubject: ${email.subject}\nFrom: ${email.from}\n\n${email.body.slice(0, 2000)}`;
  const result = await provider.chat([{ role: "user", content: prompt }], { model });
  return {
    subject: email.subject,
    from: email.from,
    date: email.date,
    summary: result.text,
  };
}

export async function summarizeAll(
  provider: AIProvider,
  emails: RawEmail[],
  model?: string,
): Promise<EmailSummary[]> {
  return Promise.all(emails.map((e) => summarizeEmail(provider, e, model)));
}
