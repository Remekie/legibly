import { checkPrerender } from './prerender.js';
import { checkRobots } from './robots.js';
import { checkLlmstxt } from './llmstxt.js';
import { checkSchema } from './schema.js';
import { checkContent } from './content.js';
import { checkBrandTrust } from './brandtrust.js';
import { checkMetadata } from './metadata.js';
import { toGrade } from './grade.js';

/**
 * Run all 6 signals against a URL and return a scored result.
 * @param {string} url - Validated, absolute URL
 * @returns {Promise<ScanResult>}
 */
export async function scan(url) {
  const [prerender, robots, llmstxt, schema, content, eeat, metadata] = await Promise.all([
    checkPrerender(url),
    checkRobots(url),
    checkLlmstxt(url),
    checkSchema(url),
    checkContent(url),
    checkBrandTrust(url),
    checkMetadata(url),
  ]);

  const signals = {
    prerender, // 25%
    robots,    // 20%
    schema,    // 15%
    llmstxt,   // 15%
    content,   // 13%
    eeat,      // 9%
    metadata,  // 13% — title, meta desc, OG tags, H1, noindex
  };

  const { grade, score, blocker } = toGrade(signals);

  return { url, grade, score, blocker, signals };
}
