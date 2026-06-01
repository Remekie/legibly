import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = 10_000;
const GENERIC_TITLES = /^(home|welcome|index|untitled|page|\s*)$/i;
const GENERIC_HEADINGS = /^(welcome|hello|home|intro|introduction|section|about|services|contact|learn more|get started|\s*)$/i;
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

    // Core meta
    const title = $('title').first().text().trim();
    const metaDesc = $('meta[name="description"]').attr('content')?.trim() ?? '';
    const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() ?? '';
    const ogDesc = $('meta[property="og:description"]').attr('content')?.trim() ?? '';
    const ogImage = $('meta[property="og:image"]').attr('content')?.trim() ?? '';
    const noindex =
      $('meta[name="robots"]').attr('content')?.toLowerCase().includes('noindex') ||
      $('meta[name="googlebot"]').attr('content')?.toLowerCase().includes('noindex') ||
      false;

    // Heading hierarchy
    const h1Text = $('h1').first().text().trim();
    const h1Generic = !h1Text || GENERIC_HEADINGS.test(h1Text);
    const hasH2 = $('h2').length > 0;

    // Canonical
    const canonical = $('link[rel="canonical"]').attr('href')?.trim() ?? '';
    const hasCanonical = canonical.length > 0;

    // Image alt text
    const images = $('img').toArray();
    const imagesWithoutAlt = images.filter(img => {
      const alt = $(img).attr('alt');
      return alt === undefined || alt.trim() === '';
    });
    const altCoverage = images.length === 0 ? 1 : (images.length - imagesWithoutAlt.length) / images.length;
    const altFailing = images.length > 0 && altCoverage < 0.7;

    const issues = [];

    if (noindex)                                                   issues.push('noindex');
    if (!title || GENERIC_TITLES.test(title.split('|')[0].trim())) issues.push('title');
    if (metaDesc.length < MIN_META_LENGTH)                         issues.push('description');
    if (!ogTitle || !ogDesc || !ogImage)                           issues.push('og');
    if (h1Generic)                                                 issues.push('h1');
    if (!hasH2)                                                    issues.push('headings');
    if (!hasCanonical)                                             issues.push('canonical');
    if (altFailing)                                                issues.push('alttext');

    if (noindex) {
      return {
        score: 0,
        issues,
        detail: "This page is telling search and AI engines not to index it. It cannot appear in AI results.",
      };
    }

    if (issues.length === 0) {
      return {
        score: 10,
        issues,
        detail: 'Page metadata complete ✓ — title, description, headings, canonical, and social tags all set correctly',
      };
    }

    // Score: lose ~1.25 points per issue, floor at 0
    const score = Math.max(0, Math.round(10 - issues.length * 1.25));

    return {
      score,
      issues,
      detail: issues.length <= 2
        ? `${formatIssues(issues)} missing or too generic — AI engines are working with incomplete information about your page.`
        : `Multiple metadata gaps — ${formatIssues(issues)}. AI engines can't fully understand what your page is about.`,
    };
  } catch {
    return {
      score: 0,
      issues: [],
      detail: 'Could not check page metadata.',
    };
  }
}

function formatIssues(issues) {
  const labels = {
    title:       'page title',
    description: 'meta description',
    og:          'social share tags',
    h1:          'main heading (H1)',
    headings:    'content structure (H2/H3)',
    canonical:   'canonical tag',
    alttext:     'image alt text',
    noindex:     'noindex block',
  };
  return issues.map(i => labels[i] ?? i).join(', ');
}
