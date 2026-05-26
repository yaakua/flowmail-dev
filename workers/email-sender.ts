import type { EmailBinding } from "./types";

export type SendEmailParams = {
  to: string;
  from: { email: string; name: string };
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

export async function sendEmail(binding: EmailBinding, params: SendEmailParams) {
  const result = await binding.send({
    to: params.to,
    from: params.from,
    replyTo: params.replyTo,
    subject: params.subject,
    html: params.html,
    text: params.text,
    headers: params.headers
  });
  return { messageId: result.messageId ?? crypto.randomUUID() };
}
