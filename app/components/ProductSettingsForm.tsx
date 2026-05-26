import { HelpTip, type HelpTipProps } from "./HelpTip";
import { t, type Locale } from "../i18n";

export type ProductSettings = {
  name: string;
  url: string;
  default_from_email: string;
  sending_domain: string;
  reply_to_email: string;
  brand_voice: string;
  organization_address: string;
};

export function ProductSettingsForm({
  locale,
  product,
  setProduct,
  onSave,
  message,
  compact = false
}: {
  locale: Locale;
  product: ProductSettings;
  setProduct: (product: ProductSettings) => void;
  onSave: () => Promise<void>;
  message?: string;
  compact?: boolean;
}) {
  const fields = compact ? (
    <>
      <Field label="Product name" help={help.productName}>
        <input value={product.name} onChange={(event) => setProduct({ ...product, name: event.target.value })} placeholder="My SaaS" />
      </Field>
      <Field label="Organization address" help={help.organizationAddress} wide>
        <textarea value={product.organization_address} onChange={(event) => setProduct({ ...product, organization_address: event.target.value })} placeholder="Acme Inc, 123 Market St, San Francisco, CA 94105, USA" />
      </Field>
    </>
  ) : (
    <>
      <Field label="Product name" help={help.productName}>
        <input value={product.name} onChange={(event) => setProduct({ ...product, name: event.target.value })} placeholder="My SaaS" />
      </Field>
      <Field label="Product URL" help={help.productUrl}>
        <input value={product.url} onChange={(event) => setProduct({ ...product, url: event.target.value })} placeholder="https://app.example.com" />
      </Field>
      <Field label="Organization address" help={help.organizationAddress} wide>
        <textarea value={product.organization_address} onChange={(event) => setProduct({ ...product, organization_address: event.target.value })} placeholder="Acme Inc, 123 Market St, San Francisco, CA 94105, USA" />
      </Field>
      <Field label="Brand voice" help={help.brandVoice} wide>
        <textarea value={product.brand_voice} onChange={(event) => setProduct({ ...product, brand_voice: event.target.value })} placeholder="Clear, concise, technical, founder-to-founder." />
      </Field>
    </>
  );

  return (
    <>
      <div className="form-grid">{fields}</div>
      <div className="row-actions">
        <button onClick={onSave}>{t(locale, "save")}</button>
        {message ? <span className="muted">{message}</span> : null}
      </div>
    </>
  );
}

export function PanelTitle({ title, help }: { title: string; help: HelpTipProps }) {
  return (
    <div className="panel-title-row">
      <h2>{title}</h2>
      <HelpTip {...help} />
    </div>
  );
}

export function Field({ label, help, children, wide }: { label: string; help: HelpTipProps; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? "field-row wide-field" : "field-row"}>
      <span>{label}<HelpTip {...help} /></span>
      {children}
    </label>
  );
}

export const help: Record<string, HelpTipProps> = {
  cloudflareEmailConfig: {
    title: "Cloudflare Email config",
    summary: "Connect one Cloudflare zone to Flowmail so setup can check the account and route replies to this Worker.",
    steps: ["In Cloudflare, open the top-right profile menu, then My Profile > API Tokens.", "Create a Custom token, not a Global API Key or Account API Token.", "Paste it here, discover settings, then Save, Check, and Apply routing."],
    example: "support@example.com -> flowmail Worker"
  },
  cloudflareCheck: {
    title: "Optional account check",
    summary: "This legacy check uses a temporary Cloudflare API token to inspect your zone DNS and Email Routing status.",
    steps: ["Open Cloudflare Dashboard > My Profile > API Tokens.", "Create a custom token with Zone:Read, DNS:Read, and Email Routing:Read for the target zone.", "Use the Cloudflare Email config panel for saved encrypted token checks and routing."],
    example: "Token permissions: Zone Read, DNS Read, Email Routing Read"
  },
  zoneName: {
    title: "Zone name",
    summary: "The root domain managed by Cloudflare. This is not the Worker URL.",
    steps: ["Open Cloudflare Dashboard.", "Pick the website/domain you want to send from.", "Use the domain shown at the top of that zone."],
    example: "example.com"
  },
  cloudflareToken: {
    title: "Cloudflare API token",
    summary: "Saved tokens are encrypted by the Worker and are never returned to the browser as plaintext.",
    steps: ["Open Cloudflare Dashboard > top-right profile icon > My Profile > API Tokens.", "Click Create Token, then Custom token.", "Grant Zone: Zone Read, Zone: DNS Read, Zone: Email Routing Rules Read/Edit, Account: Email Sending Write, and Account: Workers Scripts Read.", "Scope zone permissions to the target zone and account permissions to the account that owns the Worker."],
    example: "Do not use Global API Key or Account API Tokens."
  },
  workerName: {
    title: "Worker name",
    summary: "The deployed Cloudflare Worker that should receive inbound Email Routing messages.",
    steps: ["Use the Worker service name shown in Cloudflare.", "Keep flowmail if this project is deployed with the default Worker name.", "Apply routing after changing this value."],
    example: "flowmail"
  },
  testEmail: {
    title: "Send test email",
    summary: "Verifies that your product sender and Cloudflare Email Service binding can send one message before a campaign.",
    steps: ["Save the Cloudflare Email config.", "Make sure Email Service sender domain is ready.", "Enter your own email or leave blank to use reply-to.", "Click Send test email."],
    example: "you@example.com"
  },
  testRecipient: {
    title: "Test recipient",
    summary: "A real mailbox where you can receive the setup test email.",
    steps: ["Use your own address or a team test inbox.", "If blank, Flowmail sends to reply-to or from email."],
    example: "founder@example.com"
  },
  productSettings: {
    title: "Product profile",
    summary: "Optional identity details live here. Sender addresses are managed by the Cloudflare Email config above.",
    steps: ["Fill the fields that apply to this sender.", "Save before sending a test email."],
    example: "My project"
  },
  productName: {
    title: "Product name",
    summary: "The name users recognize. It appears in setup emails, campaign drafts, and reply drafts.",
    steps: ["Use your app, SaaS, open-source project, or product name."],
    example: "My SaaS"
  },
  productUrl: {
    title: "Product URL",
    summary: "The main URL you want users to visit from lifecycle emails.",
    steps: ["Use your app URL or marketing site.", "Include https://."],
    example: "https://app.example.com"
  },
  organizationAddress: {
    title: "Organization address",
    summary: "Optional mailing address for teams that need to keep it on file.",
    steps: ["Leave this empty when the sender does not have an organization address.", "Flowmail does not insert it into campaign footers."],
    example: "Acme Inc, 123 Market St, San Francisco, CA 94105, USA"
  },
  brandVoice: {
    title: "Brand voice",
    summary: "Short guidance for AI-generated campaign and reply drafts.",
    steps: ["Describe tone and constraints.", "Keep it practical; avoid long brand books."],
    example: "Clear, concise, technical, founder-to-founder."
  }
};
