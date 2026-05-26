import type { Env, Product } from "./types";

export async function generateLifecycleTemplate(env: Env, product: Product | null, goal: string) {
  const fallbackSubject = product?.name ? `A quick next step for ${product.name}` : "A quick next step";
  const fallbackHtml = `<p>Hi {{first_name}},</p><p>I wanted to share one practical next step for getting value from ${escapeText(product?.name ?? "the product")}.</p><p>{{company}} teams usually see momentum when they complete the first activation step.</p><p>Reply if you want help.</p><p><a href="${escapeText(product?.url ?? "https://example.com")}">Continue setup</a></p><p>{{unsubscribe_url}}</p>`;
  const fallbackText = `Hi {{first_name}},\n\nI wanted to share one practical next step for getting value from ${product?.name ?? "the product"}.\n\nReply if you want help.\n\nContinue setup: ${product?.url ?? "https://example.com"}\n\n{{unsubscribe_url}}`;

  try {
    const response = await (env.AI as any).run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content: "You write concise, compliant lifecycle email drafts for SaaS founders. Return only compact JSON with subject, html_body, text_body."
        },
        {
          role: "user",
          content: JSON.stringify({
            goal,
            product: product
              ? {
                  name: product.name,
                  url: product.url,
                  brand_voice: product.brand_voice
                }
              : null,
            required_variables: ["first_name", "company", "unsubscribe_url"]
          })
        }
      ]
    });
    const text = response?.response ?? response?.text ?? "";
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    if (json.subject && json.html_body && json.text_body) {
      return {
        subject: String(json.subject),
        html_body: String(json.html_body),
        text_body: String(json.text_body)
      };
    }
  } catch {
    // Workers AI is optional during setup; deterministic fallback keeps the MVP usable.
  }

  return { subject: fallbackSubject, html_body: fallbackHtml, text_body: fallbackText };
}

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

function escapeText(value: string) {
  return value.replace(/[<>]/g, "");
}
