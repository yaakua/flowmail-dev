import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { AppShell, localizedPath, useLocale } from "../components/AppShell";
import { MetricCard } from "../components/Workflow";
import { api } from "../lib/api";

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
  const [zoneName, setZoneName] = useState("");
  const [workerName, setWorkerName] = useState("flowmail");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [token, setToken] = useState("");
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [messages, setMessages] = useState<InboundMessage[]>([]);
  const [selectedRecipient, setSelectedRecipient] = useState("");
  const [query, setQuery] = useState("");
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
  const canSave = Boolean(zoneName.trim() && workerName.trim() && destinationAddress.trim());
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
      setZoneName(nextConfig.zoneName || "");
      setWorkerName(nextConfig.workerName || "flowmail");
      setDestinationAddress(nextConfig.destinationAddress || "");
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
          destinationAddress: destinationAddress.trim(),
          ...(token.trim() ? { token: token.trim() } : {})
        })
      });
      setConfig(saved);
      setToken("");
      setStatus("Receiver config saved.");
      await loadMailboxes(saved.zoneName || "");
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
      setStatus(checked.ok ? "Catch-all receiver is ready." : "Receiver checks need attention.");
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
      setStatus(checked.ok ? "Catch-all route applied." : "Catch-all route applied, but checks still need attention.");
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
        <h2>Routing state</h2>
        <div className={routeReady ? "risk ok" : "risk warning"}>
          <strong>{routeReady ? "Catch-all active" : "Catch-all not verified"}</strong>
          <span>{zoneName || "No domain selected"} · {workerName || "flowmail"}</span>
        </div>
        {checkResult?.checks?.map((check) => (
          <div className="mini-row" key={check.name}>
            <strong>{check.name}</strong>
            <span>{check.ok ? "OK" : "Needs attention"}</span>
          </div>
        ))}
      </section>
      <section className="side-card">
        <h2>API lookup</h2>
        <code className="api-snippet">GET /api/v1/inbox?recipient=anything@{zoneName || "mail.example.com"}</code>
        <code className="api-snippet">GET /api/v1/receive-mailboxes?domain={zoneName || "mail.example.com"}</code>
      </section>
    </div>
  );

  return (
    <AppShell aside={aside}>
      <section className="page-heading page-heading-row">
        <div>
          <p className="eyebrow">Inbound mail</p>
          <h1>Receive platform</h1>
          <p>Configure one Cloudflare Email Routing catch-all domain, then query mail by any recipient address without creating mailboxes first.</p>
        </div>
        <div className="row-actions flush">
          <button className="secondary-button" disabled={busy === "check" || !hasToken} onClick={checkRouting}>Check</button>
          <button disabled={busy === "apply" || !hasToken || !canSave} onClick={applyCatchAll}>Apply catch-all</button>
        </div>
      </section>

      <section className="metric-row metric-row-4">
        <MetricCard label="Virtual mailboxes" value={mailboxes.length} />
        <MetricCard label="Collected messages" value={totalMessages} />
        <MetricCard label="Domain" value={zoneName || "-"} />
        <MetricCard label="Route" value={routeReady ? "Ready" : "Pending"} />
      </section>

      <section className="panel receive-config-panel">
        <div className="panel-title-row">
          <div>
            <h2>Receiver domain</h2>
            <p className="muted">Use an existing zone or a delegated subdomain. The saved Cloudflare token is reused when possible.</p>
          </div>
          {hasToken ? <span className="soft-pill">Saved token {config?.tokenLast4 ? `...${config.tokenLast4}` : ""}</span> : <span className="soft-pill">No saved token</span>}
        </div>
        <div className="form-grid">
          <label className="field-row">
            <span>Domain</span>
            <input placeholder="mail.example.com" value={zoneName} onChange={(event) => setZoneName(event.target.value)} />
          </label>
          <label className="field-row">
            <span>Worker</span>
            <input placeholder="flowmail" value={workerName} onChange={(event) => setWorkerName(event.target.value)} />
          </label>
          <label className="field-row">
            <span>Destination address</span>
            <input placeholder="collector@mail.example.com" value={destinationAddress} onChange={(event) => setDestinationAddress(event.target.value)} />
          </label>
          <label className="field-row">
            <span>Cloudflare API token</span>
            <input placeholder={hasToken ? "Leave blank to reuse saved token" : "Paste token"} value={token} onChange={(event) => setToken(event.target.value)} />
          </label>
        </div>
        <div className="row-actions">
          <button disabled={!canSave || busy === "save"} onClick={saveConfig}>Save receiver</button>
          <button className="secondary-button" disabled={busy === "load"} onClick={() => void load()}>Reload</button>
          {status ? <span className="muted">{status}</span> : null}
        </div>
      </section>

      <section className="receive-grid">
        <div className="thread-list">
          <div className="tabs"><span className="active">Mailboxes {filteredMailboxes.length}</span></div>
          <div className="receive-search">
            <input placeholder="Search address or content" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter") void runSearch();
            }} />
            <button className="secondary-button" onClick={runSearch}>Search</button>
          </div>
          {filteredMailboxes.map((mailbox) => (
            <button className={mailbox.recipient === selectedRecipient ? "thread-item active" : "thread-item"} key={mailbox.recipient} onClick={() => setSelectedRecipient(mailbox.recipient)}>
              <span className="avatar-dot">@</span>
              <strong>{mailbox.recipient}</strong>
              <span>{mailbox.message_count} messages</span>
              <small>{new Date(mailbox.last_received_at).toLocaleString()}</small>
            </button>
          ))}
          {filteredMailboxes.length === 0 ? <p className="muted receive-empty">No received mailboxes yet.</p> : null}
        </div>

        <div className="conversation">
          <div className="conversation-header">
            <div>
              <h2>{selectedRecipient || "All received mail"}</h2>
              <p>{messages.length} messages collected by the Worker</p>
            </div>
            {selectedRecipient ? <button className="secondary-button" onClick={() => setSelectedRecipient("")}>Show all</button> : null}
          </div>
          <div className="receive-message-list">
            {messages.map((message) => (
              <article className="message-card receive-message" key={message.id}>
                <div className="mini-row">
                  <strong>{message.subject || "No subject"}</strong>
                  <span>{new Date(message.created_at).toLocaleString()}</span>
                </div>
                <div className="mini-row">
                  <span>From {message.sender}</span>
                  <span>To {message.recipient || "unknown"}</span>
                </div>
                <pre>{message.body_text || "No plain text body."}</pre>
                <Link to={localizedPath(locale, `/inbox/${message.id}`)}>Open detail</Link>
              </article>
            ))}
            {messages.length === 0 ? <p className="muted">No messages match this query.</p> : null}
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}
