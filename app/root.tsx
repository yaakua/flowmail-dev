import type { LinksFunction, MetaFunction } from "react-router";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useParams } from "react-router";
import { normalizeLocale, t } from "./i18n";
import "./index.css";

export const meta: MetaFunction = () => [
  { title: "Flowmail" },
  {
    name: "description",
    content: t("en", "appDescription")
  }
];

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Host+Grotesk:wght@400..800&family=Martian+Mono:wght@400;500;600&display=swap"
  }
];

export function Layout({ children }: { children: React.ReactNode }) {
  const locale = normalizeLocale(useParams().locale);
  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
