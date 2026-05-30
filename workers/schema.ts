const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  default_from_email TEXT NOT NULL DEFAULT '',
  sending_domain TEXT NOT NULL DEFAULT '',
  reply_to_email TEXT NOT NULL DEFAULT '',
  brand_voice TEXT NOT NULL DEFAULT '',
  organization_address TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  company TEXT,
  source TEXT,
  consent_status TEXT,
  consent_source TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  custom_fields_json TEXT NOT NULL DEFAULT '{}',
  unsubscribed_at TEXT,
  bounced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_imports (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  status TEXT NOT NULL,
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  report_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppressions (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  campaign_id TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS suppressions_email_reason_idx ON suppressions(email, reason);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  text_body TEXT NOT NULL,
  variables_json TEXT NOT NULL DEFAULT '[]',
  compliance_status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  goal TEXT NOT NULL,
  template_id TEXT NOT NULL,
  audience_filter_json TEXT NOT NULL DEFAULT '{}',
  scheduled_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_send_runs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  status TEXT NOT NULL,
  audience_filter_json TEXT NOT NULL DEFAULT '{}',
  requested_count INTEGER,
  selected_count INTEGER NOT NULL DEFAULT 0,
  queued_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_sent_count INTEGER NOT NULL DEFAULT 0,
  skipped_suppressed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS campaign_send_runs_campaign_idx ON campaign_send_runs(campaign_id, created_at);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL,
  message_id TEXT,
  sent_at TEXT,
  failed_at TEXT,
  failure_reason TEXT,
  unsubscribed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_recipients_unique_idx ON campaign_recipients(campaign_id, contact_id);

CREATE TABLE IF NOT EXISTS campaign_send_run_recipients (
  send_run_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (send_run_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS campaign_send_run_recipients_campaign_idx ON campaign_send_run_recipients(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS campaign_send_run_recipients_recipient_idx ON campaign_send_run_recipients(recipient_id);

CREATE TABLE IF NOT EXISTS contact_email_sends (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  campaign_id TEXT,
  send_run_id TEXT,
  recipient_id TEXT,
  email TEXT NOT NULL,
  status TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  text_body TEXT NOT NULL,
  message_id TEXT,
  failure_reason TEXT,
  sent_at TEXT,
  failed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS contact_email_sends_contact_idx ON contact_email_sends(contact_id, created_at);
CREATE INDEX IF NOT EXISTS contact_email_sends_campaign_idx ON contact_email_sends(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS contact_email_sends_recipient_idx ON contact_email_sends(recipient_id, created_at);
CREATE INDEX IF NOT EXISTS contact_email_sends_run_idx ON contact_email_sends(send_run_id, created_at);

CREATE TABLE IF NOT EXISTS tracking_links (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  original_url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  recipient_id TEXT,
  contact_id TEXT,
  event_type TEXT NOT NULL,
  event_time TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS inbound_messages (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  contact_id TEXT,
  recipient TEXT,
  recipient_local TEXT,
  recipient_domain TEXT,
  sender TEXT NOT NULL,
  subject TEXT,
  body_text TEXT,
  body_html_ref TEXT,
  raw_email_ref TEXT,
  thread_key TEXT,
  classification TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_actions (
  id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  approved_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS inbound_messages_recipient_idx ON inbound_messages(recipient, created_at);
CREATE INDEX IF NOT EXISTS inbound_messages_recipient_domain_idx ON inbound_messages(recipient_domain, created_at);
`;

const initialized = new WeakSet<D1Database>();
const inFlight = new WeakMap<D1Database, Promise<void>>();

export async function ensureSchema(db: D1Database) {
  if (initialized.has(db)) return;
  const existing = inFlight.get(db);
  if (existing) return existing;

  const promise = runSchema(db).then(() => {
    initialized.add(db);
    inFlight.delete(db);
  }).catch((error) => {
    inFlight.delete(db);
    throw error;
  });
  inFlight.set(db, promise);
  return promise;
}

async function runSchema(db: D1Database) {
  const statements = SCHEMA_SQL
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (let index = 0; index < statements.length; index += 20) {
    const chunk = statements.slice(index, index + 20);
    await db.batch(chunk.map((statement) => db.prepare(statement)));
  }
  await addColumnIfMissing(db, "inbound_messages", "recipient", "TEXT");
  await addColumnIfMissing(db, "inbound_messages", "recipient_local", "TEXT");
  await addColumnIfMissing(db, "inbound_messages", "recipient_domain", "TEXT");
}

async function addColumnIfMissing(db: D1Database, table: string, column: string, type: string) {
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/duplicate column|already exists/i.test(message)) throw error;
  }
}
