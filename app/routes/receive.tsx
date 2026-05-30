import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { AppShell, localizedPath, useLocale } from "../components/AppShell";
import { MetricCard } from "../components/Workflow";
import { api } from "../lib/api";
import { t } from "../i18n";

type ReceiverConfig = {
  zoneName?: string;
  workerName?: string;
  destinationAddress?: string;
  tokenSaved?: boolean;
  tokenLast4?: string;
  updatedAt?: string;
  localSetupMode?: boolean;
};

type CheckResult = {
  ok?: boolean;
  checks?: Array<{ name: string; ok: boolean; details: string }>;
  zone?: { id?: string; name?: string; status?: string };
  routing?: {
    status?: string;
    enabled?: boolean;
    catchAllRule?: unknown;
  };
};

type CloudflareDiscovery = {
  ok: boolean;
  zones?: Array<{ id: string; name: string; status?: string; accountId?: string; accountName?: string }>;
  selectedZone?: { id: string; name: string; status?: string; accountId?: string; accountName?: string } | null;
  workers?: Array<{ id?: string; name: string }>;
  suggested?: {
    zoneName: string;
    workerName: string;
    fromEmail: string;
    replyToEmail: string;
  };
};

type Mailbox = {
  recipient: string;
  recipient_local: string;
  recipient_domain: string;
  message_count: number;
  last_received_at: string;
};

type InboundMessage = {
  id: string;
  recipient?: string;
  sender: string;
  subject?: string;
  body_text?: string;
  classification: string;
  created_at: string;
};

