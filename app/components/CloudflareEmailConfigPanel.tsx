import { useEffect, useMemo, useState } from "react";
import { t, translateStatus, type Locale } from "../i18n";
import { api } from "../lib/api";
import { useLocale } from "./AppShell";
import { Field, PanelTitle, type ProductSettings } from "./ProductSettingsForm";

type CloudflareEmailConfig = {
  zoneName?: string;
  workerName?: string;
  fromEmail?: string;
  replyToEmail?: string;
  tokenSaved?: boolean;
  tokenLast4?: string;
  updatedAt?: string;
  localSetupMode?: boolean;
};

type CloudflareCheck = {
  ok?: boolean;
  checks?: Array<{ name: string; ok: boolean; details: string }>;
  zone?: { id?: string; name?: string; status?: string };
  dns?: {
    mxRecords?: number;
    spfRecords?: number;
    dkimHints?: number;
    dmarcRecords?: number;
  };
  routing?: {
    enabled?: boolean;
    status?: string;
    replyToRule?: unknown;
  };
};

type CloudflareDiscovery = {
  ok: boolean;
  token?: { active?: boolean };
  zones?: Array<{ id: string; name: string; status?: string; accountId?: string; accountName?: string }>;
  selectedZone?: { id: string; name: string; status?: string; accountId?: string; accountName?: string } | null;
  workers?: Array<{ id?: string; name: string }>;
  permissions?: Array<{ name: string; ok: boolean; details: string }>;
  missingPermissions?: string[];
  suggested?: {
    zoneName: string;
    workerName: string;
    fromEmail: string;
    replyToEmail: string;
  };
  warnings?: string[];
};

type FormState = {
  zoneName: string;
  sendingSubdomain: string;
  workerName: string;
  fromEmail: string;
  replyToEmail: string;
  token: string;
};

const CLOUDFLARE_API_TOKENS_URL = "https://dash.cloudflare.com/profile/api-tokens";
const FLOWMAIL_TOKEN_PERMISSIONS = [
  { key: "zone", type: "read" },
  { key: "dns", type: "read" },
  { key: "email_routing_rule", type: "read" },
  { key: "email_routing_rule", type: "edit" },
  { key: "email_sending", type: "edit" },
  { key: "workers_scripts", type: "read" }
];
const FLOWMAIL_TOKEN_TEMPLATE_URL = `${CLOUDFLARE_API_TOKENS_URL}?${new URLSearchParams({
  permissionGroupKeys: JSON.stringify(FLOWMAIL_TOKEN_PERMISSIONS),
  accountId: "*",
  zoneId: "all",
  name: "Flowmail Setup Token"
}).toString()}`;

