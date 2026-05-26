import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { AppShell, localizedPath, useLocale } from "../components/AppShell";
import { ConfirmButton } from "../components/ConfirmButton";
import { api } from "../lib/api";
import { t } from "../i18n";

export default function ReplyDetail() {
  const locale = useLocale();
  const params = useParams();
  const [data, setData] = useState<any>(null);
  const [replyText, setReplyText] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setData(await api<any>(`/api/v1/inbox/${params.messageId}`));
  }

  useEffect(() => {
    load();
  }, [params.messageId]);

  async function updateStatus(status: string) {
    await api(`/api/v1/inbox/${params.messageId}/status`, { method: "POST", body: JSON.stringify({ status }) });
    await load();
  }

  async function sendManualReply() {
    if (!replyText.trim()) return;
    await api(`/api/v1/inbox/${params.messageId}/reply`, { method: "POST", body: JSON.stringify({ text: replyText }) });
    setReplyText("");
    setMessage(t(locale, "replySent"));
    await load();
  }

  if (!data) return <AppShell><p className="muted">Loading</p></AppShell>;
  const action = data.actions?.[0];
  const output = action ? JSON.parse(action.output_json || "{}") : null;

  const aside = (
    <div className="stack">
      <section className="side-card">
        <h2>Customer information</h2>
        <div className="mini-row"><strong>Email</strong><span>{data.message.sender}</span></div>
        <div className="mini-row"><strong>Classification</strong><span>{data.message.classification}</span></div>
        <div className="mini-row"><strong>Status</strong><span>{data.message.status ?? "unreviewed"}</span></div>
      </section>
      <section className="side-card">
        <div className="panel-title-row"><h2>AI insight</h2><span className="tag">Beta</span></div>
        <div className="risk ok"><strong>Customer intent</strong><span>Use the reply content and campaign context before sending any AI draft.</span></div>
        {output ? <div className="draft"><p>{output.draft}</p></div> : <p className="muted">No draft yet.</p>}
        {action ? <ConfirmButton locale={locale} label={t(locale, "sendReply")} disabled={action.status !== "draft"} onConfirm={async () => {
          await api(`/api/v1/agent-actions/${action.id}/send`, { method: "POST", body: "{}" });
          await load();
        }} /> : null}
      </section>
      <section className="side-card">
        <h2>Actions</h2>
        <button className="secondary-button" onClick={() => updateStatus("resolved")}>Mark resolved</button>
        <button className="secondary-button" onClick={() => updateStatus("needs_reply")}>Needs reply</button>
        <button className="danger-button" onClick={() => updateStatus("unsubscribed")}>Unsubscribe sender</button>
      </section>
    </div>
  );

  return (
    <AppShell aside={aside}>
      <section className="page-heading page-heading-row">
        <div>
          <p className="eyebrow">Campaigns · Reply analysis · Reply detail</p>
          <h1>{data.message.subject || "User reply"}</h1>
          <p>{data.message.sender} · <span className="tag">{data.message.classification}</span></p>
        </div>
        <div className="row-actions flush">
          <Link className="secondary-link" to={localizedPath(locale, "/inbox/analysis")}>Back to analysis</Link>
          <button className="secondary-button" onClick={() => updateStatus("resolved")}>Mark processed</button>
        </div>
      </section>
      <section className="panel reply-profile">
        <div className="reply-identity">
          <span className="profile-avatar">{data.message.sender?.slice(0, 1).toUpperCase() || "U"}</span>
          <div>
            <strong>{data.message.sender_name ?? data.message.sender}</strong>
            <span>{data.message.sender}</span>
          </div>
        </div>
        <div className="reply-facts">
          <div><span>Campaign</span><strong>{data.message.campaign_name ?? "Lifecycle campaign"}</strong></div>
          <div><span>First reply</span><strong>{new Date(data.message.created_at).toLocaleString()}</strong></div>
          <div><span>Reply count</span><strong>{data.message.reply_count ?? 1}</strong></div>
        </div>
      </section>
      <section className="reply-detail-grid">
        <div className="panel message-body conversation-thread">
          <div className="tabs page-tabs"><span className="active">Conversation</span><span>Activity</span></div>
          <article className="message-card operator-message">
            <strong>You</strong>
            <p className="muted">Original campaign message</p>
            <p>Thanks for trying the product. We are checking whether the setup path is clear enough for your team.</p>
          </article>
          <article className="message-card customer-message">
            <strong>{data.message.sender}</strong>
            <pre>{data.message.body_text || "No plain text body."}</pre>
          </article>
          <div className="reply-compose">
            <textarea placeholder={`Reply to ${data.message.sender}...`} value={replyText} onChange={(event) => setReplyText(event.target.value)} />
            <div className="row-actions">
              <ConfirmButton locale={locale} label={t(locale, "sendReply")} disabled={!replyText.trim()} onConfirm={sendManualReply} />
              <button className="secondary-button" onClick={() => setReplyText("")}>Clear</button>
              {message ? <span className="muted">{message}</span> : null}
            </div>
          </div>
        </div>
        <div className="stack">
          <section className="panel">
            <h2>Activity overview</h2>
            <div className="mini-row"><strong>Email delivered</strong><span>{new Date(data.message.created_at).toLocaleString()}</span></div>
            <div className="mini-row"><strong>First reply</strong><span>{new Date(data.message.created_at).toLocaleString()}</span></div>
            <div className="mini-row"><strong>Average reply time</strong><span>Manual review required</span></div>
          </section>
          <section className="panel">
            <h2>Tags</h2>
            <div className="chip-cloud">
              <span className="soft-pill">{data.message.classification}</span>
              <span className="soft-pill">needs-review</span>
              <span className="soft-pill">follow-up</span>
            </div>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
