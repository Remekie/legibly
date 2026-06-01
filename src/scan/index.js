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

  const signals = {
    prerender,                                                          // 25%
    robots,                                                             // 20%
    schema:  { score: 0, stub: true, detail: 'Coming in full report' }, // 15%
    llmstxt: { score: 0, stub: true, detail: 'Coming in full report' }, // 15%
    content: { score: 0, stub: true, detail: 'Coming in full report' }, // 15%
    eeat:    { score: 0, stub: true, detail: 'Coming in full report' }, // 10%
  };

  const { grade, score, blocker } = toGrade(signals);

  return { url, grade, score, blocker, signals };
}
