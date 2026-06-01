import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = 10_000;
const KEY_TYPES = new Set([
  'LocalBusiness', 'Organization', 'Corporation', 'Product', 'Service',
  'ProfessionalService', 'MedicalBusiness', 'Restaurant', 'Store',
]);

export async function checkSchema(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { score: 0, detail: 'Could not fetch page to check structured data.' };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const blocks = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const parsed = JSON.parse($(el).html() ?? '');
        blocks.push(parsed);
      } catch {
        // malformed JSON-LD — skip
      }
    });

    if (blocks.length === 0) {
      return {
        score: 0,
        detail: "No structured data found. AI is guessing what your business is and what you offer.",
      };
    }

    const types = blocks.flatMap(b => {
      const t = b['@type'];
      return Array.isArray(t) ? t : [t];
    }).filter(Boolean);

    const hasKeyType = types.some(t => KEY_TYPES.has(t));

    if (hasKeyType) {
      return {
        score: 10,
        detail: 'AI knows exactly what your business does ✓ — structured data found',
      };
    }

    return {
      score: 5,
      detail: 'Some structured data found, but no business or service schema. AI has limited context about what you do.',
    };
  } catch {
    return {
      score: 0,
      detail: 'Could not check structured data — site may be blocking automated requests.',
    };
  }
}
