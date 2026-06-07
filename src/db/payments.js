import { randomUUID } from 'crypto';
import db from './index.js';

export function insertPayment({ userId, stripeSessionId, tier, amountCents, scanId }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO payments (id, user_id, stripe_session_id, tier, amount_cents, scan_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userId ?? null, stripeSessionId, tier, amountCents ?? null, scanId ?? null);
  return id;
}

export function getPaymentBySession(stripeSessionId) {
  return db.prepare('SELECT * FROM payments WHERE stripe_session_id = ?').get(stripeSessionId);
}

export function getUserPayments(userId) {
  return db.prepare(`
    SELECT p.*, s.url, s.grade
    FROM payments p
    LEFT JOIN scans s ON p.scan_id = s.id
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(userId);
}

export function getHighestTierForUser(userId) {
  const TIER_ORDER = { deploy: 3, report: 2, snapshot: 1 };
  const payments = db.prepare(`
    SELECT tier FROM payments WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId);
  if (!payments.length) return null;
  return payments.reduce((best, { tier }) =>
    (TIER_ORDER[tier] ?? 0) > (TIER_ORDER[best] ?? 0) ? tier : best,
    payments[0].tier
  );
}
