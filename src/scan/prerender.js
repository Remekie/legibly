import puppeteer from 'puppeteer';

const SPA_PATTERN = /<div[^>]+id=["']root["'][^>]*>\s*<\/div>/i;
const TIMEOUT_MS = 15_000;

/**
 * Fetch the page as GPTBot and check if it's a JS-only SPA.
 * Returns score 0 (blocker) if only <div id="root"></div> is present,
 * score 10 if full content is visible.
 */
export async function checkPrerender(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();

    // Impersonate GPTBot — no JS execution means we get the raw server response
    await page.setUserAgent(
      'Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.0; +https://openai.com/gptbot)'
    );
    await page.setJavaScriptEnabled(false);

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT_MS,
    });

    const html = await page.content();
    const isSpaOnly = SPA_PATTERN.test(html) || html.trim().length < 500;

    return {
      score: isSpaOnly ? 0 : 10,
      isSpaOnly,
      statusCode: response?.status() ?? null,
      detail: isSpaOnly
        ? 'GPTBot sees only <div id="root"></div> — React/SPA not pre-rendered'
        : 'Page content is visible to AI crawlers',
    };
  } finally {
    await browser?.close();
  }
}
