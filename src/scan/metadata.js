import * as cheerio from 'cheerio';

const GENERIC_TITLES = /^(home|welcome|index|untitled|page|\s*)$/i;
const GENERIC_HEADINGS = /^(welcome|hello|home|intro|introduction|section|about|services|contact|learn more|get started|\s*)$/i;
const MIN_META_LENGTH = 80;

const FETCH_TIMEOUT_MS = 8_000;

export async function checkMetadata(url, html = null, redirectHops = null) {
  if (!html) {
    return { score: 0, issues: [], detail: 'Could not reach page to check metadata.' };
  }

  try {
    const $ = cheerio.load(html);

    const title    = $('title').first().text().trim();
    const metaDesc = $('meta[name="description"]').attr('content')?.trim() ?? '';
    const ogTitle  = $('meta[property="og:title"]').attr('content')?.trim() ?? '';
    const ogDesc   = $('meta[property="og:description"]').attr('content')?.trim() ?? '';
    const ogImage  = $('meta[property="og:image"]').attr('content')?.trim() ?? '';
    const noindex  =
      $('meta[name="robots"]').attr('content')?.toLowerCase().includes('noindex') ||
      $('meta[name="googlebot"]').attr('content')?.toLowerCase().includes('noindex') ||
      false;
    const h1Text   = $('h1').first().text().trim();
    const h1Generic = !h1Text || GENERIC_HEADINGS.test(h1Text);
    const hasH2    = $('h2').length > 0;
    const canonical = $('link[rel="canonical"]').attr('href')?.trim() ?? '';

    const images = $('img').toArray();
    const imagesWithoutAlt = images.filter(img => {
      const alt = $(img).attr('alt');
      return alt === undefined || alt.trim() === '';
    });
    const altCoverage = images.length === 0 ? 1 : (images.length - imagesWithoutAlt.length) / images.length;
    const altFailing = images.length > 0 && altCoverage < 0.7;

    // Use pre-computed redirect hops from Phase 1 if available
    const redirectChain = redirectHops ?? 0;

    const issues = [];
    if (noindex)                                                    issues.push('noindex');
    if (!title || GENERIC_TITLES.test(title.split('|')[0].trim())) issues.push('title');
    if (metaDesc.length < MIN_META_LENGTH)                          issues.push('description');
    if (!ogTitle || !ogDesc || !ogImage)                            issues.push('og');
    if (h1Generic)                                                  issues.push('h1');
    if (!hasH2)                                                     issues.push('headings');
    if (!canonical)                                                 issues.push('canonical');
    if (altFailing)                                                 issues.push('alttext');
    if (redirectChain >= 2)                                         issues.push('redirectchain');

    const pageTitle = (!GENERIC_TITLES.test(title) ? title : null)
      ?? (!GENERIC_HEADINGS.test(h1Text) ? h1Text : null)
      ?? null;

    if (noindex) {
      return { score: 0, issues, pageTitle, detail: "This page is telling search and AI engines not to index it. It cannot appear in AI results." };
    }

    if (issues.length === 0) {
      return { score: 10, issues, pageTitle, detail: 'Page metadata complete ✓ — title, description, headings, canonical, and social tags all set correctly' };
    }

    const score = Math.max(0, Math.round(10 - issues.length * 1.5));
    return {
      score,
      issues,
      pageTitle,
      detail: issues.length <= 2
        ? `${formatIssues(issues)} missing or too generic — AI engines are working with incomplete information about your page.`
        : `Multiple metadata gaps — ${formatIssues(issues)}. AI engines can't fully understand what your page is about.`,
    };
  } catch {
    return { score: 0, issues: [], detail: 'Could not parse page metadata.' };
  }
}

function formatIssues(issues) {
  const labels = {
    title:         'page title',
    description:   'meta description',
    og:            'social share tags',
    h1:            'main heading (H1)',
    headings:      'content structure (H2/H3)',
    canonical:     'canonical tag',
    alttext:       'image alt text',
    noindex:       'noindex block',
    redirectchain: 'redirect chain (2+ hops)',
  };
  return issues.map(i => labels[i] ?? i).join(', ');
}

export async function checkRedirectChain(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Legibly/1.0)' },
    });
    clearTimeout(timer);
    // If it's a redirect, count hops manually
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return 1;
      // Resolve relative Location headers against original URL (RFC 7231)
      const resolvedLocation = new URL(location, url).href;
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), FETCH_TIMEOUT_MS);
      const res2 = await fetch(resolvedLocation, {
        method: 'HEAD',
        redirect: 'manual',
        signal: controller2.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Legibly/1.0)' },
      });
      clearTimeout(timer2);
      return res2.status >= 300 ? 2 : 1;
    }
    return 0;
  } catch {
    return 0;
  }
}
