import { randomUUID } from 'crypto';
import db from './index.js';

const SLOT_LIMITS = { fix: 10, monitor: 40 };

export function getPromptSlots(userId) {
  return db.prepare('SELECT * FROM monitoring_prompts WHERE user_id = ? ORDER BY created_at').all(userId);
}

export function addPromptSlot(userId, { prompt, url }, tier) {
  const limit  = SLOT_LIMITS[tier] ?? 10;
  const count  = db.prepare('SELECT COUNT(*) as n FROM monitoring_prompts WHERE user_id = ?').get(userId).n;
  if (count >= limit) throw new Error(`Slot limit reached (${limit} for ${tier} tier)`);
  const id = randomUUID();
  db.prepare('INSERT INTO monitoring_prompts (id, user_id, prompt, url) VALUES (?, ?, ?, ?)').run(id, userId, prompt, url ?? null);
  return id;
}

export function deletePromptSlot(id, userId) {
  const result = db.prepare('DELETE FROM monitoring_prompts WHERE id = ? AND user_id = ?').run(id, userId);
  return result.changes > 0;
}

export function getAllMonitoringPrompts() {
  return db.prepare(`
    SELECT mp.*, u.email, s.tier
    FROM monitoring_prompts mp
    JOIN users u ON mp.user_id = u.id
    LEFT JOIN subscriptions s ON s.user_id = mp.user_id AND s.status = 'active'
    ORDER BY mp.user_id
  `).all();
}
