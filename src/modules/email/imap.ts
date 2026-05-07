import Imap from "imap";
import { simpleParser } from "mailparser";
import { env } from "../../config/env.js";

export interface RawEmail {
  subject: string;
  from: string;
  date: string;
  body: string;
}

export async function fetchEmails(count = 5): Promise<RawEmail[]> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      host: env.emailHost,
      port: env.emailPort,
      user: env.emailUser,
      password: env.emailPass,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    const emails: RawEmail[] = [];

    imap.once("ready", () => {
      imap.openBox("INBOX", true, (err, box) => {
        if (err) return reject(err);

        const total = box.messages.total;
        const start = Math.max(1, total - count + 1);
        const fetch = imap.seq.fetch(`${start}:${total}`, { bodies: "" });

        fetch.on("message", (msg) => {
          msg.on("body", (stream) => {
            simpleParser(stream, (_err, parsed) => {
              if (_err) return;
              emails.push({
                subject: parsed.subject ?? "(no subject)",
                from: parsed.from?.text ?? "unknown",
                date: parsed.date?.toISOString() ?? "",
                body: parsed.text ?? "",
              });
            });
          });
        });

        fetch.once("end", () => imap.end());
      });
    });

    imap.once("end", () => resolve(emails));
    imap.once("error", reject);
    imap.connect();
  });
}
