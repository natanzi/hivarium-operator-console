CREATE TABLE IF NOT EXISTS license_auto_suspensions (
    license_id TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    suspended_at TEXT NOT NULL
);
