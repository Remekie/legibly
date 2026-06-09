const AI_BOTS = ['GPTBot', 'ClaudeBot', 'Claude-Web', 'PerplexityBot', 'OAI-SearchBot', 'Google-Extended', 'Googlebot-Extended'];
const FETCH_TIMEOUT_MS = 10_000;

export async function checkRobots(url) {
  const origin = new URL(url).origin;
  const robotsUrl = `${origin}/robots.txt`;

  let robotsTxt = '';
  let cloudflareBlocking = false;
  let fetchSucceeded = false;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(robotsUrl, {
      headers: { 'User-Agent': 'GPTBot/1.0' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      robotsTxt = await res.text();
      fetchSucceeded = true;
    }

    // Cloudflare "Block AI Scrapers" toggle sets this header or noai tag
    const cfHeader = res.headers.get('cf-aibm');
    const xRobots = res.headers.get('x-robots-tag') ?? '';
    cloudflareBlocking = !!cfHeader || xRobots.includes('noai');
  } catch {
    // Network timeout or error — treat as unknown, not blocked
  }

  // If robots.txt couldn't be fetched, state is unknown — never assert "blocked"
  if (!fetchSucceeded && !cloudflareBlocking) {
    return {
      score: 8,
      blockedBots: [],
      cloudflareBlocking: false,
      fetchState: 'unknown',
      detail: 'Could not verify robots.txt — assuming AI crawlers are permitted.',
    };
  }

  const blockedBots = parseBlockedBots(robotsTxt);
  const allBlocked = blockedBots.includes('*');
  const aiBlocked = allBlocked || AI_BOTS.some(b => blockedBots.includes(b));

  // Cloudflare Managed Content auto-blocks — detected via header or robots entries
  const isCloudflareManagedBlock =
    cloudflareBlocking ||
    (robotsTxt.includes('Cloudflare Managed') && aiBlocked);

  if (isCloudflareManagedBlock) {
    return {
      score: 0,
      blockedBots,
      cloudflareBlocking: true,
      detail: 'Your site is completely blocked from AI search. ChatGPT and Claude cannot see any of your content.',
    };
  }

  if (aiBlocked) {
    return {
      score: 0,
      blockedBots,
      cloudflareBlocking: false,
      detail: "Your site is actively telling AI to stay out. You're invisible to every AI search engine.",
    };
  }

  return {
    score: 8,
    blockedBots: [],
    cloudflareBlocking: false,
    detail: 'No AI blocks detected ✓',
  };
}

function parseBlockedBots(robotsTxt) {
  const blocked = [];
  let currentAgents = [];

  for (const raw of robotsTxt.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('User-agent:')) {
      currentAgents.push(line.replace('User-agent:', '').trim());
    } else if (line === 'Disallow: /') {
      // Only root-level full blocks count — subfolder disallows (Disallow: /admin) are not a block
      blocked.push(...currentAgents);
      currentAgents = [];
    } else if (line === '') {
      currentAgents = [];
    }
  }

  return [...new Set(blocked)];
}
