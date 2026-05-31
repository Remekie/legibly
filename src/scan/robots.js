// Known AI crawler user-agents to check in robots.txt
const AI_BOTS = ['GPTBot', 'ClaudeBot', 'Claude-Web', 'PerplexityBot', 'OAI-SearchBot', 'Googlebot-Extended'];

const CLOUDFLARE_AI_BLOCK_HEADER = 'cf-aibm'; // Cloudflare "Block AI Scrapers" sets this
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetch robots.txt and response headers.
 * Detect if any AI crawler is disallowed, or if Cloudflare bot-fight mode blocks them.
 */
export async function checkRobots(url) {
  const origin = new URL(url).origin;
  const robotsUrl = `${origin}/robots.txt`;

  let robotsTxt = '';
  let cloudflareBlocking = false;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(robotsUrl, {
      headers: { 'User-Agent': 'GPTBot/1.0' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    robotsTxt = await res.text();

    // Cloudflare sets x-robots-tag: noindex for blocked bots, or cf-aibm header
    const cfHeader = res.headers.get(CLOUDFLARE_AI_BLOCK_HEADER);
    const xRobots = res.headers.get('x-robots-tag') ?? '';
    cloudflareBlocking = !!cfHeader || xRobots.includes('noai');
  } catch {
    // Network error or timeout — treat as unknown, not blocked
  }

  const blockedBots = parseBlockedBots(robotsTxt);
  const allBlocked = blockedBots.includes('*');
  const aiBlocked = allBlocked || AI_BOTS.some(b => blockedBots.includes(b));

  if (cloudflareBlocking) {
    return {
      score: 0,
      blockedBots,
      cloudflareBlocking: true,
      detail: 'Cloudflare is blocking all AI crawlers. Toggle "Block AI Scrapers" OFF in Cloudflare Dashboard → Security → Bots.',
    };
  }

  if (aiBlocked) {
    const names = allBlocked ? 'all bots' : blockedBots.filter(b => AI_BOTS.includes(b)).join(', ');
    return {
      score: 0,
      blockedBots,
      cloudflareBlocking: false,
      detail: `robots.txt blocks ${names} — AI crawlers cannot access this site`,
    };
  }

  return {
    score: 8,
    blockedBots: [],
    cloudflareBlocking: false,
    detail: 'AI crawlers are allowed',
  };
}

function parseBlockedBots(robotsTxt) {
  const blocked = [];
  let currentAgents = [];

  for (const raw of robotsTxt.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('User-agent:')) {
      currentAgents.push(line.replace('User-agent:', '').trim());
    } else if (line.startsWith('Disallow: /')) {
      blocked.push(...currentAgents);
      currentAgents = [];
    } else if (line === '') {
      currentAgents = [];
    }
  }

  return [...new Set(blocked)];
}
