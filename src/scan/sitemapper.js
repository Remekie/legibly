import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGES = 3; // check up to 3 pages beyond homepage — keep memory footprint small

/**
 * Fetch and check multiple pages for a site.
 * Uses sitemap to discover pages, then runs schema/metadata/content checks across all.
 * Returns aggregate multi-page signal data.
 */
export async function checkSitePages(originUrl) {
  const origin = new URL(originUrl).origin;
  const urls = await discoverPageUrls(origin, originUrl);

  if (urls.length === 0) {
    return { pagesChecked: 0, pageResults: [], aggregate: null };
  }

  const pageResults = await Promise.all(
    urls.map(url => checkPage(url))
  );

  const checked = pageResults.length;
  const withSchema       = pageResults.filter(p => p.hasSchema).length;
  const withTitle        = pageResults.filter(p => p.hasTitle).length;
  const withDescription  = pageResults.filter(p => p.hasDescription).length;
  const withH1           = pageResults.filter(p => p.hasH1).length;
  const withContent      = pageResults.filter(p => p.hasContent).length;
  const oversizedHtml    = pageResults.filter(p => p.htmlSizeKb > 500).length;

  return {
    pagesChecked: checked,
    pageResults,
    aggregate: {
      schema:      `${withSchema}/${checked}`,
      title:       `${withTitle}/${checked}`,
      description: `${withDescription}/${checked}`,
      h1:          `${withH1}/${checked}`,
      content:     `${withContent}/${checked}`,
      oversized:   oversizedHtml,
      schemaScore: withSchema / checked,
    },
  };
}

async function checkPage(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return pageFailResult(url);

    const html = await res.text();
    const $ = cheerio.load(html);

    const title       = $('title').first().text().trim();
    const description = $('meta[name="description"]').attr('content')?.trim() ?? '';
    const h1          = $('h1').first().text().trim();
    const hasSchema   = $('script[type="application/ld+json"]').length > 0;
    const htmlSizeKb  = Math.round(html.length / 1024);

    // Content depth: body text after removing nav/footer
    $('nav, footer, header, script, style').remove();
    const wordCount = ($('body').text().replace(/\s+/g, ' ').trim().split(' ')).filter(w => w.length > 2).length;

    return {
      url,
      reachable:      true,
      hasTitle:       title.length > 5,
      hasDescription: description.length >= 50,
      hasH1:          h1.length > 0,
      hasSchema,
      hasContent:     wordCount >= 100,
      htmlSizeKb,
      wordCount,
    };
  } catch {
    return pageFailResult(url);
  }
}

function pageFailResult(url) {
  return { url, reachable: false, hasTitle: false, hasDescription: false, hasH1: false, hasSchema: false, hasContent: false, htmlSizeKb: 0, wordCount: 0 };
}

async function discoverPageUrls(origin, homeUrl) {
  const sitemapUrls = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];

  for (const sitemapUrl of sitemapUrls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(sitemapUrl, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) continue;
      const xml = await res.text();

      const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)]
        .map(m => m[1].trim().replace(/&amp;/g, '&'))
        .filter(u => {
          try { return u.startsWith('http') && !!new URL(u) && u !== homeUrl; }
          catch { return false; }
        })
        .slice(0, MAX_PAGES);

      if (urls.length > 0) return urls;
    } catch {
      continue;
    }
  }

  return [];
}
