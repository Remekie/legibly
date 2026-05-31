import { checkPrerender } from './prerender.js';
import { checkRobots } from './robots.js';
import { toGrade } from './grade.js';

/**
 * Run all 6 signals against a URL and return a scored result.
 * @param {string} url - Validated, absolute URL
 * @returns {Promise<ScanResult>}
 */
export async function scan(url) {
  const [prerender, robots] = await Promise.all([
    checkPrerender(url),
    checkRobots(url),
  ]);

  // Remaining 4 signals (geo-audit, llmstxt, content, eeat) — Week 1 stubs
  const signals = {
    prerender,   // 25%
    robots,      // 20%
    schema:      { score: 0, detail: 'Not yet implemented' },  // 15%
    llmstxt:     { score: 0, detail: 'Not yet implemented' },  // 15%
    content:     { score: 0, detail: 'Not yet implemented' },  // 15%
    eeat:        { score: 0, detail: 'Not yet implemented' },  // 10%
  };

  const { grade, score, blocker } = toGrade(signals);

  return { url, grade, score, blocker, signals };
}

/**
 * @typedef {Object} ScanResult
 * @property {string} url
 * @property {string} grade  - A | B | C | D | F
 * @property {number} score  - 0–100
 * @property {string|null} blocker - Plain-English blocker line, or null
 * @property {Object} signals
 */
