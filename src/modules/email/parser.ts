export interface ParsedEmail {
  to: string;
  subject: string;
  body: string;
  attachment?: string;
}

export function parseEmailCommand(input: string): ParsedEmail | null {
  const toMatch = input.match(/to\s+(\S+)/i);
  const subjectMatch = input.match(/subject\s+(.+?)(?=\s+body|\s+attach|$)/i);
  const bodyMatch = input.match(/body\s+([\s\S]+?)(?=\s+attach|$)/i);
  const attachMatch = input.match(/attach\s+(\S+)/i);

  if (!toMatch || !subjectMatch) return null;

  return {
    to: toMatch[1],
    subject: subjectMatch[1].trim(),
    body: bodyMatch ? bodyMatch[1].trim() : "",
    attachment: attachMatch ? attachMatch[1] : undefined,
  };
}
