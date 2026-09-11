-- Hivarium Operator Console — D1 schema (Phase 3, D-01).
--
-- Mirrors the canonical DataStore collections from src/domain/types.ts one
-- to one. Deterministic ids are primary keys; ISO-8601 timestamps are TEXT;
-- JSON columns appear only on audit_entries (before/after snapshots).
--
-- Invariants enforced here:
--   * ledger_transactions and usage_records are append-only (D-12): UPDATE
--     and DELETE are rejected by triggers; balances are always derived from
--     the rows, never stored.
--   * audit_entries are immutable (D-06): UPDATE and DELETE are rejected by
--     triggers; audit rows are written only inside the same D1 batch as the
--     mutation they record.
--   * customers cannot be hard-deleted once dependent records exist; the API
--     replaces deletion with the archive command (D-05).
--   * CHECK constraints reject impossible statuses, ledger kinds, and
--     per-kind token amounts before any row is written.

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  domain     TEXT NOT NULL,
  contact    TEXT NOT NULL,
  email      TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (
    status IN ('evaluation', 'active', 'paused', 'churned', 'archived')
  ),
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Commercial arrangements
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS commercial_arrangements (
  id                         TEXT PRIMARY KEY,
  customer_id                TEXT NOT NULL REFERENCES customers (id),
  model                      TEXT NOT NULL CHECK (model IN ('monthly', 'prepaid', 'annual')),
  status                     TEXT NOT NULL CHECK (
    status IN ('active', 'scheduled', 'ended', 'terminated')
  ),
  effective_from             TEXT NOT NULL,
  effective_to               TEXT,
  created_at                 TEXT NOT NULL,
  reason                     TEXT NOT NULL,
  replaced_by_arrangement_id TEXT,
  -- monthly model
  currency                   TEXT,
  billing_cadence            TEXT,
  monthly_amount_cents       INTEGER,
  renews_at                  TEXT,
  -- prepaid model
  warning_threshold_tokens   INTEGER,
  expires_at                 TEXT,
  notes                      TEXT,
  -- annual model
  contract_value_cents       INTEGER,
  starts_at                  TEXT,
  ends_at                    TEXT,
  renewal_status             TEXT,
  included_allowance         INTEGER,
  allowance_unit             TEXT,
  overage_rate_cents_per_unit INTEGER
);

CREATE INDEX IF NOT EXISTS idx_commercial_arrangements_customer
  ON commercial_arrangements (customer_id);

