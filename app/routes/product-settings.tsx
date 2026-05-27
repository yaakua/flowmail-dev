import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AppShell, localizedPath, useLocale } from "../components/AppShell";
import { ProductSettingsForm, type ProductSettings } from "../components/ProductSettingsForm";
import { api } from "../lib/api";
import { t } from "../i18n";

export default function ProductSettings() {
  const locale = useLocale();
  const [product, setProduct] = useState<ProductSettings | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    setProduct(await api<ProductSettings>("/api/v1/product"));
  }

  useEffect(() => {
    load();
  }, []);

  async function saveProduct() {
    if (!product) return;
    const saved = await api<ProductSettings>("/api/v1/product", { method: "PUT", body: JSON.stringify(product) });
    setProduct(saved);
    setMessage(t(locale, "settingsSaved"));
  }

  return (
    <AppShell>
      <section className="page-heading page-heading-row">
        <div>
          <p className="eyebrow">{t(locale, "settings")}</p>
          <h1>{t(locale, "productSettingsTitle")}</h1>
          <p>{t(locale, "productSettingsLead")}</p>
        </div>
        <Link className="secondary-link" to={localizedPath(locale, "/settings")}>{t(locale, "emailSettings")}</Link>
      </section>
      {product ? (
        <section className="panel product-profile-panel">
          <ProductSettingsForm locale={locale} product={product} setProduct={setProduct} onSave={saveProduct} message={message} />
        </section>
      ) : <p className="muted">{t(locale, "loading")}</p>}
    </AppShell>
  );
}