export default function Receive() {
  const locale = useLocale();
  const [config, setConfig] = useState<ReceiverConfig | null>(null);
  const [rootZoneName, setRootZoneName] = useState("");
  const [receiverSubdomain, setReceiverSubdomain] = useState("");
  const [workerName, setWorkerName] = useState("flowmail");
  const [token, setToken] = useState("");
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [discovery, setDiscovery] = useState<CloudflareDiscovery | null>(null);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [messages, setMessages] = useState<InboundMessage[]>([]);
  const [selectedRecipient, setSelectedRecipient] = useState("");
  const [query, setQuery] = useState("");
  const [testRecipient, setTestRecipient] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void loadMessages(selectedRecipient, query);
  }, [selectedRecipient]);

  const totalMessages = mailboxes.reduce((sum, mailbox) => sum + Number(mailbox.message_count ?? 0), 0);
  const hasToken = Boolean(config?.tokenSaved);
  const zoneName = buildReceiverDomain(rootZoneName, receiverSubdomain);
  const canSave = Boolean(zoneName.trim() && workerName.trim());
  const routeReady = Boolean(checkResult?.checks?.find((check) => check.name === "catchAllRoute")?.ok);

  const filteredMailboxes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return mailboxes;
    return mailboxes.filter((mailbox) => mailbox.recipient.toLowerCase().includes(needle));
  }, [mailboxes, query]);

  async function load() {
    setBusy("load");
    try {
      const nextConfig = await api<ReceiverConfig>("/api/v1/cloudflare/receiver-config");
      setConfig(nextConfig);
      setShowTokenInput(!nextConfig.tokenSaved);
      const splitDomain = splitReceiverDomain(nextConfig.zoneName || "");
      setRootZoneName(splitDomain.rootZoneName);
      setReceiverSubdomain(splitDomain.receiverSubdomain);
      setWorkerName(nextConfig.workerName || "flowmail");
      await Promise.all([
        loadMailboxes(nextConfig.zoneName || ""),
        loadMessages(selectedRecipient, query)
      ]);
      setStatus("");
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy("");
    }
  }

  async function loadMailboxes(domain = zoneName) {
    const params = new URLSearchParams();
    if (domain.trim()) params.set("domain", domain.trim());
    const rows = await api<Mailbox[]>(`/api/v1/receive-mailboxes${params.toString() ? `?${params}` : ""}`);
    setMailboxes(rows);
  }

  async function loadMessages(recipient = selectedRecipient, search = query) {
    const params = new URLSearchParams();
    if (recipient) params.set("recipient", recipient);
    if (!recipient && zoneName.trim()) params.set("domain", zoneName.trim());
    if (search.trim()) params.set("q", search.trim());
    const rows = await api<InboundMessage[]>(`/api/v1/inbox${params.toString() ? `?${params}` : ""}`);
    setMessages(rows);
  }

  async function saveConfig() {
    setBusy("save");
    setStatus("");
    try {
      const saved = await api<ReceiverConfig>("/api/v1/cloudflare/receiver-config", {
        method: "PUT",
        body: JSON.stringify({
          zoneName: zoneName.trim(),
          workerName: workerName.trim() || "flowmail",
          ...(token.trim() ? { token: token.trim() } : {})
        })
      });
      setConfig(saved);
      setToken("");
      setShowTokenInput(!saved.tokenSaved);
      setStatus(t(locale, "receiveConfigSaved"));
      await loadMailboxes(saved.zoneName || "");
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy("");
    }
  }

  async function loadDomains() {
    if (!hasToken) {
      setStatus(t(locale, "receiveSaveTokenBeforeDomains"));
      return;
    }
    setBusy("discover-saved");
    setStatus("");
    try {
      const result = await api<CloudflareDiscovery>("/api/v1/cloudflare/email-config/discover-saved", {
        method: "POST",
        body: JSON.stringify({})
      });
      setDiscovery(result);
      const suggestedZone = result.selectedZone?.name || result.suggested?.zoneName || result.zones?.[0]?.name || "";
      if (suggestedZone) {
        setRootZoneName(suggestedZone);
        setReceiverSubdomain("");
      }
      if (result.suggested?.workerName) setWorkerName(result.suggested.workerName);
      setStatus(t(locale, "receiveDomainsLoaded", { count: result.zones?.length ?? 0 }));
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy("");
    }
  }

  async function checkRouting() {
    setBusy("check");
    try {
      const checked = await api<CheckResult>("/api/v1/cloudflare/receiver-config/check", { method: "POST" });
      setCheckResult(checked);
      setStatus(t(locale, checked.ok ? "receiveReady" : "receiveChecksNeedAttention"));
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy("");
    }
  }

  async function applyCatchAll() {
    setBusy("apply");
    try {
      const checked = await api<CheckResult>("/api/v1/cloudflare/receiver-config/apply-catch-all", { method: "POST" });
      setCheckResult(checked);
      setStatus(t(locale, checked.ok ? "receiveRouteApplied" : "receiveRouteAppliedWithIssues"));
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy("");
    }
  }

  async function sendTestEmail() {
    const to = testRecipient.trim();
    if (!to) {
      setStatus(t(locale, "receiveTestRecipientRequired"));
      return;
    }
    setBusy("test-email");
    setStatus("");
    try {
      const result = await api<{ to: string; messageId?: string; simulated?: boolean }>("/api/v1/receive/test-email", {
        method: "POST",
        body: JSON.stringify({ to })
      });
      setStatus(t(locale, result.simulated ? "receiveTestEmailLocalSent" : "receiveTestEmailSent", { to: result.to, messageId: result.messageId || "-" }));
      setTestRecipient("");
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy("");
    }
  }

  async function runSearch() {
    await Promise.all([loadMailboxes(zoneName), loadMessages(selectedRecipient, query)]);
  }

  const aside = (
    <div className="stack">
      <section className="side-card">
        <h2>{t(locale, "receiveRoutingState")}</h2>
        <div className={routeReady ? "risk ok" : "risk warning"}>
          <strong>{t(locale, routeReady ? "receiveCatchAllActive" : "receiveCatchAllNotVerified")}</strong>
          <span>{zoneName || t(locale, "receiveNoDomainSelected")} · {workerName || "flowmail"}</span>
        </div>
        {checkResult?.checks?.map((check) => (
          <div className="mini-row" key={check.name}>
            <strong>{check.name}</strong>
            <span>{check.ok ? "OK" : t(locale, "receiveNeedsAttention")}</span>
          </div>
        ))}
      </section>
      <section className="side-card">
        <h2>{t(locale, "receiveApiLookup")}</h2>
        <code className="api-snippet">GET /api/v1/inbox?recipient=anything@{zoneName || "mail.example.com"}</code>
        <code className="api-snippet">GET /api/v1/receive/latest?domain={zoneName || "mail.example.com"}</code>
      </section>
    </div>
  );

  return (
    <AppShell aside={aside} hideTopbar>
      <section className="page-heading page-heading-row">
        <div>
          <p className="eyebrow">{t(locale, "receiveEyebrow")}</p>
          <h1>{t(locale, "receiveTitle")}</h1>
          <p>{t(locale, "receiveLead")}</p>
        </div>
        <div className="row-actions flush">
          <button className="secondary-button" disabled={busy === "check" || !hasToken} onClick={checkRouting}>{t(locale, "check")}</button>
          <button disabled={busy === "apply" || !hasToken || !canSave} onClick={applyCatchAll}>{t(locale, "receiveApplyCatchAll")}</button>
        </div>
      </section>

      <section className="metric-row metric-row-4">
        <MetricCard label={t(locale, "receiveVirtualMailboxes")} value={mailboxes.length} />
        <MetricCard label={t(locale, "receiveCollectedMessages")} value={totalMessages} />
        <MetricCard label={t(locale, "domain")} value={zoneName || "-"} />
        <MetricCard label={t(locale, "receiveRoute")} value={t(locale, routeReady ? "ready" : "pending")} />
      </section>

      <section className="panel receive-config-panel">
        <div className="panel-title-row">
          <div>
            <h2>{t(locale, "receiveReceiverDomain")}</h2>
            <p className="muted">{t(locale, "receiveReceiverDomainLead")}</p>
          </div>
          <div className="row-actions flush">
            {hasToken ? <span className="soft-pill">{t(locale, "receiveSavedToken", { suffix: config?.tokenLast4 ? `...${config.tokenLast4}` : "" })}</span> : <span className="soft-pill">{t(locale, "receiveNoSavedToken")}</span>}
            {hasToken ? <button className="secondary-button compact-link" onClick={() => setShowTokenInput((visible) => !visible)}>{t(locale, showTokenInput ? "cancel" : "replaceCloudflareApiToken")}</button> : null}
          </div>
        </div>
        <div className="form-grid">
          <label className="field-row">
            <span>{t(locale, "receiveRootDomain")}</span>
            {discovery?.zones?.length ? (
              <select value={rootZoneName} onChange={(event) => setRootZoneName(event.target.value)}>
                {!discovery.zones.some((zone) => zone.name === rootZoneName) && rootZoneName ? <option value={rootZoneName}>{rootZoneName}</option> : null}
                {discovery.zones.map((zone) => <option key={zone.id || zone.name} value={zone.name}>{zone.name}</option>)}
              </select>
            ) : (
              <input placeholder="example.com" value={rootZoneName} onChange={(event) => setRootZoneName(normalizeDomainInput(event.target.value))} />
            )}
            <small className="field-note">{t(locale, "receiveRootDomainNote")}</small>
          </label>
          <label className="field-row">
            <span>{t(locale, "receiveSubdomain")}</span>
            <input placeholder="mail" value={receiverSubdomain} onChange={(event) => setReceiverSubdomain(normalizeSubdomain(event.target.value, rootZoneName))} />
            <small className="field-note">{zoneName ? t(locale, "receiveDomainPreview", { domain: zoneName }) : t(locale, "receiveNoSubdomainNote")}</small>
          </label>
          <label className="field-row">
            <span>{t(locale, "worker")}</span>
            <input placeholder="flowmail" value={workerName} onChange={(event) => setWorkerName(event.target.value)} />
          </label>
          {showTokenInput ? (
            <label className="field-row">
              <span>{t(locale, hasToken ? "replaceCloudflareApiToken" : "receiveCloudflareApiToken")}</span>
              <input placeholder={t(locale, hasToken ? "tokenReplacePlaceholder" : "receivePasteTokenPlaceholder")} value={token} onChange={(event) => setToken(event.target.value)} />
              <small className="field-note">{t(locale, "receiveTokenOptionalNote")}</small>
            </label>
          ) : null}
        </div>
        <div className="row-actions">
          <button disabled={!canSave || busy === "save"} onClick={saveConfig}>{t(locale, "receiveSaveReceiver")}</button>
          <button className="secondary-button" disabled={!hasToken || busy === "discover-saved"} onClick={loadDomains}>{t(locale, "receiveLoadDomains")}</button>
          <button className="secondary-button" disabled={busy === "load"} onClick={() => void load()}>{t(locale, "reload")}</button>
          {status ? <span className="muted">{status}</span> : null}
        </div>
        <div className="receive-test-row">
          <input placeholder={zoneName ? `anything@${zoneName}` : t(locale, "receiveTestRecipientPlaceholder")} value={testRecipient} onChange={(event) => setTestRecipient(event.target.value)} />
          <button className="secondary-button" disabled={busy === "test-email"} onClick={sendTestEmail}>{t(locale, "receiveSendTestEmail")}</button>
        </div>
      </section>

      <section className="receive-grid">
        <div className="thread-list">
          <div className="tabs"><span className="active">{t(locale, "receiveMailboxes", { count: filteredMailboxes.length })}</span></div>
          <div className="receive-search">
            <input placeholder={t(locale, "receiveSearchPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter") void runSearch();
            }} />
            <button className="secondary-button" onClick={runSearch}>{t(locale, "filter")}</button>
          </div>
          {filteredMailboxes.map((mailbox) => (
            <button className={mailbox.recipient === selectedRecipient ? "thread-item active" : "thread-item"} key={mailbox.recipient} onClick={() => setSelectedRecipient(mailbox.recipient)}>
              <span className="avatar-dot">@</span>
              <strong>{mailbox.recipient}</strong>
              <span>{t(locale, "receiveMessagesCount", { count: mailbox.message_count })}</span>
              <small>{new Date(mailbox.last_received_at).toLocaleString()}</small>
            </button>
          ))}
          {filteredMailboxes.length === 0 ? <p className="muted receive-empty">{t(locale, "receiveNoMailboxes")}</p> : null}
        </div>

        <div className="conversation">
          <div className="conversation-header">
            <div>
              <h2>{selectedRecipient || t(locale, "receiveAllMail")}</h2>
              <p>{t(locale, "receiveCollectedByWorker", { count: messages.length })}</p>
            </div>
            {selectedRecipient ? <button className="secondary-button" onClick={() => setSelectedRecipient("")}>{t(locale, "receiveShowAll")}</button> : null}
          </div>
          <div className="receive-message-list">
            {messages.map((message) => (
              <article className="message-card receive-message" key={message.id}>
                <div className="mini-row">
                  <strong>{message.subject || t(locale, "receiveNoSubject")}</strong>
                  <span>{new Date(message.created_at).toLocaleString()}</span>
                </div>
                <div className="mini-row">
                  <span>{t(locale, "receiveFrom", { email: message.sender })}</span>
                  <span>{t(locale, "receiveTo", { email: message.recipient || t(locale, "unknown") })}</span>
                </div>
                <pre>{message.body_text || t(locale, "receiveNoPlainTextBody")}</pre>
                <Link to={localizedPath(locale, `/inbox/${message.id}`)}>{t(locale, "openDetail")}</Link>
              </article>
            ))}
            {messages.length === 0 ? <p className="muted">{t(locale, "receiveNoMessagesMatch")}</p> : null}
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

