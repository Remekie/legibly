import FirecrawlApp from 'firecrawl';
import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGES = 12;

/**
 * Auto-generate llms.txt content for a site.
 * Uses Firecrawl when FIRECRAWL_API_KEY is set (returns clean markdown per page).
 * Falls back to sitemap-based manual fetch when key is not available.
 */
export async function generateLlmstxt(url) {
  const origin = new URL(url).origin;
  const domain = new URL(url).hostname.replace('www.', '');

  if (process.env.FIRECRAWL_API_KEY) {
    return generateWithFirecrawl(url, domain, origin);
  }

  return generateManually(url, domain, origin);
}

// ── Firecrawl path ────────────────────────────────────────────────────────────

async function generateWithFirecrawl(url, domain, origin) {
  try {
    const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

    // Crawl the site — returns markdown per page, handles JS rendering
    const result = await app.crawlUrl(url, {
      limit: MAX_PAGES,
      scrapeOptions: { formats: ['markdown', 'links'] },
    });

    if (!result.success || !result.data?.length) {
      return generateManually(url, domain, origin);
    }

    const pages = result.data;
    const home  = pages.find(p => p.metadata?.sourceURL === url || p.metadata?.sourceURL === origin + '/') ?? pages[0];

    const lines = [];
    lines.push(`# ${home?.metadata?.title?.split('|')[0]?.trim() ?? domain}`);
    lines.push('');

    if (home?.metadata?.description) {
      lines.push(`> ${home.metadata.description}`);
      lines.push('');
    }

    lines.push('## Pages');
    lines.push('');

    for (const page of pages.slice(0, MAX_PAGES)) {
      const pageUrl   = page.metadata?.sourceURL ?? url;
      const pageTitle = page.metadata?.title?.split('|')[0]?.trim() ?? urlToLabel(pageUrl);
      const pageDesc  = page.metadata?.description ?? '';
      const desc      = pageDesc ? `: ${pageDesc}` : '';
      lines.push(`- [${pageTitle}](${pageUrl})${desc}`);
    }

    lines.push('');
    lines.push('## About');
    lines.push('');
    lines.push(`${home?.metadata?.title?.split('|')[0]?.trim() ?? domain} — ${home?.metadata?.description ?? 'No description available.'}`);

    return {
      content:    lines.join('\n'),
      pageCount:  pages.length,
      uploadPath: '/llms.txt',
      source:     'firecrawl',
    };
  } catch (err) {
    process.stderr.write(`[firecrawl error] ${err.message} — falling back to manual\n`);
    return generateManually(url, domain, origin);
  }
}

// ── Manual fallback path ──────────────────────────────────────────────────────

async function generateManually(url, domain, origin) {
  const homeContext = await fetchPageMeta(url);
  const pages = await fetchSitemapPages(origin);

  const lines = [];
  lines.push(`# ${homeContext.title || domain}`);
  lines.push('');
  if (homeContext.description) {
    lines.push(`> ${homeContext.description}`);
    lines.push('');
  }

  lines.push('## Pages');
  lines.push('');
  lines.push(`- [Home](${url})${homeContext.description ? ': ' + homeContext.description : ''}`);

  for (const page of pages.slice(0, MAX_PAGES)) {
    if (page.url === url || page.url === origin + '/') continue;
    const label = page.title || urlToLabel(page.url);
    const desc  = page.description ? `: ${page.description}` : '';
    lines.push(`- [${label}](${page.url})${desc}`);
  }

  lines.push('');
  lines.push('## About');
  lines.push('');
  lines.push(`${homeContext.title || domain} — ${homeContext.description || 'No description available.'}`);

  return {
    content:    lines.join('\n'),
    pageCount:  pages.length + 1,
    uploadPath: '/llms.txt',
    source:     'manual',
  };
}

async function fetchPageMeta(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { title: '', description: '' };
    const html = await res.text();
    const $ = cheerio.load(html);
    return {
      title:       $('title').first().text().trim().split('|')[0].trim(),
      description: $('meta[name="description"]').attr('content')?.trim() ?? '',
    };
  } catch {
    return { title: '', description: '' };
  }
}

async function fetchSitemapPages(origin) {
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
          try { return new URL(u).origin === origin; } catch { return false; }
        })
        .slice(0, MAX_PAGES);

      if (urls.length === 0) continue;

      const chunks = [];
      for (let i = 0; i < Math.min(urls.length, 6); i += 3) {
        const batch = await Promise.all(
          urls.slice(i, i + 3).map(async (u) => ({ url: u, ...await fetchPageMeta(u) }))
        );
        chunks.push(...batch);
      }
      return chunks;
    } catch {
      continue;
    }
  }
  return [];
}

function urlToLabel(url) {
  try {
    const path = new URL(url).pathname;
    return path
      .replace(/\/$/, '')
      .split('/')
      .filter(Boolean)
      .pop()
      ?.replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase()) ?? url;
  } catch {
    return url;
  }
}
