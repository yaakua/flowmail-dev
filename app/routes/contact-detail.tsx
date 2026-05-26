import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { AppShell, localizedPath, useLocale } from "../components/AppShell";
import { api } from "../lib/api";
import { t, translateStatus, type Locale } from "../i18n";
import { MetricCard } from "../components/Workflow";

type Contact = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  source?: string | null;
  consent_status?: string | null;
  consent_source?: string | null;
  suppression_reason?: string | null;
  unsubscribed_at?: string | null;
  bounced_at?: string | null;
  created_at?: string | null;
};

type ContactSend = {
  id: string;
  campaign_id?: string | null;
  send_run_id?: string | null;
  recipient_id?: string | null;
  status: string;
  subject: string;
  html_body: string;
  text_body: string;
  message_id?: string | null;
  failure_reason?: string | null;
  sent_at?: string | null;
  failed_at?: string | null;
  created_at: string;
  campaign_name?: string | null;
  send_run_created_at?: string | null;
};

type ContactDetailResponse = {
  contact: Contact;
  stats: {
    emailSendCount: number;
    emailSentCount: number;
    emailFailedCount: number;
    lastEmailSentAt: string | null;
  };
  sends: ContactSend[];
};

export default function ContactDetail() {
  const locale = useLocale();
  const params = useParams();
  const [data, setData] = useState<ContactDetailResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setError("");
        setData(await api<ContactDetailResponse>(`/api/v1/contacts/${params.contactId}`));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    }
    load();
  }, [params.contactId]);

  const contact = data?.contact;
  const stats = data?.stats;
  const sends = data?.sends ?? [];

  return (
    <AppShell>
      <section className="page-heading page-heading-row">
        <div>
          <p className="eyebrow">{t(locale, "contactDetail")}</p>
          <h1>{contact ? displayContactName(contact) : t(locale, "contactDetail")}</h1>
          <p>{contact?.email ?? t(locale, "loading")}</p>
        </div>
        <Link className="secondary-link" to={localizedPath(locale, "/contacts")}>{t(locale, "backToContacts")}</Link>
      </section>

      {error ? <p className="form-status error" role="alert">{error}</p> : null}
      {!data && !error ? <p className="muted">{t(locale, "loading")}</p> : null}

      {contact && stats ? (
        <>
          <section className="metric-row metric-row-4 compact-metrics">
            <MetricCard label={t(locale, "sendAttempts")} value={stats.emailSendCount} />
            <MetricCard label={t(locale, "sent")} value={stats.emailSentCount} />
            <MetricCard label={t(locale, "failed")} value={stats.emailFailedCount} />
            <MetricCard label={t(locale, "lastEmailSent")} value={formatDate(locale, stats.lastEmailSentAt)} />
          </section>

          <section className="panel">
            <div className="panel-title-row">
              <h2>{t(locale, "basicInformation")}</h2>
              <span className="soft-pill">{translateStatus(locale, contactStatus(contact))}</span>
            </div>
            <div className="detail-grid">
              <div><strong>{t(locale, "company")}</strong><span>{contact.company || "-"}</span></div>
              <div><strong>{t(locale, "source")}</strong><span>{contact.source || "-"}</span></div>
              <div><strong>{t(locale, "consentSource")}</strong><span>{contact.consent_source || contact.consent_status || "-"}</span></div>
              <div><strong>{t(locale, "createdAt")}</strong><span>{formatDate(locale, contact.created_at)}</span></div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-title-row">
              <h2>{t(locale, "emailSendHistory")}</h2>
              <span className="muted">{t(locale, "totalRecords", { count: sends.length })}</span>
            </div>
            {sends.length === 0 ? <p className="muted">{t(locale, "noSendHistory")}</p> : null}
            {sends.length > 0 ? (
              <div className="table-scroll">
                <table className="contact-send-table">
                  <thead>
                    <tr>
                      <th>{t(locale, "subject")}</th>
                      <th>{t(locale, "campaign")}</th>
                      <th>{t(locale, "sendRuns")}</th>
                      <th>{t(locale, "status")}</th>
                      <th>{t(locale, "emailContent")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sends.map((send) => (
                      <tr key={send.id}>
                        <td>
                          <strong>{send.subject}</strong>
                          <br />
                          <span className="muted">{statusTimeLabel(locale, send)}</span>
                        </td>
                        <td>
                          {send.campaign_id ? (
                            <Link to={localizedPath(locale, `/campaigns/${send.campaign_id}`)}>{send.campaign_name || send.campaign_id}</Link>
                          ) : "-"}
                        </td>
                        <td>
                          <span className="mono-cell">{send.send_run_id || "-"}</span>
                          {send.send_run_created_at ? <><br /><span className="muted">{formatDate(locale, send.send_run_created_at)}</span></> : null}
                        </td>
                        <td>
                          <span className={statusClass(send.status)}>{translateStatus(locale, send.status)}</span>
                          {send.message_id ? <><br /><span className="mono-cell">{send.message_id}</span></> : null}
                          {send.failure_reason ? <><br /><span className="error-cell">{send.failure_reason}</span></> : null}
                        </td>
                        <td>
                          <details className="send-content-details">
                            <summary>{t(locale, "viewEmailContent")}</summary>
                            <pre>{send.text_body || htmlToPlain(send.html_body)}</pre>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </AppShell>
  );
}

function displayContactName(contact: Contact) {
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim();
  return name || contact.email;
}

function contactStatus(contact: Contact) {
  return contact.suppression_reason || (contact.unsubscribed_at ? "unsubscribed" : contact.bounced_at ? "bounced" : "active");
}

function statusClass(status: string) {
  if (status === "failed") return "status-chip error";
  if (status === "queued" || status === "sending") return "status-chip warning";
  if (status === "sent") return "status-chip ok";
  return "status-chip";
}

function statusTimeLabel(locale: Locale, send: ContactSend) {
  if (send.failed_at) return `${t(locale, "failedAt")}: ${formatDate(locale, send.failed_at)}`;
  if (send.sent_at) return `${t(locale, "sentAt")}: ${formatDate(locale, send.sent_at)}`;
  return `${t(locale, "queuedAt")}: ${formatDate(locale, send.created_at)}`;
}

function formatDate(locale: Locale, value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function htmlToPlain(html: string) {
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