function buildReceiverDomain(rootZoneName: string, receiverSubdomain: string) {
  const zone = normalizeDomainInput(rootZoneName);
  const subdomain = normalizeSubdomain(receiverSubdomain, zone);
  if (!zone) return "";
  return subdomain ? `${subdomain}.${zone}` : zone;
}

function normalizeDomainInput(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\//, "").split("/")[0].replace(/\s+/g, "").replace(/^\.+|\.+$/g, "");
}

function normalizeSubdomain(value: string, zoneName?: string) {
  const cleaned = normalizeDomainInput(value);
  const zone = normalizeDomainInput(zoneName || "");
  if (!cleaned || !zone) return cleaned;
  if (cleaned === zone) return "";
  return cleaned.endsWith(`.${zone}`) ? cleaned.slice(0, -(zone.length + 1)) : cleaned;
}

function splitReceiverDomain(domain: string) {
  const normalized = normalizeDomainInput(domain);
  if (!normalized) return { rootZoneName: "", receiverSubdomain: "" };
  const parts = normalized.split(".");
  if (parts.length <= 2) return { rootZoneName: normalized, receiverSubdomain: "" };
  return {
    rootZoneName: parts.slice(-2).join("."),
    receiverSubdomain: parts.slice(0, -2).join(".")
  };
}
