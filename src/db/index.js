import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data');
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, 'legibly.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id    TEXT UNIQUE,
    email        TEXT UNIQUE NOT NULL,
    name         TEXT,
    avatar_url   TEXT,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS scans (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    url        TEXT NOT NULL,
    grade      TEXT,
    score      INTEGER,
    signals    TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS reports (
    id         TEXT PRIMARY KEY,
    scan_id    TEXT REFERENCES scans(id) ON DELETE CASCADE,
    tier       TEXT NOT NULL DEFAULT 'report',
    report     TEXT,
    public     INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS payments (
    id                TEXT PRIMARY KEY,
    user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
    stripe_session_id TEXT UNIQUE,
    tier              TEXT NOT NULL,
    amount_cents      INTEGER,
    scan_id           TEXT REFERENCES scans(id) ON DELETE SET NULL,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS magic_links (
    token      TEXT PRIMARY KEY,
    email      TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS brand_settings (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT,
    domain      TEXT,
    description TEXT,
    providers   TEXT NOT NULL DEFAULT '["perplexity","gemini"]',
    notify_weekly  INTEGER NOT NULL DEFAULT 1,
    notify_grade   INTEGER NOT NULL DEFAULT 0,
    notify_product INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id                     TEXT PRIMARY KEY,
    user_id                INTEGER REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id     TEXT,
    stripe_subscription_id TEXT UNIQUE,
    tier                   TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'active',
    current_period_end     INTEGER,
    created_at             INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_subscriptions_user   ON subscriptions(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);

  CREATE TABLE IF NOT EXISTS monitoring_prompts (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt     TEXT NOT NULL,
    url        TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_mon_prompts_user ON monitoring_prompts(user_id);
  CREATE INDEX IF NOT EXISTS idx_scans_user ON scans(user_id, created_at DESC);

  -- Migration: add fixed_at if not present (safe on existing DBs)

  CREATE INDEX IF NOT EXISTS idx_scans_url  ON scans(url, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_reports_scan ON reports(scan_id);
  CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(email, expires_at);
`);

// Safe migrations — add columns that may not exist on older DBs
try { db.exec('ALTER TABLE scans ADD COLUMN fixed_at INTEGER'); } catch { /* already exists */ }

export default db;
