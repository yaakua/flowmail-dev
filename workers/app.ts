import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRequestHandler } from "react-router";
import PostalMime from "postal-mime";
import { z } from "zod";
import {
  appendComplianceFooter,
  appendTextFooter,
  htmlToText,
  normalizeEmail,
  parseCsvContacts,
  renderTemplate,
  signToken,
  validateSenderDomain,
  verifyToken
} from "@flowmail/email-core";
import { runComplianceChecks } from "@flowmail/compliance";
import { generateLifecycleTemplate, classifyReply, draftReply } from "./ai";
import {
  CloudflareEmailError,
  applyCloudflareEmailRouting,
  checkCloudflareEmailConfig,
  deleteCloudflareEmailToken,
  discoverCloudflareEmailConfig,
  discoverSavedCloudflareEmailConfig,
  getCloudflareEmailConfig,
  saveCloudflareEmailConfig,
  sendCloudflareEmailTest,
  validateCloudflareEmailTokenForSetup,
  validateSavedCloudflareEmailTokenForSetup
} from "./cloudflare-email";
import { countD1Changes, runD1Batches, summarizeContactImport } from "./contact-import";
import { sendEmail } from "./email-sender";
import { createPasswordSessionCookie, getPublicAppUrl, getTrackingSecret, rememberPublicAppUrl, requestPublicAppUrl, requireFlowmailSession } from "./runtime-config";
import { ensureSchema } from "./schema";
import type { Campaign, CampaignSendRun, Contact, ContactEmailSend, Env, EventJob, InboundAttribution, Product, SendJob, Template } from "./types";

declare const __FLOWMAIL_LOCAL_SETUP__: boolean;

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  await ensureSchema(c.env.DB);
  await rememberPublicAppUrl(c.env.DB, requestPublicAppUrl(c.req.url, c.env));
  return next();
});

app.use("/api/*", cors());
app.use("/api/*", requireFlowmailSession);

app.post("/api/public/auth/session", async (c) => {
  const body = z.object({
    username: z.string().min(1),
    password: z.string().min(1)
  }).parse(await c.req.json());
  try {
    const cookie = await createPasswordSessionCookie(c.env.DB, c.env, body.username, body.password);
    c.header("Set-Cookie", cookie);
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "Invalid username or password." }, 401);
  }
});

app.get("/click/:token", async (c) => {
  const payload = await verifyToken(c.req.param("token") ?? "", await getTrackingSecret(c.env.DB, c.env));
  if (payload.type !== "click" || !payload.url) return c.text("Invalid click token", 400);
  await writeEvent(c.env.DB, {
    eventType: "click",
    campaignId: payload.campaignId,
    recipientId: payload.recipientId,
    contactId: payload.contactId,
    metadata: { url: payload.url, userAgent: c.req.header("user-agent") ?? "" }
  });
  return c.redirect(payload.url, 302);
});

app.get("/unsubscribe/:token", async (c) => {
  await verifyToken(c.req.param("token") ?? "", await getTrackingSecret(c.env.DB, c.env));
  return c.html(`<!doctype html><html><head><title>Unsubscribe</title><style>body{font-family:system-ui;background:#f6f3ee;color:#1f3d2b;display:grid;place-items:center;min-height:100vh}main{max-width:440px}button{background:#1f3d2b;color:white;border:0;padding:12px 16px;border-radius:8px}</style></head><body><main><h1>Unsubscribe</h1><p>Confirm that you no longer want lifecycle emails from this sender.</p><form method="post"><button>Confirm unsubscribe</button></form></main></body></html>`);
});

app.post("/unsubscribe/:token", async (c) => {
  const payload = await verifyToken(c.req.param("token") ?? "", await getTrackingSecret(c.env.DB, c.env));
  if (payload.type !== "unsubscribe") return c.text("Invalid unsubscribe token", 400);
  const now = new Date().toISOString();
  const contact = await c.env.DB.prepare("SELECT email FROM contacts WHERE id = ?").bind(payload.contactId).first<{ email: string }>();
  if (contact) {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE contacts SET unsubscribed_at = ?, updated_at = ? WHERE id = ?").bind(now, now, payload.contactId),
      c.env.DB.prepare("INSERT OR IGNORE INTO suppressions (id, email, reason, source, campaign_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), contact.email, "unsubscribe", "unsubscribe_page", payload.campaignId, now),
      c.env.DB.prepare("UPDATE campaign_recipients SET status = ?, unsubscribed_at = ?, updated_at = ? WHERE id = ?")
        .bind("unsubscribed", now, now, payload.recipientId)
    ]);
  }
  await writeEvent(c.env.DB, {
    eventType: "unsubscribe",
    campaignId: payload.campaignId,
    recipientId: payload.recipientId,
    contactId: payload.contactId
  });
  return c.html(`<!doctype html><html><head><title>Unsubscribed</title><style>body{font-family:system-ui;background:#f6f3ee;color:#1f3d2b;display:grid;place-items:center;min-height:100vh}</style></head><body><main><h1>You are unsubscribed.</h1><p>This address has been added to the suppression list.</p></main></body></html>`);
});

app.get("/api/v1/config", (c) => {
  return c.json({
    domains: allowedDomains(c.env),
    defaultLocale: c.env.DEFAULT_LOCALE,
    publicAppUrl: requestPublicAppUrl(c.req.url, c.env)
  });
});

app.get("/api/v1/setup/status", async (c) => {
  const checks: Array<{ name: string; ok: boolean; details: string }> = [];
  checks.push(await check("D1 database", async () => c.env.DB.prepare("SELECT 1 as ok").first()));
  checks.push(await check("R2 bucket", async () => c.env.BUCKET.list({ limit: 1 })));
  checks.push({ name: "Send queue", ok: Boolean(c.env.SEND_QUEUE), details: "Required for campaign send jobs." });
  checks.push({ name: "Email Service", ok: Boolean(c.env.EMAIL), details: "Required to send test emails and campaigns." });
  checks.push({ name: "Email Routing", ok: true, details: "Route the configured reply-to email to this Worker in Cloudflare Email Routing, then use the Cloudflare Email wizard to verify it." });
  const product = await getProduct(c.env.DB);
  const sender = validateSenderDomain(product.default_from_email, allowedSenderDomains(c.env, product));
  checks.push({ name: "Sending domain", ok: sender.ok && Boolean(product.sending_domain), details: "Save a Cloudflare Email config or sender domain before sending." });
  checks.push({ name: "Product sender", ok: sender.ok && Boolean(product.reply_to_email), details: "Save a from email and reply-to email through the Cloudflare Email config." });
  return c.json({
    checks,
    product,
    manualSteps: [
      "Enable Email Routing for your domain and route replies to this Worker.",
      "Onboard your sender domain for Cloudflare Email Service."
    ]
  });
});

app.get("/api/v1/system/diagnostics", async (c) => {
  const checks: Array<{ name: string; ok: boolean; details: string }> = [];
  checks.push(await check("D1 database", async () => c.env.DB.prepare("SELECT 1 as ok").first()));
  checks.push(await check("R2 bucket", async () => c.env.BUCKET.list({ limit: 1 })));
  checks.push({ name: "Send queue", ok: Boolean(c.env.SEND_QUEUE), details: "Required for campaign send jobs." });
  checks.push({ name: "Workers AI", ok: Boolean(c.env.AI), details: "Optional for better drafts; fallback drafts work without model access." });
  return c.json({ checks });
});

app.get("/api/v1/onboarding/status", async (c) => {
  const product = await getProduct(c.env.DB);
  const contacts = await c.env.DB.prepare("SELECT COUNT(*) as count FROM contacts").first<{ count: number }>();
  const campaigns = await c.env.DB.prepare("SELECT COUNT(*) as count FROM campaigns").first<{ count: number }>();
  const sent = await c.env.DB.prepare("SELECT COUNT(*) as count FROM email_events WHERE event_type IN ('sent', 'test_email')").first<{ count: number }>();
  const firstCampaign = await c.env.DB.prepare("SELECT COUNT(*) as count FROM campaigns WHERE status != 'draft'").first<{ count: number }>();
  const steps = [
    { key: "domain", label: "Configure your domain", complete: Boolean(product.default_from_email && product.sending_domain && product.reply_to_email) },
    { key: "contacts", label: "Import your contacts", complete: (contacts?.count ?? 0) > 0 },
    { key: "campaign", label: "Create your first email", complete: (campaigns?.count ?? 0) > 0 },
    { key: "test", label: "Send a test email", complete: (sent?.count ?? 0) > 0 },
    { key: "send", label: "Send your first campaign", complete: (firstCampaign?.count ?? 0) > 0 }
  ];
  return c.json({ steps, completed: steps.filter((step) => step.complete).length, total: steps.length });
});

app.get("/api/v1/cloudflare/email-config", async (c) => {
  return c.json({ ...await getCloudflareEmailConfig(c.env.DB, c.env), localSetupMode: isLocalSetupMode() });
});

app.post("/api/v1/cloudflare/email-config/discover", async (c) => {
  const body = z.object({
    token: z.string().min(1),
    zoneName: z.string().optional()
  }).parse(await c.req.json());

  try {
    return c.json(await discoverCloudflareEmailConfig(body, c.env));
  } catch (error) {
    return cloudflareEmailErrorResponse(c, error);
  }
});

