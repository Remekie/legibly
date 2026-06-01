const FETCH_TIMEOUT_MS = 8_000;

export async function checkLlmstxt(url) {
  const origin = new URL(url).origin;
  const llmsUrl = `${origin}/llms.txt`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(llmsUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Legibly/1.0)' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const text = await res.text();
      const hasContent = text.trim().length > 50;

      return {
        score: hasContent ? 10 : 3,
        detail: hasContent
          ? 'llms.txt found ✓ — AI engines have a plain-language summary of your site'
          : 'llms.txt exists but appears empty — AI engines have nothing to read from it',
      };
    }

    if (res.status === 404) {
      return {
        score: 0,
        detail: 'No llms.txt found. AI engines have no plain-language guide to your site.',
      };
    }

    return {
      score: 3,
      detail: `llms.txt returned ${res.status} — may be misconfigured`,
    };
  } catch {
    return {
      score: 0,
      detail: 'Could not check for llms.txt — site may be blocking automated requests.',
    };
  }
}
