import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { scan } from './scan/index.js';
import { generateReport } from './report/index.js';

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

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

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
    const result = await scan(parsed.href);
    res.json(result);
  } catch (err) {
    // Don't leak internal error details to client
    res.status(500).json({ error: 'Scan failed. Please try again.' });
    // TODO: replace with structured logger (pino/winston) before prod
    process.stderr.write(`[scan error] ${err.message}\n`);
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

app.listen(PORT, () => {
  process.stdout.write(`legibly running on http://localhost:${PORT}\n`);
});
