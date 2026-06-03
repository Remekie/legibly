import puppeteer from 'puppeteer';
import { calculateVisibility } from './visibility.js';
import { extractAgentView } from '../report/agent-view.js';

const SPA_PATTERN = /<div[^>]+id=["']root["'][^>]*>\s*<\/div>/i;
const TIMEOUT_MS = 15_000;

export async function checkPrerender(url) {
  let browser;
  try {
    const launchOpts = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };
    // Only set executablePath if CHROMIUM_PATH is set AND the file exists
    if (process.env.CHROMIUM_PATH) {
      const { existsSync } = await import('fs');
      if (existsSync(process.env.CHROMIUM_PATH)) {
        launchOpts.executablePath = process.env.CHROMIUM_PATH;
      }
    }
    browser = await puppeteer.launch(launchOpts);

    // Fetch human view and bot view in parallel using two tabs
    const [botResult, humanHtml] = await Promise.all([
      fetchBotView(browser, url),
      fetchHumanView(url),
    ]);

    const { html: botHtml, statusCode } = botResult;

    // 403/blocked — not a rendering problem
    if (statusCode === 403 || statusCode === 401 || statusCode === 429) {
      return {
        score: 0,
        isSpaOnly: false,
        isBlocked: true,
        statusCode,
        visibilityPct: 0,
        botWordCount: 0,
        humanWordCount: 0,
        missingWordCount: 0,
        missingWords: [],
        detail: "AI crawlers can't reach your site. Your content doesn't exist in AI search.",
      };
    }

    const isSpaOnly = SPA_PATTERN.test(botHtml) || botHtml.trim().length < 500;

    // Calculate content visibility
    const visibility = humanHtml
      ? calculateVisibility(botHtml, humanHtml)
      : { visibilityPct: isSpaOnly ? 0 : 85, botWordCount: 0, humanWordCount: 0, missingWordCount: 0, missingWords: [] };

    // Detect application-level bot walls (200 status but challenge page)
    const BOT_WALL = /checking your browser|enable javascript and cookies|cloudflare ray id|access denied|just a moment\.\.\./i;
    const isBotWall = BOT_WALL.test(botHtml);

    const agentView = (!isSpaOnly && !isBotWall)
      ? extractAgentView(botHtml, humanHtml)
      : null;

    return {
      score: isSpaOnly ? 0 : 10,
      isSpaOnly,
      isBlocked: false,
      statusCode,
      agentView,
      botHtml:   (isSpaOnly || isBotWall) ? null : botHtml,
      humanHtml: humanHtml ?? null,
      ...visibility,
      detail: isSpaOnly
        ? "AI can't read your site. The way it's built makes it invisible to ChatGPT, Claude, and Perplexity."
        : 'AI can read your site content ✓',
    };
  } finally {
    await browser?.close();
  }
}

async function fetchBotView(browser, url) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      'Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.0; +https://openai.com/gptbot)'
    );
    await page.setJavaScriptEnabled(false);

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT_MS,
    });

    const html = await page.content();
    return { html, statusCode: response?.status() ?? null };
  } finally {
    await page.close();
  }
}

async function fetchHumanView(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
