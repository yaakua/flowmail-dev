import { describe, expect, it, vi } from "vitest";
import {
  applyCloudflareEmailRouting,
  applyCloudflareReceiverCatchAllRouting,
  checkCloudflareEmailConfig,
  checkCloudflareReceiverConfig,
  deleteCloudflareEmailToken,
  discoverCloudflareEmailConfig,
  discoverSavedCloudflareEmailConfig,
  getCloudflareEmailConfig,
  getCloudflareReceiverConfig,
  saveCloudflareReceiverConfig,
  saveCloudflareEmailConfig,
  sendCloudflareEmail
} from "./cloudflare-email";

const secret = "0123456789abcdef0123456789abcdef";

class FakeD1Database {
  settings = new Map<string, { value_json: string; updated_at: string }>();

  prepare(sql: string) {
    return new FakeD1Statement(this, sql);
  }

  async batch(statements: FakeD1Statement[]) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

class FakeD1Statement {
  private values: unknown[] = [];

  constructor(private readonly db: FakeD1Database, private readonly sql: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.sql.includes("SELECT value_json FROM settings")) {
      return (this.db.settings.get(String(this.values[0])) ?? null) as T | null;
    }
    return null;
  }

  async run() {
    if (this.sql.includes("INSERT INTO settings")) {
      this.db.settings.set(String(this.values[0]), {
        value_json: String(this.values[1]),
        updated_at: String(this.values[2])
      });
    }
    return { success: true };
  }
}

function db() {
  return new FakeD1Database() as unknown as D1Database;
}

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    CONFIG_ENCRYPTION_KEY: secret,
    WORKER_NAME: "flowmail",
    ...overrides
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function cloudflareFetch(options: { rules?: any[] } = {}) {
  const bodies: Array<{ method: string; path: string; body: any }> = [];
  const rules = [...(options.rules ?? [])];
  let catchAllRule = {
    id: "catch-all",
    name: "Catch-all",
    enabled: false,
    matchers: [{ type: "all" }],
    actions: [{ type: "drop", value: [] }]
  };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/client/v4", "");
    const method = init?.method ?? "GET";
    if (init?.body) bodies.push({ method, path, body: JSON.parse(String(init.body)) });

    if (path === "/user/tokens/verify") {
      return response({ success: true, result: { status: "active" } });
    }
    if (path === "/zones") {
      return response({
        success: true,
        result: [{ id: "zone-1", name: "example.com", status: "active", account: { id: "account-1", name: "Example Account" } }]
      });
    }
    if (path === "/accounts/account-1/workers/scripts") {
      return response({
        success: true,
        result: [
          { id: "other-worker", script_name: "other-worker" },
          { id: "flowmail", script_name: "flowmail" }
        ]
      });
    }
    if (path === "/zones/zone-1/dns_records") {
      return response({
        success: true,
        result: [
          { type: "MX", name: "example.com", content: "route.mx.cloudflare.net" },
          { type: "TXT", name: "example.com", content: "v=spf1 include:_spf.mx.cloudflare.net ~all" },
          { type: "TXT", name: "mail._domainkey.example.com", content: "v=DKIM1" },
          { type: "TXT", name: "_dmarc.example.com", content: "v=DMARC1; p=none" }
        ]
      });
    }
    if (path === "/zones/zone-1/email/routing") {
      return response({ success: true, result: { enabled: true, status: "enabled" } });
    }
    if (path === "/zones/zone-1/email/routing/rules" && method === "GET") {
      return response({ success: true, result: rules });
    }
    if (path === "/zones/zone-1/email/routing/rules/catch_all" && method === "GET") {
      return response({ success: true, result: catchAllRule });
    }
    if (path === "/zones/zone-1/email/routing/rules/catch_all" && method === "PUT") {
      catchAllRule = { id: "catch-all", matchers: [{ type: "all" }], ...bodies.at(-1)?.body };
      return response({ success: true, result: catchAllRule });
    }
    if (path === "/zones/zone-1/email/routing/rules" && method === "POST") {
      if (!bodies.at(-1)?.body?.actions) {
        return response({ success: false, errors: [{ message: "Missing routing rule actions." }] }, 400);
      }
      const created = { id: "new-rule", ...bodies.at(-1)?.body };
      rules.push(created);
      return response({ success: true, result: created });
    }
    if (path === "/accounts/account-1/email/sending/send" && method === "POST") {
      const body = bodies.at(-1)?.body;
      if (body?.to) {
        return response({ success: true, result: { id: "cf-message-1" } });
      }
      return response({ success: false, errors: [{ message: "Missing email payload." }] }, 400);
    }
    if (path === "/zones/zone-1/email/routing/rules/rule-1" && method === "PUT") {
      const updated = { id: "rule-1", ...bodies.at(-1)?.body };
      const index = rules.findIndex((rule) => rule.id === "rule-1");
      if (index >= 0) rules[index] = updated;
      return response({ success: true, result: updated });
    }
    return response({ success: false, errors: [{ message: `Unexpected ${method} ${path}` }] }, 404);
  });
  return { fetcher, bodies };
}

