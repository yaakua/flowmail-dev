import { Link, useParams } from "react-router";
import { useEffect, useState } from "react";
import { AppShell, localizedPath, useLocale } from "../components/AppShell";
import { Stepper } from "../components/Workflow";
import { api } from "../lib/api";
import { t, translateStatus } from "../i18n";

export default function CampaignPreview() {
  const locale = useLocale();
  const params = useParams();
  const [data, setData] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      api<any>(`/api/v1/campaigns/${params.campaignId}`),
      api<any>(`/api/v1/campaigns/${params.campaignId}/preview-contact`)
    ]).then(([nextData, nextPreview]) => {
      setData(nextData);
      setPreview(nextPreview);
    });
  }, [params.campaignId]);

  if (!data) return <AppShell><p className="muted">{t(locale, "loading")}</p></AppShell>;

  return (
    <AppShell aside={<PreviewAside data={data} />}>
      <section className="page-heading page-heading-row">
        <div>
          <p className="eyebrow">{t(locale, "preview")}</p>
          <h1>{data.campaign.name}</h1>
          <p>{t(locale, "previewLead")}</p>
        </div>
        <div className="row-actions flush">
          <Link className="secondary-link" to={localizedPath(locale, `/campaigns/${data.campaign.id}`)}>{t(locale, "backToEdit")}</Link>
          <Link className="button-link" to={localizedPath(locale, `/campaigns/${data.campaign.id}/send`)}>{t(locale, "continueToSend")}</Link>
        </div>
      </section>
      <Stepper current={4} />
      <div className="tabs page-tabs"><span className="active">{t(locale, "desktopPreview")}</span><span>{t(locale, "mobilePreview")}</span><span>{t(locale, "plainText")}</span></div>
      <section className="preview-frame">
        <div className="email-paper">
          <p className="muted">{t(locale, "subject")}</p>
          <h2>{preview?.rendered?.subject ?? data.template.subject}</h2>
          {preview?.contact ? <p className="muted">{t(locale, "renderedFor", { email: preview.contact.email })}</p> : <p className="muted">{t(locale, "renderedWithPreviewValues")}</p>}
          <div dangerouslySetInnerHTML={{ __html: preview?.rendered?.html ?? data.template.html_body }} />
        </div>
      </section>
    </AppShell>
  );
}

function PreviewAside({ data }: { data: any }) {
  const locale = useLocale();
  return (
    <div className="stack">
      <section className="side-card">
        <h2>{t(locale, "emailSummary")}</h2>
        <div className="mini-row"><strong>{t(locale, "type")}</strong><span>{data.template.type}</span></div>
        <div className="mini-row"><strong>{t(locale, "status")}</strong><span>{translateStatus(locale, data.campaign.status)}</span></div>
        <div className="mini-row"><strong>{t(locale, "variables")}</strong><span>{parseVariables(data.template.variables_json).join(", ") || t(locale, "noVariables")}</span></div>
      </section>
      <section className="side-card">
        <h2>{t(locale, "renderChecks")}</h2>
        <div className="status-row"><span className="dot ok" /><div><strong>{t(locale, "subjectLine")}</strong><p>{t(locale, "subjectLineBody")}</p></div></div>
        <div className="status-row"><span className="dot ok" /><div><strong>{t(locale, "unsubscribePath")}</strong><p>{t(locale, "unsubscribePathBody")}</p></div></div>
        <div className="status-row"><span className="dot ok" /><div><strong>{t(locale, "humanReview")}</strong><p>{t(locale, "humanReviewBody")}</p></div></div>
      </section>
    </div>
  );
}

function parseVariables(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
