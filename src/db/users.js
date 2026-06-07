import db from './index.js';

export function upsertGoogleUser({ googleId, email, name, avatarUrl }) {
  return db.prepare(`
    INSERT INTO users (google_id, email, name, avatar_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(google_id) DO UPDATE SET
      email      = excluded.email,
      name       = excluded.name,
      avatar_url = excluded.avatar_url
    RETURNING *
  `).get(googleId, email, name, avatarUrl);
}

export function upsertEmailUser(email) {
  return db.prepare(`
    INSERT INTO users (email)
    VALUES (?)
    ON CONFLICT(email) DO UPDATE SET email = excluded.email
    RETURNING *
  `).get(email);
}

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

export function getBrandSettings(userId) {
  return db.prepare('SELECT * FROM brand_settings WHERE user_id = ?').get(userId);
}

export function saveBrandSettings(userId, { name, domain, description, providers, notifyWeekly, notifyGrade, notifyProduct }) {
  db.prepare(`
    INSERT INTO brand_settings (user_id, name, domain, description, providers, notify_weekly, notify_grade, notify_product, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(user_id) DO UPDATE SET
      name           = excluded.name,
      domain         = excluded.domain,
      description    = excluded.description,
      providers      = excluded.providers,
      notify_weekly  = excluded.notify_weekly,
      notify_grade   = excluded.notify_grade,
      notify_product = excluded.notify_product,
      updated_at     = unixepoch()
  `).run(userId, name ?? null, domain ?? null, description ?? null,
    JSON.stringify(providers ?? ['perplexity', 'gemini']),
    notifyWeekly ? 1 : 0, notifyGrade ? 1 : 0, notifyProduct ? 1 : 0);
}
