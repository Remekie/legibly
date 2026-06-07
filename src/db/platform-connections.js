import { randomUUID } from 'crypto';
import db from './index.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS platform_connections (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform   TEXT NOT NULL,
    url        TEXT NOT NULL,
    api_token  TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_platform_user ON platform_connections(user_id, platform);
`);

export function saveConnection({ userId, platform, url, apiToken }) {
  // One connection per user per platform per URL
  const existing = db.prepare(
    'SELECT id FROM platform_connections WHERE user_id = ? AND platform = ? AND url = ?'
  ).get(userId, platform, url);

  if (existing) {
    db.prepare('UPDATE platform_connections SET api_token = ? WHERE id = ?').run(apiToken, existing.id);
    return existing.id;
  }
  const id = randomUUID();
  db.prepare('INSERT INTO platform_connections (id, user_id, platform, url, api_token) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, platform, url, apiToken);
  return id;
}

export function getConnection(userId, platform, url) {
  return db.prepare(
    'SELECT * FROM platform_connections WHERE user_id = ? AND platform = ? AND url = ?'
  ).get(userId, platform, url);
}

export function getUserConnections(userId) {
  return db.prepare('SELECT * FROM platform_connections WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

export function deleteConnection(id, userId) {
  db.prepare('DELETE FROM platform_connections WHERE id = ? AND user_id = ?').run(id, userId);
}
