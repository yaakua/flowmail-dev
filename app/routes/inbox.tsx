import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { AppShell, localizedPath, useLocale } from "../components/AppShell";
import { ConfirmButton } from "../components/ConfirmButton";
import { api } from "../lib/api";
import { t, translateStatus } from "../i18n";

export default function Inbox() {
  const locale = useLocale();
  const [messages, setMessages] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [replyText, setReplyText] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");

  async function load() {
    const [inbox, agentActions] = await Promise.all([
      api<any[]>("/api/v1/inbox"),
      api<any[]>("/api/v1/agent-actions")
    ]);
    setMessages(inbox);
    setActions(agentActions);
    setSelectedId((current) => current || inbox[0]?.id || "");
  }

  useEffect(() => {
    load();
  }, []);

  const filteredMessages = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return messages;
    return messages.filter((message) => [message.sender, message.subject, message.body_text, message.classification].some((value) => String(value ?? "").toLowerCase().includes(query)));
  }, [messages, search]);
  const selected = useMemo(() => filteredMessages.find((message) => message.id === selectedId) ?? filteredMessages[0], [filteredMessages, selectedId]);
  const selectedAction = actions.find((action) => {
    try {
      return JSON.parse(action.input_json || "{}").inboundId === selected?.id;
    } catch {
      return false;
    }
  });

  async function sendManualReply() {
    if (!selected || !replyText.trim()) return;
    await api(`/api/v1/inbox/${selected.id}/reply`, {
      method: "POST",
      body: JSON.stringify({ text: replyText })
    });
    setReplyText("");
    setMessage(t(locale, "replySent"));
    await load();
  }

  const aside = (
    <div className="stack">
      <section className="side-card">
        <div className="panel-title-row"><h2>{t(locale, "aiAssistant")}</h2><span className="tag">{t(locale, "beta")}</span></div>
        {selected ? (
          <div className="analysis-box">
            <strong>{t(locale, "classification")}</strong>
            <span className="tag">{selected.classification}</span>
            <p>{selected.classification === "sales_intent" ? t(locale, "salesIntentHint") : t(locale, "selectedNeedsReview")}</p>
          </div>
        ) : <p className="muted">{t(locale, "noData")}</p>}
      </section>
      <section className="side-card">
        <h2>{t(locale, "suggestedReply")}</h2>
        {selectedAction ? (() => {
          const output = JSON.parse(selectedAction.output_json || "{}");
          return (
            <div className="draft" key={selectedAction.id}>
              <span className="tag">{selectedAction.status}</span>
              <p>{output.draft}</p>
              <ConfirmButton locale={locale} label={t(locale, "sendReply")} disabled={selectedAction.status !== "draft"} onConfirm={async () => {
                await api(`/api/v1/agent-actions/${selectedAction.id}/send`, { method: "POST", body: "{}" });
                await load();
              }} />
            </div>
          );
        })() : <p className="muted">{t(locale, "noData")}</p>}
      </section>
      <section className="side-card">
        <h2>{t(locale, "actions")}</h2>
        <Link to={localizedPath(locale, "/inbox/analysis")}>{t(locale, "replyAnalysis")}</Link>
      </section>
    </div>
  );

  return (
    <AppShell aside={aside}>
      <section className="page-heading page-heading-row">
        <div>
          <h1>{t(locale, "inbox")}</h1>
          <p>{t(locale, "inboxLead")}</p>
        </div>
        <div className="filter-bar inline-filter">
          <input placeholder={t(locale, "searchReplies")} value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
      </section>
      <section className="inbox-grid">
        <div className="thread-list">
          <div className="tabs"><span className="active">{t(locale, "all")} {filteredMessages.length}</span></div>
          {filteredMessages.map((message) => (
            <button className={message.id === selected?.id ? "thread-item active" : "thread-item"} key={message.id} onClick={() => setSelectedId(message.id)}>
              <span className="avatar-dot">{message.sender?.slice(0, 1).toUpperCase() || "U"}</span>
              <strong>{message.sender}</strong>
              <span>{message.subject || "No subject"}</span>
              <small>{translateStatus(locale, message.classification)}</small>
            </button>
          ))}
          {filteredMessages.length === 0 ? <p className="muted">{t(locale, "noData")}</p> : null}
        </div>
        <div className="conversation">
          {selected ? (
            <>
              <div className="conversation-header">
                <div>
                  <h2>{selected.subject || "User reply"}</h2>
                  <p>{selected.sender} · {new Date(selected.created_at).toLocaleString()}</p>
                </div>
                <Link className="secondary-link" to={localizedPath(locale, `/inbox/${selected.id}`)}>{t(locale, "openDetail")}</Link>
              </div>
              <article className="message-card">
                <strong>{selected.sender}</strong>
                <pre>{selected.body_text || "No plain text body."}</pre>
              </article>
              <div className="reply-box">
                <textarea placeholder={t(locale, "writeReply")} value={replyText} onChange={(event) => setReplyText(event.target.value)} />
                <div className="row-actions">
                  <ConfirmButton locale={locale} label={t(locale, "sendReply")} disabled={!replyText.trim()} onConfirm={sendManualReply} />
                  <button className="secondary-button" onClick={() => setReplyText("")}>{t(locale, "clear")}</button>
                  {message ? <span className="muted">{message}</span> : null}
                </div>
              </div>
            </>
          ) : <p className="muted">{t(locale, "noData")}</p>}
        </div>
      </section>
    </AppShell>
  );
}