app.post("/api/v1/cloudflare/email-config/discover-saved", async (c) => {
  const body = z.object({
    zoneName: z.string().optional()
  }).parse(await c.req.json());

  try {
    return c.json(await discoverSavedCloudflareEmailConfig(c.env.DB, body, c.env));
  } catch (error) {
    return cloudflareEmailErrorResponse(c, error);
  }
});

app.put("/api/v1/cloudflare/email-config", async (c) => {
  const body = z.object({
    zoneName: z.string().min(1),
    workerName: z.string().min(1).optional(),
    fromEmail: z.string().email(),
    replyToEmail: z.string().email(),
    token: z.string().optional()
  }).parse(await c.req.json());

  try {
    if (body.token?.trim()) {
      await validateCloudflareEmailTokenForSetup({ token: body.token, zoneName: body.zoneName }, c.env);
    } else {
      await validateSavedCloudflareEmailTokenForSetup(c.env.DB, { zoneName: body.zoneName }, c.env);
    }
    const saved = await saveCloudflareEmailConfig(c.env.DB, body, c.env);
    await syncProductSenderFromCloudflareConfig(c.env.DB, saved.fromEmail, saved.replyToEmail, saved.zoneName);
    return c.json(saved);
  } catch (error) {
    return cloudflareEmailErrorResponse(c, error);
  }
});

app.post("/api/v1/cloudflare/email-config/check", async (c) => {
  const checked = await checkCloudflareEmailConfig(c.env.DB, c.env);
  return c.json(isLocalSetupMode() ? withLocalReplyRoutingSkip(checked) : checked);
});

app.post("/api/v1/cloudflare/email-config/apply-routing", async (c) => {
  if (isLocalSetupMode()) {
    return c.json(withLocalReplyRoutingSkip(await checkCloudflareEmailConfig(c.env.DB, c.env)));
  }
  try {
    return c.json(await applyCloudflareEmailRouting(c.env.DB, c.env));
  } catch (error) {
    return cloudflareEmailErrorResponse(c, error);
  }
});

app.delete("/api/v1/cloudflare/email-config/token", async (c) => {
  return c.json(await deleteCloudflareEmailToken(c.env.DB, c.env));
});

app.post("/api/v1/setup/cloudflare-check", async (c) => {
  const body = z.object({ token: z.string().optional(), zoneName: z.string().optional() }).parse(await c.req.json());
  if (!body.token) {
    return c.json({ mode: "manual", message: "No token provided. Showing manual checklist only.", zones: [] });
  }
  const headers = { Authorization: `Bearer ${body.token}`, "Content-Type": "application/json" };
  const zonesUrl = new URL("https://api.cloudflare.com/client/v4/zones");
  if (body.zoneName) zonesUrl.searchParams.set("name", body.zoneName);
  const zonesResponse = await fetch(zonesUrl, { headers });
  const zones = await zonesResponse.json<any>();
  const zoneChecks = await Promise.all((zones.result ?? []).slice(0, 5).map(async (zone: any) => inspectZone(headers, zone)));
  return c.json({
    mode: "checked",
    zones: zoneChecks,
    nextSteps: [
      "Confirm Email Routing is enabled for the selected zone.",
      "Create a reply-to route to this Worker.",
      "Verify Email Service sender domain status in the Cloudflare dashboard."
    ]
  });
});

app.post("/api/v1/setup/test-email", async (c) => {
  const body = z.object({ to: z.string().email().optional() }).parse(await c.req.json());
  const product = await getProduct(c.env.DB);
  const sender = validateSenderDomain(product.default_from_email, allowedSenderDomains(c.env, product));
  if (!sender.ok) return c.json({ error: "Save a Cloudflare Email config before sending from this domain." }, 422);
  const to = body.to ?? (product.reply_to_email || product.default_from_email);
  const subject = `Flowmail test email for ${product.name}`;
  const html = `<p>This is a Flowmail setup test email for ${product.name}.</p>`;
  const text = `This is a Flowmail setup test email for ${product.name}.`;
  let sent: { messageId: string; provider?: string };
  let provider = "cloudflare-binding";
  try {
    sent = await sendCloudflareEmailTest(c.env.DB, {
      to,
      fromEmail: product.default_from_email,
      fromName: product.name,
      replyToEmail: product.reply_to_email || product.default_from_email,
      subject,
      html,
      text
    }, c.env);
    provider = sent.provider ?? provider;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Cloudflare token cannot send Email")) {
      return cloudflareEmailErrorResponse(c, error);
    }
    if (error instanceof CloudflareEmailError) {
      return cloudflareEmailErrorResponse(c, error);
    }
    if (!message.includes("Save Cloudflare email config") && !message.includes("Cloudflare API token")) throw error;
    sent = await sendEmail(c.env.EMAIL, {
      to,
      from: { email: product.default_from_email, name: product.name },
      replyTo: product.reply_to_email || product.default_from_email,
      subject,
      html,
      text
    });
  }
  await writeEvent(c.env.DB, { eventType: "test_email", metadata: { to, messageId: sent.messageId } });
  return c.json({ ok: true, to, messageId: sent.messageId, simulated: provider !== "cloudflare-api" && import.meta.env.DEV, provider });
});

app.get("/api/v1/product", async (c) => c.json(await getProduct(c.env.DB)));

app.put("/api/v1/product", async (c) => {
  const body = z.object({
    name: z.string().min(1),
    url: z.string().url().or(z.literal("")),
    brand_voice: z.string(),
    organization_address: z.string()
  }).parse(await c.req.json());
  const now = new Date().toISOString();
  const existing = await getProduct(c.env.DB);
  await c.env.DB.prepare(
    `UPDATE products SET name = ?, url = ?, brand_voice = ?, organization_address = ?, updated_at = ? WHERE id = ?`
  ).bind(body.name, body.url, body.brand_voice, body.organization_address, now, existing.id).run();
  return c.json(await getProduct(c.env.DB));
});

app.get("/api/v1/contacts", async (c) => {
  const hasPagination = c.req.query("page") !== undefined || c.req.query("pageSize") !== undefined;
  if (hasPagination) {
    const requestedPage = parsePositiveInt(c.req.query("page"), 1);
    const pageSize = parsePositiveInt(c.req.query("pageSize"), 25, 100);
    const totalRow = await c.env.DB.prepare("SELECT COUNT(*) as count FROM contacts").first<{ count: number }>();
    const total = Number(totalRow?.count ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * pageSize;
    const contacts = await c.env.DB.prepare(
      `SELECT contacts.*, suppressions.reason as suppression_reason,
        COALESCE(send_stats.email_send_count, 0) as email_send_count,
        COALESCE(send_stats.email_sent_count, 0) as email_sent_count,
        COALESCE(send_stats.email_failed_count, 0) as email_failed_count,
        send_stats.last_email_sent_at
       FROM contacts
       LEFT JOIN suppressions ON suppressions.email = contacts.email
       LEFT JOIN (
         SELECT contact_id,
          COUNT(*) as email_send_count,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as email_sent_count,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as email_failed_count,
          MAX(sent_at) as last_email_sent_at
         FROM contact_email_sends
         GROUP BY contact_id
       ) send_stats ON send_stats.contact_id = contacts.id
       ORDER BY contacts.created_at DESC LIMIT ? OFFSET ?`
    ).bind(pageSize, offset).all<Contact & { suppression_reason?: string }>();
    return c.json({
      items: contacts.results ?? [],
      total,
      page,
      pageSize,
      totalPages
    });
  }

  const contacts = await c.env.DB.prepare(
    `SELECT contacts.*, suppressions.reason as suppression_reason,
       COALESCE(send_stats.email_send_count, 0) as email_send_count,
       COALESCE(send_stats.email_sent_count, 0) as email_sent_count,
       COALESCE(send_stats.email_failed_count, 0) as email_failed_count,
       send_stats.last_email_sent_at
     FROM contacts
     LEFT JOIN suppressions ON suppressions.email = contacts.email
     LEFT JOIN (
       SELECT contact_id,
        COUNT(*) as email_send_count,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as email_sent_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as email_failed_count,
        MAX(sent_at) as last_email_sent_at
       FROM contact_email_sends
       GROUP BY contact_id
     ) send_stats ON send_stats.contact_id = contacts.id
     ORDER BY contacts.created_at DESC LIMIT 500`
  ).all<Contact & { suppression_reason?: string }>();
  return c.json(contacts.results ?? []);
});

app.get("/api/v1/contacts/:id", async (c) => {
  const contact = await c.env.DB.prepare(
    `SELECT contacts.*, suppressions.reason as suppression_reason
     FROM contacts
     LEFT JOIN suppressions ON suppressions.email = contacts.email
     WHERE contacts.id = ?`
  ).bind(c.req.param("id")).first<Contact & { suppression_reason?: string }>();
  if (!contact) return c.json({ error: "Not found" }, 404);

  const [stats, sends] = await Promise.all([
    c.env.DB.prepare(
      `SELECT
        COUNT(*) as email_send_count,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as email_sent_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as email_failed_count,
        MAX(sent_at) as last_email_sent_at
       FROM contact_email_sends
       WHERE contact_id = ?`
    ).bind(contact.id).first<{
      email_send_count: number;
      email_sent_count: number | null;
      email_failed_count: number | null;
      last_email_sent_at: string | null;
    }>(),
    c.env.DB.prepare(
      `SELECT contact_email_sends.*,
        campaigns.name as campaign_name,
        campaigns.status as campaign_status,
        campaign_send_runs.created_at as send_run_created_at
       FROM contact_email_sends
       LEFT JOIN campaigns ON campaigns.id = contact_email_sends.campaign_id
       LEFT JOIN campaign_send_runs ON campaign_send_runs.id = contact_email_sends.send_run_id
       WHERE contact_email_sends.contact_id = ?
       ORDER BY contact_email_sends.created_at DESC
       LIMIT 200`
    ).bind(contact.id).all<ContactEmailSend & {
      campaign_name?: string | null;
      campaign_status?: string | null;
      send_run_created_at?: string | null;
    }>()
  ]);

  return c.json({
    contact,
    stats: {
      emailSendCount: Number(stats?.email_send_count ?? 0),
      emailSentCount: Number(stats?.email_sent_count ?? 0),
      emailFailedCount: Number(stats?.email_failed_count ?? 0),
      lastEmailSentAt: stats?.last_email_sent_at ?? null
    },
    sends: sends.results ?? []
  });
});

app.get("/api/v1/suppressions", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM suppressions ORDER BY created_at DESC LIMIT 500").all();
  return c.json(rows.results ?? []);
});

