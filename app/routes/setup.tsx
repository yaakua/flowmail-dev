import { useEffect, useState } from "react";
import { AppShell, useLocale } from "../components/AppShell";
import { api } from "../lib/api";
import { t } from "../i18n";
import { CloudflareEmailConfigPanel } from "../components/CloudflareEmailConfigPanel";
import { type ProductSettings } from "../components/ProductSettingsForm";

type SetupStatus = {
  checks: Array<{ name: string; ok: boolean; details: string }>;
  product: ProductSettings;
  manualSteps: string[];
};

export default function Setup() {
  const locale = useLocale();
  const [product, setProduct] = useState<ProductSettings | null>(null);

  async function load() {
    const value = await api<SetupStatus>("/api/v1/setup/status");
    setProduct(value.product);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <AppShell>
      <section className="page-heading page-heading-row">
        <div>
          <p className="eyebrow">{t(locale, "setup")}</p>
          <h1>{t(locale, "setupWelcome")}</h1>
          <p>{t(locale, "setupLead")}</p>
        </div>
      </section>

      <section className="panel setup-focus">
        <CloudflareEmailConfigPanel product={product} mode="setup" onChanged={load} />
      </section>
    </AppShell>
  );
}
