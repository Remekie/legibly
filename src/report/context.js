import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = 12_000;

/**
 * Fetch a page and extract structured business context.
 * Used by all report sections so we only fetch once.
 */
export async function extractContext(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: controller.signal,
  });
  clearTimeout(timer);

  const html = await res.text();
  const $ = cheerio.load(html);

  $('nav, footer, header, script, style, form, aside, noscript').remove();

  const title       = $('title').first().text().trim();
  const description = $('meta[name="description"]').attr('content')?.trim() ?? '';
  const h1          = $('h1').first().text().trim();
  const h2s         = $('h2').map((_, el) => $(el).text().trim()).toArray().slice(0, 8);
  const ogImage     = $('meta[property="og:image"]').attr('content')?.trim() ?? '';

  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const first500 = bodyText.split(' ').slice(0, 500).join(' ');

  // Heuristic: detect location from content or URL
  const locationMatch = bodyText.match(
    /\b(in|serving|based in|located in|near)\s+([A-Z][a-z]+(?:[\s,]+[A-Z][a-z]+)*)/
  );
  const location = locationMatch?.[2] ?? '';

  return {
    url,
    title,
    description,
    h1,
    h2s,
    ogImage,
    bodyText: first500,
    location,
    domain: new URL(url).hostname.replace('www.', ''),
  };
}
