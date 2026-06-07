import { randomUUID } from 'crypto';
import db from './index.js';

export function insertReport({ scanId, tier, report }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO reports (id, scan_id, tier, report)
    VALUES (?, ?, ?, ?)
  `).run(id, scanId, tier ?? 'report', JSON.stringify(report));
  return id;
}

export function getReportById(id) {
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  return row ? { ...row, report: row.report ? JSON.parse(row.report) : null } : null;
}

export function getReportByScan(scanId) {
  const row = db.prepare('SELECT * FROM reports WHERE scan_id = ? ORDER BY created_at DESC LIMIT 1').get(scanId);
  return row ? { ...row, report: row.report ? JSON.parse(row.report) : null } : null;
}

export function setReportPublic(id, isPublic) {
  db.prepare('UPDATE reports SET public = ? WHERE id = ?').run(isPublic ? 1 : 0, id);
}

export function canAccessReport(reportId, userId) {
  const row = db.prepare(`
    SELECT r.id, r.public, s.user_id
    FROM reports r JOIN scans s ON r.scan_id = s.id
    WHERE r.id = ?
  `).get(reportId);
  if (!row) return false;
  return row.public === 1 || row.user_id === userId;
}

export function ownsReport(reportId, userId) {
  const row = db.prepare(`
    SELECT s.user_id FROM reports r JOIN scans s ON r.scan_id = s.id WHERE r.id = ?
  `).get(reportId);
  return row?.user_id === userId;
}
