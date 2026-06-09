import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import Stripe from 'stripe';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import { getOAuthUrl, exchangeCode, detectStack, createFixPR, parseRepo } from './fix/github.js';
import { buildFixes } from './fix/patches.js';
import { validatePublicUrl, safeFilename } from './lib/validateUrl.js';
import { scan } from './scan/index.js';
import { getCached, setCached, cacheSize } from './scan/cache.js';
import { generateReport } from './report/index.js';
import { generateFixKit } from './report/fix-kit.js';
import { mcpRouter } from './mcp/server.js';
import { generatePDF } from './report/pdf.js';
import { getGoogleAuthUrl, validateGoogleState, handleGoogleCallback, setSessionCookie, clearSessionCookie } from './auth/google.js';
import { sendMagicLink, verifyAndLogin, sendReportReady, sendDeltaEmail, sendPostFixEmail } from './auth/email.js';
import { optionalAuth, requireAuthJson } from './auth/middleware.js';
import { insertScan, getScansByUser, getScanById, getRecentScansByUrl, getDailyFreeScans, markScanFixed } from './db/scans.js';
import { insertReport, getReportById, getReportByScan, setReportPublic, canAccessReport, ownsReport } from './db/reports.js';
import { insertPayment, getPaymentBySession, getUserPayments, getHighestTierForUser } from './db/payments.js';
import { getBrandSettings, saveBrandSettings } from './db/users.js';
import { upsertSubscription, getActiveSubscription, cancelSubscription, getHighestActiveTier, getAllActiveSubscribers } from './db/subscriptions.js';
import { getPromptSlots, addPromptSlot, deletePromptSlot, getAllMonitoringPrompts } from './db/monitoring-prompts.js';
import { saveMonitoringResult, getLatestResultPerPrompt, getPromptResults } from './db/monitoring-results.js';
import { saveConnection, getConnection, getUserConnections, deleteConnection } from './db/platform-connections.js';
import db from './db/index.js';

// Fail fast on missing secrets in production
if (process.env.NODE_ENV === 'production') {
  const required = ['JWT_SECRET', 'SESSION_SECRET', 'APP_URL'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    process.stderr.write(`[startup] FATAL: Missing required env vars in production: ${missing.join(', ')}\n`);
    process.exit(1);
  }
}

const APP_URL = process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const ALLOWED_PROVIDERS = new Set(['perplexity', 'gemini', 'chatgpt', 'aioverviews']);

const app = express();
const PORT = process.env.PORT ?? 3000;

app.set('trust proxy', 2); // Cloudflare → Railway edge → Node: 2 hops; prevents IP spoofing on rate limiters
app.use(helmet());
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(optionalAuth);
app.use(session({
  secret: process.env.SESSION_SECRET ?? 'legibly-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 60 * 60 * 1000 },
}));
app.use(express.static('public'));

// ── BlindGEO MCP Server ───────────────────────────────────────────────────────
// Exposes scan_site + get_fixes tools via Model Context Protocol
// Claude Desktop config: { "blindgeo": { "url": "https://blindgeo.com/mcp" } }
app.use('/mcp', mcpRouter());

const scanLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a minute.' },
});

const reportLimiter = rateLimit({
  windowMs: 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many report requests. Please wait a minute.' },
});

const pdfLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 3,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'PDF generation limit reached. Please wait 5 minutes.' },
});

app.get('/api/stats', (_req, res) => {
  const { n } = db.prepare('SELECT COUNT(*) as n FROM scans').get() ?? { n: 0 };
  res.json({ scans: n });
});

app.get('/health', async (_req, res) => {
  const { execSync } = await import('child_process');
  let chromiumPath = process.env.CHROMIUM_PATH ?? 'not set';
  let chromiumExists = false;
  try {
    const { existsSync } = await import('fs');
    chromiumExists = chromiumPath !== 'not set' && existsSync(chromiumPath);
    if (!chromiumExists) {
      try { chromiumPath = execSync('which chromium || which chromium-browser || which google-chrome', { encoding: 'utf8' }).trim(); chromiumExists = true; } catch { /* not found */ }
    }
  } catch { /* ignore */ }
  // Don't expose API key presence or internal paths publicly
  res.json({ status: 'ok', cache: cacheSize(), chromiumExists });
});

app.post('/api/scan', scanLimiter, async (req, res) => {
  let url;
  try {
    url = await validatePublicUrl(req.body?.url ?? '');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const cached = getCached(url);
    if (cached) {
      res.set('X-Cache', 'HIT');
      return res.json(cached);
    }
    const result = await scan(url);
    // Expose page title for client-side locked teaser personalization
    result.pageTitle = result.signals?.metadata?.pageTitle ?? null;
    // Save to DB if user is authenticated
    if (req.user) {
      const scanId = insertScan({
        userId: req.user.id,
        url,
        grade: result.grade,
        score: result.score,
        signals: result.signals,
      });
      result.scanId = scanId;
    }
    setCached(url, result);
    res.set('X-Cache', 'MISS');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Scan failed. Please try again.' });
    process.stderr.write(`[scan error] ${err.message}\n${err.stack}\n`);
  }
});

