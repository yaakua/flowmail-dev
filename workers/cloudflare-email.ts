import type { Env } from "./types";
import { getConfigEncryptionKey } from "./runtime-config";

const CONFIG_KEY = "cloudflare_email_config";
const DEFAULT_WORKER_NAME = "flowmail";
const CLOUDFLARE_API_TIMEOUT_MS = 20_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type CloudflareEmailStoredConfig = {
  zoneName: string;
  workerName: string;
  fromEmail: string;
  replyToEmail: string;
  tokenCiphertext?: string;
  tokenIv?: string;
  tokenLast4?: string;
  updatedAt: string;
};

export type CloudflareEmailPublicConfig = {
  zoneName: string;
  workerName: string;
  fromEmail: string;
  replyToEmail: string;
  tokenSaved: boolean;
  tokenLast4?: string;
  updatedAt?: string;
};

export type SaveCloudflareEmailConfigInput = {
  zoneName: string;
  workerName?: string;
  fromEmail: string;
  replyToEmail: string;
  token?: string;
};

export type CloudflareCheck = {
  name: "token" | "zone" | "dns" | "emailRouting" | "replyToRoute";
  ok: boolean;
  details: string;
};

export type CloudflareDnsSummary = {
  mxRecords: number;
  spfRecords: number;
  dkimHints: number;
  dmarcRecords: number;
};

export type CloudflareRoutingRule = {
  id?: string;
  name?: string;
  enabled?: boolean;
  matchers?: Array<{ type?: string; field?: string; value?: string }>;
  actions?: Array<{ type?: string; value?: string | string[] }>;
};

export type CloudflareEmailCheckResult = {
  ok: boolean;
  checks: CloudflareCheck[];
  zone: { id: string; name: string; status?: string } | null;
  dns: CloudflareDnsSummary | null;
  routing: {
    enabled: boolean;
    status: string;
    replyToRule: CloudflareRoutingRule | null;
  } | null;
};

export type CloudflareEmailDiscoveryInput = {
  token: string;
  zoneName?: string;
};

export type CloudflareDiscoveredZone = {
  id: string;
  name: string;
  status?: string;
  accountId?: string;
  accountName?: string;
};

export type CloudflareDiscoveredWorker = {
  id?: string;
  name: string;
};

export type CloudflareEmailDiscoveryResult = {
  ok: boolean;
  token: { active: boolean };
  zones: CloudflareDiscoveredZone[];
  selectedZone: CloudflareDiscoveredZone | null;
  workers: CloudflareDiscoveredWorker[];
  permissions: CloudflarePermissionCheck[];
  missingPermissions: CloudflarePermissionName[];
  suggested: {
    zoneName: string;
    workerName: string;
    fromEmail: string;
    replyToEmail: string;
  };
  warnings: string[];
};

export type CloudflarePermissionName =
  | "zoneRead"
  | "dnsRead"
  | "emailRoutingRead"
  | "emailRoutingEdit"
  | "emailSendingEdit"
  | "workersScriptsRead";

export type CloudflarePermissionCheck = {
  name: CloudflarePermissionName;
  ok: boolean;
  details: string;
};

export type CloudflareEmailSendInput = {
  to: string;
  fromEmail: string;
  fromName?: string;
  replyToEmail?: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

export type CloudflareEmailSendResult = {
  messageId: string;
  provider: "cloudflare-api";
};

export type CloudflareEmailTestInput = CloudflareEmailSendInput;
export type CloudflareEmailTestResult = CloudflareEmailSendResult;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

type CloudflareApiResponse<T> = {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
};

type CloudflareZone = {
  id: string;
  name: string;
  status?: string;
  account?: {
    id?: string;
    name?: string;
  };
};

type CloudflareDnsRecord = {
  type: string;
  name: string;
  content: string;
};

type CloudflareRoutingStatus = {
  enabled?: boolean;
  status?: string;
};

type CloudflareWorkerScript = {
  id?: string;
  script_name?: string;
};

export class CloudflareEmailError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
    this.name = "CloudflareEmailError";
  }
}

export async function getCloudflareEmailConfig(db: D1Database, env: Pick<Env, "WORKER_NAME">): Promise<CloudflareEmailPublicConfig> {
  return toPublicConfig(await readStoredConfig(db), env);
}