export function CloudflareEmailConfigPanel({
  product,
  mode = "settings",
  onChanged
}: {
  product?: ProductSettings | null;
  mode?: "setup" | "settings";
  onChanged?: () => Promise<void> | void;
}) {
  const locale = useLocale();
  const [config, setConfig] = useState<CloudflareEmailConfig | null>(null);
  const [form, setForm] = useState<FormState>(() => initialForm(product));
  const [checkResult, setCheckResult] = useState<CloudflareCheck | null>(null);
  const [discovery, setDiscovery] = useState<CloudflareDiscovery | null>(null);
  const [testTo, setTestTo] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [configStep, setConfigStep] = useState<1 | 2 | 3>(1);
  const [autoVerificationKey, setAutoVerificationKey] = useState("");

  const hasToken = Boolean(config?.tokenSaved);
  const tokenLabel = hasToken
    ? config?.tokenLast4
      ? t(locale, "savedTokenEnding", { last4: config.tokenLast4 })
      : t(locale, "savedToken")
    : t(locale, "noSavedToken");
  const hasDetectedConfig = Boolean(discovery?.suggested || config?.zoneName || hasToken);
  const tokenHasMissingPermissions = Boolean(discovery?.missingPermissions?.length);
  const tokenPermissionsReady = discovery
    ? Boolean(discovery.ok && !tokenHasMissingPermissions)
    : Boolean(hasToken && !form.token.trim());
  const canSaveConfig = Boolean(form.zoneName.trim() && form.workerName.trim() && form.fromEmail.trim());
  const canVerifyConfig = hasToken && canSaveConfig;
  const localizedHelp = useMemo(() => cloudflareHelp(locale), [locale]);
  const workerIsDetected = Boolean(discovery?.workers?.some((worker) => worker.name.toLowerCase() === form.workerName.toLowerCase()));
  const emailDomain = buildSendingDomain(form.zoneName, form.sendingSubdomain);
  const stepItems = [
    { id: 1, label: t(locale, hasToken ? "cloudflareStepTokenSavedTitle" : "cloudflareStepTokenTitle") },
    { id: 2, label: t(locale, hasToken ? "cloudflareStepCurrentConfigTitle" : "cloudflareStepConfigTitle") },
    { id: 3, label: t(locale, "cloudflareStepVerifyTitle") }
  ] as const;

  useEffect(() => {
    void loadConfig();
  }, []);

  useEffect(() => {
    if (!config) {
      setForm((current) => mergeProductFallback(current, product));
    }
  }, [config, product]);

  useEffect(() => {
    if (configStep !== 3 || !hasToken || !canSaveConfig || busy) return;
    const key = [config?.updatedAt, form.zoneName, form.workerName, form.fromEmail, form.replyToEmail].filter(Boolean).join("|");
    if (!key || autoVerificationKey === key) return;
    setAutoVerificationKey(key);
    void verifyCloudflareSetup();
  }, [autoVerificationKey, busy, canSaveConfig, config?.updatedAt, configStep, form.fromEmail, form.replyToEmail, form.workerName, form.zoneName, hasToken]);

  const dnsMetrics = useMemo(() => {
    if (!checkResult?.dns) return [];
    return [
      { label: "MX", value: checkResult.dns.mxRecords ?? 0 },
      { label: "SPF", value: checkResult.dns.spfRecords ?? 0 },
      { label: "DKIM hints", value: checkResult.dns.dkimHints ?? 0 },
      { label: "DMARC", value: checkResult.dns.dmarcRecords ?? 0 }
    ];
  }, [checkResult]);

  async function loadConfig() {
    setBusy("load");
    try {
      const nextConfig = await api<CloudflareEmailConfig>("/api/v1/cloudflare/email-config");
      setConfig(nextConfig);
      setForm({
        zoneName: nextConfig.zoneName || product?.sending_domain || domainFromEmail(product?.default_from_email) || "",
        sendingSubdomain: deriveSubdomainFromEmail(nextConfig.fromEmail || product?.default_from_email, nextConfig.zoneName || ""),
        workerName: nextConfig.workerName || "flowmail",
        fromEmail: nextConfig.fromEmail || product?.default_from_email || "",
        replyToEmail: nextConfig.fromEmail || product?.default_from_email || nextConfig.replyToEmail || product?.reply_to_email || "",
        token: ""
      });
      if (nextConfig.tokenSaved) {
        setConfigStep(2);
      }
      setMessage("");
    } catch (error) {
      setConfig(null);
      setForm((current) => mergeProductFallback(current, product));
      setMessage(readError(locale, error, t(locale, "cloudflareConfigUnavailable")));
    } finally {
      setBusy(null);
    }
  }

  async function saveConfig() {
    setBusy("save");
    setMessage("");
    try {
      const saved = await api<CloudflareEmailConfig>("/api/v1/cloudflare/email-config", {
        method: "PUT",
        body: JSON.stringify({
          zoneName: form.zoneName.trim(),
          workerName: form.workerName.trim() || "flowmail",
          fromEmail: form.fromEmail.trim(),
          replyToEmail: form.fromEmail.trim(),
          ...(form.token.trim() ? { token: form.token.trim() } : {})
        })
      });
      setConfig(saved);
      setForm((current) => ({ ...current, replyToEmail: current.fromEmail, token: "" }));
      setConfigStep(3);
      setMessage(t(locale, "cloudflareConfigSaved"));
      await onChanged?.();
    } catch (error) {
      setMessage(readError(locale, error, t(locale, "cloudflareConfigSaveFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function discoverConfig(zoneName = "") {
    const token = form.token.trim();
    if (!token) {
      setMessage(t(locale, "tokenRequiredBeforeDiscover"));
      return;
    }
    setBusy("discover");
    setMessage("");
    try {
      const result = await api<CloudflareDiscovery>("/api/v1/cloudflare/email-config/discover", {
        method: "POST",
        body: JSON.stringify({
          token,
          ...(zoneName.trim() ? { zoneName: zoneName.trim() } : {})
        })
      });
      applyDiscoveryResult(result);
    } catch (error) {
      setDiscovery(null);
      setMessage(readError(locale, error, t(locale, "cloudflareDiscoverFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function discoverSavedConfig(zoneName = "") {
    if (!hasToken) {
      setMessage(t(locale, "tokenRequiredBeforeDiscover"));
      return;
    }
    setBusy("discover-saved");
    setMessage("");
    try {
      const result = await api<CloudflareDiscovery>("/api/v1/cloudflare/email-config/discover-saved", {
        method: "POST",
        body: JSON.stringify({
          ...(zoneName.trim() ? { zoneName: zoneName.trim() } : {})
        })
      });
      applyDiscoveryResult(result);
    } catch (error) {
      setDiscovery(null);
      setMessage(readError(locale, error, t(locale, "cloudflareDiscoverFailed")));
    } finally {
      setBusy(null);
    }
  }

  function applyDiscoveryResult(result: CloudflareDiscovery) {
    const suggested = result.suggested;
    setDiscovery(result);
    if (suggested) {
      setForm((current) => ({
        ...current,
        zoneName: suggested.zoneName || current.zoneName,
        sendingSubdomain: reconcileSubdomainForZone(current.sendingSubdomain, suggested.zoneName || current.zoneName),
        workerName: suggested.workerName || current.workerName || "flowmail",
        ...resolveSenderEmails(current, suggested.zoneName || current.zoneName, reconcileSubdomainForZone(current.sendingSubdomain, suggested.zoneName || current.zoneName), {
          fromEmail: suggested.fromEmail
        })
      }));
    }
    const zoneCount = result.zones?.length ?? 0;
    setMessage(t(locale, result.ok ? "discoverySummary" : "discoveryPermissionSummary", {
      count: zoneCount,
      zoneWord: t(locale, zoneCount === 1 ? "zoneSingular" : "zonePlural"),
      countMissing: result.missingPermissions?.length ?? 0
    }));
    if (result.ok) setConfigStep(2);
  }

  async function selectZone(zoneName: string) {
    const zone = discovery?.zones?.find((candidate) => candidate.name === zoneName);
    const sendingSubdomain = reconcileSubdomainForZone(form.sendingSubdomain, zoneName);
    const emails = resolveSenderEmails(form, zoneName, sendingSubdomain);
    setForm((current) => ({
      ...current,
      zoneName,
      sendingSubdomain,
      ...emails
    }));
    setDiscovery((current) => current ? { ...current, selectedZone: zone ?? null } : current);
  }

  function updateZoneName(zoneName: string) {
    const sendingSubdomain = reconcileSubdomainForZone(form.sendingSubdomain, zoneName);
    const emails = resolveSenderEmails(form, zoneName, sendingSubdomain);
    setForm((current) => ({
      ...current,
      zoneName,
      sendingSubdomain,
      ...emails
    }));
    setDiscovery((current) => current ? { ...current, selectedZone: null } : current);
  }

  function updateSendingSubdomain(value: string) {
    const sendingSubdomain = normalizeSubdomain(value, form.zoneName);
    setForm((current) => ({
      ...current,
      sendingSubdomain,
      ...resolveSenderEmails(current, current.zoneName, sendingSubdomain)
    }));
  }

  async function verifyCloudflareSetup() {
    setBusy("verify");
    setMessage("");
    try {
      const checked = await api<CloudflareCheck>("/api/v1/cloudflare/email-config/check", { method: "POST" });
      const checks = checked.checks ?? [];
      const canApplyRoute = Boolean(
        checks.find((check) => check.name === "token")?.ok &&
        checks.find((check) => check.name === "zone")?.ok &&
        checks.find((check) => check.name === "emailRouting")?.ok &&
        !checks.find((check) => check.name === "replyToRoute")?.ok
      );
      if (canApplyRoute && !config?.localSetupMode) {
        const routed = await api<CloudflareCheck>("/api/v1/cloudflare/email-config/apply-routing", { method: "POST" });
        setCheckResult(routed?.checks ? routed : checked);
        setMessage((routed?.ok ?? false) ? t(locale, "cloudflareSetupReady") : t(locale, "cloudflareChecksNeedAttention"));
        await onChanged?.();
        return;
      }
      setCheckResult(checked);
      setMessage(checked.ok ? t(locale, "cloudflareSetupReady") : t(locale, "cloudflareChecksNeedAttention"));
    } catch (error) {
      setMessage(readError(locale, error, t(locale, "cloudflareCheckFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function deleteToken() {
    setBusy("delete-token");
    setMessage("");
    try {
      const nextConfig = await api<CloudflareEmailConfig>("/api/v1/cloudflare/email-config/token", { method: "DELETE" });
      setConfig(nextConfig);
      setForm((current) => ({ ...current, token: "" }));
      setDiscovery(null);
      setCheckResult(null);
      setConfigStep(1);
      setMessage(t(locale, "cloudflareTokenRemoved"));
      await onChanged?.();
    } catch (error) {
      setMessage(readError(locale, error, t(locale, "cloudflareTokenDeleteFailed")));
    } finally {
      setBusy(null);
    }
  }

  function startTokenReplacement() {
    setConfigStep(1);
    setMessage("");
  }

  async function sendTestEmail() {
    setBusy("test");
    setMessage("");
    try {
      const result = await api<{ to: string; messageId?: string; simulated?: boolean }>("/api/v1/setup/test-email", {
        method: "POST",
        body: JSON.stringify({ to: testTo.trim() || undefined })
      });
      setMessage(t(locale, result.simulated ? "testEmailLocalSent" : "testEmailQueued", { to: result.to, messageId: result.messageId || "-" }));
      await onChanged?.();
    } catch (error) {
      setMessage(readError(locale, error, t(locale, "testEmailFailed")));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="cloudflare-config-panel">
      <PanelTitle title={mode === "setup" ? `1. ${t(locale, "connectCloudflareEmail")}` : t(locale, "cloudflareEmailConfigTitle")} help={localizedHelp.cloudflareEmailConfig} />
      <p className="muted">
        {t(locale, hasToken ? "cloudflareConfiguredLead" : "cloudflareConfigLead")}
      </p>

      <div className="config-stepper" aria-label={t(locale, "cloudflareEmailConfigTitle")}>
        {stepItems.map((step) => (
          <button
            className={configStep === step.id ? "config-step active" : configStep > step.id ? "config-step complete" : "config-step"}
            disabled={step.id === 2 && !hasDetectedConfig || step.id === 3 && !canVerifyConfig}
            key={step.id}
            onClick={() => setConfigStep(step.id as 1 | 2 | 3)}
          >
            <span>{step.id}</span>
            <strong>{step.label}</strong>
          </button>
        ))}
      </div>

      {configStep === 1 ? (
        <div className="config-step-content">
          <div className="cloudflare-token-guide">
            <strong>{t(locale, hasToken ? "cloudflareReplaceTokenTitle" : "cloudflareTokenGuideTitle")}</strong>
            <p>{t(locale, hasToken ? "cloudflareReplaceTokenBody" : "cloudflareStepTokenBody")}</p>
            <div className="token-link-row">
              <a className="button-link" href={FLOWMAIL_TOKEN_TEMPLATE_URL} target="_blank" rel="noreferrer">{t(locale, "createFlowmailToken")}</a>
            </div>
            <details className="token-permissions-details">
              <summary>{t(locale, "requiredTokenPermissions")}</summary>
              <p>{t(locale, "cloudflareTokenGuidePath")}</p>
              <p>{t(locale, "cloudflareTokenGuideWarning")}</p>
              <p><a href={CLOUDFLARE_API_TOKENS_URL} target="_blank" rel="noreferrer">{t(locale, "openApiTokensPage")}</a></p>
              <div className="token-permissions">
                <span>{t(locale, "permissionZoneRead")}</span>
                <span>{t(locale, "permissionDnsRead")}</span>
                <span>{t(locale, "permissionEmailRoutingRead")}</span>
                <span>{t(locale, "permissionEmailRoutingEdit")}</span>
                <span>{t(locale, "permissionEmailSendingEdit")}</span>
                <span>{t(locale, "permissionWorkersRead")}</span>
              </div>
            </details>
          </div>

          <div className="token-entry-grid">
            {hasToken ? (
              <div className="token-status-card">
                <div>
                  <span>{t(locale, "tokenStatus")}</span>
                  <strong>{tokenLabel}</strong>
                  {config?.updatedAt ? <small>{t(locale, "updatedAt", { date: formatDate(config.updatedAt, locale) })}</small> : null}
                </div>
                <button className="danger-link-button" onClick={deleteToken} disabled={Boolean(busy)}>{t(locale, "deleteToken")}</button>
              </div>
            ) : null}

            <Field label={hasToken ? t(locale, "replaceCloudflareApiToken") : t(locale, "cloudflareApiToken")} help={localizedHelp.cloudflareToken}>
              <input
                autoComplete="off"
                placeholder={hasToken ? t(locale, "tokenReplacePlaceholder") : t(locale, "tokenPlaceholder")}
                type="password"
                value={form.token}
                onChange={(event) => {
                  setForm({ ...form, token: event.target.value });
                  setDiscovery(null);
                }}
              />
            </Field>
            <div className="token-discover-action">
              {hasToken && !form.token.trim() ? <button className="compact-action" onClick={() => discoverSavedConfig()} disabled={Boolean(busy)}>{t(locale, "discoverFromSavedToken")}</button> : null}
              <button className={hasToken && !form.token.trim() ? "secondary-button compact-action" : "compact-action"} onClick={() => discoverConfig()} disabled={Boolean(busy) || !form.token.trim()}>{hasToken ? t(locale, "validateReplacementToken") : t(locale, "discoverFromToken")}</button>
              <small>{t(locale, "tokenSaveNote")}</small>
            </div>
          </div>
          {discovery?.permissions?.length ? (
            <div className="cloudflare-permission-summary">
              <strong>{t(locale, "tokenPermissionCheckTitle")}</strong>
              <div className="status-list compact-status-list">
                {discovery.permissions.map((permission) => (
                  <div className="status-row" key={permission.name}>
                    <span className={permission.ok ? "dot ok" : "dot"} />
                    <div>
                      <strong>{cloudflarePermissionLabel(locale, permission.name)}</strong>
                      <p>{localizeCloudflareMessage(locale, permission.details)}</p>
                    </div>
                  </div>
                ))}
              </div>
              {tokenHasMissingPermissions ? <p className="muted">{t(locale, "tokenPermissionBlocked")}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {configStep === 2 ? (
        <div className="config-step-content">
          <p className="muted">{t(locale, hasToken ? "cloudflareConfiguredConfigBody" : "cloudflareStepConfigBody")}</p>
          {hasToken ? (
            <div className="cloudflare-current-config">
              <div>
                <span>{t(locale, "tokenStatus")}</span>
                <strong>{tokenLabel}</strong>
                {config?.updatedAt ? <small>{t(locale, "updatedAt", { date: formatDate(config.updatedAt, locale) })}</small> : null}
              </div>
              <button className="secondary-button" onClick={startTokenReplacement} disabled={Boolean(busy)}>{t(locale, "replaceCloudflareApiToken")}</button>
            </div>
          ) : null}
          {discovery ? (
            <div className="cloudflare-discovery">
              <div className="cloudflare-state-row">
                {discovery.token?.active ? <span className="soft-pill">{t(locale, "tokenActive")}</span> : null}
                {discovery.selectedZone ? <span className="soft-pill">{t(locale, "zoneSoftLabel", { name: discovery.selectedZone.name })}</span> : null}
                <span className="soft-pill">{t(locale, "workersFound", { count: discovery.workers?.length ?? 0 })}</span>
              </div>
              {(discovery.warnings ?? []).map((warning) => <p className="muted" key={warning}>{localizeCloudflareMessage(locale, warning)}</p>)}
            </div>
          ) : null}

          <div className="form-grid cloudflare-config-grid">
            <Field label={t(locale, "domain")} help={localizedHelp.zoneName}>
              {discovery?.zones?.length ? (
                <>
                  <div className="field-action-row">
                    <select value={form.zoneName} onChange={(event) => void selectZone(event.target.value)}>
                      {discovery.zones.map((zone) => (
                        <option key={zone.id} value={zone.name}>{zone.name}{zone.status ? ` (${translateStatus(locale, zone.status)})` : ""}</option>
                      ))}
                    </select>
                    {hasToken ? <button type="button" className="secondary-button" onClick={() => discoverSavedConfig()} disabled={Boolean(busy)}>{t(locale, "refreshDetectedDomains")}</button> : null}
                  </div>
                  <small className="field-note">{t(locale, "chooseDetectedValue")}</small>
                </>
              ) : (
                <>
                  <div className="field-action-row">
                    <input placeholder="example.com" value={form.zoneName} onChange={(event) => updateZoneName(event.target.value)} />
                    {hasToken ? <button type="button" className="secondary-button" onClick={() => discoverSavedConfig()} disabled={Boolean(busy)}>{t(locale, "loadAvailableDomains")}</button> : null}
                  </div>
                  <small className="field-note">{t(locale, hasToken ? "savedTokenDomainSwitchNote" : "chooseDetectedValue")}</small>
                </>
              )}
            </Field>
            <Field label={t(locale, "sendingSubdomain")} help={localizedHelp.sendingSubdomain}>
              <input
                placeholder={t(locale, "sendingSubdomainPlaceholder")}
                value={form.sendingSubdomain}
                onChange={(event) => updateSendingSubdomain(event.target.value)}
              />
              <small className="field-note">
                {t(locale, "sendingDomainPreview", { domain: emailDomain || "example.com" })}
              </small>
            </Field>
            <Field label={t(locale, "worker")} help={localizedHelp.workerName}>
              {discovery?.workers?.length ? (
                <>
                  <select value={form.workerName} onChange={(event) => setForm({ ...form, workerName: event.target.value })}>
                    {!workerIsDetected ? <option value={form.workerName}>{t(locale, "useDeployedFlowmailWorker", { name: form.workerName })}</option> : null}
                    {discovery.workers.map((worker) => <option key={worker.id || worker.name} value={worker.name}>{worker.name}</option>)}
                  </select>
                  <small className="field-note">{workerIsDetected ? t(locale, "chooseDetectedWorker") : t(locale, "workerNotDetectedNote", { name: form.workerName })}</small>
                </>
              ) : (
                <>
                  <input placeholder="flowmail" value={form.workerName} onChange={(event) => setForm({ ...form, workerName: event.target.value })} />
                  <small className="field-note">{t(locale, "workerNotDetectedNote", { name: form.workerName || "flowmail" })}</small>
                </>
              )}
            </Field>
            <Field label={t(locale, "fromEmail")} help={localizedHelp.fromEmail}>
              <input
                placeholder={emailDomain ? defaultFromEmail(emailDomain) : "no-reply@example.com"}
                value={form.fromEmail}
                onChange={(event) => setForm({ ...form, fromEmail: event.target.value, replyToEmail: event.target.value })}
              />
              <small className="field-note">{t(locale, "editableEmailNote")}</small>
            </Field>
          </div>
        </div>
      ) : null}

      {configStep === 3 ? (
        <div className="config-step-content">
          <p className="muted">{t(locale, "cloudflareStepVerifyBody")}</p>
          <div className="cloudflare-auto-status">
            <strong>{busy === "verify" ? t(locale, "cloudflareAutoVerifying") : t(locale, "cloudflareAutoVerifyTitle")}</strong>
            <p>{t(locale, config?.localSetupMode ? "cloudflareLocalVerifyBody" : "cloudflareAutoVerifyBody")}</p>
          </div>
          <div className="cloudflare-test-row">
            <Field label={t(locale, "testRecipient")} help={localizedHelp.testRecipient}>
              <input placeholder="you@example.com" value={testTo} onChange={(event) => setTestTo(event.target.value)} />
            </Field>
            <button onClick={sendTestEmail} disabled={Boolean(busy)}>{busy === "test" ? t(locale, "sendingTestEmail") : t(locale, "sendTestEmail")}</button>
          </div>
        </div>
      ) : null}

      <div className="row-actions wizard-actions">
        {configStep > 1 && !(hasToken && configStep === 2) ? <button className="secondary-button" onClick={() => setConfigStep((configStep - 1) as 1 | 2 | 3)} disabled={Boolean(busy)}>{t(locale, "previousStep")}</button> : null}
        {configStep === 1 ? (
          <button className="secondary-button" onClick={() => setConfigStep(2)} disabled={Boolean(busy) || !hasDetectedConfig || !tokenPermissionsReady}>{t(locale, hasToken ? "continueToCurrentConfig" : "continueToConfig")}</button>
        ) : null}
        {configStep === 2 ? <button onClick={saveConfig} disabled={Boolean(busy) || !canSaveConfig || Boolean(form.token.trim() && !tokenPermissionsReady)}>{t(locale, "saveAndContinueToVerify")}</button> : null}
        {message ? <span className="muted">{message}</span> : null}
      </div>

      {checkResult ? (
        <div className="cloudflare-check-summary">
          <div className="status-list">
            {(checkResult.checks ?? []).map((check) => (
              <div className="status-row" key={check.name}>
                <span className={check.ok ? "dot ok" : "dot"} />
                <div><strong>{cloudflareCheckLabel(locale, check.name)}</strong><p>{localizeCloudflareMessage(locale, check.details)}</p></div>
              </div>
            ))}
          </div>
          {dnsMetrics.length ? (
            <div className="metric-row metric-row-4 cloudflare-dns-metrics">
              {dnsMetrics.map((metric) => (
                <div className="metric-card" key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <small>{t(locale, "records")}</small>
                </div>
              ))}
            </div>
          ) : null}
          {checkResult.zone || checkResult.routing ? (
            <div className="cloudflare-state-row">
              {checkResult.zone ? <span className="soft-pill">{t(locale, "zoneSoftLabel", { name: checkResult.zone.name ?? t(locale, "unknown") })} · {checkResult.zone.status ?? t(locale, "unknown")}</span> : null}
              {checkResult.routing ? <span className="soft-pill">{t(locale, "routingStatus", { status: checkResult.routing.status ?? (checkResult.routing.enabled ? t(locale, "enabled") : t(locale, "unknown")) })}</span> : null}
              {checkResult.routing ? <span className="soft-pill">{t(locale, "replyRouteStatus", { status: checkResult.routing.replyToRule ? t(locale, "present") : t(locale, "missing") })}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}

function initialForm(product?: ProductSettings | null): FormState {
  const zoneName = product?.sending_domain || domainFromEmail(product?.default_from_email) || "";
  return {
    zoneName,
    sendingSubdomain: deriveSubdomainFromEmail(product?.default_from_email, zoneName),
    workerName: "flowmail",
    fromEmail: product?.default_from_email || "",
    replyToEmail: product?.default_from_email || product?.reply_to_email || "",
    token: ""
  };
}

function mergeProductFallback(current: FormState, product?: ProductSettings | null): FormState {
  const zoneName = current.zoneName || product?.sending_domain || domainFromEmail(product?.default_from_email) || "";
  return {
    ...current,
    zoneName,
    sendingSubdomain: current.sendingSubdomain || deriveSubdomainFromEmail(product?.default_from_email, zoneName),
    fromEmail: current.fromEmail || product?.default_from_email || "",
    replyToEmail: current.fromEmail || product?.default_from_email || product?.reply_to_email || ""
  };
}

function domainFromEmail(email?: string) {
  const domain = email?.split("@")[1]?.trim();
  return domain || "";
}

function normalizeSubdomain(value: string, zoneName?: string) {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/\s+/g, "")
    .replace(/^\.+|\.+$/g, "");
  const zone = zoneName?.trim().toLowerCase();
  if (!cleaned || !zone) return cleaned;
  if (cleaned === zone) return "";
  return cleaned.endsWith(`.${zone}`) ? cleaned.slice(0, -(zone.length + 1)) : cleaned;
}

function reconcileSubdomainForZone(value: string, zoneName?: string) {
  return normalizeSubdomain(value, zoneName);
}

function buildSendingDomain(zoneName: string, sendingSubdomain?: string) {
  const zone = zoneName.trim().toLowerCase();
  const subdomain = normalizeSubdomain(sendingSubdomain || "", zone);
  if (!zone) return "";
  return subdomain ? `${subdomain}.${zone}` : zone;
}

function deriveSubdomainFromEmail(email?: string, zoneName?: string) {
  const domain = domainFromEmail(email).toLowerCase();
  const zone = zoneName?.trim().toLowerCase();
  if (!domain || !zone || domain === zone || !domain.endsWith(`.${zone}`)) return "";
  return domain.slice(0, -(zone.length + 1));
}

function defaultFromEmail(domain: string) {
  return `no-reply@${domain}`;
}

function resolveSenderEmails(
  current: FormState,
  zoneName: string,
  sendingSubdomain: string,
  fallback?: { fromEmail?: string }
) {
  const domain = buildSendingDomain(zoneName, sendingSubdomain);
  const defaultFrom = domain ? defaultFromEmail(domain) : fallback?.fromEmail || current.fromEmail;
  const fromEmail = shouldUseFromSuggestion(current.fromEmail, zoneName) || shouldMoveEmailToDomain(current.fromEmail, zoneName, domain)
    ? defaultFrom
    : current.fromEmail || fallback?.fromEmail || defaultFrom;
  const replyToEmail = fromEmail;
  return { fromEmail, replyToEmail };
}

function shouldUseFromSuggestion(email?: string, zoneName?: string) {
  if (!email?.trim()) return true;
  const normalized = email.trim().toLowerCase();
  const domain = domainFromEmail(normalized).toLowerCase();
  if (domain === "example.com") return true;
  if (zoneName && domain === zoneName.toLowerCase() && normalized === `hello@${domain}`) return true;
  if (normalized === `no-reply@${domain}`) return true;
  return false;
}

function shouldMoveEmailToDomain(email: string | undefined, zoneName: string, nextDomain: string) {
  const currentDomain = domainFromEmail(email).toLowerCase();
  const rootZone = zoneName.trim().toLowerCase();
  if (!nextDomain || !currentDomain || currentDomain === nextDomain) return false;
  return Boolean(rootZone && (currentDomain === rootZone || currentDomain.endsWith(`.${rootZone}`)));
}

function cloudflareHelp(locale: Locale) {
  return {
    cloudflareEmailConfig: {
      title: t(locale, "helpCloudflareConfigTitle"),
      summary: t(locale, "helpCloudflareConfigSummary"),
      steps: [
        t(locale, "helpCloudflareConfigStep1"),
        t(locale, "helpCloudflareConfigStep2"),
        t(locale, "helpCloudflareConfigStep3")
      ],
      example: t(locale, "helpCloudflareConfigExample")
    },
    zoneName: {
      title: t(locale, "helpZoneNameTitle"),
      summary: t(locale, "helpZoneNameSummary"),
      steps: [
        t(locale, "helpZoneNameStep1"),
        t(locale, "helpZoneNameStep2"),
        t(locale, "helpZoneNameStep3")
      ],
      example: "example.com"
    },
    sendingSubdomain: {
      title: t(locale, "helpSendingSubdomainTitle"),
      summary: t(locale, "helpSendingSubdomainSummary"),
      steps: [
        t(locale, "helpSendingSubdomainStep1"),
        t(locale, "helpSendingSubdomainStep2"),
        t(locale, "helpSendingSubdomainStep3")
      ],
      example: "mail -> no-reply@mail.example.com"
    },
    cloudflareToken: {
      title: t(locale, "helpCloudflareTokenTitle"),
      summary: t(locale, "helpCloudflareTokenSummary"),
      steps: [
        t(locale, "helpCloudflareTokenStep1"),
        t(locale, "helpCloudflareTokenStep2"),
        t(locale, "helpCloudflareTokenStep3"),
        t(locale, "helpCloudflareTokenStep4")
      ],
      example: t(locale, "helpCloudflareTokenExample")
    },
    workerName: {
      title: t(locale, "helpWorkerNameTitle"),
      summary: t(locale, "helpWorkerNameSummary"),
      steps: [
        t(locale, "helpWorkerNameStep1"),
        t(locale, "helpWorkerNameStep2"),
        t(locale, "helpWorkerNameStep3")
      ],
      example: "flowmail"
    },
    fromEmail: {
      title: t(locale, "helpFromEmailTitle"),
      summary: t(locale, "helpFromEmailSummary"),
      steps: [
        t(locale, "helpFromEmailStep1"),
        t(locale, "helpFromEmailStep2"),
        t(locale, "helpFromEmailStep3")
      ],
      example: "no-reply@example.com"
    },
    testRecipient: {
      title: t(locale, "helpTestRecipientTitle"),
      summary: t(locale, "helpTestRecipientSummary"),
      steps: [
        t(locale, "helpTestRecipientStep1"),
        t(locale, "helpTestRecipientStep2")
      ],
      example: "you@example.com"
    }
  };
}

function localizeCloudflareMessage(locale: Locale, message: string) {
  if (message.includes("Zone Read permission verified")) {
    return t(locale, "permissionZoneReadVerified");
  }
  if (message.includes("DNS Read permission verified")) {
    return t(locale, "permissionDnsReadVerified");
  }
  if (message.includes("Email Routing Rules Read permission verified")) {
    return t(locale, "permissionEmailRoutingReadVerified");
  }
  if (message.includes("Email Routing Rules Edit permission verified")) {
    return t(locale, "permissionEmailRoutingEditVerified");
  }
  if (message.includes("Email Sending permission verified")) {
    return t(locale, "permissionEmailSendingVerified");
  }
  if (message.includes("Workers Scripts Read permission verified")) {
    return t(locale, "permissionWorkersReadVerified");
  }
  if (message.includes("Cloudflare token cannot read DNS")) {
    return t(locale, "permissionDnsReadMissing");
  }
  if (message.includes("Cloudflare token cannot read Email Routing rules")) {
    return t(locale, "permissionEmailRoutingReadMissing");
  }
  if (message.includes("Cloudflare token cannot edit Email Routing")) {
    return t(locale, "permissionEmailRoutingEditMissing");
  }
  if (message.includes("Cloudflare token cannot read Workers Scripts")) {
    return t(locale, "permissionWorkersReadMissing");
  }
  if (message.includes("Workers Script Info not found")) {
    return t(locale, "cloudflareWorkerScriptMissing");
  }
  if (message.includes("missing required permissions")) {
    return t(locale, "tokenPermissionBlocked");
  }
  if (message === "Token active.") {
    return t(locale, "checkTokenActive");
  }
  if (message.includes("verified but is not active")) {
    return t(locale, "checkTokenInactive");
  }
  const zoneAccessible = message.match(/^(.+) is accessible\.$/);
  if (zoneAccessible) {
    return t(locale, "checkZoneAccessible", { name: zoneAccessible[1] });
  }
  const dnsSummary = message.match(/^Found (\d+) MX, (\d+) SPF, (\d+) DKIM-like, and (\d+) DMARC records\.$/);
  if (dnsSummary) {
    return t(locale, "checkDnsSummary", {
      mx: dnsSummary[1],
      spf: dnsSummary[2],
      dkim: dnsSummary[3],
      dmarc: dnsSummary[4]
    });
  }
  if (message.includes("Email Routing enabled")) {
    return t(locale, "checkEmailRoutingEnabled");
  }
  if (message.includes("Email Routing rules are readable")) {
    return t(locale, "checkEmailRoutingRulesReadable");
  }
  if (message.includes("Local setup mode skips Cloudflare reply routing")) {
    return t(locale, "checkReplyRouteSkippedLocal");
  }
  if (message.includes("Cloudflare token cannot read Email Routing") || message.includes("Authentication error")) {
    return t(locale, "checkEmailRoutingPermissionError");
  }
  if (message.includes("Cloudflare token cannot send Email")) {
    return t(locale, "cloudflareEmailSendingPermissionError");
  }
  if (message.includes("Cloudflare Email Sending request timed out")) {
    return t(locale, "cloudflareEmailSendingTimeout");
  }
  if (message.includes("Cloudflare Email Sending is disabled") || message.includes("email.sending_disabled")) {
    return t(locale, "cloudflareEmailSendingDisabled");
  }
  const routed = message.match(/^(.+) routes to (.+)\.$/);
  if (routed) {
    return t(locale, "checkReplyRoutePresent", { email: routed[1], worker: routed[2] });
  }
  const notRouted = message.match(/^(.+) is not routed to (.+)\.$/);
  if (notRouted) {
    return t(locale, "checkReplyRouteMissing", { email: notRouted[1], worker: notRouted[2] });
  }
  if (message.includes("The deployed Flowmail Worker was not found")) {
    const match = message.match(/Keep (.+?) if/);
    return t(locale, "deployedWorkerNotFoundWarning", { name: match?.[1] ?? "flowmail" });
  }
  if (message.includes("Invalid request headers")) {
    return t(locale, "invalidCloudflareToken");
  }
  if (message.includes("CONFIG_ENCRYPTION_KEY is required before saving")) {
    return t(locale, "missingConfigEncryptionKey");
  }
  if (message.includes("CONFIG_ENCRYPTION_KEY must be at least 32 bytes")) {
    return t(locale, "shortConfigEncryptionKey");
  }
  if (message.includes("Default from email is not in DOMAINS") || message.includes("Save a Cloudflare Email config before sending")) {
    return t(locale, "fromEmailNotInDomains");
  }
  return message;
}

function cloudflareCheckLabel(locale: Locale, name: string) {
  const map: Record<string, ReturnType<typeof t>> = {
    token: t(locale, "checkToken"),
    zone: t(locale, "checkZone"),
    dns: t(locale, "checkDns"),
    emailRouting: t(locale, "checkEmailRouting"),
    replyToRoute: t(locale, "checkReplyToRoute")
  };
  return map[name] ?? name;
}

function cloudflarePermissionLabel(locale: Locale, name: string) {
  const map: Record<string, ReturnType<typeof t>> = {
    zoneRead: t(locale, "permissionZoneRead"),
    dnsRead: t(locale, "permissionDnsRead"),
    emailRoutingRead: t(locale, "permissionEmailRoutingRead"),
    emailRoutingEdit: t(locale, "permissionEmailRoutingEdit"),
    emailSendingEdit: t(locale, "permissionEmailSendingEdit"),
    workersScriptsRead: t(locale, "permissionWorkersRead")
  };
  return map[name] ?? name;
}

function readError(locale: Locale, error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  try {
    const parsed = JSON.parse(error.message);
    return localizeCloudflareMessage(locale, parsed.error || parsed.message || error.message);
  } catch {
    return localizeCloudflareMessage(locale, error.message || fallback);
  }
}

function formatDate(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString(locale);
}
