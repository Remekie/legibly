import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = 10_000;
const MIN_WORDS = 80;
const ANSWER_FIRST_PATTERN = /\b(we |our |i |they )?(provide|offer|help|build|create|make|sell|serve|specialize|deliver|design|develop)/i;

export async function checkContent(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { score: 0, detail: 'Could not fetch page to check content.' };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Remove nav, footer, script, style, form noise
    $('nav, footer, header, script, style, form, aside').remove();

    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    const words = bodyText.split(' ').filter(w => w.length > 2);

    if (words.length < MIN_WORDS) {
      return {
        score: 0,
        detail: "Your page has very little text content. AI engines have almost nothing to read or cite.",
      };
    }

    // Check first 60 words for answer-first pattern
    const firstWords = words.slice(0, 60).join(' ');
    const answersFirst = ANSWER_FIRST_PATTERN.test(firstWords);

    if (answersFirst) {
      return {
        score: 10,
        detail: 'Your page opens with a clear answer AI can cite ✓',
      };
    }

    return {
      score: 5,
      detail: "Your page has content but doesn't lead with a clear value statement. AI citation engines favor pages that answer questions in the first sentence.",
    };
  } catch {
    return {
      score: 0,
      detail: 'Could not check content — site may be blocking automated requests.',
    };
  }
}
