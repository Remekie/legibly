import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = 10_000;
const ORG_TYPES = new Set(['Organization', 'Corporation', 'LocalBusiness', 'ProfessionalService']);

export async function checkBrandTrust(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { score: 0, detail: 'Could not fetch page to check brand trust signals.' };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    let hasOrgSchema = false;
    let hasSameAs = false;

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() ?? '');
        const types = [].concat(data['@type'] ?? []);
        if (types.some(t => ORG_TYPES.has(t))) {
          hasOrgSchema = true;
          if (data.sameAs && [].concat(data.sameAs).length > 0) {
            hasSameAs = true;
          }
        }
      } catch {
        // malformed JSON-LD
      }
    });

    if (hasOrgSchema && hasSameAs) {
      return {
        score: 10,
        detail: 'AI can verify your business is real ✓ — organization schema and social profiles found',
      };
    }

    if (hasOrgSchema) {
      return {
        score: 5,
        detail: 'Business schema found, but no linked social profiles. AI has limited ability to verify your business is legitimate.',
      };
    }

    return {
      score: 0,
      detail: "AI has no way to verify your business exists beyond this page.",
    };
  } catch {
    return {
      score: 0,
      detail: 'Could not check brand trust signals — site may be blocking automated requests.',
    };
  }
}