export async function discoverCloudflareEmailConfig(
  input: CloudflareEmailDiscoveryInput,
  env: Pick<Env, "WORKER_NAME">,
  fetcher: FetchLike = defaultFetch
): Promise<CloudflareEmailDiscoveryResult> {
  const token = input.token.trim();
  if (!token) throw new CloudflareEmailError("Cloudflare API token is required for discovery.", 422);

  const client = new CloudflareEmailClient(token, fetcher);
  const verified = await client.verifyToken();
  const tokenActive = isActiveToken(verified);
  if (!tokenActive) {
    throw new CloudflareEmailError("Cloudflare API token verified but is not active.", 422);
  }

  const zones = (await client.listZones(input.zoneName)).map(toDiscoveredZone);
  if (zones.length === 0) {
    throw new CloudflareEmailError("No accessible Cloudflare zones were found for this token.", 404);
  }

  const preferredZoneName = normalizeDomain(input.zoneName || "");
  const selectedZone = zones.find((zone) => zone.name === preferredZoneName) ?? zones[0] ?? null;
  const warnings: string[] = [];
  let workers: CloudflareDiscoveredWorker[] = [];
  const permissions: CloudflarePermissionCheck[] = [{ name: "zoneRead", ok: true, details: "Zone Read permission verified." }];
  if (selectedZone?.accountId) {
    try {
      workers = (await client.listWorkers(selectedZone.accountId)).map(toDiscoveredWorker).filter((worker) => worker.name);
      permissions.push({ name: "workersScriptsRead", ok: true, details: "Workers Scripts Read permission verified." });
    } catch (error) {
      permissions.push({ name: "workersScriptsRead", ok: false, details: workersScriptsReadableError(error) });
      warnings.push(`Could not list Workers for ${selectedZone.name}: ${readableError(error)}`);
    }
  } else {
    permissions.push({ name: "workersScriptsRead", ok: false, details: "Could not infer an account id for the selected zone." });
    warnings.push(`Could not infer an account id for ${selectedZone?.name ?? "the selected zone"}.`);
  }

  if (selectedZone) {
    permissions.push(...await probeRequiredPermissions(client, selectedZone));
  }

  const defaultWorkerName = normalizeWorkerName(env.WORKER_NAME || DEFAULT_WORKER_NAME);
  const workerName =
    workers.find((worker) => worker.name.toLowerCase() === defaultWorkerName.toLowerCase())?.name ??
    workers.find((worker) => worker.name.toLowerCase().includes("flowmail"))?.name ??
    defaultWorkerName;
  if (!workers.some((worker) => worker.name.toLowerCase() === workerName.toLowerCase())) {
    warnings.push(`The deployed Flowmail Worker was not found in the discovered Worker list. Keep ${workerName} if that is the Worker name used by this deployment.`);
  }
  const zoneName = selectedZone?.name ?? "";
  const defaultFromEmail = zoneName ? `no-reply@${zoneName}` : "";
  const defaultReplyToEmail = zoneName ? `reply@${zoneName}` : "";
  const missingPermissions = permissions.filter((permission) => !permission.ok).map((permission) => permission.name);
  return {
    ok: missingPermissions.length === 0,
    token: { active: true },
    zones,
    selectedZone,
    workers,
    permissions,
    missingPermissions,
    suggested: {
      zoneName,
      workerName,
      fromEmail: defaultFromEmail,
      replyToEmail: defaultReplyToEmail
    },
    warnings
  };
}

export async function validateCloudflareEmailTokenForSetup(
  input: CloudflareEmailDiscoveryInput,
  env: Pick<Env, "WORKER_NAME">,
  fetcher: FetchLike = defaultFetch
) {
  const discovered = await discoverCloudflareEmailConfig(input, env, fetcher);
  if (!discovered.ok) {
    throw new CloudflareEmailError(`Cloudflare API token is missing required permissions: ${discovered.missingPermissions.join(", ")}.`, 422);
  }
  return discovered;
}

