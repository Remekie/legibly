import { checkPrerender } from './prerender.js';
import { checkRobots } from './robots.js';
import { checkLlmstxt } from './llmstxt.js';
import { checkSchema } from './schema.js';
import { checkContent } from './content.js';
import { checkBrandTrust } from './brandtrust.js';
import { checkMetadata } from './metadata.js';
import { toGrade } from './grade.js';

const FETCH_TIMEOUT_MS = 12_000;

/**
 * Fetch the page HTML once and share it across schema, content, brandtrust, metadata.
 * Avoids 4 independent fetches that all hit rate limiting / Cloudflare together.
 */
async function fetchSharedHtml(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function scan(url) {
  // Fetch page HTML once — shared by schema, content, brandtrust, metadata
  const [prerender, robots, llmstxt, sharedHtml] = await Promise.all([
    checkPrerender(url),
    checkRobots(url),
    checkLlmstxt(url),
    fetchSharedHtml(url),
  ]);

  // Run HTML-dependent signals in parallel using the shared fetch result
  const [schema, content, eeat, metadata] = await Promise.all([
    checkSchema(url, sharedHtml),
    checkContent(url, sharedHtml),
    checkBrandTrust(url, sharedHtml),
    checkMetadata(url, sharedHtml),
  ]);

  const signals = {
    prerender, // 25%
    robots,    // 20%
    schema,    // 15%
    llmstxt,   // 15%
    content,   // 13%
    eeat,      // 9%
    metadata,  // 13%
  };

  const { grade, score, blocker } = toGrade(signals);

  return { url, grade, score, blocker, signals };
}