const emailLimiter = rateLimit({
  windowMs: 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a minute.' },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/email', emailLimiter, (req, res) => {
  const { email, url, grade } = req.body ?? {};
  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  process.stderr.write(`[lead] ${email} scanned ${url} (${grade})\n`);
  res.json({ ok: true });
});

const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a minute.' },
});

// Subscription tiers use env-var Price IDs created in Stripe dashboard
// One-time tiers use inline price_data
const TIER_PRICES = {
  fix: {
    mode: 'subscription',
    monthly: { priceId: process.env.STRIPE_PRICE_FIX_MONTHLY,  fallbackCents: 2900, interval: 'month' },
    annual:  { priceId: process.env.STRIPE_PRICE_FIX_ANNUAL,   fallbackCents: 27600, interval: 'year' },
    name: 'BlindGEO Fix — $29/mo',
    description: 'Full audit, GitHub PR, Lovable snippets, weekly re-audit, 10 prompt slots',
  },
  monitor: {
    mode: 'subscription',
    monthly: { priceId: process.env.STRIPE_PRICE_MONITOR_MONTHLY, fallbackCents: 4900, interval: 'month' },
    annual:  { priceId: process.env.STRIPE_PRICE_MONITOR_ANNUAL,  fallbackCents: 46800, interval: 'year' },
    name: 'BlindGEO Fix+Monitor — $49/mo',
    description: 'Everything in Fix + 3 sites, 40 prompt slots (daily), competitor comparison',
  },
  deploy: {
    mode: 'payment',
    cents: 7900,
    name: 'BlindGEO GitHub Fix',
    description: '1-click GitHub PR with all fixes — vite-ssg, llms.txt, schema, robots.txt',
  },
  redeploy: {
    mode: 'payment',
    cents: 4900,
    name: 'BlindGEO GitHub Re-Fix',
    description: 'Return-buyer GitHub PR (same fixes, your site changed)',
  },
};
const VALID_CHECKOUT_TIERS = new Set(Object.keys(TIER_PRICES));

app.post('/api/checkout', checkoutLimiter, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments not configured' });

  const { url: scanUrl, tier: rawTier, billing = 'monthly' } = req.body ?? {};
  const tier = VALID_CHECKOUT_TIERS.has(rawTier) ? rawTier : 'fix';
  const tierDef = TIER_PRICES[tier];

  let validScanUrl = '';
  try { validScanUrl = scanUrl ? await validatePublicUrl(scanUrl) : ''; } catch { /* non-critical */ }

  // Return-buyer discount: if user already has a deploy payment, use redeploy price
  let effectiveTier = tier;
  if (tier === 'deploy' && req.user) {
    const prior = getUserPayments(req.user.id).find(p => p.tier === 'deploy');
    if (prior) effectiveTier = 'redeploy';
  }
  const effective = TIER_PRICES[effectiveTier];

  try {
    let sessionParams = {
      metadata: { scanUrl: validScanUrl, tier: effectiveTier },
      success_url: `${APP_URL}/dashboard.html?payment_success=1`,
      cancel_url:  `${APP_URL}/`,
      ...(req.user ? { customer_email: req.user.email } : {}),
    };

    if (effective.mode === 'subscription') {
      const billingKey = billing === 'annual' ? 'annual' : 'monthly';
      const price = effective[billingKey];
      sessionParams.mode = 'subscription';
      sessionParams.line_items = price.priceId
        ? [{ price: price.priceId, quantity: 1 }]
        : [{ price_data: { currency: 'usd', unit_amount: price.fallbackCents, recurring: { interval: price.interval }, product_data: { name: effective.name, description: effective.description } }, quantity: 1 }];
    } else {
      sessionParams.mode = 'payment';
      sessionParams.line_items = [{
        price_data: { currency: 'usd', unit_amount: effective.cents, product_data: { name: effective.name, description: effective.description } },
        quantity: 1,
      }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: 'Could not create checkout session.' });
    process.stderr.write(`[stripe checkout error] ${err.message}\n`);
  }
});

