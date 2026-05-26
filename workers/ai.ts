import type { Product } from "./types";

export async function classifyReply(body: string) {
  const lower = sanitizeAgentInput(body).toLowerCase();
  if (/\bunsubscribe|remove me|opt out\b/.test(lower)) return "unsubscribe";
  if (/\bpricing|buy|demo|talk\b/.test(lower)) return "sales_intent";
  if (/\bbug|error|broken|support|help\b/.test(lower)) return "support_question";
  if (/\bprivacy|delete my data|gdpr\b/.test(lower)) return "privacy_request";
  if (/\bout of office|automatic reply\b/.test(lower)) return "auto_reply";
  return "unknown";
}

export async function draftReply(product: Product | null, sender: string, body: string) {
  const productName = product?.name ?? "the product";
  const trimmed = sanitizeAgentInput(body).trim().slice(0, 500);
  return `Hi,\n\nThanks for replying. I read your note about "${trimmed || "your question"}".\n\nFor ${productName}, the best next step is to clarify the goal and offer one concrete path forward. I can help with that if you share a little more context.\n\nBest,`;
}

export function sanitizeAgentInput(value: string) {
  return value
    .replace(/\b(ignore|forget|disregard)\s+(all\s+)?(previous|prior|above)\s+(instructions?|messages?|prompts?)\b/gi, "[removed prompt injection attempt]")
    .replace(/\bsystem\s*:\s*/gi, "system label: ")
    .replace(/\bdeveloper\s*:\s*/gi, "developer label: ");
}
