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
