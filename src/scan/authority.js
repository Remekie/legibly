/**
 * Lightweight off-page authority check.
 *
 * Checks whether the brand has detectable third-party presence — the real
 * driver of AI recommendations. On-page signals (schema, llms.txt) are
 * fixable in hours. Off-page authority (Wikipedia, Reddit, review sites)
 * takes months. Surfacing both honestly is the differentiator.
 */

const FETCH_TIMEOUT = 6_000;

async function tryFetch(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const res = await fetch(url, {
      signal: controller.signal,
      // Reddit requires a descriptive non-browser UA — generic Mozilla strings trigger 429
      headers: { 'User-Agent': 'BlindGEO/1.0 (AI visibility scanner; contact: hello@blindgeo.com)' },
    });
    clearTimeout(timer);
    return res;
  } catch {
    return null;
  }
}

async function checkWikipedia(brandName) {
  if (!brandName) return false;
  const encoded = encodeURIComponent(brandName);
  const res = await tryFetch(
    `https://en.wikipedia.org/w/api.php?action=query&titles=${encoded}&format=json&redirects=1`
  );
  if (!res?.ok) return false;
  try {
    const data = await res.json();
    const pages = data?.query?.pages ?? {};
    // Wikipedia returns page id -1 for "not found"
    return !Object.keys(pages).includes('-1');
  } catch {
    return false;
  }
}

async function checkReddit(domain) {
  if (!domain) return false;
  const query = encodeURIComponent(domain.replace('www.', ''));
  const res = await tryFetch(
    `https://www.reddit.com/search.json?q=${query}&limit=3&type=link`
  );
  if (!res?.ok) return false;
  try {
    const data = await res.json();
    return (data?.data?.children?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function checkAuthority(domain, brandName) {
  if (!domain) return null;

  const cleanBrand = brandName
    || domain.replace('www.', '').split('.')[0]
         .replace(/-/g, ' ')
         .replace(/([a-z])([A-Z])/g, '$1 $2'); // split camelCase

  // Run checks in parallel
  const [hasWikipedia, hasReddit] = await Promise.all([
    checkWikipedia(cleanBrand),
    checkReddit(domain),
  ]);

  const authorityScore = (hasWikipedia ? 1 : 0) + (hasReddit ? 1 : 0);

  const signals = [];
  if (hasWikipedia) signals.push('Wikipedia entry');
  if (hasReddit)    signals.push('Reddit discussions');

  return {
    hasWikipedia,
    hasReddit,
    authorityScore,   // 0 = none, 1 = some, 2 = strong
    signals,
    detail: authorityScore === 0
      ? 'No detectable third-party web presence. AI engines have no external sources to cite for this brand.'
      : authorityScore === 1
        ? `Found: ${signals.join(', ')}. Limited third-party presence — builds trust with AI search over time.`
        : `Found: ${signals.join(', ')}. Solid third-party presence — AI engines have sources to draw from.`,
    onPageNote: 'Schema, llms.txt, and content structure are fixable in hours. Third-party citations (Wikipedia, reviews, community mentions) take months to build — but they\'re the primary driver of AI recommendations.',
  };
}
