export type ContactInput = {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  source?: string;
  consent_status?: string;
  consent_source?: string;
  tags?: string;
};

export type ParsedContact = Required<Pick<ContactInput, "email">> & Omit<ContactInput, "email"> & {
  custom_fields_json: Record<string, string>;
};

export type CsvImportResult = {
  contacts: ParsedContact[];
  skipped: Array<{ row: number; reason: string; value?: string }>;
  duplicates: string[];
};

export type TokenPayload = {
  type: "click" | "login" | "session" | "unsubscribe";
  campaignId?: string;
  recipientId?: string;
  contactId?: string;
  email?: string;
  username?: string;
  url?: string;
  exp?: number;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tokenEncoder = new TextEncoder();
const headerlessContactHeaders = ["email", "full_name", "source"] as const;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return emailPattern.test(normalizeEmail(email));
}

export function parseCsvContacts(csv: string): CsvImportResult {
  const rows = parseCsv(csv);
  if (rows.length === 0) return { contacts: [], skipped: [], duplicates: [] };

  let headers = rows[0].map((header) => normalizeHeader(header.trim()));
  let emailIndex = headers.findIndex((header) => header.toLowerCase() === "email");
  let firstContactRowIndex = 1;

  if (emailIndex === -1) {
    if (!isValidEmail(rows[0][0] ?? "")) {
      return { contacts: [], skipped: [{ row: 1, reason: "missing_email_header" }], duplicates: [] };
    }
    headers = inferHeaderlessContactHeaders(rows[0].length);
    emailIndex = 0;
    firstContactRowIndex = 0;
  }

  const contacts: ParsedContact[] = [];
  const skipped: CsvImportResult["skipped"] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  const known = new Set(["email", "first_name", "last_name", "company", "source", "consent_status", "consent_source", "tags"]);

  for (let index = firstContactRowIndex; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.every((value) => value.trim() === "")) continue;
    const email = normalizeEmail(row[emailIndex] ?? "");
    if (!isValidEmail(email)) {
      skipped.push({ row: index + 1, reason: "invalid_email", value: row[emailIndex] });
      continue;
    }
    if (seen.has(email)) {
      duplicates.push(email);
      continue;
    }
    seen.add(email);

    const contact: ParsedContact = { email, custom_fields_json: {} };
    headers.forEach((header, headerIndex) => {
      const key = normalizeHeader(header.trim());
      const value = (row[headerIndex] ?? "").trim();
      if (!key || key.toLowerCase() === "email") return;
      if (key === "full_name") {
        const { firstName, lastName } = splitFullName(value);
        if (firstName) contact.first_name ||= firstName;
        if (lastName) contact.last_name ||= lastName;
        return;
      }
      if (known.has(key)) {
        (contact as Record<string, unknown>)[key] = value;
      } else if (value) {
        contact.custom_fields_json[key] = value;
      }
    });

    contacts.push(contact);
  }

  return { contacts, skipped, duplicates };
}

function inferHeaderlessContactHeaders(columnCount: number) {
  return Array.from({ length: columnCount }, (_, index) =>
    headerlessContactHeaders[index] ?? `custom_field_${index + 1}`
  );
}

function normalizeHeader(header: string) {
  const key = header.toLowerCase().trim().replace(/\s+/g, "_").replace(/-/g, "_");
  const aliases: Record<string, string> = {
    email_address: "email",
    e_mail: "email",
    name: "full_name",
    full_name: "full_name",
    firstname: "first_name",
    first: "first_name",
    first_name: "first_name",
    lastname: "last_name",
    last: "last_name",
    last_name: "last_name",
    organisation: "company",
    organization: "company",
    company_name: "company",
    consent: "consent_status",
    consent_source_url: "consent_source"
  };
  return aliases[key] ?? key;
}

function splitFullName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function parseCsv(csv: string) {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    const next = csv[i + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      i += 1;
      continue;
    }
    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }
    current += char;
  }

  if (current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

export function renderTemplate(input: string, values: Record<string, unknown>) {
  return input.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function appendComplianceFooter(html: string, organizationAddress: string, unsubscribeUrl: string) {
  const footer = `<hr><p style="font-size:12px;color:#647067;line-height:1.5">You are receiving this email because you signed up for updates. ${escapeHtml(organizationAddress)}<br><a href="${escapeAttribute(unsubscribeUrl)}">Unsubscribe</a></p>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${footer}</body>`);
  return `${html}${footer}`;
}

export function appendTextFooter(text: string, organizationAddress: string, unsubscribeUrl: string) {
  return `${text.trim()}\n\n--\n${organizationAddress}\nUnsubscribe: ${unsubscribeUrl}`;
}

export function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_match, _quote, href, text) => `${stripTags(text)}: ${href}`)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function rewriteLinks(html: string, signer: (url: string) => string) {
  return html.replace(/href=(["'])(https?:\/\/[^"']+)\1/gi, (_match, quote: string, url: string) => {
    return `href=${quote}${escapeAttribute(signer(url))}${quote}`;
  });
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, "").trim();
}

export function validateSenderDomain(fromEmail: string, allowedDomains: string[]) {
  const email = normalizeEmail(fromEmail);
  const domain = email.split("@")[1];
  if (!domain) return { ok: false, reason: "invalid_from_email" };
  if (!allowedDomains.map((item) => item.toLowerCase()).includes(domain)) {
    return { ok: false, reason: "domain_not_allowed" };
  }
  return { ok: true, domain };
}

export async function signToken(payload: TokenPayload, secret: string) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmac(body, secret);
  return `${body}.${signature}`;
}

export async function verifyToken(token: string, secret: string): Promise<TokenPayload> {
  const [body, signature] = token.split(".");
  if (!body || !signature) throw new Error("invalid_token");
  const expected = await hmac(body, secret);
  if (!timingSafeEqual(signature, expected)) throw new Error("invalid_signature");
  const payload = JSON.parse(base64UrlDecode(body)) as TokenPayload;
  if (payload.exp && payload.exp < Date.now()) throw new Error("expired_token");
  return payload;
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function base64UrlEncode(value: string) {
  const bytes = tokenEncoder.encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function hmac(body: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    tokenEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, tokenEncoder.encode(body));
  const bytes = Array.from(new Uint8Array(signature));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