export async function discoverSavedCloudflareEmailConfig(
  db: D1Database,
  input: Omit<CloudflareEmailDiscoveryInput, "token">,
  env: Pick<Env, "CONFIG_ENCRYPTION_KEY" | "WORKER_NAME">,
  fetcher: FetchLike = defaultFetch
): Promise<CloudflareEmailDiscoveryResult> {
  const config = await readStoredConfig(db);
  if (!config) throw new CloudflareEmailError("Save a Cloudflare API token before rediscovering domains.", 422);
  const token = await requireSavedToken(db, config, env);
  return discoverCloudflareEmailConfig({ token, zoneName: input.zoneName }, env, fetcher);
}

export async function validateSavedCloudflareEmailTokenForSetup(
  db: D1Database,
  input: Omit<CloudflareEmailDiscoveryInput, "token">,
  env: Pick<Env, "CONFIG_ENCRYPTION_KEY" | "WORKER_NAME">,
  fetcher: FetchLike = defaultFetch
) {
  const discovered = await discoverSavedCloudflareEmailConfig(db, input, env, fetcher);
  if (!discovered.ok) {
    throw new CloudflareEmailError(`Cloudflare API token is missing required permissions: ${discovered.missingPermissions.join(", ")}.`, 422);
  }
  return discovered;
}

export async function saveCloudflareEmailConfig(
  db: D1Database,
  input: SaveCloudflareEmailConfigInput,
  env: Pick<Env, "CONFIG_ENCRYPTION_KEY" | "WORKER_NAME">
): Promise<CloudflareEmailPublicConfig> {
  const existing = await readStoredConfig(db);
  const now = new Date().toISOString();
  const token = input.token?.trim();
  const next: CloudflareEmailStoredConfig = {
    zoneName: normalizeDomain(input.zoneName),
    workerName: normalizeWorkerName(input.workerName || env.WORKER_NAME || existing?.workerName || DEFAULT_WORKER_NAME),
    fromEmail: input.fromEmail.trim().toLowerCase(),
    replyToEmail: input.replyToEmail.trim().toLowerCase(),
    tokenCiphertext: existing?.tokenCiphertext,
    tokenIv: existing?.tokenIv,
    tokenLast4: existing?.tokenLast4,
    updatedAt: now
  };

  if (token) {
    const encrypted = await encryptToken(token, await getConfigEncryptionKey(db, env));
    next.tokenCiphertext = encrypted.ciphertext;
    next.tokenIv = encrypted.iv;
    next.tokenLast4 = token.slice(-4);
  }

  await writeStoredConfig(db, next);
  return toPublicConfig(next, env);
}

export async function deleteCloudflareEmailToken(db: D1Database, env: Pick<Env, "WORKER_NAME">): Promise<CloudflareEmailPublicConfig> {
  const existing = await readStoredConfig(db);
  if (!existing) return toPublicConfig(null, env);
  const next: CloudflareEmailStoredConfig = {
    zoneName: existing.zoneName,
    workerName: existing.workerName,
    fromEmail: existing.fromEmail,
    replyToEmail: existing.replyToEmail,
    updatedAt: new Date().toISOString()
  };
  await writeStoredConfig(db, next);
  return toPublicConfig(next, env);
}

