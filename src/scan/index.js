import { checkPrerender } from './prerender.js';
import { checkRobots } from './robots.js';
import { checkLlmstxt } from './llmstxt.js';
import { checkSchema } from './schema.js';
import { checkContent } from './content.js';
import { checkBrandTrust } from './brandtrust.js';
import { checkMetadata } from './metadata.js';
import { checkSitePages } from './sitemapper.js';
import { toGrade } from './grade.js';

const FETCH_TIMEOUT_MS = 12_000;

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
  // Phase 1: parallel — prerender (Puppeteer), robots, llmstxt, shared HTML fetch, multi-page crawl
  const [prerender, robots, llmstxt, sharedHtml, sitePages] = await Promise.all([
    checkPrerender(url),
    checkRobots(url),
    checkLlmstxt(url),
    fetchSharedHtml(url),
    checkSitePages(url),
  ]);

  // Phase 2: HTML-dependent signals from shared fetch
  const [schema, content, eeat, metadata] = await Promise.all([
    checkSchema(url, sharedHtml),
    checkContent(url, sharedHtml),
    checkBrandTrust(url, sharedHtml),
    checkMetadata(url, sharedHtml),
  ]);

  // Enrich schema signal with multi-page data
  if (sitePages.aggregate && sitePages.pagesChecked > 1) {
    const agg = sitePages.aggregate;
    if (schema.score === 0 && agg.schemaScore === 0) {
      schema.detail = `No structured data found across ${sitePages.pagesChecked} pages checked. AI is guessing what your business is and what you offer.`;
    } else if (agg.schemaScore < 1) {
      schema.siteWide = `${agg.schema} pages have structured data`;
    }
    metadata.siteWide = {
      title:       agg.title,
      description: agg.description,
      h1:          agg.h1,
      content:     agg.content,
      oversized:   agg.oversized,
      pagesChecked: sitePages.pagesChecked,
    };
  }

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

  return { url, grade, score, blocker, signals, sitePages };
}
