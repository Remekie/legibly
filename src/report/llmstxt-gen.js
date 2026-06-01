import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGES = 12;

/**
 * Auto-generate llms.txt content for a site.
 * Strategy: fetch sitemap → extract top pages → build llms.txt.
 */
export async function generateLlmstxt(url) {
  const origin = new URL(url).origin;
  const domain = new URL(url).hostname.replace('www.', '');

  // 1. Fetch homepage context for the header block
  const homeContext = await fetchPageMeta(url);

  // 2. Try to get sitemap
  const pages = await fetchSitemapPages(origin);

  // 3. Build llms.txt
  const lines = [];

  // Header
  lines.push(`# ${homeContext.title || domain}`);
  lines.push('');
  if (homeContext.description) {
    lines.push(`> ${homeContext.description}`);
    lines.push('');
  }

  // Homepage section
  lines.push('## Pages');
  lines.push('');
  lines.push(`- [Home](${url})${homeContext.description ? ': ' + homeContext.description : ''}`);

  // Add discovered pages
  for (const page of pages.slice(0, MAX_PAGES)) {
    if (page.url === url || page.url === origin + '/') continue;
    const label = page.title || urlToLabel(page.url);
    const desc = page.description ? `: ${page.description}` : '';
    lines.push(`- [${label}](${page.url})${desc}`);
  }

  lines.push('');
  lines.push('## About');
  lines.push('');
  lines.push(`${homeContext.title || domain} — ${homeContext.description || 'No description available.'}`);

  return {
    content: lines.join('\n'),
    pageCount: pages.length + 1,
    uploadPath: '/llms.txt',
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
      title: $('title').first().text().trim().split('|')[0].trim(),
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
        .filter(u => { try { return u.startsWith('http') && !!new URL(u); } catch { return false; } })
        .slice(0, MAX_PAGES);

      if (urls.length === 0) continue;

      // Fetch meta for each page (parallel, cap at 6 concurrent)
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
