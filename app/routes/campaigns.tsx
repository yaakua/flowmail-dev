import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { AppShell, localizedPath, useLocale } from "../components/AppShell";
import { api } from "../lib/api";
import { t, translateStatus } from "../i18n";
import { MetricCard } from "../components/Workflow";

export default function Campaigns() {
  const locale = useLocale();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [goal, setGoal] = useState(t(locale, "campaignDefaultGoal"));
  const [busy, setBusy] = useState(false);

  async function load() {
    setCampaigns(await api<any[]>("/api/v1/campaigns"));
  }

  useEffect(() => {
    load();
  }, []);

  async function createCampaign() {
    setBusy(true);
    try {
      const result = await api<any>("/api/v1/campaigns/draft", { method: "POST", body: JSON.stringify({ goal }) });
      navigate(localizedPath(locale, `/campaigns/${result.campaign.id}`));
    } finally {
      setBusy(false);
    }
  }

  const totals = {
    recipients: campaigns.reduce((sum, item) => sum + Number(item.recipient_count ?? 0), 0),
    replies: campaigns.reduce((sum, item) => sum + Number(item.reply_count ?? 0), 0),
    clicks: campaigns.reduce((sum, item) => sum + Number(item.click_count ?? 0), 0),
    unsubscribes: campaigns.reduce((sum, item) => sum + Number(item.unsubscribe_count ?? 0), 0)
  };
  const aside = (
    <div className="stack">
      <section className="side-card">
        <h2>{t(locale, "campaignWorkflowReady")}</h2>
        <div className="status-list compact-status-list">
          <div className="status-row"><span className="dot ok" /><div><strong>{t(locale, "createCampaign")}</strong><p>{t(locale, "draftWorkflowBody")}</p></div></div>
          <div className="status-row"><span className="dot ok" /><div><strong>{t(locale, "createBatch")}</strong><p>{t(locale, "batchReviewBody")}</p></div></div>
          <div className="status-row"><span className="dot ok" /><div><strong>{t(locale, "sendRecords")}</strong><p>{t(locale, "sendRecordLead")}</p></div></div>
        </div>
      </section>
    </div>
  );

  return (
    <AppShell aside={aside}>
      <section className="page-heading page-heading-row">
        <div>
          <h1>{t(locale, "campaignWorkbenchTitle")}</h1>
          <p>{t(locale, "campaignWorkbenchLead")}</p>
        </div>
      </section>
      <section className="panel goal-lab">
        <div className="panel-title-row">
          <div>
            <p className="eyebrow">{t(locale, "campaignActivity")}</p>
            <h2>{t(locale, "createCampaign")}</h2>
          </div>
        </div>
        <label>{t(locale, "lifecycleGoal")}</label>
        <textarea value={goal} onChange={(event) => setGoal(event.target.value)} />
        <div className="row-actions">
          <button disabled={busy} onClick={createCampaign}>{busy ? t(locale, "generating") : t(locale, "generate")}</button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-title-row">
          <h2>{t(locale, "campaignActivity")}</h2>
          <span className="muted">{t(locale, "totalRecords", { count: campaigns.length })}</span>
        </div>
        <div className="metric-row metric-row-4">
          <MetricCard label={t(locale, "campaigns")} value={campaigns.length} />
          <MetricCard label={t(locale, "sendRuns")} value={campaigns.reduce((sum, item) => sum + Number(item.send_run_count ?? 0), 0)} />
          <MetricCard label={t(locale, "recipients")} value={totals.recipients} />
          <MetricCard label={t(locale, "replies")} value={totals.replies} note={t(locale, "primaryQualitySignal")} />
        </div>
        <table>
          <thead><tr><th>{t(locale, "name")}</th><th>{t(locale, "status")}</th><th>{t(locale, "sendRuns")}</th><th>{t(locale, "recipients")}</th><th>{t(locale, "replies")}</th><th>{t(locale, "nextAction")}</th></tr></thead>
          <tbody>
            {campaigns.map((campaign) => (
              <tr key={campaign.id}>
                <td><Link to={localizedPath(locale, `/campaigns/${campaign.id}`)}>{localizeCampaignName(locale, campaign.name)}</Link></td>
                <td><span className="tag">{translateStatus(locale, campaign.status)}</span></td>
                <td>{campaign.send_run_count ?? 0}</td>
                <td>{campaign.recipient_count ?? 0}</td>
                <td>{campaign.reply_count ?? 0}</td>
                <td><Link className="secondary-link compact-link inline-row-link" to={localizedPath(locale, nextCampaignPath(campaign))}>{campaign.status === "draft" ? t(locale, "continueEditing") : t(locale, "openSendStep")}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {campaigns.length === 0 ? <p className="muted">{t(locale, "noData")}</p> : null}
      </section>
    </AppShell>
  );
}

function localizeCampaignName(locale: ReturnType<typeof useLocale>, name: string) {
  return locale === "zh-CN" && name === t("en", "campaignDefaultGoal") ? t(locale, "campaignDefaultGoal") : name;
}

function nextCampaignPath(campaign: any) {
  return campaign.status === "draft" ? `/campaigns/${campaign.id}` : `/campaigns/${campaign.id}/send`;
}
