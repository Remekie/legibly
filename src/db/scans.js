import { randomUUID } from 'crypto';
import db from './index.js';

export function insertScan({ userId, url, grade, score, signals }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO scans (id, user_id, url, grade, score, signals)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userId ?? null, url, grade ?? null, score ?? null,
    signals ? JSON.stringify(signals) : null);
  return id;
}

export function getScanById(id) {
  const row = db.prepare('SELECT * FROM scans WHERE id = ?').get(id);
  return row ? { ...row, signals: row.signals ? JSON.parse(row.signals) : null } : null;
}

export function getScansByUser(userId, limit = 50) {
  return db.prepare(`
    SELECT s.*, r.tier, r.id as report_id
    FROM scans s
    LEFT JOIN reports r ON r.scan_id = s.id
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC
    LIMIT ?
  `).all(userId, limit).map(row => ({
    ...row,
    signals: row.signals ? JSON.parse(row.signals) : null,
  }));
}

export function getRecentScansByUrl(url, userId, limit = 10) {
  return db.prepare(`
    SELECT * FROM scans
    WHERE url = ? AND user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(url, userId, limit).map(row => ({
    ...row,
    signals: row.signals ? JSON.parse(row.signals) : null,
  }));
}

export function markScanFixed(scanId) {
  db.prepare('UPDATE scans SET fixed_at = unixepoch() WHERE id = ?').run(scanId);
}

export function getDailyFreeScans(userId) {
  const since = Math.floor(Date.now() / 1000) - 86400;
  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM scans
    WHERE user_id = ? AND created_at > ?
  `).get(userId, since);
  return row.cnt;
}
