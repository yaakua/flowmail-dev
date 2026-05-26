import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AppShell, localizedPath, useLocale } from "../components/AppShell";
import { EmptyState } from "../components/Workflow";
import { api } from "../lib/api";
import { t, translateStatus } from "../i18n";

export default function FollowUp() {
  const locale = useLocale();
  const [tasks, setTasks] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    Promise.all([api<any[]>("/api/v1/followups"), api<any>("/api/v1/dashboard/summary")]).then(([nextTasks, nextSummary]) => {
      setTasks(nextTasks);
      setSummary(nextSummary);
    });
  }, []);

  const rows = tasks.length > 0 ? tasks : [];
  const aside = (
    <div className="stack">
      <section className="side-card">
        <h2>{t(locale, "followUpInsights")}</h2>
        <div className="insight-row"><strong>{summary?.pendingDrafts ?? 0}</strong><span>{t(locale, "aiDraftsWaiting")}</span></div>
        <div className="insight-row"><strong>{summary?.replies ?? 0}</strong><span>{t(locale, "repliesCaptured")}</span></div>
        <div className="insight-row"><strong>{summary?.clicks ?? 0}</strong><span>{t(locale, "clicksBeforeReply")}</span></div>
      </section>
      <section className="side-card">
        <h2>{t(locale, "recommendedActions")}</h2>
        <Link to={localizedPath(locale, "/inbox")}>{t(locale, "reviewReplyInbox")}</Link>
        <Link to={localizedPath(locale, "/campaigns")}>{t(locale, "finishCampaignApproval")}</Link>
        <Link to={localizedPath(locale, "/contacts")}>{t(locale, "checkSuppressedContacts")}</Link>
      </section>
      <section className="side-card">
        <h2>{t(locale, "tips")}</h2>
        <p className="muted">{t(locale, "followUpTips")}</p>
      </section>
    </div>
  );

  return (
    <AppShell aside={aside}>
      <section className="page-heading page-heading-row">
        <div>
          <h1>{t(locale, "followUpTitle")}</h1>
          <p>{t(locale, "followUpLead")}</p>
        </div>
        <Link className="button-link" to={localizedPath(locale, "/inbox")}>{t(locale, "reviewReplyInbox")}</Link>
      </section>
      <section className="metric-row metric-row-4 compact-metrics">
        <div className="metric-card"><span>{t(locale, "peopleToFollowUp")}</span><strong>{rows.length || summary?.pendingDrafts || 0}</strong><small>{t(locale, "peopleToFollowUpNote")}</small></div>
        <div className="metric-card"><span>{t(locale, "highIntent")}</span><strong>{summary?.replies ?? 0}</strong><small>{t(locale, "highIntentNote")}</small></div>
        <div className="metric-card"><span>{t(locale, "replied")}</span><strong>{summary?.replies ?? 0}</strong><small>{t(locale, "repliedNote")}</small></div>
        <div className="metric-card"><span>{t(locale, "converted")}</span><strong>{summary?.clicks ?? 0}</strong><small>{t(locale, "convertedNote")}</small></div>
      </section>
      <section className="panel">
        <div className="panel-title-row">
          <h2>{t(locale, "recommendedActions")}</h2>
          <span className="muted">{t(locale, "totalRecords", { count: rows.length })}</span>
        </div>
        {rows.length === 0 ? <EmptyState title={t(locale, "noFollowUpsTitle")} body={t(locale, "noFollowUpsBody")} /> : (
          <table>
            <thead><tr><th>{t(locale, "priority")}</th><th>{t(locale, "contactTask")}</th><th>{t(locale, "intent")}</th><th>{t(locale, "lastCampaign")}</th><th>{t(locale, "status")}</th><th>{t(locale, "nextBestAction")}</th></tr></thead>
            <tbody>
              {rows.map((task) => (
                <tr key={`${task.type}-${task.id}`}>
                  <td><span className="tag">{translateStatus(locale, task.priority)}</span></td>
                  <td><Link to={localizedPath(locale, task.href)}><strong>{localizeTaskTitle(locale, task.title)}</strong></Link><br /><span className="muted">{task.type === "campaign" ? t(locale, "contactTaskTypeCampaign") : t(locale, "contactTaskTypeReply")}</span></td>
                  <td>{t(locale, "high")}</td>
                  <td>{t(locale, "lifecycleCampaign")}</td>
                  <td><span className="soft-pill">{t(locale, "needsReview")}</span></td>
                  <td><Link className="secondary-link" to={localizedPath(locale, task.href)}>{t(locale, "openTask")}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </AppShell>
  );
}

function localizeTaskTitle(locale: ReturnType<typeof useLocale>, title: string) {
  const prefix = "Finish campaign: ";
  if (locale === "zh-CN" && title.startsWith(prefix)) {
    const name = title.slice(prefix.length);
    return t(locale, "finishCampaignTask", { name: name === t("en", "campaignDefaultGoal") ? t(locale, "campaignDefaultGoal") : name });
  }
  return title;
}