export async function checkCloudflareEmailConfig(
  db: D1Database,
  env: Pick<Env, "CONFIG_ENCRYPTION_KEY" | "WORKER_NAME">,
  fetcher: FetchLike = defaultFetch
): Promise<CloudflareEmailCheckResult> {
  const config = await readStoredConfig(db);
  const checks: CloudflareCheck[] = [];
  const empty = result(false, checks, null, null, null);
  if (!config) {
    checks.push({ name: "token", ok: false, details: "No Cloudflare email config is saved." });
    return empty();
  }

  const token = await decryptSavedToken(db, config, env, checks);
  if (!token) return empty();

  const client = new CloudflareEmailClient(token, fetcher);
  try {
    const verified = await client.verifyToken();
    checks.push({ name: "token", ok: isActiveToken(verified), details: isActiveToken(verified) ? "Token active." : "Token verified but is not active." });
  } catch (error) {
    checks.push({ name: "token", ok: false, details: readableError(error) });
    return empty();
  }

  let zone: CloudflareZone;
  try {
    zone = await client.getZoneByName(config.zoneName);
    checks.push({ name: "zone", ok: true, details: `${zone.name} is accessible.` });
  } catch (error) {
    checks.push({ name: "zone", ok: false, details: readableError(error) });
    return empty();
  }

  let dns: CloudflareDnsSummary | null = null;
  try {
    dns = await client.getDnsSummary(zone.id);
    checks.push({ name: "dns", ok: true, details: `Found ${dns.mxRecords} MX, ${dns.spfRecords} SPF, ${dns.dkimHints} DKIM-like, and ${dns.dmarcRecords} DMARC records.` });
  } catch (error) {
    checks.push({ name: "dns", ok: false, details: readableError(error) });
  }

  let routing: { enabled: boolean; status: string; replyToRule: CloudflareRoutingRule | null } | null = null;
  let routingStatus: CloudflareRoutingStatus | null = null;
  let routingStatusError: unknown = null;
  let rules: CloudflareRoutingRule[] | null = null;
  let rulesError: unknown = null;
  try {
    routingStatus = await client.getEmailRoutingStatus(zone.id);
  } catch (error) {
    routingStatusError = error;
  }

  try {
    rules = await client.listRoutingRules(zone.id);
  } catch (error) {
    rulesError = error;
  }

  if (routingStatus) {
    checks.push({
      name: "emailRouting",
      ok: Boolean(routingStatus.enabled),
      details: routingStatus.enabled ? "Email Routing enabled." : `Email Routing is ${routingStatus.status || "not enabled"}.`
    });
  } else if (rules && (!routingStatusError || isAuthenticationError(routingStatusError))) {
    checks.push({
      name: "emailRouting",
      ok: true,
      details: routingStatusError
        ? "Email Routing rules are readable. Email Routing status requires Zone Settings Read, so Flowmail skipped the enabled-status check."
        : "Email Routing rules are readable."
    });
  } else if (routingStatusError || rulesError) {
    checks.push({ name: "emailRouting", ok: false, details: emailRoutingReadableError(rulesError ?? routingStatusError) });
  }

  if (rules) {
    const replyToRule = findReplyToWorkerRule(rules, config.replyToEmail, config.workerName);
    checks.push({
      name: "replyToRoute",
      ok: Boolean(replyToRule),
      details: replyToRule
        ? `${config.replyToEmail} routes to ${config.workerName}.`
        : `${config.replyToEmail} is not routed to ${config.workerName}.`
    });
    routing = {
      enabled: Boolean(routingStatus?.enabled),
      status: routingStatus?.status || (routingStatus?.enabled ? "enabled" : "unknown"),
      replyToRule: replyToRule ? toPublicRule(replyToRule) : null
    };
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
    zone: { id: zone.id, name: zone.name, status: zone.status },
    dns,
    routing
  };
}

export async function applyCloudflareEmailRouting(
  db: D1Database,
  env: Pick<Env, "CONFIG_ENCRYPTION_KEY" | "WORKER_NAME">,
  fetcher: FetchLike = defaultFetch
): Promise<CloudflareEmailCheckResult & { rule: CloudflareRoutingRule }> {
  const config = await readStoredConfig(db);
  if (!config) throw new CloudflareEmailError("Save Cloudflare email config before applying routing.", 422);
  const token = await requireSavedToken(db, config, env);
  const client = new CloudflareEmailClient(token, fetcher);
  const zone = await client.getZoneByName(config.zoneName);
  const rules = await client.listRoutingRules(zone.id);
  const existing = findExistingReplyToRule(rules, config.replyToEmail);
  const rule = existing
    ? await client.updateRoutingRule(zone.id, existing.id || "", buildRoutingRulePayload(config))
    : await client.createRoutingRule(zone.id, buildRoutingRulePayload(config));

  const checked = await checkCloudflareEmailConfig(db, env, fetcher);
  return {
    ...checked,
    ok: checked.checks.every((check) => check.ok),
    zone: checked.zone ?? { id: zone.id, name: zone.name, status: zone.status },
    rule: toPublicRule(rule)
  };
}

