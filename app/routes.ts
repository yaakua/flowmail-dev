import { index, route, type RouteConfig } from "@react-router/dev/routes";

function appRoutes(prefix = "") {
  return [
  index("routes/home.tsx", { id: `${prefix}home` }),
  route("auth", "routes/auth.tsx", { id: `${prefix}auth` }),
  route("landing", "routes/landing.tsx", { id: `${prefix}landing` }),
  route("setup", "routes/setup.tsx", { id: `${prefix}setup` }),
  route("settings", "routes/settings.tsx", { id: `${prefix}settings` }),
  route("contacts", "routes/contacts.tsx", { id: `${prefix}contacts` }),
  route("contacts/import", "routes/contacts-import.tsx", { id: `${prefix}contacts-import` }),
  route("contacts/:contactId", "routes/contact-detail.tsx", { id: `${prefix}contact-detail` }),
  route("campaigns", "routes/campaigns.tsx", { id: `${prefix}campaigns` }),
  route("campaigns/:campaignId", "routes/campaign-detail.tsx", { id: `${prefix}campaign-detail` }),
  route("campaigns/:campaignId/preview", "routes/campaign-preview.tsx", { id: `${prefix}campaign-preview` }),
  route("campaigns/:campaignId/send", "routes/campaign-send.tsx", { id: `${prefix}campaign-send` }),
  route("send-tasks", "routes/send-tasks.tsx", { id: `${prefix}send-tasks` }),
  route("inbox", "routes/inbox.tsx", { id: `${prefix}inbox` }),
  route("inbox/analysis", "routes/reply-analysis.tsx", { id: `${prefix}reply-analysis` }),
  route("inbox/:messageId", "routes/reply-detail.tsx", { id: `${prefix}reply-detail` }),
  route("follow-up", "routes/follow-up.tsx", { id: `${prefix}follow-up` })
] satisfies RouteConfig;
}

export default [
  ...appRoutes(),
  route(":locale", "routes/locale.tsx", { id: "locale" }, appRoutes("locale-")),
  route("*", "routes/not-found.tsx")
] satisfies RouteConfig;