app.get('/api/verify-payment', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments not configured' });

  const { session_id } = req.query;
  if (!session_id || typeof session_id !== 'string') {
    return res.status(400).json({ error: 'session_id required' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const paid = session.payment_status === 'paid';
    res.json({ paid, scanUrl: session.metadata?.scanUrl ?? '' });
  } catch (err) {
    res.status(400).json({ error: 'Invalid session' });
    process.stderr.write(`[stripe verify error] ${err.message}\n`);
  }
});

app.post('/api/report', reportLimiter, async (req, res) => {
  let url;
  try {
    url = await validatePublicUrl(req.body?.url ?? '');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Server-side payment verification — client-side hasPaidTier() is not trusted
  let paymentVerified = false;

  if (req.user) {
    const tier = getHighestTierForUser(req.user.id);
    paymentVerified = tier === 'report' || tier === 'deploy';
  }

  if (!paymentVerified && stripe) {
    // Fallback: verify Stripe session_id passed from client
    const sessionId = req.body?.session_id ?? req.query?.session_id;
    if (sessionId && typeof sessionId === 'string') {
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        paymentVerified = session.payment_status === 'paid';
        if (paymentVerified) {
          insertPayment({
            userId: req.user?.id ?? null,
            stripeSessionId: sessionId,
            tier: session.metadata?.tier ?? 'report',
            amountCents: session.amount_total ?? 0,
            scanId: null,
          });
        }
      } catch { /* invalid session */ }
    }
  }

  // Allow test mode only outside production
  if (!paymentVerified && process.env.NODE_ENV !== 'production' && req.body?.test_mode === true) {
    paymentVerified = true;
  }

  if (!paymentVerified && !process.env.STRIPE_SECRET_KEY) {
    // No Stripe configured — dev environment, allow report generation
    paymentVerified = true;
  }

  if (!paymentVerified) {
    return res.status(402).json({ error: 'Payment required. Please purchase a report to continue.' });
  }

  try {
    const brandContext = req.user ? getBrandSettings(req.user.id) : null;
    const result = await generateReport(url, brandContext);

    // Persist scan + report to DB so the result is accessible by ?id= URL
    const scanId = insertScan({
      userId: req.user?.id ?? null,
      url,
      grade:   result.grade,
      score:   result.score,
      signals: result.signals,
    });
    const reportId = insertReport({ scanId, tier: 'report', report: result });

    res.json({ ...result, scanId, reportId });
  } catch (err) {
    res.status(500).json({ error: 'Report generation failed. Please try again.' });
    process.stderr.write(`[report error] ${err.message}\n`);
  }
});

app.post('/api/report/pdf', pdfLimiter, async (req, res) => {
  let url;
  try {
    url = await validatePublicUrl(req.body?.url ?? '');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const reportData = await generateReport(url);
    const pdf = await generatePDF(reportData);
    const hostname = new URL(url).hostname;
    const filename = `legibly-report-${safeFilename(hostname)}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: 'PDF generation failed. Please try again.' });
    process.stderr.write(`[pdf error] ${err.message}\n`);
  }
});

// ── WordPress connector ───────────────────────────────────────────────────────

app.get('/api/connections', requireAuthJson, (req, res) => {
  res.json({ connections: getUserConnections(req.user.id) });
});

app.post('/api/connections/wordpress', requireAuthJson, async (req, res) => {
  const { url, apiToken } = req.body ?? {};
  if (!url || !apiToken) return res.status(400).json({ error: 'url and apiToken required' });

  let validUrl;
  try { validUrl = await validatePublicUrl(url); } catch (err) { return res.status(400).json({ error: err.message }); }

  // Test connection by calling the plugin ping endpoint
  try {
    const pingRes = await fetch(`${validUrl}/wp-json/blindgeo/v1/ping`, {
      headers: { 'X-BlindGEO-Token': apiToken },
      signal: AbortSignal.timeout(8000),
    });
    if (!pingRes.ok) return res.status(400).json({ error: 'Could not connect to WordPress plugin. Make sure the plugin is installed and activated.' });
  } catch {
    return res.status(400).json({ error: 'Could not reach your WordPress site. Check the URL and plugin installation.' });
  }

  const id = saveConnection({ userId: req.user.id, platform: 'wordpress', url: validUrl, apiToken });
  res.json({ ok: true, id });
});

app.delete('/api/connections/:connectionId', requireAuthJson, (req, res) => {
  deleteConnection(req.params.connectionId, req.user.id);
  res.json({ ok: true });
});

app.post('/api/connections/wordpress/apply/:scanId', requireAuthJson, async (req, res) => {
  const scanRec = getScanById(req.params.scanId);
  if (!scanRec) return res.status(404).json({ error: 'Scan not found' });
  if (scanRec.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

  let validUrl;
  try { validUrl = await validatePublicUrl(scanRec.url); } catch (err) { return res.status(400).json({ error: err.message }); }

  const conn = getConnection(req.user.id, 'wordpress', validUrl);
  if (!conn) return res.status(404).json({ error: 'No WordPress connection found for this site. Connect WordPress first.' });

  const reportRec  = getReportByScan(scanRec.id);
  const domain     = new URL(validUrl).hostname.replace(/^www\./, '');
  const schemaRec  = reportRec?.report?.schemaRecs?.recommendations?.[0];
  const llmstxt    = reportRec?.report?.llmstxt?.content;

  const payload = {
    fixes: [
      { type: 'robots' },
      llmstxt    ? { type: 'llmstxt',    content: llmstxt }                             : null,
      schemaRec  ? { type: 'schema',     snippet: schemaRec.snippet, schemaType: schemaRec.type } : null,
    ].filter(Boolean),
  };

  try {
    const applyRes = await fetch(`${conn.url}/wp-json/blindgeo/v1/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-BlindGEO-Token': conn.api_token },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (!applyRes.ok) {
      const err = await applyRes.json().catch(() => ({}));
      return res.status(502).json({ error: err.message ?? 'WordPress plugin returned an error.' });
    }
    const result = await applyRes.json();
    res.json({ ok: true, applied: result.applied ?? [], errors: result.errors ?? [] });
  } catch (err) {
    res.status(502).json({ error: 'Could not reach WordPress site to apply fixes.' });
    process.stderr.write(`[wp-apply error] ${err.message}\n`);
  }
});

