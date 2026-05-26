import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AppShell, localizedPath, useLocale } from "../components/AppShell";
import { api } from "../lib/api";
import { t, translateStatus } from "../i18n";
import { MetricCard } from "../components/Workflow";

const PAGE_SIZE = 25;

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
  email_send_count?: number | null;
  email_sent_count?: number | null;
  email_failed_count?: number | null;
  last_email_sent_at?: string | null;
};

type ContactsPage = {
  items: Contact[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export default function Contacts() {
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ContactsPage>({
    items: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    totalPages: 1
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isCurrent = true;
    async function loadContacts() {
      setIsLoading(true);
      setError("");
      try {
        const nextData = await api<ContactsPage>(`/api/v1/contacts?page=${page}&pageSize=${PAGE_SIZE}`);
        if (!isCurrent) return;
        setData(nextData);
        if (nextData.page !== page) setPage(nextData.page);
      } catch (loadError) {
        if (!isCurrent) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    }
    loadContacts();
    return () => {
      isCurrent = false;
    };
  }, [page]);

  const activeOnPage = data.items.filter((contact) => contactStatus(contact) === "active").length;
  const suppressedOnPage = data.items.filter((contact) => contactStatus(contact) !== "active").length;

  return (
    <AppShell>
      <section className="page-heading page-heading-row">
        <div>
          <h1>{t(locale, "allContacts")}</h1>
          <p>{t(locale, "contactListLead")}</p>
        </div>
        <Link className="button-link" to={localizedPath(locale, "/contacts/import")}>{t(locale, "importContacts")}</Link>
      </section>

      <section className="metric-row metric-row-4 compact-metrics">
        <MetricCard label={t(locale, "totalContacts")} value={data.total} />
        <MetricCard label={t(locale, "contactRowsOnPage")} value={data.items.length} note={t(locale, "showingContacts", { count: data.items.length })} />
        <MetricCard label={t(locale, "active")} value={activeOnPage} note={t(locale, "currentPage")} />
        <MetricCard label={t(locale, "suppressed")} value={suppressedOnPage} note={t(locale, "currentPage")} />
      </section>

      <section className="panel">
        <div className="panel-title-row">
          <h2>{t(locale, "contacts")}</h2>
          <span className="muted">{t(locale, "contactPagination", { page: data.page, totalPages: data.totalPages, total: data.total })}</span>
        </div>

        {error ? <p className="form-status error" role="alert">{error}</p> : null}
        {isLoading ? <p className="muted">{t(locale, "loading")}</p> : null}

        <div className="table-scroll">
          <table className="contact-table">
            <thead>
              <tr>
                <th>{t(locale, "contact")}</th>
                <th>{t(locale, "company")}</th>
                <th>{t(locale, "source")}</th>
                <th>{t(locale, "consentSource")}</th>
                <th>{t(locale, "sendAttempts")}</th>
                <th>{t(locale, "sent")}</th>
                <th>{t(locale, "failed")}</th>
                <th>{t(locale, "status")}</th>
                <th>{t(locale, "createdAt")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((contact) => (
                <tr key={contact.id}>
                  <td>
                    <Link to={localizedPath(locale, `/contacts/${contact.id}`)}><strong>{displayContactName(contact)}</strong></Link>
                    <br />
                    <span className="muted">{contact.email}</span>
                  </td>
                  <td>{contact.company || "-"}</td>
                  <td>{contact.source || "-"}</td>
                  <td>{contact.consent_source || contact.consent_status || "-"}</td>
                  <td>{contact.email_send_count ?? 0}</td>
                  <td>{contact.email_sent_count ?? 0}</td>
                  <td>{contact.email_failed_count ?? 0}</td>
                  <td><span className="soft-pill">{translateStatus(locale, contactStatus(contact))}</span></td>
                  <td>{formatDate(contact.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!isLoading && data.items.length === 0 ? <p className="muted">{t(locale, "noData")}</p> : null}

        <div className="pagination-row">
          <button className="secondary-button" disabled={data.page <= 1 || isLoading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            {t(locale, "previousStep")}
          </button>
          <span className="muted">{t(locale, "contactPaginationShort", { page: data.page, totalPages: data.totalPages })}</span>
          <button className="secondary-button" disabled={data.page >= data.totalPages || isLoading} onClick={() => setPage((current) => current + 1)}>
            {t(locale, "nextStep")}
          </button>
        </div>
      </section>
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

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}
