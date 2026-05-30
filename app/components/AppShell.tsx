import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { normalizeLocale, t, type Locale } from "../i18n";
import { BrandMark } from "./BrandLogo";

export function useLocale() {
  const params = useParams();
  return normalizeLocale(params.locale);
}

export function localizedPath(locale: Locale, path: string) {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return locale === "en" ? clean : `/${locale}${clean === "/" ? "" : clean}`;
}

export function AppShell({ children, aside, hideTopbar = false }: { children: React.ReactNode; aside?: React.ReactNode; hideTopbar?: boolean }) {
  const locale = useLocale();
  const location = useLocation();
  const currentPath = stripLocale(location.pathname);
  const unreadInboxCount = useUnreadInboxCount(location.pathname);
  const nav = [
    { label: t(locale, "campaigns"), path: "/campaigns" },
    { label: t(locale, "contacts"), path: "/contacts" },
    { label: t(locale, "sendRecords"), path: "/send-tasks" },
    { label: t(locale, "clickAnalytics"), path: "/clicks" },
    { label: t(locale, "receive"), path: "/receive" },
    { label: t(locale, "inbox"), path: "/inbox", badge: unreadInboxCount },
    { label: t(locale, "emailSettings"), path: "/settings" },
    { label: t(locale, "productSettings"), path: "/product-settings" }
  ];
  return (
    <div className={aside ? "app-shell" : "app-shell app-shell-no-inspector"}>
      <a className="skip-link" href="#main-content">{t(locale, "skipToWorkspace")}</a>
      <aside className="sidebar">
        <Link className="brand" to={localizedPath(locale, "/campaigns")}>
          <span className="brand-mark"><BrandMark /></span>
          <span>
            <strong>Flowmail</strong>
            <small>{t(locale, "brandSubtitle")}</small>
          </span>
        </Link>
        <Link className="create-campaign-link" to={localizedPath(locale, "/campaigns")}>+ {t(locale, "createCampaign")}</Link>
        <nav className="primary-nav" aria-label={t(locale, "primaryNav")}>
          {nav.map((item) => (
            <Link
              key={item.path}
              className={isActive(currentPath, item.path) ? "nav-link active" : "nav-link"}
              to={localizedPath(locale, item.path)}
            >
              <span>{item.label}</span>
              {item.badge ? <strong className="nav-badge" aria-label={t(locale, "unreadCount", { count: item.badge })}>{formatBadgeCount(item.badge)}</strong> : null}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="account-chip">
            <span>FM</span>
            <div><strong>My SaaS</strong><small>{t(locale, "owner")}</small></div>
          </div>
        </div>
        <div className="locale-switch">
          <Link to={localizedPath("en", stripLocale(location.pathname))}>EN</Link>
          <Link to={localizedPath("zh-CN", stripLocale(location.pathname))}>中文</Link>
        </div>
      </aside>
      <main className="workspace" id="main-content">
        {hideTopbar ? null : (
          <header className="workspace-topbar">
            <div>
              <span>{t(locale, "operatorConsole")}</span>
              <strong>{t(locale, "operatorSummary")}</strong>
            </div>
          </header>
        )}
        {children}
      </main>
      {aside ? <aside className="inspector">{aside}</aside> : null}
    </div>
  );
}

function stripLocale(pathname: string) {
  return pathname.replace(/^\/zh-CN(?=\/|$)/, "") || "/";
}

function isActive(currentPath: string, navPath: string) {
  return currentPath === navPath || currentPath.startsWith(`${navPath}/`);
}

function useUnreadInboxCount(pathname: string) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/v1/inbox/unread-count");
        if (!response.ok) return;
        const data = await response.json() as { count?: number };
        if (!cancelled) setCount(Number(data.count ?? 0));
      } catch {
        if (!cancelled) setCount(0);
      }
    }

    void load();
    const timer = window.setInterval(load, 30000);
    window.addEventListener("flowmail:inbox-read-status-changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener("flowmail:inbox-read-status-changed", load);
      window.clearInterval(timer);
    };
  }, [pathname]);

  return count;
}

function formatBadgeCount(count: number) {
  return count > 99 ? "99+" : String(count);
}
