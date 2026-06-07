import { randomBytes } from 'crypto';
import db from './index.js';

const EXPIRY_SECONDS = 15 * 60; // 15 minutes

export function createMagicLink(email) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + EXPIRY_SECONDS;
  db.prepare(`
    INSERT INTO magic_links (token, email, expires_at) VALUES (?, ?, ?)
  `).run(token, email.toLowerCase().trim(), expiresAt);
  return token;
}

const _verifyAndConsume = db.transaction((token) => {
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(
    'SELECT * FROM magic_links WHERE token = ? AND expires_at > ? AND used = 0'
  ).get(token, now);
  if (!row) return null;
  db.prepare('UPDATE magic_links SET used = 1 WHERE token = ?').run(token);
  return row.email;
});

export function verifyMagicLink(token) {
  return _verifyAndConsume(token);
}

export function cleanExpiredLinks() {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('DELETE FROM magic_links WHERE expires_at < ?').run(now);
}
