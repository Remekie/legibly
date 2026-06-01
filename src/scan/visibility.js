import * as cheerio from 'cheerio';

const STOP_WORDS = new Set([
  'the','and','for','are','but','not','you','all','can','had','her','was',
  'one','our','out','has','have','been','will','with','this','that','from',
  'they','were','his','its','she','how','their','what','when','who','which',
]);

/**
 * Port of Compass llmo-checker.js calculateOverlap + extractVisibleText.
 * Compares what AI bots see (botHtml) vs what humans see (humanHtml).
 * Returns visibility score (0-100), missing word count, and sample missing words.
 */
export function calculateVisibility(botHtml, humanHtml) {
  const botText   = extractText(botHtml);
  const humanText = extractText(humanHtml);

  const botWords   = wordSet(botText);
  const humanWords = wordSet(humanText);

  const botWordCount   = countWords(botText);
  const humanWordCount = countWords(humanText);

  if (humanWordCount === 0) {
    return { visibilityPct: 100, botWordCount: 0, humanWordCount: 0, missingWordCount: 0, missingWords: [] };
  }

  // Score: % of unique human words also present in bot view
  let found = 0;
  const missingSet = new Set();

  for (const word of humanWords) {
    if (botWords.has(word)) {
      found++;
    } else {
      missingSet.add(word);
    }
  }

  const visibilityPct = Math.round((found / humanWords.size) * 100);
  const missingWords = [...missingSet]
    .filter(w => !STOP_WORDS.has(w) && w.length > 3)
    .slice(0, 15);

  return {
    visibilityPct,
    botWordCount,
    humanWordCount,
    missingWordCount: Math.max(0, humanWordCount - botWordCount),
    missingWords,
  };
}

function extractText(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, svg, [hidden]').remove();
  return ($('body').text() ?? '').replace(/\s+/g, ' ').trim();
}

function wordSet(text) {
  return new Set(
    text.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  );
}

function countWords(text) {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}
