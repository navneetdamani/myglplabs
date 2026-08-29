export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    mobile TEXT,
    zip_code TEXT NOT NULL,
    neighborhood TEXT NOT NULL,
    resident_type TEXT NOT NULL,
    preferred_channel TEXT NOT NULL,
    email_consent INTEGER NOT NULL DEFAULT 1,
    sms_consent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_signups_email_zip ON signups(email, zip_code)`,
  `CREATE INDEX IF NOT EXISTS idx_signups_zip ON signups(zip_code)`,
  `CREATE TABLE IF NOT EXISTS signup_interests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signup_id INTEGER NOT NULL,
    interest TEXT NOT NULL,
    FOREIGN KEY (signup_id) REFERENCES signups(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_signup_interests_interest ON signup_interests(interest)`,
  `CREATE TABLE IF NOT EXISTS campaign_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    campaign_type TEXT NOT NULL,
    category TEXT NOT NULL,
    neighborhood TEXT NOT NULL,
    zip_code TEXT NOT NULL,
    desired_timeframe TEXT NOT NULL,
    target_group_size INTEGER NOT NULL,
    description TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_campaign_requests_zip_category ON campaign_requests(zip_code, category)`,
];