export async function sendCloudflareEmailTest(
  db: D1Database,
  input: CloudflareEmailSendInput,
  env: Pick<Env, "CONFIG_ENCRYPTION_KEY">,
  fetcher: FetchLike = defaultFetch
): Promise<CloudflareEmailSendResult> {
  return sendCloudflareEmail(db, input, env, fetcher);
}

export async function sendCloudflareEmail(
  db: D1Database,
  input: CloudflareEmailSendInput,
  env: Pick<Env, "CONFIG_ENCRYPTION_KEY">,
  fetcher: FetchLike = defaultFetch
): Promise<CloudflareEmailSendResult> {
  const config = await readStoredConfig(db);
  if (!config) throw new CloudflareEmailError("Save Cloudflare email config before sending real email.", 422);
  const token = await requireSavedToken(db, config, env);
  const client = new CloudflareEmailClient(token, fetcher);
  let result: Record<string, unknown> | null;
  try {
    const zone = await client.getZoneByName(config.zoneName);
    const accountId = zone.account?.id;
    if (!accountId) throw new CloudflareEmailError("Could not infer the Cloudflare account for this zone.", 422);
    result = await client.sendEmail(accountId, {
      from: input.fromName ? { address: input.fromEmail, name: input.fromName } : input.fromEmail,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      reply_to: input.replyToEmail || input.fromEmail,
      headers: input.headers
    });
  } catch (error) {
    const message = readableError(error);
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new CloudflareEmailError("Cloudflare Email Sending request timed out. Check the saved token permissions and try again.", 504);
    }
    if (message.toLowerCase().includes("authentication")) {
      throw new CloudflareEmailError("Cloudflare token cannot send Email. Create a new API token with Email Sending Write/Edit permission for this account, then save it again.", error instanceof CloudflareEmailError ? error.status : 401);
    }
    if (message.includes("email.sending_disabled")) {
      throw new CloudflareEmailError("Cloudflare Email Sending is disabled for this account or domain. Enable Email Sending in Cloudflare, verify the sender domain, then try again.", error instanceof CloudflareEmailError ? error.status : 422);
    }
    throw error;
  }
  return { messageId: extractCloudflareMessageId(result), provider: "cloudflare-api" };
}

async function readStoredConfig(db: D1Database): Promise<CloudflareEmailStoredConfig | null> {
  const row = await db.prepare("SELECT value_json FROM settings WHERE key = ?").bind(CONFIG_KEY).first<{ value_json: string }>();
  if (!row?.value_json) return null;
  try {
    return JSON.parse(row.value_json) as CloudflareEmailStoredConfig;
  } catch {
    return null;
  }
}

async function writeStoredConfig(db: D1Database, config: CloudflareEmailStoredConfig) {
  await db.prepare(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).bind(CONFIG_KEY, JSON.stringify(config), config.updatedAt).run();
}

function toPublicConfig(config: CloudflareEmailStoredConfig | null, env: Pick<Env, "WORKER_NAME">): CloudflareEmailPublicConfig {
  if (!config) {
    return {
      zoneName: "",
      workerName: normalizeWorkerName(env.WORKER_NAME || DEFAULT_WORKER_NAME),
      fromEmail: "",
      replyToEmail: "",
      tokenSaved: false
    };
  }
  return {
    zoneName: config.zoneName,
    workerName: normalizeWorkerName(config.workerName || env.WORKER_NAME || DEFAULT_WORKER_NAME),
    fromEmail: config.fromEmail,
    replyToEmail: config.replyToEmail,
    tokenSaved: Boolean(config.tokenCiphertext && config.tokenIv),
    tokenLast4: config.tokenLast4,
    updatedAt: config.updatedAt
  };
}

async function decryptSavedToken(db: D1Database, config: CloudflareEmailStoredConfig, env: Pick<Env, "CONFIG_ENCRYPTION_KEY">, checks: CloudflareCheck[]) {
  if (!config.tokenCiphertext || !config.tokenIv) {
    checks.push({ name: "token", ok: false, details: "No Cloudflare API token is saved." });
    return null;
  }
  try {
    return await decryptToken(config.tokenCiphertext, config.tokenIv, await getConfigEncryptionKey(db, env));
  } catch {
    checks.push({ name: "token", ok: false, details: "Saved token could not be decrypted. Delete it and save a new token." });
    return null;
  }
}

