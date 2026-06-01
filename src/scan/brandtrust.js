import * as cheerio from 'cheerio';

const ORG_TYPES = new Set(['Organization', 'Corporation', 'LocalBusiness', 'ProfessionalService']);

export async function checkBrandTrust(url, html = null) {
  if (!html) {
    return { score: 0, detail: 'Could not reach page to check brand trust signals.' };
  }

  try {
    const $ = cheerio.load(html);
    let hasOrgSchema = false;
    let hasSameAs = false;

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() ?? '');
        const types = [].concat(data['@type'] ?? []);
        if (types.some(t => ORG_TYPES.has(t))) {
          hasOrgSchema = true;
          if ([].concat(data.sameAs ?? []).length > 0) hasSameAs = true;
        }
      } catch { /* malformed */ }
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
    return { score: 0, detail: 'Could not parse brand trust signals.' };
  }
}
