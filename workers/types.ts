export type EmailBinding = {
  send(message: Record<string, unknown>): Promise<{ messageId?: string }>;
};

export type SendJob = {
  campaignId: string;
  recipientId: string;
  sendRunId?: string;
};

export type EventJob = {
  eventType: string;
  campaignId?: string;
  recipientId?: string;
  contactId?: string;
  metadata?: Record<string, unknown>;
};

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  SEND_QUEUE: Queue<SendJob>;
  AI: Ai;
  EMAIL: EmailBinding;
  DOMAINS?: string;
  PUBLIC_APP_URL?: string;
  DEFAULT_LOCALE: "en" | "zh-CN";
  TRACKING_SECRET?: string;
  DAILY_SEND_LIMIT: string;
  SEND_RATE_PER_MINUTE: string;
  CONFIG_ENCRYPTION_KEY?: string;
  WORKER_NAME?: string;
  EMAIL_BINDING_MODE?: "remote" | "local";
}

export type Product = {
  id: string;
  name: string;
  url: string;
  default_from_email: string;
  sending_domain: string;
  reply_to_email: string;
  brand_voice: string;
  organization_address: string;
  created_at: string;
  updated_at: string;
};

export type Template = {
  id: string;
  name: string;
  type: string;
  subject: string;
  html_body: string;
  text_body: string;
  variables_json: string;
  compliance_status: string;
  created_at: string;
  updated_at: string;
};

export type Campaign = {
  id: string;
  name: string;
  status: string;
  goal: string;
  template_id: string;
  audience_filter_json: string;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignSendRun = {
  id: string;
  campaign_id: string;
  status: string;
  audience_filter_json: string;
  requested_count: number | null;
  selected_count: number;
  queued_count: number;
  sent_count: number;
  failed_count: number;
  skipped_sent_count: number;
  skipped_suppressed_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type Contact = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  source: string | null;
  consent_status: string | null;
  consent_source: string | null;
  tags_json: string;
  custom_fields_json: string;
  unsubscribed_at: string | null;
  bounced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ContactEmailSend = {
  id: string;
  contact_id: string;
  campaign_id: string | null;
  send_run_id: string | null;
  recipient_id: string | null;
  email: string;
  status: string;
  subject: string;
  html_body: string;
  text_body: string;
  message_id: string | null;
  failure_reason: string | null;
  sent_at: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type InboundAttribution = {
  campaignId: string | null;
  recipientId: string | null;
  contactId: string | null;
};
