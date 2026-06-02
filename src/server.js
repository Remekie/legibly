import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import Stripe from 'stripe';
import { validatePublicUrl, safeFilename } from './lib/validateUrl.js';
import { scan } from './scan/index.js';
import { getCached, setCached, cacheSize } from './scan/cache.js';
import { generateReport } from './report/index.js';
import { generatePDF } from './report/pdf.js';

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(helmet());
app.use(express.json({ limit: '10kb' }));
app.use(express.static('public'));

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
// In-memory store — replace with DB when adding persistence
const emailLeads = new Map(); // email → { url, grade, ts }

app.post('/api/email', emailLimiter, (req, res) => {
  const { email, url, grade } = req.body ?? {};

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  emailLeads.set(email.toLowerCase().trim(), {
    url: url ?? '',
    grade: grade ?? '',
    ts: new Date().toISOString(),
  });

  process.stderr.write(`[lead] ${email} scanned ${url} (${grade})\n`);
  res.json({ ok: true });
});

const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a minute.' },
});

const REPORT_PRICE_CENTS = 7900; // $79.00

app.post('/api/checkout', checkoutLimiter, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments not configured' });

  const { url } = req.body ?? {};
  let scanUrl = '';
  try {
    scanUrl = url ? await validatePublicUrl(url) : '';
  } catch { /* non-critical — just metadata */ }

  const appUrl = process.env.APP_URL ?? `https://${req.get('host')}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: REPORT_PRICE_CENTS,
          product_data: {
            name: 'Legibly AI Visibility Report',
            description: 'Full AI visibility analysis — prompts, schema snippets, generated llms.txt, copy-paste fixes, PDF',
          },
        },
        quantity: 1,
      }],
      metadata: { scanUrl },
      success_url: `${appUrl}/?payment_success=1&session_id={CHECKOUT_SESSION_ID}&scan_url=${encodeURIComponent(scanUrl)}`,
      cancel_url: `${appUrl}/`,
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: 'Could not create checkout session.' });
    process.stderr.write(`[stripe error] ${err.message}\n`);
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

  try {
    const result = await generateReport(url);
    res.json(result);
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

app.listen(PORT, () => {
  process.stdout.write(`legibly running on http://localhost:${PORT}\n`);
});