app.post("/api/v1/suppressions", async (c) => {
  const body = z.object({
    email: z.string().email(),
    reason: z.string().min(1).default("manual"),
    source: z.string().min(1).default("operator")
  }).parse(await c.req.json());
  const email = normalizeEmail(body.email);
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO suppressions (id, email, reason, source, campaign_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), email, body.reason, body.source, null, now),
    c.env.DB.prepare("UPDATE contacts SET unsubscribed_at = COALESCE(unsubscribed_at, ?), updated_at = ? WHERE email = ?")
      .bind(now, now, email)
  ]);
  return c.json({ ok: true, email });
});

app.post("/api/v1/contacts/import", async (c) => {
  const body = z.object({ filename: z.string().default("contacts.csv"), csv: z.string().min(1) }).parse(await c.req.json());
  const now = new Date().toISOString();
  const parsed = parseCsvContacts(body.csv);
  const importId = crypto.randomUUID();
  await c.env.BUCKET.put(`imports/${importId}/${body.filename}`, body.csv, { httpMetadata: { contentType: "text/csv" } });
  const statements = parsed.contacts.map((contact) =>
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO contacts (id, email, first_name, last_name, company, source, consent_status, consent_source, tags_json, custom_fields_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      contact.email,
      contact.first_name ?? null,
      contact.last_name ?? null,
      contact.company ?? null,
      contact.source ?? "csv",
      contact.consent_status ?? "unknown",
      contact.consent_source ?? contact.source ?? "csv",
      JSON.stringify((contact.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean)),
      JSON.stringify(contact.custom_fields_json),
      now,
      now
    )
  );
  const insertResults = statements.length > 0 ? await runD1Batches(c.env.DB, statements) : [];
  const report = summarizeContactImport(parsed, countD1Changes(insertResults));
  await c.env.DB.prepare(
    `INSERT INTO contact_imports (id, filename, status, total_rows, imported_count, skipped_count, error_count, report_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    importId,
    body.filename,
    "completed",
    report.totalRows,
    report.importedCount,
    report.skippedCount + report.duplicateCount + report.existingCount,
    report.skippedCount,
    JSON.stringify(report),
    now
  ).run();
  return c.json({ importId, ...report });
});

app.get("/api/v1/campaigns", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT c.*, t.subject,
      (SELECT COUNT(*) FROM campaign_recipients r WHERE r.campaign_id = c.id) as recipient_count,
      (SELECT COUNT(*) FROM campaign_recipients r WHERE r.campaign_id = c.id AND r.status IN ('sent', 'sending', 'queued')) as touched_recipient_count,
      (SELECT COUNT(*) FROM campaign_send_runs sr WHERE sr.campaign_id = c.id) as send_run_count,
      (SELECT COUNT(*) FROM email_events e WHERE e.campaign_id = c.id AND e.event_type = 'click') as click_count,
      (SELECT COUNT(*) FROM email_events e WHERE e.campaign_id = c.id AND e.event_type = 'reply') as reply_count,
      (SELECT COUNT(*) FROM email_events e WHERE e.campaign_id = c.id AND e.event_type = 'unsubscribe') as unsubscribe_count
     FROM campaigns c JOIN templates t ON t.id = c.template_id ORDER BY c.created_at DESC`
  ).all();
  return c.json(rows.results ?? []);
});

app.get("/api/v1/send-tasks", async (c) => {
  const campaignId = c.req.query("campaignId");
  const taskSql = `SELECT r.*,
      c.name as campaign_name,
      c.status as campaign_status,
      latest_run.send_run_id,
      latest_run.created_at as send_run_created_at,
      contacts.first_name,
      contacts.last_name,
      contacts.company
     FROM campaign_recipients r
     JOIN campaigns c ON c.id = r.campaign_id
     LEFT JOIN contacts ON contacts.id = r.contact_id
     LEFT JOIN (
       SELECT recipient_id, send_run_id, MAX(created_at) as created_at
       FROM campaign_send_run_recipients
       GROUP BY recipient_id
     ) latest_run ON latest_run.recipient_id = r.id
     ${campaignId ? "WHERE r.campaign_id = ?" : ""}
     ORDER BY r.updated_at DESC, r.created_at DESC
     LIMIT 500`;
  const summarySql = `SELECT r.status, COUNT(*) as count
     FROM campaign_recipients r
     ${campaignId ? "WHERE r.campaign_id = ?" : ""}
     GROUP BY r.status`;
  const recentFailuresSql = `SELECT r.*,
      c.name as campaign_name,
      contacts.first_name,
      contacts.last_name,
      contacts.company
     FROM campaign_recipients r
     JOIN campaigns c ON c.id = r.campaign_id
     LEFT JOIN contacts ON contacts.id = r.contact_id
     WHERE r.failure_reason IS NOT NULL ${campaignId ? "AND r.campaign_id = ?" : ""}
     ORDER BY r.failed_at DESC, r.updated_at DESC
     LIMIT 8`;
  const taskStatement = campaignId ? c.env.DB.prepare(taskSql).bind(campaignId) : c.env.DB.prepare(taskSql);
  const summaryStatement = campaignId ? c.env.DB.prepare(summarySql).bind(campaignId) : c.env.DB.prepare(summarySql);
  const recentFailuresStatement = campaignId ? c.env.DB.prepare(recentFailuresSql).bind(campaignId) : c.env.DB.prepare(recentFailuresSql);
  const [tasks, summary, recentFailures] = await Promise.all([
    taskStatement.all(),
    summaryStatement.all<{ status: string; count: number }>(),
    recentFailuresStatement.all()
  ]);
  const runs = await getCampaignSendRuns(c.env.DB, campaignId ?? undefined, 50);
  return c.json({
    tasks: tasks.results ?? [],
    summary: Object.fromEntries((summary.results ?? []).map((row) => [row.status, Number(row.count)])),
    recentFailures: recentFailures.results ?? [],
    runs
  });
});

app.get("/api/v1/dashboard/summary", async (c) => {
  const [contacts, campaigns, replies, clicks, unsubscribes, drafts] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as count FROM contacts").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM campaigns").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM inbound_messages").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM email_events WHERE event_type = 'click'").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM email_events WHERE event_type = 'unsubscribe'").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM agent_actions WHERE status = 'draft'").first<{ count: number }>()
  ]);
  return c.json({
    contacts: contacts?.count ?? 0,
    campaigns: campaigns?.count ?? 0,
    replies: replies?.count ?? 0,
    clicks: clicks?.count ?? 0,
    unsubscribes: unsubscribes?.count ?? 0,
    pendingDrafts: drafts?.count ?? 0
  });
});

app.get("/api/v1/campaigns/:id", async (c) => {
  const campaign = await c.env.DB.prepare("SELECT * FROM campaigns WHERE id = ?").bind(c.req.param("id")).first<Campaign>();
  if (!campaign) return c.json({ error: "Not found" }, 404);
  const template = await c.env.DB.prepare("SELECT * FROM templates WHERE id = ?").bind(campaign.template_id).first<Template>();
  const [recipients, events, sendRuns, audience] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM campaign_recipients WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 100").bind(campaign.id).all(),
    c.env.DB.prepare("SELECT event_type, COUNT(*) as count FROM email_events WHERE campaign_id = ? GROUP BY event_type").bind(campaign.id).all(),
    getCampaignSendRuns(c.env.DB, campaign.id, 20),
    campaignAudience(c.env.DB, campaign.id)
  ]);
  return c.json({
    campaign,
    template,
    recipients: recipients.results ?? [],
    events: events.results ?? [],
    sendRuns,
    audience: audienceSummary(audience)
  });
});

