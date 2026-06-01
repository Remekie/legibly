import puppeteer from 'puppeteer';

const SPA_PATTERN = /<div[^>]+id=["']root["'][^>]*>\s*<\/div>/i;
const TIMEOUT_MS = 15_000;

export async function checkPrerender(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.0; +https://openai.com/gptbot)'
    );
    await page.setJavaScriptEnabled(false);

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT_MS,
    });

    const statusCode = response?.status() ?? null;

    // Blocked by server (Cloudflare, auth wall, etc.) — not a rendering problem
    if (statusCode === 403 || statusCode === 401 || statusCode === 429) {
      return {
        score: 0,
        isSpaOnly: false,
        isBlocked: true,
        statusCode,
        detail: "AI crawlers can't reach your site. Your content doesn't exist in AI search.",
      };
    }

    const html = await page.content();
    const isSpaOnly = SPA_PATTERN.test(html) || html.trim().length < 500;

    return {
      score: isSpaOnly ? 0 : 10,
      isSpaOnly,
      isBlocked: false,
      statusCode,
      detail: isSpaOnly
        ? "AI can't read your site. The way it's built makes it invisible to ChatGPT, Claude, and Perplexity."
        : 'AI can read your site content ✓',
    };
  } finally {
    await browser?.close();
  }
}
