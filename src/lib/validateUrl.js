import { lookup } from 'node:dns/promises';

// RFC 1918 + loopback + link-local + metadata endpoints
const BLOCKED = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,        // link-local + AWS/GCP metadata
  /^0\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
];

/**
 * Parse, validate, and SSRF-guard a user-supplied URL.
 * Throws with a user-safe message on any failure.
 * @param {string} raw - Raw user input
 * @returns {Promise<string>} Validated absolute URL (href)
 */
export async function validatePublicUrl(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('url is required');

  const href = raw.startsWith('http') ? raw : `https://${raw}`;

  let parsed;
  try {
    parsed = new URL(href);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL must use http or https');
  }

  // Resolve hostname and block private/internal addresses
  try {
    const { address } = await lookup(parsed.hostname);
    if (BLOCKED.some(r => r.test(address))) {
      throw new Error('URL resolves to a private address');
    }
  } catch (err) {
    if (err.message === 'URL resolves to a private address') throw err;
    // DNS lookup failed — surface as invalid URL
    throw new Error('Could not resolve URL');
  }

  return parsed.href;
}

/**
 * Sanitize a hostname for use in filenames and HTTP headers.
 * Strips anything that isn't alphanumeric, hyphen, or dot.
 */
export function safeFilename(hostname) {
  return hostname.replace('www.', '').replace(/[^a-z0-9.-]/gi, '_');
}
