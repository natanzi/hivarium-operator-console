-- Forward-only evaluation-request configuration and customer origin metadata.

ALTER TABLE demo_requests ADD COLUMN technical_requirements TEXT NOT NULL DEFAULT '';
ALTER TABLE demo_requests ADD COLUMN proposed_admin_email TEXT NOT NULL DEFAULT '';
ALTER TABLE demo_requests ADD COLUMN proposed_max_agent_count TEXT NOT NULL DEFAULT '';
ALTER TABLE demo_requests ADD COLUMN proposed_token_allowance TEXT NOT NULL DEFAULT '';
ALTER TABLE demo_requests ADD COLUMN proposed_portal_access INTEGER NOT NULL DEFAULT 1;
ALTER TABLE demo_requests ADD COLUMN proposed_workspace_access INTEGER NOT NULL DEFAULT 0;
ALTER TABLE demo_requests ADD COLUMN welcome_email_status TEXT NOT NULL DEFAULT 'not_started';

ALTER TABLE customers ADD COLUMN origin_demo_request_id TEXT;
ALTER TABLE customers ADD COLUMN evaluation_expires_at TEXT;
ALTER TABLE customers ADD COLUMN evaluation_deployment_model TEXT;
ALTER TABLE customers ADD COLUMN approved_agent_capacity TEXT;
ALTER TABLE customers ADD COLUMN portal_membership_status TEXT;
