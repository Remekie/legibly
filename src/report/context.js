import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = 12_000;
const ERROR_TITLES = /^(403|404|500|forbidden|not found|error|access denied|unauthorized)/i;

export async function extractContext(url) {
  const domain = new URL(url).hostname.replace('www.', '');
  const fallback = { url, title: domain, description: '', h1: '', h2s: [], ogImage: '', bodyText: '', location: '', domain };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    // If server returns an error status, use domain as fallback — don't parse error pages
    if (!res.ok) return fallback;

    const html = await res.text();
    const $ = cheerio.load(html);

    $('nav, footer, header, script, style, form, aside, noscript').remove();

    const rawTitle = $('title').first().text().trim();
    // If title looks like an error page, fall back to domain
    const title = ERROR_TITLES.test(rawTitle) ? domain : (rawTitle || domain);

    const description = $('meta[name="description"]').attr('content')?.trim() ?? '';
    const h1          = $('h1').first().text().trim();
    const h2s         = $('h2').map((_, el) => $(el).text().trim()).toArray().slice(0, 8);
    const ogImage     = $('meta[property="og:image"]').attr('content')?.trim() ?? '';

    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    const first500 = bodyText.split(' ').slice(0, 500).join(' ');

    const locationMatch = bodyText.match(
      /\b(in|serving|based in|located in|near)\s+([A-Z][a-z]+(?:[\s,]+[A-Z][a-z]+)*)/
    );
    const location = locationMatch?.[2] ?? '';

    return { url, title, description, h1, h2s, ogImage, bodyText: first500, location, domain };
  } catch {
    return fallback;
  }
}
