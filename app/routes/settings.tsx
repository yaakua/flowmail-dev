import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AppShell, localizedPath, useLocale } from "../components/AppShell";
import { api } from "../lib/api";
import { CloudflareEmailConfigPanel } from "../components/CloudflareEmailConfigPanel";
import type { ProductSettings } from "../components/ProductSettingsForm";
import { t } from "../i18n";

export default function Settings() {
  const locale = useLocale();
  const [product, setProduct] = useState<ProductSettings | null>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);

  async function load() {
    const [nextProduct, nextDiagnostics] = await Promise.all([
      api<ProductSettings>("/api/v1/product"),
      api<any>("/api/v1/system/diagnostics")
    ]);
    setProduct(nextProduct);
    setDiagnostics(nextDiagnostics);
  }

  useEffect(() => {
    load();
  }, []);

  const aside = (
    <div className="stack">
      <h2>{t(locale, "diagnostics")}</h2>
      {(diagnostics?.checks ?? []).map((check: any) => (
        <div className="status-row" key={check.name}>
          <span className={check.ok ? "dot ok" : "dot"} />
          <div><strong>{check.name}</strong><p>{check.details}</p></div>
        </div>
      ))}
    </div>
  );

  return (
    <AppShell aside={aside}>
      <section className="page-heading page-heading-row">
        <div>
          <p className="eyebrow">{t(locale, "settings")}</p>
          <h1>{t(locale, "emailSettingsTitle")}</h1>
          <p>{t(locale, "emailSettingsLead")}</p>
        </div>
        <Link className="secondary-link" to={localizedPath(locale, "/setup")}>{t(locale, "setup")}</Link>
      </section>
      {product ? (
        <section className="panel">
          <CloudflareEmailConfigPanel product={product} mode="settings" onChanged={load} />
        </section>
      ) : <p className="muted">{t(locale, "loading")}</p>}
    </AppShell>
  );
}
