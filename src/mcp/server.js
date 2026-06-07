/**
 * BlindGEO MCP Server — Streamable HTTP transport
 *
 * Tools:
 *  - scan_site(url)              free (10/month per IP) — grade + signals
 *  - get_fixes(scan_id, api_key) API-key-gated — copy-paste fixes
 *
 * Mount: app.use('/mcp', mcpRouter())
 *
 * Claude Desktop: { "blindgeo": { "url": "https://blindgeo.com/mcp" } }
 * Claude Code:    claude mcp add blindgeo --transport http https://blindgeo.com/mcp
 */

import { Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import db from '../db/index.js';
import { scan } from '../scan/index.js';
import { validatePublicUrl } from '../lib/validateUrl.js';
import { getReportByScan } from '../db/reports.js';

const APP_URL = process.env.APP_URL ?? 'https://blindgeo.com';
const FREE_LIMIT = 10;

// ── Rate limiting ─────────────────────────────────────────────────────────────

db.exec(`CREATE TABLE IF NOT EXISTS mcp_usage (
  ip    TEXT NOT NULL,
  month TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, month)
)`);

function getUsage(ip) {
  const month = new Date().toISOString().slice(0, 7);
  return db.prepare('SELECT count FROM mcp_usage WHERE ip = ? AND month = ?').get(ip, month)?.count ?? 0;
}

function incUsage(ip) {
  const month = new Date().toISOString().slice(0, 7);
  db.prepare(`INSERT INTO mcp_usage (ip, month, count) VALUES (?, ?, 1)
    ON CONFLICT(ip, month) DO UPDATE SET count = count + 1`).run(ip, month);
}

// ── API key check — DB lookup against api_keys table ─────────────────────────

import { timingSafeEqual, createHash } from 'crypto';

db.exec(`CREATE TABLE IF NOT EXISTS api_keys (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  key_hash   TEXT UNIQUE NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);

function hashKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

function isValidKey(key) {
  if (!key || typeof key !== 'string') return false;

  // Dev override: compare hashes so both strings must be equal length — no timing leak
  const testKey = process.env.MCP_TEST_KEY;
  if (testKey) {
    const a = Buffer.from(hashKey(key));
    const b = Buffer.from(hashKey(testKey));
    if (timingSafeEqual(a, b)) return true;
  }

  // Production: DB lookup (key stored as SHA-256 hash, never plaintext)
  const row = db.prepare('SELECT 1 FROM api_keys WHERE key_hash = ? AND active = 1').get(hashKey(key));
  return !!row;
}

// Log dev mode at startup
if (process.env.MCP_TEST_KEY) {
  process.stderr.write(`[mcp] ⚠️  MCP_TEST_KEY is set — API key gate bypassed for testing\n`);
}

// Provision an API key for a user. Returns the raw key once — never stored plaintext.
export function provisionApiKey(userId) {
  const rawKey = `bg_${randomUUID().replace(/-/g, '')}`;
  const hash   = hashKey(rawKey);
  db.prepare('INSERT INTO api_keys (id, user_id, key_hash) VALUES (?, ?, ?)').run(randomUUID(), userId, hash);
  return rawKey;
}

// ── Signal formatting ─────────────────────────────────────────────────────────

const FAIL_LABELS = {
  prerender: "AI can't read your site (JS rendering issue)",
  robots:    'AI crawler rules missing (robots.txt)',
  schema:    "AI doesn't know what you sell (no schema)",
  llmstxt:   'AI summary missing (/llms.txt not found)',
  content:   "Content doesn't answer questions directly",
  eeat:      'Business credibility signals missing',
  metadata:  "Pages aren't described clearly (title/meta)",
};
const PASS_LABELS = {
  prerender: 'AI can read your site',
  robots:    'Search rules are set',
  schema:    'AI knows what you sell',
  llmstxt:   'AI summary is in place',
  content:   'Content answers questions',
  eeat:      'Business credibility signals present',
  metadata:  'Pages described clearly',
};

function fmtSignals(signals) {
  return Object.entries(signals ?? {}).map(([k, s]) => {
    const score = s?.score ?? 0;
    const icon  = score >= 8 ? '✓' : score >= 4 ? '!' : '✗';
    const label = score >= 8 ? (PASS_LABELS[k] ?? k) : (FAIL_LABELS[k] ?? k);
    return `  ${icon} ${label} (${score}/10)`;
  }).join('\n');
}

// ── Build MCP server instance ─────────────────────────────────────────────────

function buildMcpServer() {
  const server = new McpServer({ name: 'blindgeo', version: '1.0.0' });

  // Tool 1 — scan_site (free tier)
  server.tool(
    'scan_site',
    'Scan any website for AI visibility issues. Returns grade A–F, 7-signal breakdown (AI rendering, schema, llms.txt, etc.), and which competitors appear in AI search results instead of this site. Free: 10 scans/month. Upgrade at blindgeo.com for unlimited scans + fixes.',
    { url: z.string().describe('Website URL to scan, e.g. "example.com"') },
    async ({ url }, extra) => {
      // SDK 1.29: IP and headers live on extra.requestInfo.headers (not requestContext)
      const hdrs = extra?.requestInfo?.headers;
      const getHeader = (name) => hdrs?.get?.(name) ?? hdrs?.[name] ?? null;
      const ip  = (getHeader('x-forwarded-for') ?? '').split(',')[0].trim() || '0.0.0.0';
      const key = getHeader('x-blindgeo-key');

      let valid;
      try { valid = await validatePublicUrl(url); }
      catch (e) { return { content: [{ type: 'text', text: `Invalid URL: ${e.message}` }], isError: true }; }

      const authed = isValidKey(key);
      if (!authed) {
        const used = getUsage(ip);
        if (used >= FREE_LIMIT) {
          return { content: [{ type: 'text', text:
            `⚠️ Free tier limit reached (${FREE_LIMIT} scans/month).\n\n` +
            `Get a BlindGEO API key for unlimited scans:\n${APP_URL}?upgrade=fix\n\n` +
            `Fix plan ($19/mo) includes unlimited MCP scans, competitor tracking, and weekly monitoring.`
          }]};
        }
        incUsage(ip);
      }

      let result;
      try { result = await scan(valid); }
      catch (e) { return { content: [{ type: 'text', text: `Scan failed: ${e.message}` }], isError: true }; }

      const { grade, score, blocker, signals } = result;
      const domain   = new URL(valid).hostname.replace(/^www\./, '');
      const failCount = Object.values(signals ?? {}).filter(s => (s?.score ?? 0) < 5).length;

      const lines = [
        `## BlindGEO — ${domain}`,
        ``,
        `**Grade: ${grade}** | Score: ${score}/100`,
        blocker ? `\n⚠️ ${blocker}\n` : '',
        ``,
        `### Signals`,
        fmtSignals(signals),
        ``,
      ];

      if (failCount > 0) {
        lines.push(`**${failCount} issue${failCount > 1 ? 's' : ''} blocking AI visibility.**`);
        lines.push(`Get copy-paste fixes: ${APP_URL}?url=${encodeURIComponent(valid)}`);
        if (!authed) {
          lines.push(`\n_Competitor names + fix generation require a BlindGEO account ($19/mo)._`);
        }
      } else {
        lines.push(`✅ ${domain} passes all AI visibility checks.`);
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  // Tool 2 — get_fixes (API-key gated)
  server.tool(
    'get_fixes',
    'Get copy-paste fixes for a scanned site: llms.txt content, JSON-LD schema, robots.txt rules, and Lovable/Bolt/v0 paste prompts. Requires a BlindGEO API key (included with Fix plan at blindgeo.com).',
    {
      scan_id: z.string().describe('Scan ID from a previous scan_site call'),
      api_key: z.string().describe('BlindGEO API key from blindgeo.com/dashboard'),
    },
    async ({ scan_id, api_key }) => {
      if (!isValidKey(api_key)) {
        return { content: [{ type: 'text', text:
          `get_fixes requires a BlindGEO API key.\nGet yours at: ${APP_URL}/dashboard.html\n(Included in Fix plan — $19/mo)`
        }], isError: true };
      }

      const rec = getReportByScan(scan_id);
      if (!rec) {
        return { content: [{ type: 'text', text: `No report for scan ID "${scan_id}". Run scan_site first.` }], isError: true };
      }

      const r     = rec.report ?? {};
      const lines = ['## BlindGEO Fixes', ''];

      (r.lovableSnippets ?? []).forEach(s => {
        lines.push(`### ${s.title}`);
        lines.push('```'); lines.push(s.prompt); lines.push('```'); lines.push('');
      });

      if (r.llmstxt?.content) {
        lines.push('### llms.txt — upload to yoursite.com/llms.txt');
        lines.push('```'); lines.push(r.llmstxt.content.slice(0, 600)); lines.push('```'); lines.push('');
      }

      const schema = r.schemaRecs?.recommendations?.[0];
      if (schema) {
        lines.push('### Schema — paste in <head>');
        lines.push('```html');
        lines.push('<script type="application/ld+json">');
        lines.push(schema.snippet?.slice(0, 500) ?? '');
        lines.push('</script>');
        lines.push('```'); lines.push('');
      }

      lines.push(`Full report: ${APP_URL}/report.html?id=${rec.id}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  return server;
}

// ── Express router ────────────────────────────────────────────────────────────

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min idle eviction

export function mcpRouter() {
  const router     = Router();
  const transports = new Map(); // sessionId → { transport, lastSeen }

  // Evict idle sessions every 5 minutes
  const evictTimer = setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, entry] of transports) {
      if (entry.lastSeen < cutoff) {
        entry.transport.close?.().catch(() => {});
        transports.delete(id);
      }
    }
  }, 5 * 60 * 1000);
  evictTimer.unref(); // don't block process exit

  router.post('/', async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'] ?? randomUUID();
      let entry       = transports.get(sessionId);

      if (!entry) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
        });
        const server = buildMcpServer();
        await server.connect(transport);
        entry = { transport, lastSeen: Date.now() };
        transports.set(sessionId, entry);
        transport.onclose = () => transports.delete(sessionId);
      }

      entry.lastSeen = Date.now();
      await entry.transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: err.message });
      process.stderr.write(`[mcp error] ${err.message}\n`);
    }
  });

  // SSE stream endpoint (for clients that use GET for streaming)
  router.get('/', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const entry     = sessionId ? transports.get(sessionId) : null;
    if (!entry) { res.status(404).json({ error: 'Session not found' }); return; }
    entry.lastSeen = Date.now();
    await entry.transport.handleRequest(req, res);
  });

  router.delete('/', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId) transports.delete(sessionId);
    res.status(200).end();
  });

  return router;
}
