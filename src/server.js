import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { validatePublicUrl, safeFilename } from './lib/validateUrl.js';
import { scan } from './scan/index.js';
import { getCached, setCached, cacheSize } from './scan/cache.js';
import { generateReport } from './report/index.js';
import { generatePDF } from './report/pdf.js';

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