app.get("/api/v1/campaigns/:id/preview-contact", async (c) => {
  const campaign = await getCampaign(c.env.DB, c.req.param("id"));
  if (!campaign) return c.json({ error: "Not found" }, 404);
  const template = await getTemplate(c.env.DB, campaign.template_id);
  if (!template) return c.json({ error: "Template missing" }, 500);
  const product = await getProduct(c.env.DB);
  const audience = await campaignAudience(c.env.DB);
  const contact = audience.eligible[0] ?? audience.contacts[0] ?? null;
  const values: Record<string, string> = contact ? contactValues(contact) : { first_name: "Preview", last_name: "", company: product.name, email: "preview@example.com" };
  values.unsubscribe_url = `${requestPublicAppUrl(c.req.url, c.env)}/unsubscribe/preview`;
  const renderedHtml = renderTemplate(template.html_body, values);
  const renderedText = renderTemplate(template.text_body, values);
  return c.json({
    contact,
    rendered: {
      subject: renderTemplate(template.subject, values),
      html: appendComplianceFooter(renderedHtml, product.organization_address || "Organization address preview", values.unsubscribe_url),
      text: appendTextFooter(renderedText, product.organization_address || "Organization address preview", values.unsubscribe_url)
    }
  });
});

app.get("/api/v1/campaigns/:id/compliance", async (c) => {
  const campaign = await getCampaign(c.env.DB, c.req.param("id"));
  if (!campaign) return c.json({ error: "Not found" }, 404);
  const product = await getProduct(c.env.DB);
  const template = await getTemplate(c.env.DB, campaign.template_id);
  if (!template) return c.json({ error: "Template missing" }, 500);
  const audience = await campaignAudience(c.env.DB, campaign.id);
  return c.json(runComplianceChecks({
    fromEmail: product.default_from_email,
    allowedDomains: allowedSenderDomains(c.env, product),
    subject: template.subject,
    htmlBody: template.html_body,
    textBody: template.text_body,
    organizationAddress: product.organization_address,
    totalRecipients: audience.eligible.length,
    suppressedRecipients: audience.suppressedCount,
    consentlessRecipients: audience.consentlessCount
  }));
});

