import nodemailer from "nodemailer";
import type { SendEmailOptions } from "./types.js";

const port = Number(process.env.SMTP_PORT ?? 587);
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure: port === 465, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmail(options: SendEmailOptions): Promise<string> {
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || '"CAKE AI" <[EMAIL_ADDRESS]>',
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
    attachments: options.attachments,
  });
  return info.messageId || "";
}
