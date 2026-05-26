import { signToken, verifyToken } from "@flowmail/email-core";
import type { Context, Next } from "hono";
import type { Env } from "./types";

const CONFIG_ENCRYPTION_KEY = "config_encryption_key";
const ADMIN_AUTH_KEY = "admin_auth";
const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "flowmail-admin";
const PUBLIC_APP_URL_KEY = "public_app_url";
const SESSION_COOKIE = "flowmail_session";
const TRACKING_SECRET_KEY = "tracking_secret";

type RuntimeSetting = {
  value_json: string;
};

export async function getTrackingSecret(db: D1Database, env: Pick<Env, "TRACKING_SECRET">) {
  if (isUsableSecret(env.TRACKING_SECRET)) return env.TRACKING_SECRET;
  return getOrCreateSecret(db, TRACKING_SECRET_KEY);
}

export async function getConfigEncryptionKey(db: D1Database, env: Pick<Env, "CONFIG_ENCRYPTION_KEY">) {
  if (isUsableSecret(env.CONFIG_ENCRYPTION_KEY)) return env.CONFIG_ENCRYPTION_KEY;
  return getOrCreateSecret(db, CONFIG_ENCRYPTION_KEY);
}

export async function requireFlowmailSession(c: Context<{ Bindings: Env }>, next: Next) {
  if (new URL(c.req.url).pathname.startsWith("/api/public/")) return next();

  const token = readCookie(c.req.header("cookie") ?? "", SESSION_COOKIE);
  if (!token) return c.json({ error: "Authentication required." }, 401);

  try {
    const payload = await verifyToken(token, await getTrackingSecret(c.env.DB, c.env));
    if (payload.type !== "session") throw new Error("invalid_session");
    const admin = await ensureAdminAuth(c.env.DB);
    if (payload.username !== admin.username) throw new Error("invalid_admin");
    return next();
  } catch {
    return c.json({ error: "Authentication required." }, 401);
  }
}

export async function createPasswordSessionCookie(db: D1Database, env: Pick<Env, "TRACKING_SECRET">, username: string, password: string) {
  const admin = await ensureAdminAuth(db);
  if (username.trim() !== admin.username || await hashPassword(password) !== admin.passwordHash) {
    throw new Error("invalid_credentials");
  }
  const session = await signToken({ type: "session", username: admin.username, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 }, await getTrackingSecret(db, env));
  return `${SESSION_COOKIE}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`;
}

export function requestPublicAppUrl(requestUrl: string, env: Pick<Env, "PUBLIC_APP_URL">) {
  if (isConfiguredPublicUrl(env.PUBLIC_APP_URL)) return env.PUBLIC_APP_URL.replace(/\/+$/, "");
  return new URL(requestUrl).origin;
}

export async function rememberPublicAppUrl(db: D1Database, url: string) {
  const normalized = url.replace(/\/+$/, "");
  if (!normalized) return;
  await writeSetting(db, PUBLIC_APP_URL_KEY, normalized);
}

export async function getPublicAppUrl(db: D1Database, env: Pick<Env, "PUBLIC_APP_URL">, fallback = "") {
  if (isConfiguredPublicUrl(env.PUBLIC_APP_URL)) return env.PUBLIC_APP_URL.replace(/\/+$/, "");
  const saved = await readSetting(db, PUBLIC_APP_URL_KEY);
  return saved || fallback.replace(/\/+$/, "");
}

function isConfiguredPublicUrl(value?: string): value is string {
  return Boolean(value && /^https?:\/\//i.test(value) && !value.includes("example.com"));
}

function isUsableSecret(value?: string): value is string {
  return Boolean(value && value.length >= 32 && !value.startsWith("replace-"));
}

async function getOrCreateSecret(db: D1Database, key: string) {
  const existing = await readSetting(db, key);
  if (isUsableSecret(existing)) return existing;
  const value = randomSecret();
  await writeSetting(db, key, value);
  return value;
}

async function readSetting(db: D1Database, key: string) {
  const row = await db.prepare("SELECT value_json FROM settings WHERE key = ?").bind(key).first<RuntimeSetting>();
  if (!row?.value_json) return "";
  try {
    const parsed = JSON.parse(row.value_json);
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return "";
  }
}

async function ensureAdminAuth(db: D1Database) {
  const existing = await readSetting(db, ADMIN_AUTH_KEY);
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as { username?: string; passwordHash?: string };
      if (parsed.username && parsed.passwordHash) return { username: parsed.username, passwordHash: parsed.passwordHash };
    } catch {
      // Recreate malformed admin settings below.
    }
  }
  const admin = {
    username: DEFAULT_ADMIN_USERNAME,
    passwordHash: await hashPassword(DEFAULT_ADMIN_PASSWORD)
  };
  await writeSetting(db, ADMIN_AUTH_KEY, JSON.stringify(admin));
  return admin;
}

async function writeSetting(db: D1Database, key: string, value: string) {
  await db.prepare(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).bind(key, JSON.stringify(value), new Date().toISOString()).run();
}

function randomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readCookie(cookieHeader: string, name: string) {
  const cookies = cookieHeader.split(";").map((part) => part.trim());
  const prefix = `${name}=`;
  return cookies.find((cookie) => cookie.startsWith(prefix))?.slice(prefix.length) ?? "";
}

async function hashPassword(password: string) {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