app.post("/api/v1/campaigns/draft", async (c) => {
  const body = z.object({ goal: z.string().min(1), name: z.string().optional() }).parse(await c.req.json());
  const now = new Date().toISOString();
  const product = await getProduct(c.env.DB);
  const draft = await generateLifecycleTemplate(c.env, product, body.goal);
  const templateId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO templates (id, name, type, subject, html_body, text_body, variables_json, compliance_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(templateId, body.name ?? "Lifecycle email", "lifecycle", draft.subject, draft.html_body, draft.text_body, JSON.stringify(["first_name", "company", "unsubscribe_url"]), "draft", now, now),
    c.env.DB.prepare(
      `INSERT INTO campaigns (id, name, status, goal, template_id, audience_filter_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(campaignId, body.name ?? body.goal.slice(0, 80), "draft", body.goal, templateId, JSON.stringify({ type: "all_contacts" }), now, now)
  ]);
  return c.json({ campaign: await getCampaign(c.env.DB, campaignId), template: await getTemplate(c.env.DB, templateId) }, 201);
});

app.put("/api/v1/campaigns/:id/template", async (c) => {
  const body = z.object({ subject: z.string().min(1), html_body: z.string().min(1), text_body: z.string().min(1).optional() }).parse(await c.req.json());
  const campaign = await getCampaign(c.env.DB, c.req.param("id"));
  if (!campaign) return c.json({ error: "Not found" }, 404);
  const now = new Date().toISOString();
  const textBody = body.text_body?.trim() || htmlToText(body.html_body);
  await c.env.DB.prepare("UPDATE templates SET subject = ?, html_body = ?, text_body = ?, updated_at = ? WHERE id = ?")
    .bind(body.subject, body.html_body, textBody, now, campaign.template_id).run();
  return c.json({ campaign, template: await getTemplate(c.env.DB, campaign.template_id) });
});

app.post("/api/v1/campaigns/:id/send-preview", async (c) => {
  const campaign = await getCampaign(c.env.DB, c.req.param("id"));
  if (!campaign) return c.json({ error: "Not found" }, 404);
  const body = z.object({ limit: z.number().int().positive().max(1000).optional() }).parse(await c.req.json().catch(() => ({})));
  const preview = await prepareCampaignSend(c.env, campaign, { limit: body.limit });
  return c.json(preview);
});

app.post("/api/v1/campaigns/:id/send-runs", async (c) => {
  const campaign = await getCampaign(c.env.DB, c.req.param("id"));
  if (!campaign) return c.json({ error: "Not found" }, 404);
  const body = z.object({ limit: z.number().int().positive().max(1000).optional() }).parse(await c.req.json().catch(() => ({})));
  const result = await createCampaignSendRun(c.env, campaign, { limit: body.limit });
  if (!result.ok) return c.json(result, result.statusCode);
  return c.json(result);
});

app.post("/api/v1/campaigns/:id/approve", async (c) => {
  const campaign = await getCampaign(c.env.DB, c.req.param("id"));
  if (!campaign) return c.json({ error: "Not found" }, 404);
  const result = await createCampaignSendRun(c.env, campaign, {});
  if (!result.ok) return c.json(result, result.statusCode);
  return c.json({ campaign: result.campaign, queued: result.run.queued_count, compliance: result.compliance, run: result.run });
});

app.post("/api/v1/send-runs/:id/retry", async (c) => {
  const result = await retryFailedSendRun(c.env, c.req.param("id"));
  if (!result.ok) return c.json(result, result.statusCode);
  return c.json(result);
});

app.get("/api/v1/inbox", async (c) => {
  const messages = await c.env.DB.prepare(
    `SELECT inbound_messages.*, contacts.email as contact_email
     FROM inbound_messages LEFT JOIN contacts ON contacts.id = inbound_messages.contact_id
     ORDER BY inbound_messages.created_at DESC LIMIT 200`
  ).all();
  return c.json(messages.results ?? []);
});

app.get("/api/v1/inbox/analysis", async (c) => {
  const [classifications, recent, agent] = await Promise.all([
    c.env.DB.prepare("SELECT classification, COUNT(*) as count FROM inbound_messages GROUP BY classification ORDER BY count DESC").all(),
    c.env.DB.prepare("SELECT * FROM inbound_messages ORDER BY created_at DESC LIMIT 20").all(),
    c.env.DB.prepare("SELECT status, COUNT(*) as count FROM agent_actions GROUP BY status").all()
  ]);
  return c.json({
    classifications: classifications.results ?? [],
    recent: recent.results ?? [],
    agent: agent.results ?? []
  });
});

app.get("/api/v1/inbox/:id", async (c) => {
  const message = await c.env.DB.prepare(
    `SELECT inbound_messages.*, contacts.email as contact_email, contacts.first_name, contacts.company
     FROM inbound_messages
     LEFT JOIN contacts ON contacts.id = inbound_messages.contact_id
     WHERE inbound_messages.id = ?`
  ).bind(c.req.param("id")).first<any>();
  if (!message) return c.json({ error: "Not found" }, 404);
  const actions = await c.env.DB.prepare("SELECT * FROM agent_actions WHERE json_extract(input_json, '$.inboundId') = ? ORDER BY created_at DESC")
    .bind(message.id)
    .all();
  return c.json({ message, actions: actions.results ?? [] });
});

app.post("/api/v1/inbox/:id/status", async (c) => {
  const body = z.object({ status: z.enum(["resolved", "needs_reply", "archived", "unsubscribed"]) }).parse(await c.req.json());
  const message = await c.env.DB.prepare("SELECT * FROM inbound_messages WHERE id = ?").bind(c.req.param("id")).first<any>();
  if (!message) return c.json({ error: "Not found" }, 404);
  if (body.status === "unsubscribed" && message.sender) {
    const now = new Date().toISOString();
    await c.env.DB.prepare("INSERT OR IGNORE INTO suppressions (id, email, reason, source, campaign_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), message.sender, "reply_unsubscribe", "inbox_action", message.campaign_id ?? null, now)
      .run();
  }
  await writeEvent(c.env.DB, {
    eventType: `reply_${body.status}`,
    campaignId: message.campaign_id ?? undefined,
    contactId: message.contact_id ?? undefined,
    metadata: { inboundId: message.id }
  });
  return c.json({ ok: true });
});

app.post("/api/v1/inbox/:id/reply", async (c) => {
  const body = z.object({ text: z.string().min(1).max(5000) }).parse(await c.req.json());
  const inbound = await c.env.DB.prepare("SELECT * FROM inbound_messages WHERE id = ?").bind(c.req.param("id")).first<any>();
  if (!inbound) return c.json({ error: "Not found" }, 404);
  try {
    const sent = await sendReplyToInbound(c.env, inbound, body.text, { source: "manual_reply" });
    return c.json({ ok: true, messageId: sent.messageId });
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 422);
  }
});

app.get("/api/v1/followups", async (c) => {
  const [drafts, replies, campaigns] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM agent_actions WHERE status = 'draft' ORDER BY created_at DESC LIMIT 20").all<any>(),
    c.env.DB.prepare("SELECT * FROM inbound_messages ORDER BY created_at DESC LIMIT 20").all<any>(),
    c.env.DB.prepare("SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 10").all<any>()
  ]);
  const tasks = [
    ...(drafts.results ?? []).map((action: any) => ({
      id: action.id,
      type: "agent_draft",
      title: "Review Agent reply draft",
      priority: "high",
      href: "/inbox",
      created_at: action.created_at
    })),
    ...(replies.results ?? []).filter((message: any) => message.classification !== "auto_reply").map((message: any) => ({
      id: message.id,
      type: "reply",
      title: `Follow up with ${message.sender}`,
      priority: message.classification === "sales_intent" ? "high" : "normal",
      href: `/inbox/${message.id}`,
      created_at: message.created_at
    })),
    ...(campaigns.results ?? []).filter((campaign: any) => campaign.status === "draft").map((campaign: any) => ({
      id: campaign.id,
      type: "campaign",
      title: `Finish campaign: ${campaign.name}`,
      priority: "normal",
      href: `/campaigns/${campaign.id}`,
      created_at: campaign.created_at
    }))
  ];
  return c.json(tasks.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 30));
});

app.get("/api/v1/agent-actions", async (c) => {
  const actions = await c.env.DB.prepare("SELECT * FROM agent_actions ORDER BY created_at DESC LIMIT 100").all();
  return c.json(actions.results ?? []);
});

app.post("/api/v1/agent-actions/:id/approve", async (c) => {
  const now = new Date().toISOString();
  await c.env.DB.prepare("UPDATE agent_actions SET status = ?, approved_at = ? WHERE id = ?").bind("approved", now, c.req.param("id")).run();
  return c.json({ ok: true });
});

app.post("/api/v1/agent-actions/:id/send", async (c) => {
  const action = await c.env.DB.prepare("SELECT * FROM agent_actions WHERE id = ?").bind(c.req.param("id")).first<any>();
  if (!action) return c.json({ error: "Not found" }, 404);
  if (action.status !== "draft") return c.json({ error: "Agent action is not draft." }, 409);
  if (action.action_type !== "reply_draft") return c.json({ error: "Only reply drafts can be sent." }, 422);

  const input = JSON.parse(action.input_json || "{}");
  const output = JSON.parse(action.output_json || "{}");
  const inbound = await c.env.DB.prepare("SELECT * FROM inbound_messages WHERE id = ?").bind(input.inboundId).first<any>();
  if (!inbound) return c.json({ error: "Inbound message missing." }, 404);

  const product = await getProduct(c.env.DB);
  const sender = validateSenderDomain(product.default_from_email, allowedSenderDomains(c.env, product));
  if (!sender.ok) return c.json({ error: "Save a Cloudflare Email config before sending from this domain." }, 422);
  if (await isSuppressed(c.env.DB, inbound.sender)) return c.json({ error: "Recipient is suppressed." }, 422);

  const subject = inbound.subject?.toLowerCase().startsWith("re:") ? inbound.subject : `Re: ${inbound.subject || "your reply"}`;
  const draft = String(output.draft ?? "");
  const sent = await sendEmail(c.env.EMAIL, {
    to: inbound.sender,
    from: { email: product.default_from_email, name: product.name },
    replyTo: product.reply_to_email || product.default_from_email,
    subject,
    html: `<p>${escapeHtmlForEmail(draft).replace(/\n/g, "<br>")}</p>`,
    text: draft,
    headers: {
      "X-Flowmail-Agent-Action": action.id,
      ...(inbound.thread_key ? { "In-Reply-To": inbound.thread_key } : {})
    }
  });

  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE agent_actions SET status = ?, approved_at = ? WHERE id = ?").bind("sent", now, action.id),
    c.env.DB.prepare("INSERT INTO email_events (id, campaign_id, recipient_id, contact_id, event_type, event_time, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), inbound.campaign_id ?? null, null, inbound.contact_id ?? null, "agent_reply_sent", now, JSON.stringify({ inboundId: inbound.id, messageId: sent.messageId }))
  ]);
  return c.json({ ok: true, messageId: sent.messageId });
});

app.all("*", (c) => {
  return requestHandler(c.req.raw, {
    cloudflare: { env: c.env, ctx: c.executionCtx as ExecutionContext }
  });
});

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<SendJob | EventJob>, env: Env, ctx: ExecutionContext) {
    await ensureSchema(env.DB);
    for (const message of batch.messages) {
      let body: SendJob | EventJob | null = null;
      try {
        body = message.body as SendJob | EventJob;
        if ("recipientId" in body && "campaignId" in body && !("eventType" in body)) {
          await processSendJob(env, body);
        } else {
          await writeEvent(env.DB, body as EventJob);
        }
        message.ack();
      } catch (error) {
        console.error("Queue message failed", error);
        const reason = errorMessage(error);
        if (reason === "Per-minute send rate reached.") {
          message.retry({ delaySeconds: 60 });
        } else if (reason === "Daily send limit reached.") {
          message.retry({ delaySeconds: 60 * 60 });
        } else if (isSendJob(body) && message.attempts >= 3) {
          await markLatestContactEmailSendFailed(env.DB, body.recipientId, body.sendRunId, reason);
          await markRecipient(env.DB, body.recipientId, "failed", reason);
          await refreshSendRunForRecipient(env.DB, body.recipientId, body.sendRunId);
          await updateCampaignCompletion(env.DB, body.campaignId);
          message.ack();
        } else {
          if (isSendJob(body)) await markLatestContactEmailSendFailed(env.DB, body.recipientId, body.sendRunId, reason);
          message.retry();
        }
      }
    }
  },
  async email(event: { raw: ReadableStream; rawSize: number }, env: Env, ctx: ExecutionContext) {
    await ensureSchema(env.DB);
    ctx.waitUntil(receiveEmail(event, env));
  }
};

async function processSendJob(env: Env, job: SendJob) {
  const recipient = await env.DB.prepare("SELECT * FROM campaign_recipients WHERE id = ?").bind(job.recipientId).first<any>();
  if (!recipient || recipient.status === "sent") return;
  const sendRunId = job.sendRunId ?? await findSendRunIdForRecipient(env.DB, recipient.id);

  const [campaign, template, product, contact] = await Promise.all([
    getCampaign(env.DB, job.campaignId),
    env.DB.prepare("SELECT templates.* FROM templates JOIN campaigns ON campaigns.template_id = templates.id WHERE campaigns.id = ?").bind(job.campaignId).first<Template>(),
    getProduct(env.DB),
    env.DB.prepare("SELECT * FROM contacts WHERE id = ?").bind(recipient.contact_id).first<Contact>()
  ]);
  if (!campaign || !template || !contact) return;

  if (contact.unsubscribed_at || contact.bounced_at || await isSuppressed(env.DB, contact.email)) {
    await markRecipient(env.DB, recipient.id, "suppressed", "Recipient is suppressed.");
    if (sendRunId) await refreshSendRun(env.DB, sendRunId);
    await updateCampaignCompletion(env.DB, campaign.id);
    return;
  }

  const nowSending = new Date().toISOString();
  await env.DB.prepare("UPDATE campaign_recipients SET status = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
    .bind("sending", nowSending, recipient.id)
    .run();
  if (sendRunId) await refreshSendRun(env.DB, sendRunId);

  const sentToday = await env.DB.prepare("SELECT COUNT(*) as count FROM campaign_recipients WHERE sent_at >= ?")
    .bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .first<{ count: number }>();
  if ((sentToday?.count ?? 0) >= Number(env.DAILY_SEND_LIMIT || 250)) {
    throw new Error("Daily send limit reached.");
  }
  const rateLimit = Number(env.SEND_RATE_PER_MINUTE || 30);
  const sentLastMinute = await env.DB.prepare("SELECT COUNT(*) as count FROM campaign_recipients WHERE sent_at >= ?")
    .bind(new Date(Date.now() - 60 * 1000).toISOString())
    .first<{ count: number }>();
  if (rateLimit > 0 && (sentLastMinute?.count ?? 0) >= rateLimit) {
    throw new Error("Per-minute send rate reached.");
  }

  const values = contactValues(contact);
  const [trackingSecret, publicAppUrl] = await Promise.all([
    getTrackingSecret(env.DB, env),
    getPublicAppUrl(env.DB, env)
  ]);
  const unsubscribeToken = await signToken({ type: "unsubscribe", campaignId: campaign.id, recipientId: recipient.id, contactId: contact.id }, trackingSecret);
  const unsubscribeUrl = `${publicAppUrl}/unsubscribe/${unsubscribeToken}`;
  values.unsubscribe_url = unsubscribeUrl;
  const linkSigner = async (url: string) => {
    const token = await signToken({ type: "click", campaignId: campaign.id, recipientId: recipient.id, contactId: contact.id, url }, trackingSecret);
    return `${publicAppUrl}/click/${token}`;
  };

  const subject = renderTemplate(template.subject, values);
  const renderedHtml = renderTemplate(template.html_body, values);
  const renderedText = renderTemplate(template.text_body, values);
  const html = appendComplianceFooter(await rewriteHtmlLinks(renderedHtml, linkSigner), product.organization_address, unsubscribeUrl);
  const text = appendTextFooter(renderedText, product.organization_address, unsubscribeUrl);
  const sendRecordId = crypto.randomUUID();
  await writeContactEmailSend(env.DB, {
    id: sendRecordId,
    contactId: contact.id,
    campaignId: campaign.id,
    sendRunId,
    recipientId: recipient.id,
    email: contact.email,
    status: "sending",
    subject,
    html,
    text
  });
  const sent = await sendEmail(env.EMAIL, {
    to: contact.email,
    from: { email: product.default_from_email, name: product.name },
    replyTo: product.reply_to_email || product.default_from_email,
    subject,
    html,
    text,
    headers: {
      "X-Flowmail-Campaign": campaign.id,
      "X-Flowmail-Recipient": recipient.id
    }
  });

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE campaign_recipients SET status = ?, message_id = ?, sent_at = ?, updated_at = ? WHERE id = ?")
      .bind("sent", sent.messageId, now, now, recipient.id),
    env.DB.prepare("UPDATE contact_email_sends SET status = ?, message_id = ?, sent_at = ?, updated_at = ? WHERE id = ?")
      .bind("sent", sent.messageId, now, now, sendRecordId),
    env.DB.prepare("INSERT INTO email_events (id, campaign_id, recipient_id, contact_id, event_type, event_time, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), campaign.id, recipient.id, contact.id, "sent", now, JSON.stringify({ messageId: sent.messageId }))
  ]);
  if (sendRunId) await refreshSendRun(env.DB, sendRunId);
  await updateCampaignCompletion(env.DB, campaign.id);
}

function isSendJob(body: SendJob | EventJob | null): body is SendJob {
  return Boolean(body && "recipientId" in body && "campaignId" in body && !("eventType" in body) && body.recipientId && body.campaignId);
}

async function receiveEmail(event: { raw: ReadableStream; rawSize: number }, env: Env) {
  const raw = await new Response(event.raw).arrayBuffer();
  const rawKey = `inbound/${crypto.randomUUID()}.eml`;
  await env.BUCKET.put(rawKey, raw, { httpMetadata: { contentType: "message/rfc822" } });
  const parsed = await PostalMime.parse(raw);
  const from = normalizeEmail((parsed.from as any)?.address ?? "");
  const attribution = await resolveInboundAttribution(env.DB, parsed, from);
  const contact = attribution.contactId
    ? await env.DB.prepare("SELECT * FROM contacts WHERE id = ?").bind(attribution.contactId).first<Contact>()
    : from ? await env.DB.prepare("SELECT * FROM contacts WHERE email = ?").bind(from).first<Contact>() : null;
  const bodyText = parsed.text ?? "";
  const classification = await classifyReply(bodyText);
  const now = new Date().toISOString();
  const inboundId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO inbound_messages (id, campaign_id, contact_id, sender, subject, body_text, raw_email_ref, thread_key, classification, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(inboundId, attribution.campaignId, contact?.id ?? attribution.contactId, from || "unknown", parsed.subject ?? "", bodyText, rawKey, parsed.inReplyTo ?? parsed.messageId ?? "", classification, now).run();
  if (contact) {
    await writeEvent(env.DB, { eventType: "reply", campaignId: attribution.campaignId ?? undefined, recipientId: attribution.recipientId ?? undefined, contactId: contact.id, metadata: { inboundId, classification } });
  }
  const product = await getProduct(env.DB);
  const output = { draft: await draftReply(product, from, bodyText), inboundId, classification };
  await env.DB.prepare(
    `INSERT INTO agent_actions (id, action_type, input_json, output_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), "reply_draft", JSON.stringify({ inboundId, sender: from, subject: parsed.subject ?? "", campaignId: attribution.campaignId, recipientId: attribution.recipientId }), JSON.stringify(output), "draft", now).run();
}

async function sendReplyToInbound(env: Env, inbound: any, text: string, metadata: Record<string, unknown>) {
  const product = await getProduct(env.DB);
  const sender = validateSenderDomain(product.default_from_email, allowedSenderDomains(env, product));
  if (!sender.ok) throw new Error("Save a Cloudflare Email config before sending from this domain.");
  if (await isSuppressed(env.DB, inbound.sender)) throw new Error("Recipient is suppressed.");

  const subject = inbound.subject?.toLowerCase().startsWith("re:") ? inbound.subject : `Re: ${inbound.subject || "your reply"}`;
  const sent = await sendEmail(env.EMAIL, {
    to: inbound.sender,
    from: { email: product.default_from_email, name: product.name },
    replyTo: product.reply_to_email || product.default_from_email,
    subject,
    html: `<p>${escapeHtmlForEmail(text).replace(/\n/g, "<br>")}</p>`,
    text,
    headers: {
      ...(inbound.thread_key ? { "In-Reply-To": inbound.thread_key } : {})
    }
  });

  await writeEvent(env.DB, {
    eventType: "manual_reply_sent",
    campaignId: inbound.campaign_id ?? undefined,
    contactId: inbound.contact_id ?? undefined,
    metadata: { ...metadata, inboundId: inbound.id, messageId: sent.messageId }
  });
  return sent;
}

async function getProduct(db: D1Database) {
  const existing = await db.prepare("SELECT * FROM products LIMIT 1").first<Product>();
  if (existing) return existing;
  const now = new Date().toISOString();
  const product: Product = {
    id: crypto.randomUUID(),
    name: "Flowmail",
    url: "https://example.com",
    default_from_email: "hello@example.com",
    sending_domain: "example.com",
    reply_to_email: "hello@example.com",
    brand_voice: "Clear, concise, and helpful.",
    organization_address: "",
    created_at: now,
    updated_at: now
  };
  await db.prepare(
    `INSERT INTO products (id, name, url, default_from_email, sending_domain, reply_to_email, brand_voice, organization_address, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(product.id, product.name, product.url, product.default_from_email, product.sending_domain, product.reply_to_email, product.brand_voice, product.organization_address, now, now).run();
  return product;
}

async function syncProductSenderFromCloudflareConfig(db: D1Database, fromEmail: string, replyToEmail: string, zoneName: string) {
  const product = await getProduct(db);
  const sendingDomain = domainFromEmail(fromEmail) || zoneName;
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE products SET default_from_email = ?, reply_to_email = ?, sending_domain = ?, updated_at = ? WHERE id = ?`
  ).bind(fromEmail, replyToEmail, sendingDomain, now, product.id).run();
}

async function getCampaign(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM campaigns WHERE id = ?").bind(id).first<Campaign>();
}

async function getTemplate(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM templates WHERE id = ?").bind(id).first<Template>();
}

async function writeEvent(db: D1Database, event: EventJob) {
  await db.prepare("INSERT INTO email_events (id, campaign_id, recipient_id, contact_id, event_type, event_time, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), event.campaignId ?? null, event.recipientId ?? null, event.contactId ?? null, event.eventType, new Date().toISOString(), JSON.stringify(event.metadata ?? {}))
    .run();
}

async function resolveInboundAttribution(db: D1Database, parsed: Awaited<ReturnType<typeof PostalMime.parse>>, from: string): Promise<InboundAttribution> {
  const campaignHeader = headerValue(parsed.headers, "x-flowmail-campaign");
  const recipientHeader = headerValue(parsed.headers, "x-flowmail-recipient");
  if (campaignHeader && recipientHeader) {
    const row = await db.prepare("SELECT campaign_id, id as recipient_id, contact_id FROM campaign_recipients WHERE campaign_id = ? AND id = ?")
      .bind(campaignHeader, recipientHeader)
      .first<{ campaign_id: string; recipient_id: string; contact_id: string }>();
    if (row) return { campaignId: row.campaign_id, recipientId: row.recipient_id, contactId: row.contact_id };
  }

  const messageIds = [parsed.inReplyTo, parsed.references].filter(Boolean).flatMap((value) => extractMessageIds(String(value)));
  for (const messageId of messageIds) {
    const row = await db.prepare("SELECT campaign_id, id as recipient_id, contact_id FROM campaign_recipients WHERE message_id = ? OR message_id = ? LIMIT 1")
      .bind(messageId, stripAngleBrackets(messageId))
      .first<{ campaign_id: string; recipient_id: string; contact_id: string }>();
    if (row) return { campaignId: row.campaign_id, recipientId: row.recipient_id, contactId: row.contact_id };
  }

  if (from) {
    const latest = await db.prepare(
      `SELECT campaign_id, id as recipient_id, contact_id
       FROM campaign_recipients
       WHERE email = ? AND status = 'sent'
       ORDER BY sent_at DESC LIMIT 1`
    ).bind(from).first<{ campaign_id: string; recipient_id: string; contact_id: string }>();
    if (latest) return { campaignId: latest.campaign_id, recipientId: latest.recipient_id, contactId: latest.contact_id };
  }

  return { campaignId: null, recipientId: null, contactId: null };
}

function headerValue(headers: Array<{ key: string; value: string }>, key: string) {
  return headers.find((header) => header.key.toLowerCase() === key.toLowerCase())?.value ?? "";
}

function extractMessageIds(value: string) {
  const matches = value.match(/<[^>]+>/g);
  return matches && matches.length > 0 ? matches : value.split(/\s+/).filter(Boolean);
}

function stripAngleBrackets(value: string) {
  return value.replace(/^<|>$/g, "");
}

async function isSuppressed(db: D1Database, email: string) {
  const row = await db.prepare("SELECT id FROM suppressions WHERE email = ? LIMIT 1").bind(email).first();
  return Boolean(row);
}

type AudienceContact = Contact & {
  suppressed: number;
  campaign_recipient_status?: string | null;
};

type CampaignAudience = Awaited<ReturnType<typeof campaignAudience>>;

async function campaignAudience(db: D1Database, campaignId?: string) {
  const sql = campaignId
    ? `SELECT contacts.*,
        CASE WHEN EXISTS (SELECT 1 FROM suppressions WHERE suppressions.email = contacts.email) OR contacts.unsubscribed_at IS NOT NULL OR contacts.bounced_at IS NOT NULL THEN 1 ELSE 0 END as suppressed,
        existing.status as campaign_recipient_status
       FROM contacts
       LEFT JOIN campaign_recipients existing ON existing.campaign_id = ? AND existing.contact_id = contacts.id
       ORDER BY contacts.created_at ASC`
    : `SELECT contacts.*,
        CASE WHEN EXISTS (SELECT 1 FROM suppressions WHERE suppressions.email = contacts.email) OR contacts.unsubscribed_at IS NOT NULL OR contacts.bounced_at IS NOT NULL THEN 1 ELSE 0 END as suppressed,
        NULL as campaign_recipient_status
       FROM contacts
       ORDER BY contacts.created_at ASC`;
  const audience = campaignId
    ? await db.prepare(sql).bind(campaignId).all<AudienceContact>()
    : await db.prepare(sql).all<AudienceContact>();
  const contacts = audience.results ?? [];
  const unsuppressed = contacts.filter((contact) => !contact.suppressed);
  const eligible = unsuppressed.filter((contact) => !contact.campaign_recipient_status);
  const consentless = eligible.filter((contact) => !contact.source && !contact.consent_source);
  return {
    contacts,
    eligible,
    suppressedCount: contacts.filter((contact) => contact.suppressed).length,
    alreadyIncludedCount: unsuppressed.length - eligible.length,
    alreadySentCount: unsuppressed.filter((contact) => contact.campaign_recipient_status === "sent").length,
    alreadyActiveCount: unsuppressed.filter((contact) => ["queued", "sending"].includes(String(contact.campaign_recipient_status))).length,
    failedCount: unsuppressed.filter((contact) => contact.campaign_recipient_status === "failed").length,
    consentlessCount: consentless.length
  };
}

function audienceSummary(audience: CampaignAudience) {
  return {
    totalContacts: audience.contacts.length,
    sendableCount: audience.eligible.length,
    suppressedCount: audience.suppressedCount,
    alreadyIncludedCount: audience.alreadyIncludedCount,
    alreadySentCount: audience.alreadySentCount,
    alreadyActiveCount: audience.alreadyActiveCount,
    failedCount: audience.failedCount,
    consentlessCount: audience.consentlessCount
  };
}

async function prepareCampaignSend(env: Env, campaign: Campaign, options: { limit?: number }) {
  const [product, template, audience] = await Promise.all([
    getProduct(env.DB),
    getTemplate(env.DB, campaign.template_id),
    campaignAudience(env.DB, campaign.id)
  ]);
  if (!template) throw new Error("Template missing.");
  const requestedCount = normalizeBatchLimit(options.limit, audience.eligible.length);
  const selectedContacts = audience.eligible.slice(0, requestedCount);
  const compliance = runComplianceChecks({
    fromEmail: product.default_from_email,
    allowedDomains: allowedSenderDomains(env, product),
    subject: template.subject,
    htmlBody: template.html_body,
    textBody: template.text_body,
    organizationAddress: product.organization_address,
    totalRecipients: selectedContacts.length,
    suppressedRecipients: audience.suppressedCount,
    consentlessRecipients: audience.consentlessCount
  });
  return {
    compliance,
    requestedCount,
    selectedCount: selectedContacts.length,
    selectedContacts,
    audience: audienceSummary(audience)
  };
}

async function createCampaignSendRun(env: Env, campaign: Campaign, options: { limit?: number }) {
  const preview = await prepareCampaignSend(env, campaign, options);
  if (!preview.compliance.ok) {
    return { ok: false as const, statusCode: 422 as const, error: "Compliance checks failed", ...preview };
  }
  if (preview.selectedContacts.length === 0) {
    return { ok: false as const, statusCode: 422 as const, error: "No new recipients available for this campaign.", ...preview };
  }

  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const recipientRows = preview.selectedContacts.map((contact) => ({
    id: crypto.randomUUID(),
    contact
  }));
  const audienceFilter = {
    type: "batch",
    requestedCount: preview.requestedCount,
    skipPreviouslyIncluded: true
  };
  const statements = [
    env.DB.prepare(
      `INSERT INTO campaign_send_runs (id, campaign_id, status, audience_filter_json, requested_count, selected_count, queued_count, skipped_sent_count, skipped_suppressed_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(runId, campaign.id, "sending", JSON.stringify(audienceFilter), preview.requestedCount, recipientRows.length, recipientRows.length, preview.audience.alreadySentCount, preview.audience.suppressedCount, now, now),
    env.DB.prepare("UPDATE campaigns SET status = ?, approved_at = COALESCE(approved_at, ?), started_at = COALESCE(started_at, ?), completed_at = NULL, updated_at = ? WHERE id = ?")
      .bind("sending", now, now, now, campaign.id),
    ...recipientRows.flatMap(({ id, contact }) => [
      env.DB.prepare(
        `INSERT OR IGNORE INTO campaign_recipients (id, campaign_id, contact_id, email, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, campaign.id, contact.id, contact.email, "queued", now, now),
      env.DB.prepare(
        `INSERT OR IGNORE INTO campaign_send_run_recipients (send_run_id, recipient_id, campaign_id, contact_id, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(runId, id, campaign.id, contact.id, now)
    ])
  ];
  await env.DB.batch(statements);
  await Promise.all(recipientRows.map(({ id }) => env.SEND_QUEUE.send({ campaignId: campaign.id, recipientId: id, sendRunId: runId })));
  const run = await refreshSendRun(env.DB, runId);
  if (!run) return { ok: false as const, statusCode: 500 as const, error: "Send run could not be created.", ...preview };
  return {
    ok: true as const,
    campaign: await getCampaign(env.DB, campaign.id),
    run,
    compliance: preview.compliance,
    audience: preview.audience
  };
}

async function retryFailedSendRun(env: Env, sourceRunId: string) {
  const sourceRun = await env.DB.prepare("SELECT * FROM campaign_send_runs WHERE id = ?").bind(sourceRunId).first<CampaignSendRun>();
  if (!sourceRun) return { ok: false as const, statusCode: 404 as const, error: "Send run not found." };
  const failed = await env.DB.prepare(
    `SELECT r.id, r.contact_id
     FROM campaign_send_run_recipients rr
     JOIN campaign_recipients r ON r.id = rr.recipient_id
     WHERE rr.send_run_id = ? AND r.status = 'failed'
     ORDER BY r.failed_at DESC, r.updated_at DESC`
  ).bind(sourceRunId).all<{ id: string; contact_id: string }>();
  const recipients = failed.results ?? [];
  if (recipients.length === 0) return { ok: false as const, statusCode: 422 as const, error: "No failed recipients to retry." };

  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(
      `INSERT INTO campaign_send_runs (id, campaign_id, status, audience_filter_json, requested_count, selected_count, queued_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(runId, sourceRun.campaign_id, "sending", JSON.stringify({ type: "retry_failed", sourceRunId }), recipients.length, recipients.length, recipients.length, now, now),
    env.DB.prepare("UPDATE campaigns SET status = ?, completed_at = NULL, updated_at = ? WHERE id = ?")
      .bind("sending", now, sourceRun.campaign_id),
    ...recipients.flatMap((recipient) => [
      env.DB.prepare("UPDATE campaign_recipients SET status = ?, failed_at = NULL, failure_reason = NULL, updated_at = ? WHERE id = ?")
        .bind("queued", now, recipient.id),
      env.DB.prepare(
        `INSERT OR IGNORE INTO campaign_send_run_recipients (send_run_id, recipient_id, campaign_id, contact_id, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(runId, recipient.id, sourceRun.campaign_id, recipient.contact_id, now)
    ])
  ];
  await env.DB.batch(statements);
  await Promise.all(recipients.map((recipient) => env.SEND_QUEUE.send({ campaignId: sourceRun.campaign_id, recipientId: recipient.id, sendRunId: runId })));
  const run = await refreshSendRun(env.DB, runId);
  if (!run) return { ok: false as const, statusCode: 500 as const, error: "Retry run could not be created." };
  return { ok: true as const, run, campaign: await getCampaign(env.DB, sourceRun.campaign_id) };
}

function normalizeBatchLimit(limit: number | undefined, available: number) {
  if (available <= 0) return 0;
  if (!limit) return available;
  return Math.max(1, Math.min(limit, available));
}

async function getCampaignSendRuns(db: D1Database, campaignId?: string, limit = 20) {
  const where = campaignId ? "WHERE sr.campaign_id = ?" : "";
  const sql = `SELECT sr.*,
      SUM(CASE WHEN r.status IN ('queued', 'sending') THEN 1 ELSE 0 END) as current_queued_count,
      SUM(CASE WHEN r.status = 'sent' THEN 1 ELSE 0 END) as current_sent_count,
      SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END) as current_failed_count
     FROM campaign_send_runs sr
     LEFT JOIN campaign_send_run_recipients rr ON rr.send_run_id = sr.id
     LEFT JOIN campaign_recipients r ON r.id = rr.recipient_id
     ${where}
     GROUP BY sr.id
     ORDER BY sr.created_at DESC
     LIMIT ?`;
  const result = campaignId
    ? await db.prepare(sql).bind(campaignId, limit).all<any>()
    : await db.prepare(sql).bind(limit).all<any>();
  return (result.results ?? []).map((run) => ({
    ...run,
    queued_count: Number(run.current_queued_count ?? run.queued_count ?? 0),
    sent_count: Number(run.current_sent_count ?? run.sent_count ?? 0),
    failed_count: Number(run.current_failed_count ?? run.failed_count ?? 0)
  }));
}

async function refreshSendRunForRecipient(db: D1Database, recipientId: string, preferredRunId?: string) {
  const sendRunId = preferredRunId ?? await findSendRunIdForRecipient(db, recipientId);
  if (sendRunId) await refreshSendRun(db, sendRunId);
}

async function writeContactEmailSend(db: D1Database, input: {
  id: string;
  contactId: string;
  campaignId: string | null;
  sendRunId: string | null;
  recipientId: string | null;
  email: string;
  status: string;
  subject: string;
  html: string;
  text: string;
}) {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO contact_email_sends (id, contact_id, campaign_id, send_run_id, recipient_id, email, status, subject, html_body, text_body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    input.id,
    input.contactId,
    input.campaignId,
    input.sendRunId,
    input.recipientId,
    input.email,
    input.status,
    input.subject,
    input.html,
    input.text,
    now,
    now
  ).run();
}

async function markLatestContactEmailSendFailed(db: D1Database, recipientId: string, sendRunId: string | undefined, reason: string) {
  const sendRecord = await db.prepare(
    `SELECT id
     FROM contact_email_sends
     WHERE recipient_id = ? AND status = 'sending' ${sendRunId ? "AND send_run_id = ?" : ""}
     ORDER BY created_at DESC
     LIMIT 1`
  );
  const row = sendRunId
    ? await sendRecord.bind(recipientId, sendRunId).first<{ id: string }>()
    : await sendRecord.bind(recipientId).first<{ id: string }>();
  if (!row) return;
  const now = new Date().toISOString();
  await db.prepare("UPDATE contact_email_sends SET status = ?, failed_at = ?, failure_reason = ?, updated_at = ? WHERE id = ?")
    .bind("failed", now, reason, now, row.id)
    .run();
}

async function findSendRunIdForRecipient(db: D1Database, recipientId: string) {
  const row = await db.prepare(
    `SELECT send_run_id
     FROM campaign_send_run_recipients
     WHERE recipient_id = ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(recipientId).first<{ send_run_id: string }>();
  return row?.send_run_id ?? "";
}

async function refreshSendRun(db: D1Database, sendRunId: string) {
  const rows = await db.prepare(
    `SELECT r.status, COUNT(*) as count
     FROM campaign_send_run_recipients rr
     JOIN campaign_recipients r ON r.id = rr.recipient_id
     WHERE rr.send_run_id = ?
     GROUP BY r.status`
  ).bind(sendRunId).all<{ status: string; count: number }>();
  const counts = Object.fromEntries((rows.results ?? []).map((row) => [row.status, Number(row.count)]));
  const active = Number(counts.queued ?? 0) + Number(counts.sending ?? 0);
  const sent = Number(counts.sent ?? 0);
  const failed = Number(counts.failed ?? 0);
  const total = Object.values(counts).reduce((sum, count) => sum + Number(count), 0);
  const now = new Date().toISOString();
  const status = active > 0 ? "sending" : failed > 0 ? "completed_with_failures" : total > 0 ? "completed" : "empty";
  await db.prepare(
    `UPDATE campaign_send_runs
     SET status = ?, queued_count = ?, sent_count = ?, failed_count = ?, selected_count = ?, updated_at = ?, completed_at = CASE WHEN ? = 0 THEN COALESCE(completed_at, ?) ELSE NULL END
     WHERE id = ?`
  ).bind(status, active, sent, failed, total, now, active, now, sendRunId).run();
  return db.prepare("SELECT * FROM campaign_send_runs WHERE id = ?").bind(sendRunId).first<CampaignSendRun>();
}

async function markRecipient(db: D1Database, id: string, status: string, reason: string) {
  const now = new Date().toISOString();
  await db.prepare("UPDATE campaign_recipients SET status = ?, failed_at = ?, failure_reason = ?, updated_at = ? WHERE id = ?")
    .bind(status, status === "failed" ? now : null, reason, now, id).run();
}

async function updateCampaignCompletion(db: D1Database, campaignId: string) {
  const rows = await db.prepare("SELECT status, COUNT(*) as count FROM campaign_recipients WHERE campaign_id = ? GROUP BY status")
    .bind(campaignId)
    .all<{ status: string; count: number }>();
  const counts = Object.fromEntries((rows.results ?? []).map((row) => [row.status, Number(row.count)]));
  const active = Number(counts.queued ?? 0) + Number(counts.sending ?? 0);
  const total = Object.values(counts).reduce((sum, count) => sum + Number(count), 0);
  if (total > 0 && active === 0) {
    const now = new Date().toISOString();
    await db.prepare("UPDATE campaigns SET status = ?, completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE id = ? AND status IN ('approved', 'sending')")
      .bind("completed", now, now, campaignId)
      .run();
  }
}

function allowedDomains(env: Env) {
  return (env.DOMAINS || "").split(",").map((domain) => domain.trim().toLowerCase()).filter(Boolean);
}

function allowedSenderDomains(env: Env, product: Pick<Product, "sending_domain" | "default_from_email" | "reply_to_email">) {
  return Array.from(new Set([
    ...allowedDomains(env),
    product.sending_domain,
    domainFromEmail(product.reply_to_email)
  ].map((domain) => domain.trim().toLowerCase()).filter(Boolean)));
}

function domainFromEmail(email: string) {
  return email.includes("@") ? email.split("@").pop()?.toLowerCase() ?? "" : "";
}

function cloudflareEmailErrorResponse(c: any, error: unknown) {
  const status = error instanceof CloudflareEmailError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Cloudflare email config request failed.";
  return c.json({ error: message }, status);
}

function isLocalSetupMode() {
  return import.meta.env.DEV && __FLOWMAIL_LOCAL_SETUP__ === true;
}

function parsePositiveInt(value: string | undefined, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function withLocalReplyRoutingSkip(result: Awaited<ReturnType<typeof checkCloudflareEmailConfig>>) {
  const checks = result.checks.map((check) =>
    check.name === "replyToRoute" && !check.ok
      ? { ...check, ok: true, details: "Local setup mode skips Cloudflare reply routing. Deploy this Worker to Cloudflare to verify inbound replies." }
      : check
  );
  return {
    ...result,
    ok: checks.every((check) => check.ok),
    checks
  };
}

function contactValues(contact: Contact): Record<string, string> {
  const custom = JSON.parse(contact.custom_fields_json || "{}") as Record<string, string>;
  return {
    ...custom,
    email: contact.email,
    first_name: contact.first_name ?? "",
    last_name: contact.last_name ?? "",
    company: contact.company ?? ""
  };
}

async function rewriteHtmlLinks(html: string, signer: (url: string) => Promise<string>) {
  const urls = Array.from(html.matchAll(/href=(["'])(https?:\/\/[^"']+)\1/gi));
  let rewritten = html;
  for (const match of urls) {
    const original = match[0];
    const quote = match[1];
    const url = match[2];
    rewritten = rewritten.replace(original, `href=${quote}${await signer(url)}${quote}`);
  }
  return rewritten;
}

async function check(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    return { name, ok: true, details: "Ready." };
  } catch (error) {
    return { name, ok: false, details: error instanceof Error ? error.message : "Check failed." };
  }
}

async function inspectZone(headers: Record<string, string>, zone: any) {
  const [dns, routing] = await Promise.all([
    cloudflareApi<any>(`https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records?per_page=100`, headers),
    cloudflareApi<any>(`https://api.cloudflare.com/client/v4/zones/${zone.id}/email/routing`, headers)
  ]);
  return {
    id: zone.id,
    name: zone.name,
    status: zone.status,
    dns: {
      mxRecords: dns.ok ? (dns.result?.filter((record: any) => record.type === "MX").length ?? 0) : null,
      spfRecords: dns.ok ? (dns.result?.filter((record: any) => record.type === "TXT" && String(record.content).includes("v=spf1")).length ?? 0) : null,
      dmarcRecords: dns.ok ? (dns.result?.filter((record: any) => record.type === "TXT" && String(record.name).startsWith("_dmarc")).length ?? 0) : null,
      dkimHints: dns.ok ? (dns.result?.filter((record: any) => record.type === "TXT" && String(record.name).toLowerCase().includes("dkim")).length ?? 0) : null,
      check: dns.ok ? "checked" : "unavailable"
    },
    emailRouting: routing.ok
      ? { enabled: Boolean(routing.result?.enabled), status: routing.result?.status ?? "unknown" }
      : { enabled: false, status: "unavailable" }
  };
}

async function cloudflareApi<T>(url: string, headers: Record<string, string>) {
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return { ok: false as const, result: null };
    const body = await response.json<T>();
    return { ok: true as const, ...(body as any) };
  } catch {
    return { ok: false as const, result: null };
  }
}

function escapeHtmlForEmail(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Queue message failed.";
}