// ── Fix Kit download ──────────────────────────────────────────────────────────

const fixKitLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many fix kit requests. Please wait.' },
});

app.get('/api/fix-kit/:scanId', fixKitLimiter, async (req, res) => {
  const scanRec   = getScanById(req.params.scanId);
  if (!scanRec) return res.status(404).json({ error: 'Scan not found' });

  // Allow access to own scans or public scans
  if (scanRec.user_id && req.user?.id !== scanRec.user_id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const domain   = new URL(scanRec.url).hostname.replace(/^www\./, '');
    const reportRec = getReportByScan(scanRec.id);
    const zip = await generateFixKit({
      domain,
      url: scanRec.url,
      signals: scanRec.signals,
      report: reportRec?.report ?? null,
    });
    const filename = `blindgeo-fix-kit-${safeFilename(domain)}.zip`;
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': zip.length,
    });
    res.send(zip);
  } catch (err) {
    res.status(500).json({ error: 'Could not generate fix kit.' });
    process.stderr.write(`[fix-kit error] ${err.message}\n`);
  }
});

// ── GitHub OAuth + Fix Deploy ─────────────────────────────────────────────────

app.get('/api/github/auth', (req, res) => {
  if (!process.env.GITHUB_CLIENT_ID) return res.status(503).json({ error: 'GitHub not configured' });
  const state = Math.random().toString(36).slice(2);
  req.session.oauthState = state;
  res.redirect(getOAuthUrl(state));
});

app.get('/api/github/callback', async (req, res) => {
  const { code, state } = req.query;
  const appUrl = process.env.APP_URL ?? `https://${req.get('host')}`;

  if (!code || state !== req.session.oauthState) {
    return res.redirect(`${appUrl}/?github_error=1`);
  }

  try {
    const token = await exchangeCode(String(code));
    req.session.githubToken = token;
    req.session.oauthState  = null;
    res.redirect(`${appUrl}/?github_connected=1`);
  } catch {
    res.redirect(`${appUrl}/?github_error=1`);
  }
});

const fixLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many fix requests. Please wait 5 minutes.' },
});

app.post('/api/fix', fixLimiter, async (req, res) => {
  if (!req.session.githubToken) {
    return res.status(401).json({ error: 'GitHub not connected. Visit /api/github/auth first.' });
  }

  const { repoUrl, scanUrl } = req.body ?? {};
  if (!repoUrl || typeof repoUrl !== 'string') {
    return res.status(400).json({ error: 'repoUrl is required (e.g. github.com/owner/repo)' });
  }

  let owner, repo;
  try {
    ({ owner, repo } = parseRepo(repoUrl));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const token = req.session.githubToken;
    const stackInfo = await detectStack(token, owner, repo);

    // Generate the report for the scanned URL (for llms.txt + schema)
    let reportData = null;
    if (scanUrl) {
      try {
        const validUrl = await validatePublicUrl(scanUrl);
        reportData = await generateReport(validUrl);
      } catch { /* non-critical */ }
    }

    const fixes = buildFixes({
      stack:     stackInfo.stack,
      hasViteSsg: stackInfo.hasViteSsg,
      llmstxt:   reportData?.report?.llmstxt,
      schemaRecs: reportData?.report?.schemaRecs,
      domain:    new URL(scanUrl ?? 'https://example.com').hostname,
    });

    const { prUrl } = await createFixPR(token, owner, repo, fixes);
    res.json({ prUrl, fixCount: fixes.length, stack: stackInfo.stack });
  } catch (err) {
    res.status(500).json({ error: 'Could not create fix PR. Check repo permissions.' });
    process.stderr.write(`[fix error] ${err.message}\n`);
  }
});

// ── Competitors preview (free tier teaser — 1 Perplexity call, aggressively cached) ──

const competitorCache = new Map(); // url → { domains, ts }
const COMPETITOR_TTL  = 12 * 60 * 60 * 1000; // 12 hours

const competitorLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests.' },
});

