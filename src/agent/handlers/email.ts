import fs from "fs";
import path from "path";
import type { AIProvider, ChatResult } from "../../providers/types.js";
import {
  fetchEmails,
  summarizeAll,
  sendEmail,
  parseEmailCommand,
} from "../../modules/email/index.js";
import { text } from "../utils/text.js";
import { parseJsonMarkdown, stripQuotes } from "../../shared/utils/utils.js";


export async function handleEmail(
  provider: AIProvider,
  _input: string,
  model?: string,
): Promise<ChatResult> {
  const raw = await fetchEmails(5);
  const summaries = await summarizeAll(provider, raw, model);
  const out = summaries
    .map(
      (e) =>
        `  • ${e.subject}\n    From: ${e.from}\n    Date: ${new Date(e.date).toLocaleString()}\n      Summary: ${e.summary}\n    `,
    )
    .join("\n\n");
  return text(`[EMAIL] Emails:\n${out}`);
}

export async function handleSendEmail(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  // Check for piped content
  const pipeMarker = "__pipe__:";
  const pipeIdx = input.indexOf(pipeMarker);
  let pipedContent = "";
  let commandPart = input;

  if (pipeIdx !== -1) {
    commandPart = input.slice(0, pipeIdx).trim();
    pipedContent = input.slice(pipeIdx + pipeMarker.length).trim();
  }

  // Try to parse with regex first
  let parsed = parseEmailCommand(commandPart);

  if (!parsed || !parsed.body) {
    // If regex fails or body is missing, use AI to extract fields
    // We include the piped content in the context for the AI
    const extractionPrompt = `
      Extract email details from this command: "${commandPart}"
      ${pipedContent ? `\n\nThere is piped content from a previous command that should be used as the email body unless specified otherwise.\nPiped content: ${pipedContent.slice(0, 500)}${pipedContent.length > 500 ? "..." : ""}` : ""}
      
      Return a JSON object with: to, subject, body, attachment (file path if mentioned).
      If a field is missing, use an empty string.
      If the command mentions "this" or "it" as the body, use the piped content.
      
      ONLY return JSON.
    `;
    const result = await provider.chat(
      [{ role: "user", content: extractionPrompt }],
      { model },
    );
    try {
      const aiParsed = parseJsonMarkdown(result.text);
      if (parsed) {
        parsed.to = aiParsed.to || parsed.to;
        parsed.subject = aiParsed.subject || parsed.subject;
        parsed.body = aiParsed.body || parsed.body || pipedContent;
        parsed.attachment = aiParsed.attachment || parsed.attachment;
      } else {
        parsed = aiParsed;
        if (!parsed!.body && pipedContent) {
          parsed!.body = pipedContent;
        }
      }
    } catch (e) {
      if (!parsed) {
        return text(
          "Could not parse email details. Please use format: email_send to <email> subject <subject> body <body>",
        );
      }
    }
  }

  // Auto-detect file path from piped content if no attachment was explicitly provided
  if (pipedContent && !parsed?.attachment) {
    // Look for common output patterns: "File: <path>" or "Exported to <path>"
    const fileMatch = pipedContent.match(
      /(?:File|Exported to|at):\s*([^\n\r]+)/i,
    );
    const potentialPath = fileMatch ? fileMatch[1].trim() : pipedContent.trim();

    // Clean up quotes or markdown formatting
    const cleanPath = stripQuotes(potentialPath);

    if (cleanPath && (path.isAbsolute(cleanPath) || cleanPath.includes("."))) {
      try {
        if (fs.existsSync(cleanPath) && fs.statSync(cleanPath).isFile()) {
          if (parsed) {
            parsed.attachment = cleanPath;
          } else {
            // If no parsed data yet, we'll need AI or default to handle to/subject
          }
        }
      } catch (e) {
        // Not a valid file path, ignore
      }
    }
  }

  if (
    !parsed?.to ||
    !parsed?.subject ||
    (!parsed?.body && !parsed?.attachment)
  ) {
    return text(`Missing email details. 
    To: ${parsed?.to || "???"}
    Subject: ${parsed?.subject || "???"}
    Body: ${parsed?.body || "???"}
    Attachment: ${parsed?.attachment || "None"}
    Please provide recipient, subject, and either a body or an attachment.`);
  }

  try {
    const attachments = [];
    if (parsed.attachment) {
      attachments.push({
        filename: path.basename(parsed.attachment),
        path: path.resolve(parsed.attachment),
      });
    }

    const messageId = await sendEmail({
      to: parsed.to,
      subject: parsed.subject,
      text: parsed.body,
      attachments,
    });

    return text(`[EMAIL] Sent successfully! Message ID: ${messageId}`);
  } catch (error: any) {
    return text(`[EMAIL] Failed to send email: ${error.message}`);
  }
}
