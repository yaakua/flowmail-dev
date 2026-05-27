import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AppShell, localizedPath, useLocale } from "../components/AppShell";
import { EmptyState, MetricCard } from "../components/Workflow";
import { api } from "../lib/api";
import { t, type Locale } from "../i18n";

type ClickSummary = {
  total_clicks?: number;
  unique_contacts?: number;
  campaign_count?: number;
  last_click_at?: string | null;
};

type ClickCampaign = {
  id?: string;
  name?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  click_count: number;
  unique_contacts?: number;
  last_click_at?: string | null;
};

type ClickUrl = {
  url: string;
  click_count: number;
  unique_contacts: number;
  last_click_at: string | null;
};

type ClickEvent = {
  id: string;
  campaign_id: string | null;
  recipient_id: string | null;
  contact_id: string | null;
  event_time: string;
  metadata_json: string;
  campaign_name: string | null;
  contact_email: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
};

type ClicksResponse = {
  summary: ClickSummary;
  byCampaign: ClickCampaign[];
  topUrls: ClickUrl[];
  recent: ClickEvent[];
  campaigns: ClickCampaign[];
};

type NormalizedClick = ClickEvent & {
  email: string;
  url: string;
  userAgent: string;
};

export default function Clicks() {
  const locale = useLocale();
  const [params, setParams] = useSearchParams();
  const campaignId = params.get("campaignId");
  const [data, setData] = useState<ClicksResponse | null>(null);

  async function load() {
    const query = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
    setData(await api<ClicksResponse>(`/api/v1/clicks${query}`));
  }

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [campaignId]);

  const recent = useMemo(() => (data?.recent ?? []).map(normalizeClick), [data?.recent]);
  const campaigns = data?.campaigns ?? [];
  const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignId);
  const summary = data?.summary ?? {};

  function updateCampaign(nextCampaignId: string) {
    if (!nextCampaignId) {
      setParams({});
      return;
    }
    setParams({ campaignId: nextCampaignId });
  }

  const aside = (
    <div className="stack">
      <section className="side-card">
        <h2>{t(locale, "moreFilters")}</h2>
        <label>
          {t(locale, "campaign")}
          <select value={campaignId ?? ""} onChange={(event) => updateCampaign(event.target.value)}>
            <option value="">{t(locale, "allCampaigns")}</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>{campaign.name} ({campaign.click_count})</option>
            ))}
          </select>
        </label>
      </section>
      <section className="side-card">
        <h2>{t(locale, "clicksByCampaign")}</h2>
        {(data?.byCampaign ?? []).length === 0 ? <p className="muted">{t(locale, "noData")}</p> : null}
        {(data?.byCampaign ?? []).slice(0, 8).map((campaign) => (
          <div className="mini-row" key={campaign.campaign_id ?? "unknown"}>
            <strong>{campaign.campaign_name ?? t(locale, "lifecycleCampaign")}</strong>
            <span>{campaign.click_count} {t(locale, "clicks")}</span>
          </div>
        ))}
      </section>
      <section className="side-card">
        <h2>{t(locale, "quickActions")}</h2>
        <Link to={localizedPath(locale, "/campaigns")}>{t(locale, "viewCampaign")}</Link>
        {selectedCampaign ? <Link to={localizedPath(locale, `/campaigns/${selectedCampaign.id}`)}>{t(locale, "openCampaign")}</Link> : null}
      </section>
    </div>
  );

  return (
    <AppShell aside={aside}>
      <section className="page-heading page-heading-row">
        <div>
          <p className="eyebrow">{t(locale, "clickAnalyticsEyebrow")}</p>
          <h1>{t(locale, "clickAnalyticsTitle")}</h1>
          <p>{t(locale, "clickAnalyticsLead")}</p>
        </div>
        <button className="secondary-button" onClick={load}>{t(locale, "reload")}</button>
      </section>

      <section className="metric-row metric-row-4 compact-metrics">
        <MetricCard label={t(locale, "clicks")} value={summary.total_clicks ?? 0} />
        <MetricCard label={t(locale, "uniqueClickers")} value={summary.unique_contacts ?? 0} />
        <MetricCard label={t(locale, "activeCampaigns")} value={summary.campaign_count ?? 0} />
        <MetricCard label={t(locale, "lastClick")} value={formatDate(locale, summary.last_click_at)} />
      </section>

      <section className="panel">
        <div className="panel-title-row">
          <div>
            <h2>{t(locale, "topClickedLinks")}</h2>
            <p className="muted">{t(locale, "topClickedLinksBody")}</p>
          </div>
        </div>
        {(data?.topUrls ?? []).length === 0 ? (
          <EmptyState title={t(locale, "noClicksTitle")} body={t(locale, "noClicksBody")} />
        ) : (
          <div className="table-scroll">
            <table className="click-table">
              <thead>
                <tr>
                  <th>{t(locale, "destination")}</th>
                  <th>{t(locale, "clicks")}</th>
                  <th>{t(locale, "uniqueContacts")}</th>
                  <th>{t(locale, "latestClick")}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.topUrls ?? []).map((item) => (
                  <tr key={item.url}>
                    <td><a href={item.url} target="_blank" rel="noreferrer" title={item.url}>{formatUrl(item.url)}</a></td>
                    <td>{item.click_count}</td>
                    <td>{item.unique_contacts}</td>
                    <td>{formatDate(locale, item.last_click_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-title-row">
          <div>
            <h2>{t(locale, "recentClicks")}</h2>
            <p className="muted">{t(locale, "recentClicksBody")}</p>
          </div>
          <span className="muted">{t(locale, "totalRecords", { count: recent.length })}</span>
        </div>
        {recent.length === 0 ? (
          <p className="muted">{t(locale, "noData")}</p>
        ) : (
          <div className="table-scroll">
            <table className="click-table recent-click-table">
              <thead>
                <tr>
                  <th>{t(locale, "clicker")}</th>
                  <th>{t(locale, "campaign")}</th>
                  <th>{t(locale, "destination")}</th>
                  <th>{t(locale, "clickTime")}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((click) => (
                  <tr key={click.id}>
                    <td>
                      <strong>{displayContact(click)}</strong>
                      <br />
                      <span className="muted">{click.email}</span>
                    </td>
                    <td>
                      {click.campaign_id ? <Link to={localizedPath(locale, `/campaigns/${click.campaign_id}`)}>{click.campaign_name ?? t(locale, "lifecycleCampaign")}</Link> : t(locale, "lifecycleCampaign")}
                      {click.company ? <><br /><span className="muted">{click.company}</span></> : null}
                    </td>
                    <td>
                      <a href={click.url} target="_blank" rel="noreferrer" title={click.url}>{formatUrl(click.url)}</a>
                      {click.userAgent ? <><br /><span className="mono-cell" title={click.userAgent}>{click.userAgent}</span></> : null}
                    </td>
                    <td>{formatDate(locale, click.event_time)}</td>
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

function normalizeClick(click: ClickEvent): NormalizedClick {
  const metadata = parseMetadata(click.metadata_json);
  return {
    ...click,
    email: click.contact_email ?? metadata.email ?? "-",
    url: metadata.url ?? "",
    userAgent: metadata.userAgent ?? ""
  };
}

function parseMetadata(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      email: typeof parsed.email === "string" ? parsed.email : undefined,
      url: typeof parsed.url === "string" ? parsed.url : undefined,
      userAgent: typeof parsed.userAgent === "string" ? parsed.userAgent : undefined
    };
  } catch {
    return {};
  }
}

function displayContact(click: NormalizedClick) {
  const name = [click.first_name, click.last_name].filter(Boolean).join(" ").trim();
  return name || click.email;
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

function formatUrl(value: string) {
  if (!value) return "-";
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return value;
  }
}