app.get('/api/competitors-preview', competitorLimiter, async (req, res) => {
  let url;
  try { url = await validatePublicUrl(String(req.query.url ?? '')); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  const cached = competitorCache.get(url);
  if (cached && Date.now() - cached.ts < COMPETITOR_TTL) {
    return res.json({ competitors: cached.domains });
  }

  if (!process.env.PERPLEXITY_API_KEY) {
    return res.json({ competitors: [] });
  }

  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const prompt   = `Search for "${hostname}" and list the top 3 competitor domain names that appear in AI search results for the same queries. Return ONLY a JSON array of domain strings, no explanation. Example: ["competitor1.com","competitor2.com","competitor3.com"]`;

    const resp = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 80,
      }),
    });

    let domains = [];
    if (resp.ok) {
      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content ?? '[]';
      const match = text.match(/\[.*?\]/s);
      if (match) {
        const parsed = JSON.parse(match[0]);
        domains = parsed
          .filter(d => typeof d === 'string' && d.includes('.'))
          .map(d => d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0])
          .filter(d => d !== hostname)
          .slice(0, 3);
      }
    }

    competitorCache.set(url, { domains, ts: Date.now() });
    res.json({ competitors: domains });
  } catch (err) {
    process.stderr.write(`[competitors-preview error] ${err.message}\n`);
    res.json({ competitors: [] });
  }
});

// ── Google OAuth ──────────────────────────────────────────────────────────────

app.get('/auth/google', (_req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.redirect('/login.html?error=not_configured');
  const redirectUri = `${APP_URL}/auth/google/callback`;
  const { url }     = getGoogleAuthUrl(redirectUri);
  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !validateGoogleState(String(state ?? ''))) {
    return res.redirect('/login.html?error=oauth_failed');
  }
  try {
    const redirectUri = `${APP_URL}/auth/google/callback`;
    const user = await handleGoogleCallback(String(code), redirectUri);
    setSessionCookie(res, user);
    res.redirect('/dashboard.html');
  } catch (err) {
    process.stderr.write(`[google auth error] ${err.message}\n`);
    res.redirect('/login.html?error=oauth_failed');
  }
});

// ── Email magic link ──────────────────────────────────────────────────────────

const emailAuthLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please wait 5 minutes.' },
});

app.post('/auth/email', emailAuthLimiter, async (req, res) => {
  const { email } = req.body ?? {};
  if (!email || !EMAIL_RE.test(String(email))) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  try {
    await sendMagicLink(String(email).toLowerCase().trim());
    res.json({ ok: true });
  } catch (err) {
    process.stderr.write(`[magic link error] ${err.message}\n`);
    res.status(500).json({ error: 'Could not send login email. Please try again.' });
  }
});

app.get('/auth/email/verify', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/login.html?error=invalid_token');
  try {
    const user = await verifyAndLogin(String(token));
    if (!user) return res.redirect('/login.html?error=expired_token');
    setSessionCookie(res, user);
    res.redirect('/dashboard.html');
  } catch (err) {
    process.stderr.write(`[magic link verify error] ${err.message}\n`);
    res.redirect('/login.html?error=invalid_token');
  }
});

app.post('/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.redirect('/');
});

// ── Auth-aware user API ───────────────────────────────────────────────────────

app.get('/api/me', requireAuthJson, (req, res) => {
  const { id, email, name, avatar_url, created_at } = req.user;
  const tier  = getHighestActiveTier(id);  // subscriptions first, then one-time payments
  const brand = getBrandSettings(id);
  res.json({ id, email, name, avatarUrl: avatar_url, createdAt: created_at, tier, brand });
});

app.get('/api/subscription/status', requireAuthJson, (req, res) => {
  const sub  = getActiveSubscription(req.user.id);
  const tier = getHighestActiveTier(req.user.id);
  res.json({
    active:    !!sub || !!tier,
    tier:      tier ?? null,
    renewsAt:  sub?.current_period_end ?? null,
    subId:     sub?.stripe_subscription_id ?? null,
  });
});

app.get('/api/scans', requireAuthJson, (req, res) => {
  const scans = getScansByUser(req.user.id);
  res.json({ scans });
});

