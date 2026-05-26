import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AppShell, localizedPath, useLocale } from "../components/AppShell";
import { EmptyState, MetricCard } from "../components/Workflow";
import { api } from "../lib/api";
import { t, translateStatus, type Locale } from "../i18n";

type SendTask = {
  id: string;
  campaign_id: string;
  contact_id: string;
  email: string;
  status: string;
  message_id: string | null;
  sent_at: string | null;
  failed_at: string | null;
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
};

type SendRun = {
  id: string;
  campaign_id: string;
  status: string;
  selected_count: number;
  queued_count: number;
  sent_count: number;
  failed_count: number;
  skipped_sent_count: number;
  skipped_suppressed_count: number;
  created_at: string;
  completed_at: string | null;
};

const filters = ["all", "queued", "sent", "failed"] as const;

export default function SendTasks() {
  const locale = useLocale();
  const [params] = useSearchParams();
  const campaignId = params.get("campaignId");
  const [data, setData] = useState<SendTaskResponse | null>(null);
  const [activeFilter, setActiveFilter] = useState<(typeof filters)[number]>("all");

  async function load() {
    const query = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
    setData(await api<SendTaskResponse>(`/api/v1/send-tasks${query}`));
  }

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [campaignId]);

  const tasks = data?.tasks ?? [];
  const summary = data?.summary ?? {};
  const filteredTasks = useMemo(() => {
    if (activeFilter === "all") return tasks;
    return tasks.filter((task) => task.status === activeFilter);
  }, [tasks, activeFilter]);
  const total = tasks.length;
  const open = Number(summary.queued ?? 0) + Number(summary.sending ?? 0);
  const failures = Number(summary.failed ?? 0);
  const runs = data?.runs ?? [];

  async function retryRun(runId: string) {
    await api(`/api/v1/send-runs/${runId}/retry`, { method: "POST", body: "{}" });
    await load();
  }

  const aside = (
    <div className="stack">
      <section className="side-card">
        <h2>{t(locale, "sendTaskStatusSummary")}</h2>
        <div className="setup-progress compact-progress">
          {filters.map((filter) => (
            <button
              aria-pressed={activeFilter === filter}
              className={activeFilter === filter ? "setup-step-mini complete" : "setup-step-mini"}
              key={filter}
              onClick={() => setActiveFilter(filter)}
            >
              <span>{filter === "all" ? total : summary[filter] ?? 0}</span>
              <strong>{filter === "all" ? t(locale, "allSendTasks") : translateStatus(locale, filter)}</strong>
            </button>
          ))}
        </div>
      </section>
      <section className="side-card">
        <h2>{t(locale, "latestSendRuns")}</h2>
        {runs.length === 0 ? <p className="muted">{t(locale, "noSendRuns")}</p> : null}
        {runs.slice(0, 6).map((run) => (
          <div className="run-card" key={run.id}>
            <div className="mini-row"><strong>{translateStatus(locale, run.status)}</strong><span>{formatDate(locale, run.created_at)}</span></div>
            <div className="mini-row"><strong>{run.sent_count}/{run.selected_count}</strong><span>{t(locale, "sent")}</span></div>
            {run.failed_count > 0 ? <button className="secondary-button compact-action" onClick={() => retryRun(run.id)}>{t(locale, "retryFailed")}</button> : null}
          </div>
        ))}
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
    </div>
  );

  return (
    <AppShell aside={aside}>
      <section className="page-heading page-heading-row">
        <div>
          <p className="eyebrow">{t(locale, "sendRuns")}</p>
          <h1>{t(locale, "sendRecordTitle")}</h1>
          <p>{t(locale, "sendRecordLead")}</p>
        </div>
        <button className="secondary-button" onClick={load}>{t(locale, "reload")}</button>
      </section>

      <section className="metric-row metric-row-4 compact-metrics">
        <MetricCard label={t(locale, "sendRuns")} value={runs.length} />
        <MetricCard label={t(locale, "queued")} value={open} note={t(locale, "queueLimitedSending")} />
        <MetricCard label={t(locale, "sent")} value={summary.sent ?? 0} note={t(locale, "messageId")} />
        <MetricCard label={t(locale, "failed")} value={failures} />
      </section>

      <section className="panel send-task-panel">
        <div className="panel-title-row">
          <h2>{activeFilter === "all" ? t(locale, "allSendTasks") : translateStatus(locale, activeFilter)}</h2>
          <span className="muted">{t(locale, "totalRecords", { count: filteredTasks.length })}</span>
        </div>
        {filteredTasks.length === 0 ? (
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
                {filteredTasks.map((task) => (
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
                    <td className="error-cell">{task.failure_reason || t(locale, "noError")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function displayRecipient(task: SendTask) {
  const name = [task.first_name, task.last_name].filter(Boolean).join(" ").trim();
  return name || task.email;
}

function statusClass(status: string) {
  if (status === "failed") return "status-chip error";
  if (status === "queued" || status === "sending") return "status-chip warning";
  if (status === "sent") return "status-chip ok";
  return "status-chip";
}

function statusTimeLabel(locale: Locale, task: SendTask) {
  if (task.failed_at) return `${t(locale, "failedAt")}: ${formatDate(locale, task.failed_at)}`;
  if (task.sent_at) return `${t(locale, "sentAt")}: ${formatDate(locale, task.sent_at)}`;
  return `${t(locale, "queuedAt")}: ${formatDate(locale, task.created_at)}`;
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
