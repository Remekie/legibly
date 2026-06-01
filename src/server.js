import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Resend } from 'resend';
import { scan } from './scan/index.js';
import { getCached, setCached, cacheSize } from './scan/cache.js';
import { generateReport } from './report/index.js';
import { generatePDF } from './report/pdf.js';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(helmet());
app.use(express.json({ limit: '10kb' }));
app.use(express.static('public'));

const reportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many report requests. Please wait a minute.' },
});

const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a minute.' },
});

app.get('/health', async (_req, res) => {
  const { execSync } = await import('child_process');
  let chromiumPath = process.env.CHROMIUM_PATH ?? 'not set';
  let chromiumExists = false;
  try {
    const { existsSync } = await import('fs');
    chromiumExists = chromiumPath !== 'not set' && existsSync(chromiumPath);
    if (!chromiumExists) {
      // Try to find system chromium
      try { chromiumPath = execSync('which chromium || which chromium-browser || which google-chrome', { encoding: 'utf8' }).trim(); chromiumExists = true; } catch { /* not found */ }
    }
  } catch { /* ignore */ }
  res.json({
    status: 'ok',
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    perplexity: !!process.env.PERPLEXITY_API_KEY,
    cache: cacheSize(),
    chromiumPath,
    chromiumExists,
  });
});

app.post('/api/scan', scanLimiter, async (req, res) => {
  const { url } = req.body ?? {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  let parsed;
  try {
    parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'URL must use http or https' });
  }

  try {
    const cached = getCached(parsed.href);
    if (cached) {
      res.set('X-Cache', 'HIT');
      return res.json(cached);
    }
    const result = await scan(parsed.href);
    setCached(parsed.href, result);
    res.set('X-Cache', 'MISS');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Scan failed. Please try again.' });
    process.stderr.write(`[scan error] ${err.message}\n${err.stack}\n`);
  }
});

app.post('/api/report', reportLimiter, async (req, res) => {
  const { url } = req.body ?? {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  let parsed;
  try {
    parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'URL must use http or https' });
  }

  try {
    const result = await generateReport(parsed.href);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Report generation failed. Please try again.' });
    process.stderr.write(`[report error] ${err.message}\n`);
  }
});

const pdfLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'PDF generation limit reached. Please wait 5 minutes.' },
});

app.post('/api/report/pdf', pdfLimiter, async (req, res) => {
  const { url } = req.body ?? {};

  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url is required' });

  let parsed;
  try {
    parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'URL must use http or https' });
  }

  try {
    const reportData = await generateReport(parsed.href);
    const pdf = await generatePDF(reportData);
    const filename = `legibly-report-${parsed.hostname.replace('www.', '')}.pdf`;
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
