import * as cheerio from 'cheerio';
import { calculateVisibility } from '../scan/visibility.js';

const STOP_WORDS = new Set([
  'the','and','for','are','but','not','you','all','can','had','her','was',
  'one','our','out','has','have','been','will','with','this','that','from',
  'they','were','its','she','how','what','when','who','which','your','their',
]);

/**
 * Extract what AI crawlers actually read from a page.
 * Uses botHtml (Puppeteer/GPTBot view) to show exactly what gets ingested.
 */
export function extractAgentView(botHtml, humanHtml = null) {
  if (!botHtml) return null;

  const $ = cheerio.load(botHtml);
  $('nav, footer, header, script, style, form, aside, noscript').remove();

  const agentText = $('body').text().replace(/\s+/g, ' ').trim();
  const agentWordCount = agentText.split(/\s+/).filter(w => w.length > 2).length;

  // Missing words only meaningful when we have both views
  let missingWords = [];
  if (humanHtml) {
    const visibility = calculateVisibility(botHtml, humanHtml);
    missingWords = visibility.missingWords ?? [];
  }

  // First 300 words shown in free preview, rest locked
  const words = agentText.split(/\s+/);
  const preview = words.slice(0, 300).join(' ');
  const full    = agentText;

  return {
    preview,       // free: first 300 words
    full,          // paid: complete agent view
    agentWordCount,
    missingWords,  // paid: specific terms invisible to AI
  };
}
