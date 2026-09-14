-- Demo-request intake, audit, provisioning jobs, and email outbox.
-- Operator Console is the workflow authority. Landing and Portal never write
-- these tables. Records are retained; there is no hard-delete path.

CREATE TABLE IF NOT EXISTS demo_requests (
  id TEXT PRIMARY KEY,
  public_reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (
    status IN (
      'submitted',
      'under_review',
      'needs_information',
      'approved',
      'provisioning',
      'active',
      'rejected',
      'expired',
      'provisioning_failed'
    )
  ),
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  applicant_name TEXT NOT NULL,
  applicant_email TEXT NOT NULL,
  organization_name TEXT NOT NULL,
  organization_domain TEXT NOT NULL,
  role_title TEXT NOT NULL DEFAULT '',
  use_case TEXT NOT NULL,
  deployment_preference TEXT NOT NULL,
  expected_agent_count TEXT NOT NULL DEFAULT '',
  requested_agent_ids_json TEXT NOT NULL DEFAULT '[]',
  infrastructure_notes TEXT NOT NULL DEFAULT '',
  timeline TEXT NOT NULL DEFAULT '',
  additional_details TEXT NOT NULL DEFAULT '',
  operator_notes TEXT NOT NULL DEFAULT '',
  customer_visible_notes TEXT NOT NULL DEFAULT '',
  proposed_customer_name TEXT NOT NULL,
  proposed_customer_domain TEXT NOT NULL,
  proposed_deployment_model TEXT NOT NULL,
  proposed_features_json TEXT NOT NULL DEFAULT '[]',
  proposed_agent_ids_json TEXT NOT NULL DEFAULT '[]',
  proposed_capacity_notes TEXT NOT NULL DEFAULT '',
  demo_start_at TEXT NOT NULL,
  demo_expires_at TEXT NOT NULL,
  provisioning_status TEXT NOT NULL DEFAULT 'not_started' CHECK (
    provisioning_status IN (
      'not_started',
      'in_progress',
      'succeeded',
      'failed'
    )
  ),
  provisioned_customer_id TEXT,
  approved_by TEXT,
  approved_at TEXT,
  rejected_by TEXT,
  rejected_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  intake_idempotency_key TEXT NOT NULL UNIQUE,
  intake_body_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_demo_requests_status ON demo_requests (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_demo_requests_email ON demo_requests (applicant_email);
CREATE INDEX IF NOT EXISTS idx_demo_requests_org ON demo_requests (organization_name);

CREATE TABLE IF NOT EXISTS demo_request_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES demo_requests (id),
  occurred_at TEXT NOT NULL,
  principal TEXT NOT NULL,
  action TEXT NOT NULL,
  correlation_id TEXT NOT NULL DEFAULT '',
  idempotency_hash TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_demo_request_events_request
  ON demo_request_events (request_id, occurred_at);

CREATE TRIGGER IF NOT EXISTS demo_request_events_no_update
BEFORE UPDATE ON demo_request_events
BEGIN
  SELECT RAISE(ABORT, 'demo_request_events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS demo_request_events_no_delete
BEFORE DELETE ON demo_request_events
BEGIN
  SELECT RAISE(ABORT, 'demo_request_events are append-only');
END;

CREATE TABLE IF NOT EXISTS demo_provisioning_jobs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES demo_requests (id),
  step TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT NOT NULL DEFAULT '',
  next_retry_at TEXT,
  correlation_id TEXT NOT NULL DEFAULT '',
  UNIQUE (request_id, step)
);

CREATE TABLE IF NOT EXISTS demo_email_outbox (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES demo_requests (id),
  template TEXT NOT NULL,
  to_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT NOT NULL DEFAULT '',
  provider_message_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_demo_email_outbox_status ON demo_email_outbox (status, created_at);
