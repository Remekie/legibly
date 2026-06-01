import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = 10_000;
const GENERIC_TITLES = /^(home|welcome|index|untitled|page|\s*)$/i;
const MIN_META_LENGTH = 80;

export async function checkMetadata(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { score: 0, detail: 'Could not fetch page to check metadata.' };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const title = $('title').first().text().trim();
    const metaDesc = $('meta[name="description"]').attr('content')?.trim() ?? '';
    const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() ?? '';
    const ogDesc = $('meta[property="og:description"]').attr('content')?.trim() ?? '';
    const ogImage = $('meta[property="og:image"]').attr('content')?.trim() ?? '';
    const noindex = $('meta[name="robots"]').attr('content')?.toLowerCase().includes('noindex') ?? false;
    const h1 = $('h1').first().text().trim();

    const issues = [];

    if (noindex) issues.push('noindex');
    if (!title || GENERIC_TITLES.test(title.split('|')[0].trim())) issues.push('title');
    if (metaDesc.length < MIN_META_LENGTH) issues.push('description');
    if (!ogTitle || !ogDesc || !ogImage) issues.push('og');
    if (!h1) issues.push('h1');

    if (issues.length === 0) {
      return {
        score: 10,
        detail: 'Page metadata complete ✓ — title, description, and social tags all set correctly',
      };
    }

    if (noindex) {
      return {
        score: 0,
        detail: "This page is telling search and AI engines not to index it. It cannot appear in AI results.",
      };
    }

    if (issues.length <= 2) {
      const missing = formatIssues(issues);
      return {
        score: 5,
        detail: `Partial metadata — ${missing} missing or too generic. AI engines are working with incomplete information about your page.`,
      };
    }

    return {
      score: 0,
      detail: "Critical metadata missing — no descriptive title, description, or social tags. AI engines can't understand what your page is about.",
    };
  } catch {
    return {
      score: 0,
      detail: 'Could not check page metadata.',
    };
  }
}

function formatIssues(issues) {
  const labels = {
    title: 'page title',
    description: 'meta description',
    og: 'social share tags (og:title, og:description, og:image)',
    h1: 'main heading (H1)',
    noindex: 'noindex block',
  };
  return issues.map(i => labels[i] ?? i).join(', ');
}
