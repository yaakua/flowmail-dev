import { Link } from "react-router";
import { AppShell, localizedPath, useLocale } from "../components/AppShell";
import { t } from "../i18n";

export default function NotFound() {
  const locale = useLocale();
  return (
    <AppShell>
      <section className="page-heading">
        <p className="eyebrow">404</p>
        <h1>{t(locale, "notFoundTitle")}</h1>
        <p><Link to={localizedPath(locale, "/setup")}>{t(locale, "returnToSetup")}</Link></p>
      </section>
    </AppShell>
  );
}
