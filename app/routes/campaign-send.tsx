import { Link, useParams, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import { AppShell, localizedPath, useLocale } from "../components/AppShell";
import { ConfirmButton } from "../components/ConfirmButton";
import { MetricCard, Stepper } from "../components/Workflow";
import { api } from "../lib/api";
import { t, translateStatus } from "../i18n";

export default function CampaignSend() {
  const locale = useLocale();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [limit, setLimit] = useState(() => normalizeLimit(searchParams.get("limit"), 50));
  const [message, setMessage] = useState("");

  async function load() {
    const [nextData, nextPreview] = await Promise.all([
      api<any>(`/api/v1/campaigns/${params.campaignId}`),
      api<any>(`/api/v1/campaigns/${params.campaignId}/send-preview`, { method: "POST", body: JSON.stringify({ limit }) })
    ]);
    setData(nextData);
    setPreview(nextPreview);
  }

  useEffect(() => {
    load();
  }, [params.campaignId]);

  async function recalculate() {
    setPreview(await api<any>(`/api/v1/campaigns/${params.campaignId}/send-preview`, { method: "POST", body: JSON.stringify({ limit }) }));
  }

  async function createRun() {
    try {
      await api<any>(`/api/v1/campaigns/${params.campaignId}/send-runs`, { method: "POST", body: JSON.stringify({ limit }) });
      setMessage(t(locale, "sendRunQueued"));
      await load();
    } catch (error) {
      try {
        const parsed = JSON.parse(error instanceof Error ? error.message : "");
        setMessage(parsed.error ?? t(locale, "blockedBeforeSend"));
      } catch {
        setMessage(error instanceof Error ? error.message : t(locale, "blockedBeforeSend"));
      }
    }
  }

  if (!data) return <AppShell><p className="muted">{t(locale, "loading")}</p></AppShell>;
  const compliance = preview?.compliance;
  const selectedCount = preview?.selectedCount ?? 0;
  const canSend = Boolean(compliance?.ok && selectedCount > 0);

  return (
    <AppShell aside={<SendRisk preview={preview} data={data} />}>
      <section className="page-heading page-heading-row">
        <div>
          <p className="eyebrow">{t(locale, "createBatch")}</p>
          <h1>{data.campaign.name}</h1>
          <p>{t(locale, "sendLead")}</p>
        </div>
        <Link className="secondary-link" to={localizedPath(locale, `/campaigns/${data.campaign.id}/preview`)}>{t(locale, "backToPreview")}</Link>
      </section>
      <Stepper current={5} />
      <section className="status-banner">
        <strong>{canSend ? t(locale, "readyForApproval") : t(locale, "blockedBeforeSend")}</strong>
        <span>{selectedCount > 0 ? t(locale, "sendStatusBody") : t(locale, "noNewRecipients")}</span>
      </section>
      <section className="panel send-approval-panel">
        <div className="metric-row">
          <MetricCard label={t(locale, "selectedRecipients")} value={selectedCount} note={t(locale, "calculatedAfterConsent")} />
          <MetricCard label={t(locale, "alreadySkipped")} value={preview?.audience?.alreadyIncludedCount ?? 0} />
          <MetricCard label={t(locale, "skippedSuppressedRecipients")} value={preview?.audience?.suppressedCount ?? 0} />
          <MetricCard label={t(locale, "compliance")} value={compliance?.ok ? t(locale, "ready") : t(locale, "blocked")} />
        </div>
        <div className="approval-grid">
          <div className="send-settings">
            <label>
              {t(locale, "batchSize")}
              <input type="number" min={1} max={1000} value={limit} onChange={(event) => setLimit(Number(event.target.value || 1))} />
            </label>
            <div><strong>{t(locale, "sendMethod")}</strong><span>{t(locale, "queueLimitedSending")}</span></div>
            <div><strong>{t(locale, "availableRecipients")}</strong><span>{preview?.audience?.sendableCount ?? 0}</span></div>
            <div><strong>{t(locale, "failedCanRetry")}</strong><span>{preview?.audience?.failedCount ?? 0}</span></div>
          </div>
          <div className="approval-checklist">
            <label><input type="checkbox" readOnly checked={selectedCount > 0} /> {t(locale, "selectedRecipients")}: {selectedCount}</label>
            <label><input type="checkbox" readOnly checked={Boolean(compliance?.ok)} /> {t(locale, "complianceChecksPassing")}</label>
            <label><input type="checkbox" readOnly checked /> {t(locale, "humanApprovalRequired")}</label>
          </div>
        </div>
        <div className="row-actions">
          <button className="secondary-button" onClick={recalculate}>{t(locale, "recalculate")}</button>
          <ConfirmButton locale={locale} label={t(locale, "startSendRun")} disabled={!canSend} onConfirm={createRun} />
          <Link className="secondary-link" to={localizedPath(locale, `/send-tasks?campaignId=${data.campaign.id}`)}>{t(locale, "viewSendRecords")}</Link>
          {message ? <span className="muted">{message}</span> : null}
        </div>
      </section>
    </AppShell>
  );
}

function SendRisk({ preview, data }: { preview: any; data: any }) {
  const locale = useLocale();
  return (
    <div className="stack">
      <section className="side-card">
        <h2>{t(locale, "batchPreview")}</h2>
        <div className="mini-row"><strong>{t(locale, "selectedRecipients")}</strong><span>{preview?.selectedCount ?? 0}</span></div>
        <div className="mini-row"><strong>{t(locale, "availableRecipients")}</strong><span>{preview?.audience?.sendableCount ?? 0}</span></div>
        <div className="mini-row"><strong>{t(locale, "alreadySkipped")}</strong><span>{preview?.audience?.alreadyIncludedCount ?? 0}</span></div>
      </section>
      <section className="side-card">
        <h2>{t(locale, "sendRiskPrompts")}</h2>
        {(preview?.compliance?.findings ?? []).map((finding: any) => (
          <div className={`risk ${finding.severity}`} key={finding.code}>
            <strong>{finding.code}</strong>
            <span>{finding.message}</span>
          </div>
        ))}
        {preview?.compliance?.ok ? <div className="risk ok"><strong>{t(locale, "protectionEnabled")}</strong><span>{t(locale, "protectionEnabledBody")}</span></div> : null}
      </section>
      <section className="side-card">
        <h2>{t(locale, "latestSendRuns")}</h2>
        {(data.sendRuns ?? []).slice(0, 4).map((run: any) => (
          <div className="mini-row" key={run.id}>
            <strong>{translateRunStatus(locale, run.status)}</strong>
            <span>{run.sent_count ?? 0}/{run.selected_count ?? 0} {t(locale, "sent")}</span>
          </div>
        ))}
        {(data.sendRuns ?? []).length === 0 ? <p className="muted">{t(locale, "noSendRuns")}</p> : null}
      </section>
    </div>
  );
}

function translateRunStatus(locale: ReturnType<typeof useLocale>, status: string) {
  return translateStatus(locale, status);
}

function normalizeLimit(value: string | null, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), 1000));
}
