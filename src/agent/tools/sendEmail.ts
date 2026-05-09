import type { Tool } from "./types.js";
import { sendEmail } from "../../modules/email/index.js";
export const sendEmailTool: Tool = async (ctx) => {
  const args = ctx.args ?? {};
  const to = String(args.to ?? "");
  const subject = String(args.subject ?? "");
  const body = String(ctx.input ?? args.body ?? "");

  if (!to) {
    return {
      success: false,
      output: "Missing recipient email address",
      type: "text",
    };
  }

  try {
    const messageId = await sendEmail({
      to,
      subject,
      text: body,
    });

    return {
      success: true,
      output: `Email sent successfully! Message ID: ${messageId}`,
      type: "text",
    };
  } catch (error: any) {
    return {
      success: false,
      output: `Failed to send email: ${error.message}`,
      type: "text",
    };
  }
};
