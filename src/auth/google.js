import { createHmac, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { upsertGoogleUser } from '../db/users.js';

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USER_URL  = 'https://www.googleapis.com/oauth2/v3/userinfo';

const JWT_SECRET  = process.env.JWT_SECRET ?? 'legibly-dev-jwt-secret-change-in-prod';
const JWT_EXPIRY  = '30d';
const COOKIE_NAME = 'legibly_session';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  path: '/',
};

export function signJwt(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyJwt(token) {
  return jwt.verify(token, JWT_SECRET);
}

export { COOKIE_NAME, COOKIE_OPTS };

function stateHmac(state) {
  return createHmac('sha256', JWT_SECRET).update(state).digest('hex').slice(0, 16);
}

export function getGoogleAuthUrl(redirectUri) {
  const state = randomBytes(16).toString('hex');
  const sig   = stateHmac(state);
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'openid email profile',
    state:         `${state}.${sig}`,
    prompt:        'select_account',
  });
  return { url: `${GOOGLE_AUTH_URL}?${params}`, state };
}

export function validateGoogleState(stateParam) {
  const [state, sig] = (stateParam ?? '').split('.');
  if (!state || !sig) return false;
  return stateHmac(state) === sig;
}

export async function exchangeGoogleCode(code, redirectUri) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }),
  });
  if (!res.ok) throw new Error('Token exchange failed');
  return res.json();
}

export async function fetchGoogleUser(accessToken) {
  const res = await fetch(GOOGLE_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Could not fetch Google user');
  return res.json();
}

export function setSessionCookie(res, user) {
  const token = signJwt({ userId: user.id, email: user.email, name: user.name });
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export async function handleGoogleCallback(code, redirectUri) {
  const tokens   = await exchangeGoogleCode(code, redirectUri);
  const profile  = await fetchGoogleUser(tokens.access_token);
  const user     = upsertGoogleUser({
    googleId:  profile.sub,
    email:     profile.email,
    name:      profile.name,
    avatarUrl: profile.picture,
  });
  return user;
}
