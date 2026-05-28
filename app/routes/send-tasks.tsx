import { type FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AppShell, localizedPath, useLocale } from "../components/AppShell";
import { EmptyState, MetricCard } from "../components/Workflow";
import { api } from "../lib/api";
import { t, translateStatus, type Locale } from "../i18n";

const PAGE_SIZE = 25;
const filters = ["all", "queued", "sending", "sent", "failed", "suppressed", "unsubscribed"] as const;

type SendTaskFilter = (typeof filters)[number];

type SendTask = {
  id: string;
  campaign_id: string;
  contact_id: string;
  email: string;
  status: string;
  message_id: string | null;
  sent_at: string | null;
  failed_at: string | null;
  unsubscribed_at?: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  campaign_name: string;
  campaign_status?: string;
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
};

type SendTaskResponse = {
  tasks: SendTask[];
  summary: Record<string, number>;
  recentFailures: SendTask[];
  runs: SendRun[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type SendRun = {
  id: string;
  campaign_id: string;
  campaign_name?: string;
  status: string;
  selected_count: number;
  queued_count: number;
  sent_count: number;
  failed_count: number;
  skipped_sent_count: number;
  skipped_suppressed_count: number;
  unsubscribed_count?: number;
  suppressed_count?: number;
  click_count?: number;
  unsubscribe_event_count?: number;
  created_at: string;
  completed_at: string | null;
};

export default function SendTasks() {
  const locale = useLocale();
  const [params, setParams] = useSearchParams();
  const campaignId = params.get("campaignId");
  const selectedRunId = params.get("sendRunId") ?? "";
  const keyword = params.get("q") ?? "";
  const activeFilter = normalizeFilter(params.get("status"));
  const [searchInput, setSearchInput] = useState(keyword);
  const [data, setData] = useState<SendTaskResponse | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setIsLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE)
      });
      if (campaignId) query.set("campaignId", campaignId);
      if (selectedRunId) query.set("sendRunId", selectedRunId);
      if (activeFilter !== "all") query.set("status", activeFilter);
      if (keyword) query.set("q", keyword);
      const nextData = await api<SendTaskResponse>(`/api/v1/send-tasks?${query.toString()}`);
      setData(nextData);
      if (nextData.page !== page) setPage(nextData.page);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [campaignId, activeFilter, selectedRunId, keyword, page]);

  useEffect(() => {
    setPage(1);
  }, [campaignId, activeFilter, selectedRunId, keyword]);

  useEffect(() => {
    setSearchInput(keyword);
  }, [keyword]);

  const tasks = data?.tasks ?? [];
  const summary = data?.summary ?? {};
  const total = Number(Object.values(summary).reduce((sum, count) => sum + Number(count), 0));
  const open = Number(summary.queued ?? 0) + Number(summary.sending ?? 0);
  const failures = Number(summary.failed ?? 0);
  const unsubscribed = Number(summary.unsubscribed ?? 0);
  const runs = data?.runs ?? [];
  const selectedRun = runs.find((run) => run.id === selectedRunId);
  const pageTotal = data?.total ?? 0;
  const showingRunDetails = Boolean(selectedRunId);

  function updateQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  }

  function updateStatusFilter(nextFilter: SendTaskFilter) {
    setPage(1);
    updateQuery({ status: nextFilter === "all" ? null : nextFilter });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    updateQuery({ q: searchInput.trim() || null });
  }

  async function retryRun(runId: string) {
    await api(`/api/v1/send-runs/${runId}/retry`, { method: "POST", body: "{}" });
    await load();
  }

  async function recoverRun(runId: string) {
    if (!window.confirm(t(locale, "recoverSendingRunConfirm"))) return;
    await api(`/api/v1/send-runs/${runId}/recover`, { method: "POST", body: "{}" });
    await load();
  }

  async function retryTask(taskId: string) {
    await api(`/api/v1/send-tasks/${taskId}/retry`, { method: "POST", body: "{}" });
    await load();
  }

  async function deleteRun(runId: string) {
    if (!window.confirm(t(locale, "deleteSendRunConfirm"))) return;
    await api(`/api/v1/send-runs/${runId}`, { method: "DELETE" });
    if (selectedRunId === runId) updateQuery({ sendRunId: null, status: null, q: null });
    await load();
  }

  async function deleteFailedTask(taskId: string) {
    if (!window.confirm(t(locale, "deleteFailedRecordConfirm"))) return;
    await api(`/api/v1/send-tasks/${taskId}`, { method: "DELETE" });
    await load();
  }

  const aside = (
    <div className="stack">
      <section className="side-card">
        <h2>{t(locale, "sendTaskStatusSummary")}</h2>
        <div className="setup-progress compact-progress">
          <div className="setup-step-mini complete">
            <span>{total}</span>
            <strong>{t(locale, "allSendTasks")}</strong>
          </div>
          {filters.filter((filter) => filter !== "all").map((filter) => (
            <div className="setup-step-mini" key={filter}>
              <span>{summary[filter] ?? 0}</span>
              <strong>{translateStatus(locale, filter)}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className="side-card">
        <h2>{t(locale, "recentErrors")}</h2>
        {(data?.recentFailures ?? []).length === 0 ? <p className="muted">{t(locale, "noRecentErrors")}</p> : null}
        {(data?.recentFailures ?? []).map((task) => (
          <div className="mini-row" key={task.id}>
            <strong>{task.email}</strong>
            <span>{task.failure_reason}</span>
          </div>
        ))}
      </section>
      <section className="side-card">
        <h2>{t(locale, "quickActions")}</h2>
        <Link to={localizedPath(locale, "/clicks")}>{t(locale, "clickAnalytics")}</Link>
        <Link to={localizedPath(locale, "/campaigns")}>{t(locale, "viewCampaign")}</Link>
      </section>
    </div>
  );

  return (
    <AppShell aside={aside}>
      <section className="page-heading page-heading-row">
        <div>
          <p className="eyebrow">{t(locale, "sendRuns")}</p>
          <h1>{t(locale, "sendRecordTitle")}</h1>
          <p>{t(locale, "sendRecordLead")}</p>
          {showingRunDetails ? (
            <p className="muted">
              {selectedRun ? t(locale, "viewingSendRun", { date: formatDate(locale, selectedRun.created_at) }) : selectedRunId}
            </p>
          ) : null}
        </div>
        <div className="row-actions flush-actions">
          {showingRunDetails ? <Link className="secondary-link" to={sendRunListPath(locale, campaignId)}>{t(locale, "backToSendRuns")}</Link> : null}
          <button className="secondary-button" onClick={load}>{t(locale, "reload")}</button>
        </div>
      </section>

      <section className="metric-row compact-metrics">
        <MetricCard label={showingRunDetails ? t(locale, "selectedRecipients") : t(locale, "sendRuns")} value={showingRunDetails ? selectedRun?.selected_count ?? pageTotal : runs.length} />
        <MetricCard label={t(locale, "queued")} value={open} note={t(locale, "queueLimitedSending")} />
        <MetricCard label={t(locale, "sent")} value={summary.sent ?? 0} note={t(locale, "messageId")} />
        <MetricCard label={t(locale, "failed")} value={failures} />
        <MetricCard label={t(locale, "unsubscribed")} value={unsubscribed} />
      </section>

      {showingRunDetails ? (
        <section className="panel send-task-panel">
          <div className="panel-title-row">
            <h2>{t(locale, "sendRunDetails")}</h2>
            <span className="muted">{t(locale, "sendTaskPagination", { page: data?.page ?? page, totalPages: data?.totalPages ?? 1, total: pageTotal })}</span>
          </div>

          <div className="send-task-controls">
            <label>
              {t(locale, "status")}
              <select value={activeFilter} onChange={(event) => updateStatusFilter(normalizeFilter(event.target.value))}>
                {filters.map((filter) => (
                  <option key={filter} value={filter}>
                    {filter === "all" ? t(locale, "allStatus") : translateStatus(locale, filter)}
                  </option>
                ))}
              </select>
            </label>
            <form className="send-task-search" onSubmit={submitSearch}>
              <label htmlFor="send-task-search">{t(locale, "searchSendTasks")}</label>
              <div className="send-task-search-row">
                <input
                  id="send-task-search"
                  placeholder={t(locale, "searchSendTasksPlaceholder")}
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
                <button type="submit" className="secondary-button">{t(locale, "filter")}</button>
                {keyword ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setSearchInput("");
                      setPage(1);
                      updateQuery({ q: null });
                    }}
                  >
                    {t(locale, "clear")}
                  </button>
                ) : null}
              </div>
            </form>
          </div>

          {error ? <p className="form-status error" role="alert">{error}</p> : null}
          {isLoading ? <p className="muted">{t(locale, "loading")}</p> : null}

          {!isLoading && tasks.length === 0 ? (
            <EmptyState title={t(locale, "noSendTasksTitle")} body={t(locale, "noSendTasksBody")} />
          ) : (
            <div className="table-scroll">
              <table className="send-task-table">
                <thead>
                  <tr>
                    <th>{t(locale, "recipient")}</th>
                    <th>{t(locale, "campaign")}</th>
                    <th>{t(locale, "status")}</th>
                    <th>{t(locale, "taskError")}</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => (
                    <tr key={task.id}>
                      <td>
                        <strong>{displayRecipient(task)}</strong>
                        <br />
                        <span className="muted">{task.email}</span>
                      </td>
                      <td>
                        <Link to={localizedPath(locale, `/campaigns/${task.campaign_id}`)}>{task.campaign_name}</Link>
                        {task.company ? <><br /><span className="muted">{task.company}</span></> : null}
                      </td>
                      <td>
                        <span className={statusClass(task.status)}>{translateStatus(locale, task.status)}</span>
                        <br />
                        <span className="mono-cell">{task.message_id || "-"}</span>
                        <br />
                        <span className="muted">{statusTimeLabel(locale, task)}</span>
                      </td>
                      <td className="error-cell">
                        {task.failure_reason || t(locale, "noError")}
                        {task.status === "failed" ? (
                          <>
                            <br />
                            <button className="secondary-button compact-action" onClick={() => retryTask(task.id)}>{t(locale, "retryThisRecord")}</button>
                            <button className="danger-button compact-action" onClick={() => deleteFailedTask(task.id)}>{t(locale, "deleteFailedRecord")}</button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="pagination-row">
            <button className="secondary-button" disabled={(data?.page ?? page) <= 1 || isLoading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              {t(locale, "previousStep")}
            </button>
            <span className="muted">{t(locale, "sendTaskPaginationShort", { page: data?.page ?? page, totalPages: data?.totalPages ?? 1 })}</span>
            <button className="secondary-button" disabled={(data?.page ?? page) >= (data?.totalPages ?? 1) || isLoading} onClick={() => setPage((current) => current + 1)}>
              {t(locale, "nextStep")}
            </button>
          </div>
        </section>
      ) : (
        <section className="panel send-run-list-panel">
          <div className="panel-title-row">
            <h2>{t(locale, "sendRuns")}</h2>
            <span className="muted">{t(locale, "totalRecords", { count: runs.length })}</span>
          </div>

          {error ? <p className="form-status error" role="alert">{error}</p> : null}
          {isLoading ? <p className="muted">{t(locale, "loading")}</p> : null}

          {!isLoading && runs.length === 0 ? (
            <EmptyState title={t(locale, "noSendRuns")} body={t(locale, "noSendTasksBody")} />
          ) : (
            <div className="table-scroll">
              <table className="send-run-table">
                <thead>
                  <tr>
                    <th>{t(locale, "batchCreatedAt")}</th>
                    <th>{t(locale, "campaign")}</th>
                    <th>{t(locale, "status")}</th>
                    <th>{t(locale, "deliveryProgress")}</th>
                    <th>{t(locale, "clicks")}</th>
                    <th>{t(locale, "nextAction")}</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <strong>{formatDate(locale, run.created_at)}</strong>
                        <br />
                        <span className="mono-cell" title={run.id}>{run.id}</span>
                      </td>
                      <td>
                        <Link to={localizedPath(locale, `/campaigns/${run.campaign_id}`)}>{run.campaign_name || run.campaign_id}</Link>
                      </td>
                      <td><span className={statusClass(run.status)}>{translateStatus(locale, run.status)}</span></td>
                      <td><SendRunMetrics locale={locale} run={run} /></td>
                      <td>
                        <strong>{run.click_count ?? 0}</strong>
                        <br />
                        <span className="muted">{t(locale, "trackedClicks")}</span>
                      </td>
                      <td>
                        <Link className="secondary-link compact-link inline-row-link" to={sendRunDetailPath(locale, campaignId, run.id)}>{t(locale, "openSendRun")}</Link>
                        {run.queued_count > 0 ? <button className="secondary-button compact-action" onClick={() => recoverRun(run.id)}>{t(locale, "recoverSendingRun")}</button> : null}
                        {run.failed_count > 0 ? <button className="secondary-button compact-action" onClick={() => retryRun(run.id)}>{t(locale, "retryFailed")}</button> : null}
                        <button className="danger-button compact-action" onClick={() => deleteRun(run.id)}>{t(locale, "deleteSendRun")}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </AppShell>
  );
}

function SendRunMetrics({ locale, run }: { locale: Locale; run: SendRun }) {
  return (
    <div className="send-run-metrics">
      <span><strong>{run.selected_count}</strong>{t(locale, "selectedRecipients")}</span>
      <span><strong>{run.queued_count}</strong>{t(locale, "queued")}</span>
      <span><strong>{run.sent_count}</strong>{t(locale, "sent")}</span>
      <span><strong>{run.failed_count}</strong>{t(locale, "failed")}</span>
      <span><strong>{run.unsubscribed_count ?? 0}</strong>{t(locale, "unsubscribed")}</span>
    </div>
  );
}

function displayRecipient(task: SendTask) {
  const name = [task.first_name, task.last_name].filter(Boolean).join(" ").trim();
  return name || task.email;
}

function normalizeFilter(value?: string | null): SendTaskFilter {
  return filters.includes(value as SendTaskFilter) ? value as SendTaskFilter : "all";
}

function statusClass(status: string) {
  if (status === "failed") return "status-chip error";
  if (status === "queued" || status === "sending" || status === "suppressed" || status === "unsubscribed") return "status-chip warning";
  if (status === "sent" || status === "completed") return "status-chip ok";
  return "status-chip";
}

function statusTimeLabel(locale: Locale, task: SendTask) {
  if (task.unsubscribed_at) return `${t(locale, "unsubscribedAt")}: ${formatDate(locale, task.unsubscribed_at)}`;
  if (task.failed_at) return `${t(locale, "failedAt")}: ${formatDate(locale, task.failed_at)}`;
  if (task.sent_at) return `${t(locale, "sentAt")}: ${formatDate(locale, task.sent_at)}`;
  if (task.status === "suppressed") return `${t(locale, "lastUpdated")}: ${formatDate(locale, task.updated_at)}`;
  return `${t(locale, "queuedAt")}: ${formatDate(locale, task.created_at)}`;
}

function sendRunListPath(locale: Locale, campaignId?: string | null) {
  const query = new URLSearchParams();
  if (campaignId) query.set("campaignId", campaignId);
  const suffix = query.toString();
  return localizedPath(locale, suffix ? `/send-tasks?${suffix}` : "/send-tasks");
}

function sendRunDetailPath(locale: Locale, campaignId: string | null, sendRunId: string) {
  const query = new URLSearchParams({ sendRunId });
  if (campaignId) query.set("campaignId", campaignId);
  return localizedPath(locale, `/send-tasks?${query.toString()}`);
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
