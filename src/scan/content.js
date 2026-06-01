import * as cheerio from 'cheerio';

const MIN_WORDS = 80;
const ANSWER_FIRST_PATTERN = /\b(we |our |i |they )?(provide|offer|help|build|create|make|sell|serve|specialize|deliver|design|develop)/i;

export async function checkContent(url, html = null) {
  if (!html) {
    return { score: 0, detail: 'Could not reach page to check content.' };
  }

  try {
    const $ = cheerio.load(html);
    $('nav, footer, header, script, style, form, aside').remove();

    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    const words = bodyText.split(' ').filter(w => w.length > 2);

    if (words.length < MIN_WORDS) {
      return {
        score: 0,
        detail: "Your page has very little text content. AI engines have almost nothing to read or cite.",
      };
    }

    const firstWords = words.slice(0, 60).join(' ');
    const answersFirst = ANSWER_FIRST_PATTERN.test(firstWords);

    if (answersFirst) {
      return { score: 10, detail: 'Your page opens with a clear answer AI can cite ✓' };
    }

    return {
      score: 5,
      detail: "Your page has content but doesn't lead with a clear value statement. AI citation engines favor pages that answer questions in the first sentence.",
    };
  } catch {
    return { score: 0, detail: 'Could not parse page content.' };
  }
}