async function saveConfig(database: D1Database) {
  return saveCloudflareEmailConfig(database, {
    zoneName: "example.com",
    workerName: "flowmail",
    fromEmail: "hello@example.com",
    replyToEmail: "support@example.com",
    token: "cf-token-secret"
  }, env());
}

async function saveReceiverConfig(database: D1Database) {
  return saveCloudflareReceiverConfig(database, {
    zoneName: "mail.example.com",
    workerName: "flowmail",
    destinationAddress: "collector@mail.example.com",
    token: "cf-token-secret"
  }, env());
}

describe("cloudflare email config", () => {
  it("discovers zones, workers, and sender suggestions from one token", async () => {
    const { fetcher } = cloudflareFetch();

    const discovered = await discoverCloudflareEmailConfig({ token: "cf-token-secret" }, env(), fetcher);

    expect(discovered.ok).toBe(true);
    expect(discovered.zones).toEqual([{
      id: "zone-1",
      name: "example.com",
      status: "active",
      accountId: "account-1",
      accountName: "Example Account"
    }]);
    expect(discovered.workers.map((worker) => worker.name)).toEqual(["other-worker", "flowmail"]);
    expect(discovered.suggested).toEqual({
      zoneName: "example.com",
      workerName: "flowmail",
      fromEmail: "no-reply@example.com",
      replyToEmail: "reply@example.com"
    });
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
      "https://api.cloudflare.com/client/v4/zones?per_page=50",
      "https://api.cloudflare.com/client/v4/accounts/account-1/workers/scripts?per_page=100",
      "https://api.cloudflare.com/client/v4/zones/zone-1/dns_records?per_page=100",
      "https://api.cloudflare.com/client/v4/zones/zone-1/email/routing/rules?per_page=100",
      "https://api.cloudflare.com/client/v4/zones/zone-1/email/routing/rules",
      "https://api.cloudflare.com/client/v4/accounts/account-1/email/sending/send"
    ]);
    expect(discovered.permissions.every((permission) => permission.ok)).toBe(true);
    expect(discovered.missingPermissions).toEqual([]);
  });

  it("rediscovers selectable domains with the saved token", async () => {
    const database = db();
    await saveConfig(database);
    const { fetcher } = cloudflareFetch();

    const discovered = await discoverSavedCloudflareEmailConfig(database, {}, env(), fetcher);

    expect(discovered.ok).toBe(true);
    expect(discovered.selectedZone?.name).toBe("example.com");
    expect(discovered.suggested).toMatchObject({
      zoneName: "example.com",
      fromEmail: "no-reply@example.com",
      replyToEmail: "reply@example.com"
    });
  });

  it("uses the saved zone name when rediscovering domains from a saved token", async () => {
    const database = db();
    await saveConfig(database);
    const base = cloudflareFetch();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/client/v4", "");
      if (path === "/zones" && !url.searchParams.get("name")) return response({ success: true, result: [] });
      return base.fetcher(input, init);
    });

    const discovered = await discoverSavedCloudflareEmailConfig(database, {}, env(), fetcher);

    expect(discovered.selectedZone?.name).toBe("example.com");
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/zones?per_page=50&name=example.com",
      expect.any(Object)
    );
  });

  it("uses global fetch with the correct receiver when no fetcher is injected", async () => {
    const { fetcher } = cloudflareFetch();
    const runtimeFetch = vi.fn(function (this: typeof globalThis, input: RequestInfo | URL, init?: RequestInit) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return fetcher(input, init);
    });
    vi.stubGlobal("fetch", runtimeFetch);
    try {
      const discovered = await discoverCloudflareEmailConfig({ token: "cf-token-secret" }, env());

      expect(discovered.suggested.zoneName).toBe("example.com");
      expect(runtimeFetch).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the deployed worker name when discovery only finds unrelated workers", async () => {
    const { fetcher } = cloudflareFetch();
    fetcher.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/client/v4", "");
      if (path === "/user/tokens/verify") return response({ success: true, result: { status: "active" } });
      if (path === "/zones") {
        return response({
          success: true,
          result: [{ id: "zone-1", name: "example.com", status: "active", account: { id: "account-1", name: "Example Account" } }]
        });
      }
      if (path === "/accounts/account-1/workers/scripts") {
        return response({ success: true, result: [{ id: "docker-hub", script_name: "docker-hub" }] });
      }
      return response({ success: false, errors: [{ message: `Unexpected ${init?.method ?? "GET"} ${path}` }] }, 404);
    });

    const discovered = await discoverCloudflareEmailConfig({ token: "cf-token-secret" }, env(), fetcher);

    expect(discovered.workers.map((worker) => worker.name)).toEqual(["docker-hub"]);
    expect(discovered.suggested?.workerName).toBe("flowmail");
    expect(discovered.warnings).toHaveLength(1);
    expect(discovered.permissions.find((permission) => permission.name === "workersScriptsRead")?.ok).toBe(true);
  });

  it("reports missing required permissions during discovery", async () => {
    const { fetcher } = cloudflareFetch();
    fetcher.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/client/v4", "");
      const method = init?.method ?? "GET";
      if (path === "/user/tokens/verify") return response({ success: true, result: { status: "active" } });
      if (path === "/zones") {
        return response({
          success: true,
          result: [{ id: "zone-1", name: "example.com", status: "active", account: { id: "account-1", name: "Example Account" } }]
        });
      }
      if (path === "/accounts/account-1/workers/scripts") return response({ success: true, result: [] });
      if (path === "/zones/zone-1/dns_records") return response({ success: false, errors: [{ message: "Authentication error" }] }, 403);
      if (path === "/zones/zone-1/email/routing/rules" && method === "GET") return response({ success: false, errors: [{ message: "Authentication error" }] }, 403);
      if (path === "/zones/zone-1/email/routing/rules" && method === "POST") return response({ success: false, errors: [{ message: "Authentication error" }] }, 403);
      if (path === "/accounts/account-1/email/sending/send" && method === "POST") return response({ success: false, errors: [{ message: "Authentication error" }] }, 403);
      return response({ success: false, errors: [{ message: `Unexpected ${method} ${path}` }] }, 404);
    });

    const discovered = await discoverCloudflareEmailConfig({ token: "cf-token-secret" }, env(), fetcher);

    expect(discovered.ok).toBe(false);
    expect(discovered.missingPermissions).toEqual(["dnsRead", "emailRoutingRead", "emailRoutingEdit", "emailSendingEdit"]);
    expect(discovered.permissions.filter((permission) => !permission.ok).map((permission) => permission.name)).toEqual(discovered.missingPermissions);
  });

  it("generates an encryption key when CONFIG_ENCRYPTION_KEY is missing", async () => {
    const database = db();
    const saved = await saveCloudflareEmailConfig(database, {
      zoneName: "example.com",
      fromEmail: "hello@example.com",
      replyToEmail: "support@example.com",
      token: "cf-token-secret"
    }, env({ CONFIG_ENCRYPTION_KEY: undefined }));
    const settings = (database as unknown as FakeD1Database).settings;
    expect(saved).toMatchObject({ tokenSaved: true, tokenLast4: "cret" });
    expect(settings.get("config_encryption_key")?.value_json).toBeTruthy();
    expect(settings.get("cloudflare_email_config")?.value_json).not.toContain("cf-token-secret");
  });

  it("stores encrypted token data and never returns plaintext token fields", async () => {
    const database = db();
    const saved = await saveConfig(database);
    expect(saved).toMatchObject({ tokenSaved: true, tokenLast4: "cret" });
    expect(saved).not.toHaveProperty("token");
    expect(saved).not.toHaveProperty("tokenCiphertext");

    const stored = (database as unknown as FakeD1Database).settings.get("cloudflare_email_config")?.value_json ?? "";
    expect(stored).not.toContain("cf-token-secret");
    expect(stored).toContain("tokenCiphertext");

    const loaded = await getCloudflareEmailConfig(database, env());
    expect(loaded).toMatchObject({ tokenSaved: true, tokenLast4: "cret" });

    const withoutToken = await deleteCloudflareEmailToken(database, env());
    expect(withoutToken).toMatchObject({
      zoneName: "example.com",
      workerName: "flowmail",
      fromEmail: "hello@example.com",
      replyToEmail: "support@example.com",
      tokenSaved: false
    });
  });

  it("sends arbitrary recipients through Cloudflare Email Sending API", async () => {
    const database = db();
    await saveConfig(database);
    const { fetcher, bodies } = cloudflareFetch();

    const sent = await sendCloudflareEmail(database, {
      to: "customer@other-domain.test",
      fromEmail: "hello@example.com",
      fromName: "Flowmail",
      replyToEmail: "support@example.com",
      subject: "Hello",
      html: "<p>Hello</p>",
      text: "Hello",
      headers: { "X-Flowmail-Test": "true" }
    }, env(), fetcher);

    expect(sent).toEqual({ messageId: "cf-message-1", provider: "cloudflare-api" });
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/account-1/email/sending/send",
      expect.objectContaining({ method: "POST" })
    );
    expect(bodies.at(-1)?.body).toMatchObject({
      to: "customer@other-domain.test",
      from: { address: "hello@example.com", name: "Flowmail" },
      reply_to: "support@example.com",
      subject: "Hello",
      headers: { "X-Flowmail-Test": "true" }
    });
  });

  it("checks token, zone, dns, email routing, and exact reply-to worker rule", async () => {
    const database = db();
    await saveConfig(database);
    const { fetcher } = cloudflareFetch({
      rules: [{
        id: "rule-1",
        name: "Flowmail inbound: support@example.com",
        enabled: true,
        matchers: [{ type: "literal", field: "to", value: "support@example.com" }],
        actions: [{ type: "worker", value: ["flowmail"] }]
      }]
    });

    const checked = await checkCloudflareEmailConfig(database, env(), fetcher);

    expect(checked.ok).toBe(true);
    expect(checked.zone).toMatchObject({ id: "zone-1", name: "example.com" });
    expect(checked.dns).toEqual({ mxRecords: 1, spfRecords: 1, dkimHints: 1, dmarcRecords: 1 });
    expect(checked.routing?.replyToRule?.id).toBe("rule-1");
    expect(checked.checks.map((check) => check.name)).toEqual(["token", "zone", "dns", "emailRouting", "replyToRoute"]);
  });

  it("does not require Zone Settings Read when routing rules are readable", async () => {
    const database = db();
    await saveConfig(database);
    const base = cloudflareFetch({
      rules: [{
        id: "rule-1",
        name: "Flowmail inbound: support@example.com",
        enabled: true,
        matchers: [{ type: "literal", field: "to", value: "support@example.com" }],
        actions: [{ type: "worker", value: ["flowmail"] }]
      }]
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/client/v4", "");
      if (path === "/zones/zone-1/email/routing") {
        return response({ success: false, errors: [{ message: "Authentication error" }] }, 403);
      }
      return base.fetcher(input, init);
    });

    const checked = await checkCloudflareEmailConfig(database, env(), fetcher);

    expect(checked.ok).toBe(true);
    expect(checked.routing?.status).toBe("unknown");
    expect(checked.routing?.replyToRule?.id).toBe("rule-1");
    expect(checked.checks.find((check) => check.name === "emailRouting")).toMatchObject({
      ok: true,
      details: "Email Routing rules are readable. Email Routing status requires Zone Settings Read, so Flowmail skipped the enabled-status check."
    });
  });

  it("creates one literal recipient worker routing rule and no catch-all", async () => {
    const database = db();
    await saveConfig(database);
    const { fetcher, bodies } = cloudflareFetch({ rules: [] });

    const result = await applyCloudflareEmailRouting(database, env(), fetcher);

    expect(result.ok).toBe(true);
    expect(result.routing?.replyToRule?.id).toBe("new-rule");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ method: "POST", path: "/zones/zone-1/email/routing/rules" });
    expect(bodies[0].body).toEqual({
      name: "Flowmail inbound: support@example.com",
      enabled: true,
      matchers: [{ type: "literal", field: "to", value: "support@example.com" }],
      actions: [{ type: "worker", value: ["flowmail"] }]
    });
    expect(JSON.stringify(bodies[0].body)).not.toContain("catch");
  });

  it("updates an existing exact recipient routing rule instead of creating another", async () => {
    const database = db();
    await saveConfig(database);
    const { fetcher, bodies } = cloudflareFetch({
      rules: [{
        id: "rule-1",
        name: "Old route",
        enabled: false,
        matchers: [{ type: "literal", field: "to", value: "support@example.com" }],
        actions: [{ type: "forward", value: ["ops@example.com"] }]
      }]
    });

    const result = await applyCloudflareEmailRouting(database, env(), fetcher);

    expect(result.rule.id).toBe("rule-1");
    expect(result.routing?.replyToRule?.id).toBe("rule-1");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ method: "PUT", path: "/zones/zone-1/email/routing/rules/rule-1" });
    expect(bodies[0].body.actions).toEqual([{ type: "worker", value: ["flowmail"] }]);
  });

  it("saves receiver config and reuses the existing encrypted token by default", async () => {
    const database = db();
    await saveConfig(database);

    const saved = await saveCloudflareReceiverConfig(database, {
      zoneName: "mail.example.com",
      workerName: "flowmail",
      destinationAddress: "collector@mail.example.com"
    }, env());

    expect(saved).toMatchObject({
      zoneName: "mail.example.com",
      workerName: "flowmail",
      destinationAddress: "collector@mail.example.com",
      tokenSaved: true,
      tokenLast4: "cret"
    });
    expect(await getCloudflareReceiverConfig(database, env())).toMatchObject({ tokenSaved: true });
  });

  it("exposes saved email config token state for receiver setup before receiver config exists", async () => {
    const database = db();
    await saveConfig(database);

    const loaded = await getCloudflareReceiverConfig(database, env());

    expect(loaded).toMatchObject({
      zoneName: "",
      workerName: "flowmail",
      destinationAddress: "",
      tokenSaved: true,
      tokenLast4: "cret"
    });
    expect(loaded).not.toHaveProperty("token");
    expect(loaded).not.toHaveProperty("tokenCiphertext");
  });

  it("applies a catch-all worker route for the receiver domain", async () => {
    const database = db();
    await saveReceiverConfig(database);
    const base = cloudflareFetch();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.replace("/client/v4", "") === "/zones" && url.searchParams.get("name") === "mail.example.com") {
        return response({
          success: true,
          result: [{ id: "zone-1", name: "mail.example.com", status: "active", account: { id: "account-1", name: "Example Account" } }]
        });
      }
      return base.fetcher(input, init);
    });

    const result = await applyCloudflareReceiverCatchAllRouting(database, env(), fetcher);

    expect(result.ok).toBe(true);
    expect(result.routing?.catchAllRule?.id).toBe("catch-all");
    expect(base.bodies).toHaveLength(1);
    expect(base.bodies[0]).toMatchObject({ method: "PUT", path: "/zones/zone-1/email/routing/rules/catch_all" });
    expect(base.bodies[0].body).toEqual({
      name: "Flowmail receiver catch-all: mail.example.com",
      enabled: true,
      matchers: [{ type: "all" }],
      actions: [{ type: "worker", value: ["flowmail"] }]
    });
  });

  it("checks the saved receiver catch-all route", async () => {
    const database = db();
    await saveReceiverConfig(database);
    const base = cloudflareFetch();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/client/v4", "");
      if (path === "/zones" && url.searchParams.get("name") === "mail.example.com") {
        return response({
          success: true,
          result: [{ id: "zone-1", name: "mail.example.com", status: "active", account: { id: "account-1", name: "Example Account" } }]
        });
      }
      if (path === "/zones/zone-1/email/routing/rules/catch_all") {
        return response({
          success: true,
          result: {
            id: "catch-all",
            name: "Flowmail receiver catch-all: mail.example.com",
            enabled: true,
            actions: [{ type: "worker", value: ["flowmail"] }]
          }
        });
      }
      return base.fetcher(input, init);
    });

    const checked = await checkCloudflareReceiverConfig(database, env(), fetcher);

    expect(checked.ok).toBe(true);
    expect(checked.checks.map((check) => check.name)).toEqual(["token", "zone", "emailRouting", "catchAllRoute"]);
    expect(checked.routing?.catchAllRule?.id).toBe("catch-all");
  });
});