app.get('/api/report/:reportId', (req, res) => {
  const report = getReportById(req.params.reportId);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  if (!canAccessReport(req.params.reportId, req.user?.id ?? null)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  res.json(report);
});

app.patch('/api/report/:reportId/share', requireAuthJson, (req, res) => {
  const { isPublic } = req.body ?? {};
  if (!ownsReport(req.params.reportId, req.user.id)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  setReportPublic(req.params.reportId, Boolean(isPublic));
  res.json({ ok: true });
});

// ── MCP API keys ─────────────────────────────────────────────────────────────

import { provisionApiKey } from './mcp/server.js';

app.get('/api/keys', requireAuthJson, (req, res) => {
  const keys = db.prepare(`
    SELECT id, created_at,
      substr(key_hash, 1, 8) as key_preview
    FROM api_keys WHERE user_id = ? AND active = 1
    ORDER BY created_at DESC
  `).all(req.user.id);
  res.json({ keys });
});

app.post('/api/keys/provision', requireAuthJson, (req, res) => {
  const tier = getHighestActiveTier(req.user.id);
  if (!tier || !['fix', 'monitor'].includes(tier)) {
    return res.status(402).json({ error: 'Fix subscription ($29/mo) required to generate an API key' });
  }
  // Limit to 3 active keys per user
  const count = db.prepare('SELECT COUNT(*) as n FROM api_keys WHERE user_id = ? AND active = 1').get(req.user.id).n;
  if (count >= 3) {
    return res.status(400).json({ error: 'Maximum 3 active API keys. Revoke one before generating a new key.' });
  }
  const rawKey = provisionApiKey(req.user.id);
  res.json({ key: rawKey, note: 'Copy this key now — it will not be shown again.' });
});

app.delete('/api/keys/:keyId', requireAuthJson, (req, res) => {
  const result = db.prepare(
    'UPDATE api_keys SET active = 0 WHERE id = ? AND user_id = ?'
  ).run(req.params.keyId, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Key not found' });
  res.json({ ok: true });
});

// ── Brand settings ────────────────────────────────────────────────────────────

app.get('/api/settings/brand', requireAuthJson, (req, res) => {
  const settings = getBrandSettings(req.user.id) ?? {};
  res.json({
    name:          settings.name ?? '',
    domain:        settings.domain ?? '',
    description:   settings.description ?? '',
    providers:     settings.providers ? JSON.parse(settings.providers) : ['perplexity', 'gemini'],
    notifyWeekly:  Boolean(settings.notify_weekly),
    notifyGrade:   Boolean(settings.notify_grade),
    notifyProduct: Boolean(settings.notify_product),
  });
});

app.post('/api/settings/brand', requireAuthJson, (req, res) => {
  const { name, domain, description, providers, notifyWeekly, notifyGrade, notifyProduct } = req.body ?? {};
  // Validate providers allowlist
  const safeProviders = Array.isArray(providers)
    ? providers.filter(p => ALLOWED_PROVIDERS.has(p))
    : undefined;
  // Validate domain is a plain hostname (no scheme, no path, no internal IPs)
  if (domain && !/^[a-zA-Z0-9.-]+$/.test(domain)) {
    return res.status(400).json({ error: 'Invalid domain' });
  }
  saveBrandSettings(req.user.id, { name, domain, description, providers: safeProviders, notifyWeekly, notifyGrade, notifyProduct });
  res.json({ ok: true });
});

// ── Prompt monitoring slots ───────────────────────────────────────────────────

app.get('/api/prompts', requireAuthJson, (req, res) => {
  res.json({ prompts: getPromptSlots(req.user.id) });
});

app.post('/api/prompts', requireAuthJson, async (req, res) => {
  const { prompt, url } = req.body ?? {};
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
    return res.status(400).json({ error: 'Prompt must be at least 5 characters' });
  }
  if (prompt.trim().length > 500) {
    return res.status(400).json({ error: 'Prompt must be 500 characters or fewer' });
  }
  // Validate url if provided — prevents SSRF via cron loop
  let validUrl = null;
  if (url) {
    try { validUrl = await validatePublicUrl(url); }
    catch (err) { return res.status(400).json({ error: `Invalid URL: ${err.message}` }); }
  }
  const tier = getHighestActiveTier(req.user.id);
  if (!tier) return res.status(402).json({ error: 'Fix subscription required' });
  try {
    const id = addPromptSlot(req.user.id, { prompt: prompt.trim(), url: validUrl }, tier);
    res.json({ ok: true, id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/prompts/results', requireAuthJson, (req, res) => {
  const results = getLatestResultPerPrompt(req.user.id);
  res.json({ results });
});

app.delete('/api/prompts/:promptId', requireAuthJson, (req, res) => {
  const deleted = deletePromptSlot(req.params.promptId, req.user.id);
  if (!deleted) return res.status(404).json({ error: 'Prompt not found' });
  res.json({ ok: true });
});

// ── Competitor comparison ─────────────────────────────────────────────────────

const compareLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many comparison requests. Please wait.' },
});

app.post('/api/compare', compareLimiter, requireAuthJson, async (req, res) => {
  const tier = getHighestActiveTier(req.user.id);
  if (!tier || !['monitor'].includes(tier)) {
    return res.status(402).json({ error: 'Fix+Monitor subscription required for competitor comparison' });
  }
  const { urlA, urlB } = req.body ?? {};
  let validA, validB;
  try {
    validA = await validatePublicUrl(urlA ?? '');
    validB = await validatePublicUrl(urlB ?? '');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    const [scanA, scanB] = await Promise.all([scan(validA), scan(validB)]);
    res.json({
      urlA: validA, urlB: validB,
      gradeA: scanA.grade, scoreA: scanA.score, signalsA: scanA.signals,
      gradeB: scanB.grade, scoreB: scanB.score, signalsB: scanB.signals,
    });
  } catch (err) {
    res.status(500).json({ error: 'Comparison failed. Please try again.' });
    process.stderr.write(`[compare error] ${err.message}\n`);
  }
});

// ── Mark fixed ───────────────────────────────────────────────────────────────

app.post('/api/scans/:scanId/mark-fixed', requireAuthJson, (req, res) => {
  const scan = getScanById(req.params.scanId);
  if (!scan) return res.status(404).json({ error: 'Scan not found' });
  if (scan.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
  markScanFixed(req.params.scanId);
  res.json({ ok: true });
});

// ── Rescan ────────────────────────────────────────────────────────────────────

const rescanLimiter = rateLimit({
  windowMs: 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many rescan requests. Please wait a minute.' },
});

app.post('/api/rescan/:scanId', requireAuthJson, rescanLimiter, async (req, res) => {
  const original = getScanById(req.params.scanId);
  if (!original) return res.status(404).json({ error: 'Scan not found' });
  if (original.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

  try {
    const url    = await validatePublicUrl(original.url);
    const result = await scan(url);
    const newId  = insertScan({ userId: req.user.id, url, grade: result.grade, score: result.score, signals: result.signals });
    const gradeDelta = result.score - (original.score ?? 0);
    res.json({ scanId: newId, grade: result.grade, score: result.score, gradeDelta });
  } catch (err) {
    res.status(500).json({ error: 'Rescan failed. Please try again.' });
    process.stderr.write(`[rescan error] ${err.message}\n`);
  }
});

// ── Stripe webhook (server-side report delivery) ──────────────────────────────

app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(503).send('Payments not configured');
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    process.stderr.write('[webhook] STRIPE_WEBHOOK_SECRET not set — rejecting unverified webhook\n');
    return res.status(400).send('Webhook secret not configured');
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook signature error: ${err.message}`);
  }

  // Subscription lifecycle events
  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const sub = event.data.object;
    const tier = sub.metadata?.tier
      ?? (sub.items?.data?.[0]?.price?.metadata?.tier)
      ?? 'fix';
    // Find user by customer ID
    const userId = (() => {
      const row = sub.customer
        ? db.prepare('SELECT id FROM users WHERE email = (SELECT email FROM users WHERE id IN (SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?) LIMIT 1)').get(sub.customer)
        : null;
      return row?.id ?? null;
    })();
    upsertSubscription({
      userId,
      stripeCustomerId:     sub.customer,
      stripeSubscriptionId: sub.id,
      tier,
      status:              sub.status === 'active' ? 'active' : 'inactive',
      currentPeriodEnd:    sub.current_period_end,
    });
    process.stderr.write(`[sub] ${event.type} — ${sub.id} tier=${tier} status=${sub.status}\n`);
  }

  if (event.type === 'customer.subscription.deleted') {
    cancelSubscription(event.data.object.id);
    process.stderr.write(`[sub] canceled — ${event.data.object.id}\n`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    try {
      const existing = getPaymentBySession(session.id);
      if (existing) return res.json({ received: true }); // idempotent

      const scanUrl     = session.metadata?.scanUrl ?? '';
      const tier        = session.metadata?.tier ?? 'fix';
      const amountCents = session.amount_total ?? 0;

      // Link to user by email
      const customerEmail = session.customer_details?.email;
      let linkedUserId = null;
      if (customerEmail) {
        const userRow = db.prepare('SELECT id FROM users WHERE email = ?').get(customerEmail.toLowerCase());
        linkedUserId = userRow?.id ?? null;
      }

      // For subscription checkouts, wire up the subscription record
      if (session.mode === 'subscription' && session.subscription) {
        upsertSubscription({
          userId:               linkedUserId,
          stripeCustomerId:     session.customer,
          stripeSubscriptionId: session.subscription,
          tier,
          status:              'active',
          currentPeriodEnd:    null, // will be updated by subscription.updated event
        });
      }

      // Generate report server-side
      let reportId = null;
      let scanId   = null;
      if (scanUrl) {
        const validUrl   = await validatePublicUrl(scanUrl).catch(() => null);
        if (validUrl) {
          const scanResult = await scan(validUrl).catch(() => null);
          if (scanResult) {
            scanId = insertScan({ userId: null, url: validUrl, grade: scanResult.grade, score: scanResult.score, signals: scanResult.signals });
            const reportResult = await generateReport(validUrl).catch(() => null);
            if (reportResult) {
              reportId = insertReport({ scanId, tier, report: reportResult });
            }
          }
        }
      }

      insertPayment({ userId: null, stripeSessionId: session.id, tier, amountCents, scanId });

      // Email report link to customer
      if (reportId && session.customer_details?.email) {
        const appUrl    = process.env.APP_URL ?? 'https://legibly.dev';
        const reportUrl = `${appUrl}/report.html?id=${reportId}`;
        const domain    = scanUrl ? new URL(scanUrl).hostname : 'your site';
        await sendReportReady(session.customer_details.email, reportUrl, domain).catch(() => {});
      }
    } catch (err) {
      process.stderr.write(`[webhook error] ${err.message}\n${err.stack}\n`);
    }
  }

  res.json({ received: true });
});

// ── Internal cron endpoint (called by Railway scheduled job) ─────────────────

const SIGNAL_ISSUE_LABELS = {
  prerender: "AI crawlers can't read your site",
  robots:    'AI crawlers are blocked',
  schema:    'No structured data',
  llmstxt:   'Missing llms.txt file',
  content:   'Content not answer-first',
  eeat:      'No brand trust signals',
  metadata:  'Weak page title/description',
};

app.get('/internal/cron/weekly-audit', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers['x-cron-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const subscribers = getAllActiveSubscribers(null);
  process.stderr.write(`[cron] weekly-audit — ${subscribers.length} subscribers\n`);

  // Respond immediately — work runs detached to avoid Railway HTTP timeout
  res.json({ accepted: true, total: subscribers.length });

  // Detached async loop with concurrency limit (5 parallel)
  const CONCURRENCY = 5;
  let idx = 0;
  let rescanned = 0, emailed = 0, errors = 0;

  async function checkPromptInPerplexity(prompt, domain) {
    if (!process.env.PERPLEXITY_API_KEY) return null;
    try {
      const resp = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: prompt }], max_tokens: 300 }),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      const answer = data.choices?.[0]?.message?.content ?? '';
      const appeared = answer.toLowerCase().includes(domain.toLowerCase());
      // Return snippet (first 200 chars of answer) so results are meaningful
      const snippet = answer.slice(0, 200).trim() || null;
      return { appeared, snippet };
    } catch { return null; }
  }

  async function runOne({ user_id, email }) {
    try {
      const userScans = getScansByUser(user_id, 2);
      if (!userScans.length) return;
      const latest = userScans[0];
      const url    = await validatePublicUrl(latest.url).catch(() => null);
      if (!url) return;

      const controller = new AbortController();
      const timer      = setTimeout(() => controller.abort(), 20_000);
      const newScan    = await scan(url).finally(() => clearTimeout(timer));
      const newScanId  = insertScan({ userId: user_id, url, grade: newScan.grade, score: newScan.score, signals: newScan.signals });
      rescanned++;

      // Grade-drop alert
      const brand    = getBrandSettings(user_id);
      const prevScore = latest.score ?? 0;
      const scoreDelta = newScan.score - prevScore;
      const gradeDrop  = scoreDelta < -10; // >10 point drop triggers alert

      if (brand?.notify_weekly !== 0 || (gradeDrop && brand?.notify_grade !== 0)) {
        const domain    = new URL(url).hostname;
        const topIssues = Object.entries(newScan.signals ?? {})
          .filter(([, s]) => (s?.score ?? 0) < 5).slice(0, 3)
          .map(([key]) => SIGNAL_ISSUE_LABELS[key] ?? key);

        if (gradeDrop && brand?.notify_grade !== 0) {
          // Immediate grade-drop alert (override weekly preference)
          await sendDeltaEmail(email, domain, `${APP_URL}/dashboard.html`, {
            prevGrade: latest.grade ?? '?', newGrade: newScan.grade, scoreDelta, topIssues,
          }).catch(() => {});
        } else if (brand?.notify_weekly !== 0) {
          await sendDeltaEmail(email, domain, `${APP_URL}/dashboard.html`, {
            prevGrade: latest.grade ?? '?', newGrade: newScan.grade, scoreDelta, topIssues,
          }).catch(() => {});
        }
        emailed++;
      }

      // Check user-defined monitoring prompts and store results
      const monPrompts = getPromptSlots(user_id);
      for (const mp of monPrompts) {
        if (!mp.url) continue;
        try {
          const mpDomain = new URL(mp.url).hostname.replace(/^www\./, '');
          const result = await checkPromptInPerplexity(mp.prompt, mpDomain);
          if (result !== null) {
            saveMonitoringResult({
              promptId: mp.id,
              userId:   user_id,
              appeared: result.appeared,
              snippet:  result.snippet,
            });
          }
        } catch { /* non-critical per-prompt error */ }
      }
    } catch (err) {
      errors++;
      process.stderr.write(`[cron] error for user ${user_id}: ${err.message}\n`);
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (idx < subscribers.length) {
      const sub = subscribers[idx++];
      await runOne(sub);
    }
  });
  Promise.allSettled(workers).then(() => {
    process.stderr.write(`[cron] done — rescanned:${rescanned} emailed:${emailed} errors:${errors}\n`);
  });
});

app.listen(PORT, () => {
  process.stdout.write(`blindgeo running on http://localhost:${PORT}\n`);
});
