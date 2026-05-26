import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { localizedPath } from "../components/AppShell";
import { normalizeLocale } from "../i18n";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const acceptLanguage = request.headers.get("accept-language") ?? "";
  const locale = params.locale ? normalizeLocale(params.locale) : acceptLanguage.toLowerCase().includes("zh") ? "zh-CN" : "en";
  const target = await needsInitialSetup(context) ? "/setup" : "/campaigns";
  throw redirect(localizedPath(locale, target));
}

export default function Home() {
  return null;
}

async function needsInitialSetup(context: LoaderFunctionArgs["context"]) {
  try {
    const db = context.cloudflare.env.DB as D1Database;
    const product = await db.prepare(
      "SELECT default_from_email, sending_domain, reply_to_email FROM products LIMIT 1"
    ).first<{ default_from_email: string; sending_domain: string; reply_to_email: string }>();
    return !product
      || !product.default_from_email
      || product.default_from_email.includes("example.com")
      || !product.sending_domain
      || !product.reply_to_email;
  } catch {
    return true;
  }
}