-- ---------------------------------------------------------------------------
-- Agent access grants
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_access_grants (
  id                  TEXT PRIMARY KEY,
  customer_id         TEXT NOT NULL REFERENCES customers (id),
  agent_product_id    TEXT NOT NULL REFERENCES agent_products (id),
  starts_at           TEXT NOT NULL,
  ends_at             TEXT,
  created_at          TEXT NOT NULL,
  revoked_at          TEXT,
  scheduled_revoke_at TEXT,
  activity_event_id   TEXT,
  reason_for_change   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_access_grants_customer
  ON agent_access_grants (customer_id);

-- ---------------------------------------------------------------------------
-- Activity events (commercial/access timeline)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS activity_events (
  id              TEXT PRIMARY KEY,
  occurred_at     TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('operator', 'system', 'migration')),
  type            TEXT NOT NULL,
  customer_id     TEXT NOT NULL REFERENCES customers (id),
  label           TEXT NOT NULL,
  subject_id      TEXT NOT NULL,
  subject_id2     TEXT,
  resulting_state TEXT NOT NULL,
  causation_id    TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_events_customer
  ON activity_events (customer_id);

-- ---------------------------------------------------------------------------
-- Immutable token ledger (append-only, D-12)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id                     TEXT PRIMARY KEY,
  customer_id            TEXT NOT NULL REFERENCES customers (id),
  occurred_at            TEXT NOT NULL,
  kind                   TEXT NOT NULL CHECK (
    kind IN ('credit_grant', 'usage_debit', 'manual_adjustment', 'reversal')
  ),
  amount_tokens          INTEGER NOT NULL CHECK (
    (kind = 'credit_grant' AND amount_tokens > 0) OR
    (kind = 'usage_debit' AND amount_tokens < 0) OR
    (kind = 'manual_adjustment' AND amount_tokens <> 0) OR
    (kind = 'reversal' AND amount_tokens <> 0)
  ),
  reason                 TEXT NOT NULL,
  reference              TEXT NOT NULL,
  usage_record_id        TEXT,
  agent_product_id       TEXT,
  reverses_transaction_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_ledger_transactions_customer
  ON ledger_transactions (customer_id);

-- ---------------------------------------------------------------------------
-- Operational usage records (append-only, D-12)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS usage_records (
  id                   TEXT PRIMARY KEY,
  customer_id          TEXT NOT NULL REFERENCES customers (id),
  agent_product_id     TEXT NOT NULL REFERENCES agent_products (id),
  occurred_at          TEXT NOT NULL,
  token_quantity       INTEGER NOT NULL CHECK (token_quantity > 0),
  source_reference     TEXT NOT NULL,
  ledger_transaction_id TEXT NOT NULL,
  UNIQUE (customer_id, source_reference)
);

CREATE INDEX IF NOT EXISTS idx_usage_records_customer
  ON usage_records (customer_id);

-- ---------------------------------------------------------------------------
-- Immutable operator audit trail (D-06)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_entries (
  id             TEXT PRIMARY KEY,
  occurred_at    TEXT NOT NULL,
  operator_email TEXT NOT NULL,
  operator_sub   TEXT NOT NULL,
  action         TEXT NOT NULL,
  customer_id    TEXT,
  subject_type   TEXT NOT NULL,
  subject_id     TEXT NOT NULL,
  summary        TEXT NOT NULL,
  before_json    TEXT,
  after_json     TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_entries_customer
  ON audit_entries (customer_id);
CREATE INDEX IF NOT EXISTS idx_audit_entries_occurred_at
  ON audit_entries (occurred_at);

-- ---------------------------------------------------------------------------
-- Feature entitlements and agent catalog
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS feature_entitlements (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers (id),
  feature     TEXT NOT NULL,
  description TEXT NOT NULL,
  granted_at  TEXT NOT NULL,
  expires_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_feature_entitlements_customer
  ON feature_entitlements (customer_id);

CREATE TABLE IF NOT EXISTS agent_products (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  category    TEXT NOT NULL,
  version     TEXT NOT NULL,
  plans_json  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Append-only / immutability triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS ledger_transactions_no_update
BEFORE UPDATE ON ledger_transactions
BEGIN
  SELECT RAISE(ABORT, 'ledger_transactions is append-only, updates are forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS ledger_transactions_no_delete
BEFORE DELETE ON ledger_transactions
BEGIN
  SELECT RAISE(ABORT, 'ledger_transactions is append-only, deletes are forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS usage_records_no_update
BEFORE UPDATE ON usage_records
BEGIN
  SELECT RAISE(ABORT, 'usage_records is append-only, updates are forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS usage_records_no_delete
BEFORE DELETE ON usage_records
BEGIN
  SELECT RAISE(ABORT, 'usage_records is append-only, deletes are forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS audit_entries_no_update
BEFORE UPDATE ON audit_entries
BEGIN
  SELECT RAISE(ABORT, 'audit_entries is immutable, updates are forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS audit_entries_no_delete
BEFORE DELETE ON audit_entries
BEGIN
  SELECT RAISE(ABORT, 'audit_entries is immutable, deletes are forbidden.');
END;

-- Archive replaces delete (D-05): a customer with any dependent record can
-- never be hard-deleted through the database.
CREATE TRIGGER IF NOT EXISTS customers_no_delete_with_dependents
BEFORE DELETE ON customers
BEGIN
  SELECT RAISE(ABORT, 'customers cannot be deleted, archive instead.')
  WHERE EXISTS (SELECT 1 FROM commercial_arrangements WHERE customer_id = OLD.id)
     OR EXISTS (SELECT 1 FROM agent_access_grants WHERE customer_id = OLD.id)
     OR EXISTS (SELECT 1 FROM activity_events WHERE customer_id = OLD.id)
     OR EXISTS (SELECT 1 FROM ledger_transactions WHERE customer_id = OLD.id)
     OR EXISTS (SELECT 1 FROM usage_records WHERE customer_id = OLD.id)
     OR EXISTS (SELECT 1 FROM feature_entitlements WHERE customer_id = OLD.id);
END;