import { verifyJwt, COOKIE_NAME } from './google.js';
import { getUserById } from '../db/users.js';

export function optionalAuth(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const payload = verifyJwt(token);
      req.user = getUserById(payload.userId);
    } catch {
      // expired or invalid — continue as unauthenticated
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.redirect(`/login.html?return=${encodeURIComponent(req.path)}`);
  try {
    const payload = verifyJwt(token);
    const user    = getUserById(payload.userId);
    if (!user) return res.redirect('/login.html');
    req.user = user;
    next();
  } catch {
    res.redirect('/login.html');
  }
}

export function requireAuthJson(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = verifyJwt(token);
    const user    = getUserById(payload.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
}
