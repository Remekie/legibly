import * as cheerio from 'cheerio';

const KEY_TYPES = new Set([
  'LocalBusiness', 'Organization', 'Corporation', 'Product', 'Service',
  'ProfessionalService', 'MedicalBusiness', 'Restaurant', 'Store',
]);

export async function checkSchema(url, html = null) {
  if (!html) {
    return { score: 0, detail: 'Could not reach page to check structured data.' };
  }

  try {
    const $ = cheerio.load(html);
    const blocks = [];

    $('script[type="application/ld+json"]').each((_, el) => {
      try { blocks.push(JSON.parse($(el).html() ?? '')); } catch { /* malformed */ }
    });

    if (blocks.length === 0) {
      return {
        score: 0,
        detail: "No structured data found. AI is guessing what your business is and what you offer.",
      };
    }

    const types = blocks.flatMap(b => [].concat(b['@type'] ?? [])).filter(Boolean);
    const hasKeyType = types.some(t => KEY_TYPES.has(t));

    if (hasKeyType) {
      return { score: 10, detail: 'AI knows exactly what your business does ✓ — structured data found' };
    }

    return {
      score: 5,
      detail: 'Some structured data found, but no business or service schema. AI has limited context about what you do.',
    };
  } catch {
    return { score: 0, detail: 'Could not parse structured data on this page.' };
  }
}
