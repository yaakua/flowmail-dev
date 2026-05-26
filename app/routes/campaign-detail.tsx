import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { AppShell, useLocale } from "../components/AppShell";
import { api } from "../lib/api";
import { t, translateStatus } from "../i18n";
import { appendComplianceFooter, htmlToText, renderTemplate } from "@flowmail/email-core";
import { templateVariablesForDisplay } from "../lib/templateVariables";

export default function CampaignDetail() {
  const locale = useLocale();
  const params = useParams();
  const [data, setData] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [batchSize, setBatchSize] = useState(50);
  const [message, setMessage] = useState("");
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testRecipients, setTestRecipients] = useState("");
  const [testError, setTestError] = useState("");
  const [testBusy, setTestBusy] = useState(false);

  async function load() {
    const [nextData, nextPreview] = await Promise.all([
      api<any>(`/api/v1/campaigns/${params.campaignId}`),
      api<any>(`/api/v1/campaigns/${params.campaignId}/preview-contact`)
    ]);
    setData(nextData);
    setPreview(nextPreview);
  }

  useEffect(() => {
    load();
  }, [params.campaignId]);

  useEffect(() => {
    const available = data?.audience?.sendableCount ?? 0;
    if (available > 0) setBatchSize((current) => clampBatchSize(current, available));
  }, [data?.audience?.sendableCount]);

  async function saveTemplate() {
    await api(`/api/v1/campaigns/${params.campaignId}/template`, {
      method: "PUT",
      body: JSON.stringify({
        subject: data.template.subject,
        html_body: data.template.html_body,
        text_body: htmlToText(data.template.html_body)
      })
    });
    setMessage(t(locale, "templateSaved"));
    await load();
  }

  async function sendCampaignTestEmail() {
    const parsedRecipients = parseRecipientInput(testRecipients);
    if (parsedRecipients.valid.length === 0) {
      setTestError(t(locale, "campaignTestRecipientsRequired"));
      return;
    }
    if (parsedRecipients.invalid.length > 0) {
      setTestError(t(locale, "campaignTestInvalidRecipients", { emails: parsedRecipients.invalid.join(", ") }));
      return;
    }

    setTestBusy(true);
    setTestError("");
    try {
      const result = await api<{ count: number; sent: Array<{ to: string; messageId?: string }> }>(`/api/v1/campaigns/${params.campaignId}/test-email`, {
        method: "POST",
        body: JSON.stringify({
          recipients: parsedRecipients.valid,
          subject: data.template.subject,
          html_body: data.template.html_body,
          text_body: htmlToText(data.template.html_body)
        })
      });
      setMessage(t(locale, "campaignTestEmailSent", { count: result.count, recipients: result.sent.map((item) => item.to).join(", ") }));
      setTestModalOpen(false);
      setTestRecipients("");
      await load();
    } catch (error) {
      setTestError(error instanceof Error ? error.message : t(locale, "campaignTestEmailFailed"));
    } finally {
      setTestBusy(false);
    }
  }

  if (!data) return <AppShell><p className="muted">{t(locale, "loading")}</p></AppShell>;
  const { campaign, template } = data;
  const variables = templateVariablesForDisplay(template.variables_json);
  const availableRecipients = data.audience?.sendableCount ?? 0;
  const selectedBatchSize = availableRecipients > 0 ? clampBatchSize(batchSize, availableRecipients) : 1;
  const sendPath = `send?limit=${selectedBatchSize}`;
  const previewValues = buildPreviewValues(preview?.contact, data.product?.name);
  const previewSubject = renderTemplate(template.subject, previewValues);
  const previewHtml = appendComplianceFooter(
    renderTemplate(template.html_body, previewValues),
    previewValues.unsubscribe_url
  );

  return (
    <AppShell>
      <section className="page-heading page-heading-row">
        <div>
          <p className="eyebrow">{t(locale, "templateLibraryTitle")}</p>
          <h1>{campaign.name}</h1>
          <p>{t(locale, "templateLibraryLead")}</p>
        </div>
        <div className="row-actions flush">
          <button className="secondary-button" onClick={() => {
            setTestError("");
            setTestModalOpen(true);
          }}>{t(locale, "testCampaignEmail")}</button>
          <button className="secondary-button" onClick={saveTemplate}>{t(locale, "saveDraft")}</button>
        </div>
      </section>
      <section className="campaign-edit-grid">
        <div className="panel editor-panel">
          <div className="panel-title-row">
            <h2>{t(locale, "emailTemplate")}</h2>
            <span className="tag">{translateStatus(locale, campaign.status)}</span>
          </div>
          <div className="form-grid">
            <div className="wide-field">
              <label>{t(locale, "subject")}</label>
              <input value={template.subject} onChange={(event) => setData({ ...data, template: { ...template, subject: event.target.value } })} />
            </div>
            <div className="wide-field">
              <label>{t(locale, "emailBodyHtml")}</label>
              <div className="editor-toolbar">
                <span>Paragraph</span><span>B</span><span>I</span><span>Link</span><span>{t(locale, "variables")}</span>
              </div>
              <textarea className="email-editor" value={template.html_body} onChange={(event) => setData({ ...data, template: { ...template, html_body: event.target.value } })} />
            </div>
          </div>
          {message ? <p className="muted">{message}</p> : null}
        </div>
        <div className="stack">
          <section className="panel batch-builder-panel">
            <h2>{t(locale, "generateBatchTitle")}</h2>
            <p className="muted">{t(locale, "generateBatchBody")}</p>
            <label>
              {t(locale, "batchSize")}
              <input
                min={1}
                max={Math.max(availableRecipients, 1)}
                type="number"
                value={selectedBatchSize}
                onChange={(event) => setBatchSize(Number(event.target.value || 1))}
              />
            </label>
            <div className="mini-row"><strong>{t(locale, "availableRecipients")}</strong><span>{availableRecipients}</span></div>
            <div className="mini-row"><strong>{t(locale, "alreadySkipped")}</strong><span>{data.audience?.alreadyIncludedCount ?? 0}</span></div>
            <div className="mini-row"><strong>{t(locale, "failedCanRetry")}</strong><span>{data.audience?.failedCount ?? 0}</span></div>
            <Link className={availableRecipients > 0 ? "button-link" : "button-link disabled-link"} to={availableRecipients > 0 ? sendPath : "#"}>{t(locale, "generateBatch")}</Link>
          </section>
          <section className="panel">
            <h2>{t(locale, "variables")}</h2>
            <p className="muted">{t(locale, "variablesHelp")}</p>
            <div className="chip-cloud">
              {(variables.length ? variables : ["full_name"]).map((name) => <span className="soft-pill" key={name}>{`{{ ${name} }}`}</span>)}
            </div>
          </section>
          <section className="panel">
            <h2>{t(locale, "emailPreview")}</h2>
            <div className="email-preview">
              <strong>{previewSubject}</strong>
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
          </section>
        </div>
      </section>
      {testModalOpen ? (
        <div className="modal-backdrop">
          <div className="modal campaign-test-modal" role="dialog" aria-modal="true" aria-labelledby="campaign-test-title">
            <div className="modal-title-row">
              <h2 id="campaign-test-title">{t(locale, "testCampaignEmail")}</h2>
              <button className="icon-button" aria-label={t(locale, "close")} onClick={() => setTestModalOpen(false)}>&times;</button>
            </div>
            <p className="muted">{t(locale, "campaignTestEmailBody")}</p>
            <form onSubmit={(event) => {
              event.preventDefault();
              void sendCampaignTestEmail();
            }}>
              <label htmlFor="campaign-test-recipients">{t(locale, "testRecipients")}</label>
              <textarea
                id="campaign-test-recipients"
                className="campaign-test-input"
                placeholder="you@example.com, teammate@example.com"
                value={testRecipients}
                onChange={(event) => setTestRecipients(event.target.value)}
              />
              <span className="field-note">{t(locale, "campaignTestRecipientsHelp")}</span>
              {testError ? <p className="form-status error" role="alert">{testError}</p> : null}
              <div className="row-actions">
                <button type="button" className="secondary-button" onClick={() => setTestModalOpen(false)}>{t(locale, "cancel")}</button>
                <button disabled={testBusy}>{testBusy ? t(locale, "sendingTestEmail") : t(locale, "sendTestEmail")}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

function clampBatchSize(value: number, available: number) {
  const normalized = Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.max(1, Math.min(normalized, Math.max(available, 1)));
}

function buildPreviewValues(contact: any, productName: string | null | undefined) {
  const firstName = contact?.first_name ?? "Preview";
  const lastName = contact?.last_name ?? "Contact";
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim() || "Preview Contact";
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return {
    email: contact?.email ?? "preview@example.com",
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    company: contact?.company ?? productName ?? "",
    unsubscribe_url: `${origin}/unsubscribe/preview`
  };
}

function parseRecipientInput(input: string) {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  input
    .split(/[\s,;，；]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .forEach((email) => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        invalid.push(email);
        return;
      }
      if (!seen.has(email)) {
        seen.add(email);
        valid.push(email);
      }
    });
  return { valid, invalid };
}
