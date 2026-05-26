import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AppShell, localizedPath, useLocale } from "../components/AppShell";
import { MetricCard } from "../components/Workflow";
import { api } from "../lib/api";
import { t, translateStatus } from "../i18n";

export default function ReplyAnalysis() {
  const locale = useLocale();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api<any>("/api/v1/inbox/analysis").then(setData);
  }, []);

  const classifications = data?.classifications ?? [];
  const total = classifications.reduce((sum: number, row: any) => sum + Number(row.count), 0);
  const recent = data?.recent ?? [];
  const primary = classifications[0];

  return (
    <AppShell aside={<AnalysisAside locale={locale} classifications={classifications} total={total} primary={primary} />}>
      <section className="page-heading page-heading-row">
        <div>
          <p className="eyebrow">{t(locale, "replyAnalysisEyebrow")}</p>
          <h1>{t(locale, "understandFeedback")}</h1>
          <p>{t(locale, "understandFeedbackLead")}</p>
        </div>
        <div className="row-actions flush">
          <Link className="secondary-link" to={localizedPath(locale, "/campaigns")}>{t(locale, "viewCampaign")}</Link>
          <button>{t(locale, "exportData")}</button>
        </div>
      </section>
      <div className="tabs page-tabs"><span>{t(locale, "overview")}</span><span className="active">{t(locale, "replyList")}</span><span>{t(locale, "topicAnalysis")}</span><span>{t(locale, "timeline")}</span></div>
      <section className="metric-row metric-row-4">
          <MetricCard label={t(locale, "replies")} value={total} />
          {classifications.slice(0, 3).map((row: any) => <MetricCard key={row.classification} label={row.classification} value={row.count} />)}
      </section>
      <section className="panel">
        <div className="panel-title-row">
          <div>
            <h2>{t(locale, "recentReplies")}</h2>
            <p className="muted">{t(locale, "recentRepliesBody")}</p>
          </div>
          <div className="filter-bar inline-filter">
            <input placeholder={t(locale, "searchContactContent")} />
            <button className="secondary-button">{t(locale, "allStatus")}</button>
            <button className="secondary-button">{t(locale, "latest")}</button>
          </div>
        </div>
        <table>
          <thead><tr><th>{t(locale, "sender")}</th><th>{t(locale, "subject")}</th><th>{t(locale, "classification")}</th><th>{t(locale, "status")}</th><th></th></tr></thead>
          <tbody>
            {recent.map((message: any) => (
              <tr key={message.id}>
                <td><strong>{message.sender}</strong><br /><span className="muted">{message.sender_name ?? "Contact"}</span></td>
                <td>{message.subject}</td>
                <td><span className="tag">{message.classification}</span></td>
                <td><span className="soft-pill">{translateStatus(locale, message.status ?? "needs_review")}</span></td>
                <td><Link to={localizedPath(locale, `/inbox/${message.id}`)}>{t(locale, "openDetail")}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {recent.length === 0 ? <p className="muted">{t(locale, "noData")}</p> : null}
      </section>
      <section className="panel trend-panel">
        <div className="panel-title-row">
          <h2>{t(locale, "recentReplyTrend")}</h2>
          <button className="secondary-button">{t(locale, "byDay")}</button>
        </div>
        {total > 0 ? <div className="trend-line" aria-hidden="true"><span /><span /><span /><span /><span /><span /></div> : <div className="empty-trend">{t(locale, "noReplyTrend")}</div>}
      </section>
    </AppShell>
  );
}

function AnalysisAside({ locale, classifications, total, primary }: { locale: ReturnType<typeof useLocale>; classifications: any[]; total: number; primary: any }) {
  return (
    <div className="stack">
      <section className="side-card">
        <h2>{t(locale, "replyTopicDistribution")}</h2>
        <div className={total > 0 ? "donut-card" : "donut-card empty"}>
          <strong>{total}</strong>
          <span>{t(locale, "totalReplies")}</span>
        </div>
        {classifications.slice(0, 6).map((row) => (
          <div className="mini-row" key={row.classification}>
            <strong>{row.classification}</strong>
            <span>{row.count} {t(locale, "replies")}</span>
          </div>
        ))}
      </section>
      <section className="side-card">
        <h2>{t(locale, "aiReplyInsight")}</h2>
        <div className="risk ok"><strong>{t(locale, "highIntentSignal")}</strong><span>{primary ? `${primary.count} ${t(locale, "replies")} · ${primary.classification}` : t(locale, "noSignalYet")}</span></div>
        <div className="risk warning"><strong>{t(locale, "followUpFocus")}</strong><span>{t(locale, "followUpFocusBody")}</span></div>
      </section>
      <section className="side-card">
        <h2>{t(locale, "quickActions")}</h2>
        <Link to={localizedPath(locale, "/inbox")}>{t(locale, "viewAllReplies")}</Link>
        <Link to={localizedPath(locale, "/follow-up")}>{t(locale, "createFollowUpTasks")}</Link>
      </section>
    </div>
  );
}
