import { randomUUID } from 'crypto';
import db from './index.js';

const TIER_ORDER = { snapshot: 1, fix: 2, monitor: 3, deploy: 4 };

export function upsertSubscription({ userId, stripeCustomerId, stripeSubscriptionId, tier, status, currentPeriodEnd }) {
  const existing = db.prepare(
    'SELECT id FROM subscriptions WHERE stripe_subscription_id = ?'
  ).get(stripeSubscriptionId);

  if (existing) {
    db.prepare(`
      UPDATE subscriptions
      SET status = ?, tier = ?, current_period_end = ?, stripe_customer_id = ?,
          user_id = COALESCE(user_id, ?)
      WHERE stripe_subscription_id = ?
    `).run(status, tier, currentPeriodEnd ?? null, stripeCustomerId ?? null,
           userId ?? null, stripeSubscriptionId);
    return existing.id;
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO subscriptions (id, user_id, stripe_customer_id, stripe_subscription_id, tier, status, current_period_end)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId ?? null, stripeCustomerId ?? null, stripeSubscriptionId, tier, status, currentPeriodEnd ?? null);
  return id;
}

export function getActiveSubscription(userId) {
  const now = Math.floor(Date.now() / 1000);
  return db.prepare(`
    SELECT * FROM subscriptions
    WHERE user_id = ? AND status = 'active' AND (current_period_end IS NULL OR current_period_end > ?)
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, now);
}

export function cancelSubscription(stripeSubscriptionId) {
  db.prepare(
    "UPDATE subscriptions SET status = 'canceled' WHERE stripe_subscription_id = ?"
  ).run(stripeSubscriptionId);
}

export function getHighestActiveTier(userId) {
  const sub = getActiveSubscription(userId);
  if (sub) return sub.tier;

  // Fall back to one-time payments (deploy tier)
  const payments = db.prepare(
    "SELECT tier FROM payments WHERE user_id = ? ORDER BY created_at DESC"
  ).all(userId);
  if (!payments.length) return null;
  return payments.reduce((best, { tier }) =>
    (TIER_ORDER[tier] ?? 0) > (TIER_ORDER[best] ?? 0) ? tier : best,
    payments[0].tier
  );
}

export function getAllActiveSubscribers(tier) {
  const now = Math.floor(Date.now() / 1000);
  return db.prepare(`
    SELECT DISTINCT s.user_id, u.email, s.tier
    FROM subscriptions s
    JOIN users u ON s.user_id = u.id
    WHERE s.status = 'active'
      AND (s.current_period_end IS NULL OR s.current_period_end > ?)
      AND (? IS NULL OR s.tier = ?)
  `).all(now, tier ?? null, tier ?? null);
}