async function requireSavedToken(db: D1Database, config: CloudflareEmailStoredConfig, env: Pick<Env, "CONFIG_ENCRYPTION_KEY">) {
  if (!config.tokenCiphertext || !config.tokenIv) throw new CloudflareEmailError("Save a Cloudflare API token before applying routing.", 422);
  try {
    return await decryptToken(config.tokenCiphertext, config.tokenIv, await getConfigEncryptionKey(db, env));
  } catch {
    throw new CloudflareEmailError("Saved token could not be decrypted. Delete it and save a new token.", 422);
  }
}

async function encryptToken(token: string, secret: string) {
  const key = await encryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(token));
  return { ciphertext: base64Encode(new Uint8Array(ciphertext)), iv: base64Encode(iv) };
}

async function decryptToken(ciphertext: string, iv: string, secret: string) {
  const key = await encryptionKey(secret);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64Decode(iv) }, key, base64Decode(ciphertext));
  return decoder.decode(plaintext);
}

async function encryptionKey(secret: string) {
  if (encoder.encode(secret).byteLength < 32) {
    throw new CloudflareEmailError("CONFIG_ENCRYPTION_KEY must be at least 32 bytes.", 422);
  }
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function base64Encode(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64Decode(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

class CloudflareEmailClient {
  constructor(private readonly token: string, private readonly fetcher: FetchLike) {}

  verifyToken() {
    return this.api<{ status?: string }>("/user/tokens/verify");
  }

  listZones(zoneName?: string) {
    const params = new URLSearchParams({ per_page: "50" });
    if (zoneName?.trim()) params.set("name", normalizeDomain(zoneName));
    return this.api<CloudflareZone[]>(`/zones?${params.toString()}`);
  }

  async getZoneByName(zoneName: string) {
    const zones = await this.api<CloudflareZone[]>(`/zones?name=${encodeURIComponent(zoneName)}&per_page=1`);
    const zone = zones.find((candidate) => candidate.name.toLowerCase() === zoneName.toLowerCase()) ?? zones[0];
    if (!zone) throw new CloudflareEmailError(`${zoneName} is not accessible with this token.`, 404);
    return zone;
  }

  listWorkers(accountId: string) {
    return this.api<CloudflareWorkerScript[]>(`/accounts/${accountId}/workers/scripts?per_page=100`);
  }

  async getDnsSummary(zoneId: string): Promise<CloudflareDnsSummary> {
    const records = await this.api<CloudflareDnsRecord[]>(`/zones/${zoneId}/dns_records?per_page=100`);
    return {
      mxRecords: records.filter((record) => record.type === "MX").length,
      spfRecords: records.filter((record) => record.type === "TXT" && record.content.toLowerCase().includes("v=spf1")).length,
      dkimHints: records.filter((record) => {
        const name = record.name.toLowerCase();
        return record.type === "TXT" && (name.includes("dkim") || name.includes("_domainkey"));
      }).length,
      dmarcRecords: records.filter((record) => record.type === "TXT" && record.name.toLowerCase().startsWith("_dmarc")).length
    };
  }

  getEmailRoutingStatus(zoneId: string) {
    return this.api<CloudflareRoutingStatus>(`/zones/${zoneId}/email/routing`);
  }

  listRoutingRules(zoneId: string) {
    return this.api<CloudflareRoutingRule[]>(`/zones/${zoneId}/email/routing/rules?per_page=100`);
  }

  probeRoutingRuleEdit(zoneId: string) {
    return this.probeApiPermission(`/zones/${zoneId}/email/routing/rules`, {
      method: "POST",
      body: JSON.stringify({})
    });
  }

  createRoutingRule(zoneId: string, payload: Record<string, unknown>) {
    return this.api<CloudflareRoutingRule>(`/zones/${zoneId}/email/routing/rules`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  updateRoutingRule(zoneId: string, ruleId: string, payload: Record<string, unknown>) {
    if (!ruleId) throw new CloudflareEmailError("Cannot update a routing rule without a rule id.", 422);
    return this.api<CloudflareRoutingRule>(`/zones/${zoneId}/email/routing/rules/${ruleId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  sendEmail(accountId: string, payload: Record<string, unknown>) {
    return this.api<Record<string, unknown>>(`/accounts/${accountId}/email/sending/send`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  probeEmailSendingEdit(accountId: string) {
    return this.probeApiPermission(`/accounts/${accountId}/email/sending/send`, {
      method: "POST",
      body: JSON.stringify({})
    });
  }

  private async api<T>(path: string, init: RequestInit = {}) {
    const url = new URL(path.replace(/^\/+/, ""), "https://api.cloudflare.com/client/v4/");
    const response = await this.fetcher(url.toString(), {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(CLOUDFLARE_API_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {})
      }
    });
    let body: CloudflareApiResponse<T> | null = null;
    try {
      body = await response.json<CloudflareApiResponse<T>>();
    } catch {
      body = null;
    }
    if (!response.ok || body?.success === false) {
      throw new CloudflareEmailError(cloudflareErrorMessage(body, response.status), response.status || 502);
    }
    return (body?.result ?? null) as T;
  }

  private async probeApiPermission(path: string, init: RequestInit) {
    try {
      await this.api<unknown>(path, init);
      return true;
    } catch (error) {
      if (isAuthenticationError(error)) return false;
      return true;
    }
  }
}

async function probeRequiredPermissions(client: CloudflareEmailClient, zone: CloudflareDiscoveredZone): Promise<CloudflarePermissionCheck[]> {
  const checks: CloudflarePermissionCheck[] = [];

  try {
    await client.getDnsSummary(zone.id);
    checks.push({ name: "dnsRead", ok: true, details: "DNS Read permission verified." });
  } catch (error) {
    checks.push({ name: "dnsRead", ok: false, details: dnsReadableError(error) });
  }

  try {
    await client.listRoutingRules(zone.id);
    checks.push({ name: "emailRoutingRead", ok: true, details: "Email Routing Rules Read permission verified." });
  } catch (error) {
    checks.push({ name: "emailRoutingRead", ok: false, details: emailRoutingReadableError(error) });
  }

  try {
    const ok = await client.probeRoutingRuleEdit(zone.id);
    checks.push({
      name: "emailRoutingEdit",
      ok,
      details: ok
        ? "Email Routing Rules Edit permission verified."
        : "Cloudflare token cannot edit Email Routing rules. Create a new API token with Email Routing Rules Edit permission for this zone, then paste it again."
    });
  } catch (error) {
    checks.push({ name: "emailRoutingEdit", ok: false, details: emailRoutingEditReadableError(error) });
  }

  if (!zone.accountId) {
    checks.push({ name: "emailSendingEdit", ok: false, details: "Could not infer an account id for the selected zone." });
    return checks;
  }

  try {
    const ok = await client.probeEmailSendingEdit(zone.accountId);
    checks.push({
      name: "emailSendingEdit",
      ok,
      details: ok
        ? "Email Sending permission verified."
        : "Cloudflare token cannot send Email. Create a new API token with Email Sending Write/Edit permission for this account, then paste it again."
    });
  } catch (error) {
    checks.push({ name: "emailSendingEdit", ok: false, details: emailSendingReadableError(error) });
  }

  return checks;
}

function buildRoutingRulePayload(config: CloudflareEmailStoredConfig) {
  return {
    name: `Flowmail inbound: ${config.replyToEmail}`,
    enabled: true,
    matchers: [{ type: "literal", field: "to", value: config.replyToEmail }],
    actions: [{ type: "worker", value: [config.workerName] }]
  };
}

function findExistingReplyToRule(rules: CloudflareRoutingRule[], replyToEmail: string) {
  return rules.find((rule) => hasLiteralRecipientMatcher(rule, replyToEmail) || rule.name === `Flowmail inbound: ${replyToEmail}`);
}

function findReplyToWorkerRule(rules: CloudflareRoutingRule[], replyToEmail: string, workerName: string) {
  return rules.find((rule) => rule.enabled !== false && hasLiteralRecipientMatcher(rule, replyToEmail) && hasWorkerAction(rule, workerName)) ?? null;
}

function hasLiteralRecipientMatcher(rule: CloudflareRoutingRule, replyToEmail: string) {
  return Boolean(rule.matchers?.some((matcher) =>
    matcher.type === "literal" &&
    matcher.field === "to" &&
    matcher.value?.toLowerCase() === replyToEmail.toLowerCase()
  ));
}

function hasWorkerAction(rule: CloudflareRoutingRule, workerName: string) {
  return Boolean(rule.actions?.some((action) => {
    if (action.type !== "worker") return false;
    const values = Array.isArray(action.value) ? action.value : [action.value];
    return values.some((value) => String(value).toLowerCase() === workerName.toLowerCase());
  }));
}

function toPublicRule(rule: CloudflareRoutingRule): CloudflareRoutingRule {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    matchers: rule.matchers,
    actions: rule.actions
  };
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}

function normalizeWorkerName(value: string) {
  return value.trim() || DEFAULT_WORKER_NAME;
}

function toDiscoveredZone(zone: CloudflareZone): CloudflareDiscoveredZone {
  return {
    id: zone.id,
    name: normalizeDomain(zone.name),
    status: zone.status,
    accountId: zone.account?.id,
    accountName: zone.account?.name
  };
}

function toDiscoveredWorker(worker: CloudflareWorkerScript): CloudflareDiscoveredWorker {
  return {
    id: worker.id,
    name: worker.script_name || worker.id || ""
  };
}

function isActiveToken(result: { status?: string } | null) {
  return !result?.status || result.status === "active";
}

function extractCloudflareMessageId(result: Record<string, unknown> | null) {
  const candidates = [
    result?.message_id,
    result?.messageId,
    result?.id,
    result && typeof result === "object" && "message" in result ? (result.message as any)?.id : undefined
  ];
  return String(candidates.find((candidate) => typeof candidate === "string" && candidate) ?? crypto.randomUUID());
}

function cloudflareErrorMessage(body: CloudflareApiResponse<unknown> | null, status: number) {
  const message = body?.errors?.map((error) => error.message).filter(Boolean).join("; ");
  return message || `Cloudflare API request failed with status ${status}.`;
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : "Cloudflare API request failed.";
}

function emailRoutingReadableError(error: unknown) {
  const message = readableError(error);
  if (isAuthenticationMessage(message)) {
    return "Cloudflare token cannot read Email Routing rules. Create a new API token with Email Routing Rules Read and Edit permissions for this zone, then save it again.";
  }
  return message;
}

function dnsReadableError(error: unknown) {
  const message = readableError(error);
  if (isAuthenticationMessage(message)) {
    return "Cloudflare token cannot read DNS records. Create a new API token with DNS Read permission for this zone, then paste it again.";
  }
  return message;
}

function emailRoutingEditReadableError(error: unknown) {
  const message = readableError(error);
  if (isAuthenticationMessage(message)) {
    return "Cloudflare token cannot edit Email Routing rules. Create a new API token with Email Routing Rules Edit permission for this zone, then paste it again.";
  }
  return message;
}

function emailSendingReadableError(error: unknown) {
  const message = readableError(error);
  if (isAuthenticationMessage(message)) {
    return "Cloudflare token cannot send Email. Create a new API token with Email Sending Write/Edit permission for this account, then paste it again.";
  }
  return message;
}

function workersScriptsReadableError(error: unknown) {
  const message = readableError(error);
  if (isAuthenticationMessage(message)) {
    return "Cloudflare token cannot read Workers Scripts. Create a new API token with Workers Scripts Read permission for this account, then paste it again.";
  }
  return message;
}

function isAuthenticationError(error: unknown) {
  return error instanceof CloudflareEmailError && (error.status === 401 || error.status === 403 || isAuthenticationMessage(error.message));
}

function isAuthenticationMessage(message: string) {
  return /authenticat|authori[sz]ation|permission|not allowed|unauthorized|forbidden/i.test(message);
}

function result(
  ok: boolean,
  checks: CloudflareCheck[],
  zone: CloudflareEmailCheckResult["zone"],
  dns: CloudflareEmailCheckResult["dns"],
  routing: CloudflareEmailCheckResult["routing"]
) {
  return () => ({ ok, checks, zone, dns, routing });
}
