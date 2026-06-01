import puppeteer from 'puppeteer';

const INTENT_LABELS = {
  awareness:    'Awareness',
  comparison:   'Comparison',
  decision:     'Decision',
  usecase:      'Use Case',
  postpurchase: 'Post-Purchase',
};

const SIGNAL_LABELS = {
  prerender: 'AI Crawler Rendering',
  robots:    'Crawler Access',
  schema:    'Structured Data',
  llmstxt:   'llms.txt File',
  content:   'Answer-First Content',
  eeat:      'Brand Trust Signals',
  metadata:  'Page Metadata',
};

/**
 * Generate a PDF report from a full report result object.
 * Uses Puppeteer to render HTML → PDF for pixel-perfect design.
 * @param {object} reportData - Full result from generateReport()
 * @returns {Promise<Buffer>} PDF bytes
 */
export async function generatePDF(reportData) {
  const html = buildReportHTML(reportData);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return pdf;
  } finally {
    await browser?.close();
  }
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function gradeColor(grade) {
  return { A: '#4ade80', B: '#a3e635', C: '#facc15', D: '#fb923c', F: '#f87171' }[grade] ?? '#f87171';
}

function signalColor(score, stub) {
  if (stub) return '#52525b';
  if (score >= 8) return '#4ade80';
  if (score > 0)  return '#facc15';
  return '#f87171';
}

function signalIcon(score, stub) {
  if (stub) return '·';
  if (score >= 8) return '✓';
  if (score > 0)  return '~';
  return '✗';
}

function gaugeArc(pct) {
  const r = 70, cx = 90, cy = 90;
  const circ = 2 * Math.PI * r;
  const arc  = circ * 0.75;
  const fill = arc * (pct / 100);
  const gap  = circ - arc;
  const color = pct >= 80 ? '#4ade80' : pct >= 50 ? '#facc15' : '#f87171';
  return { r, cx, cy, circ, arc, fill, gap, color };
}

function buildReportHTML(data) {
  const { url, grade, score, blocker, signals, context, report } = data;
  const domain = context?.domain ?? new URL(url).hostname;
  const title  = context?.title ?? domain;
  const prerender = signals?.prerender ?? {};
  const visPct  = prerender.visibilityPct ?? null;
  const missing = prerender.missingWordCount ?? 0;
  const gColor  = gradeColor(grade);
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const g = visPct !== null ? gaugeArc(visPct) : null;

  const promptsHTML = (() => {
    const p = report?.prompts;
    if (!p) return '';
    const rows = Object.entries(p)
      .filter(([, v]) => v?.length)
      .map(([intent, prompts]) => `
        <div class="prompt-group">
          <div class="intent-badge">${esc(INTENT_LABELS[intent] ?? intent)}</div>
          ${prompts.map(q => `<div class="prompt-item">"${esc(q)}"</div>`).join('')}
        </div>
      `).join('');
    return rows ? `
      <div class="section">
        <div class="section-header">
          <span class="section-icon">🎯</span>
          <h2>Prompts This Page Should Be Winning</h2>
        </div>
        <p class="section-sub">Real queries people type into ChatGPT and Perplexity where this site should appear — but likely doesn't.</p>
        <div class="prompts-grid">${rows}</div>
      </div>` : '';
  })();

  const schemaHTML = (() => {
    const recs = report?.schemaRecs?.recommendations;
    if (!recs?.length) return '';
    return `
      <div class="section">
        <div class="section-header">
          <span class="section-icon">🏗️</span>
          <h2>Structured Data — Add This to Your Site</h2>
        </div>
        <p class="section-sub">Paste each snippet inside a &lt;script type="application/ld+json"&gt; tag in your page &lt;head&gt;.</p>
        ${recs.map(r => `
          <div class="schema-block">
            <div class="schema-header">
              <span class="type-badge">${esc(r.type)}</span>
              <span class="schema-reason">${esc(r.reason)}</span>
            </div>
            <pre class="code-block">${esc(r.snippet)}</pre>
          </div>
        `).join('')}
      </div>`;
  })();

  const llmstxtHTML = (() => {
    const lt = report?.llmstxt;
    if (!lt?.content) return '';
    return `
      <div class="section">
        <div class="section-header">
          <span class="section-icon">📄</span>
          <h2>Your llms.txt File</h2>
        </div>
        <p class="section-sub">Upload this file to <strong>https://${esc(domain)}/llms.txt</strong> so AI engines have a plain-language guide to your site. Covers ${lt.pageCount ?? '?'} pages.</p>
        <pre class="code-block llmstxt-block">${esc(lt.content)}</pre>
      </div>`;
  })();

  const fixesHTML = (() => {
    const fixes = report?.fixes;
    if (!fixes || !Object.keys(fixes).length) return '';
    const items = Object.values(fixes).map(fix => {
      if (!fix) return '';
      if (fix.items) {
        return `
          <div class="fix-block">
            <h4>${esc(fix.title)}</h4>
            ${fix.items.map(i => `
              <div class="fix-item">
                <strong>${esc(i.label)}</strong>
                <pre class="code-block">${esc(i.instruction)}</pre>
              </div>`).join('')}
          </div>`;
      }
      return `
        <div class="fix-block">
          <h4>${esc(fix.title)}</h4>
          ${(fix.options ?? []).map(o => `
            <div class="fix-option">
              <strong>${esc(o.label)}</strong>
              <pre class="code-block">${o.steps.map(s => esc(s)).join('\n')}</pre>
              ${o.note ? `<p class="fix-note">${esc(o.note)}</p>` : ''}
            </div>`).join('')}
        </div>`;
    }).join('');
    return `
      <div class="section">
        <div class="section-header">
          <span class="section-icon">🔧</span>
          <h2>How to Fix What's Failing</h2>
        </div>
        ${items}
      </div>`;
  })();

  const signalsHTML = Object.entries(signals ?? {}).map(([key, s]) => `
    <div class="signal-row">
      <span class="signal-icon-sm" style="color:${signalColor(s.score, s.stub)}">${signalIcon(s.score, s.stub)}</span>
      <span class="signal-name">${esc(SIGNAL_LABELS[key] ?? key)}</span>
      <span class="signal-score" style="color:${signalColor(s.score, s.stub)}">${s.stub ? '—' : s.score + '/10'}</span>
      <div class="signal-bar-wrap">
        <div class="signal-bar" style="width:${s.stub ? 0 : (s.score / 10) * 100}%;background:${signalColor(s.score, s.stub)}"></div>
      </div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Visibility Report — ${esc(domain)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: #ffffff;
    color: #0f172a;
    font-size: 11pt;
    line-height: 1.6;
  }

  /* ── Cover page ── */
  .cover {
    background: linear-gradient(145deg, #0a0a0f 0%, #0f1729 60%, #1a0f2e 100%);
    min-height: 100vh;
    padding: 60px 64px;
    display: flex;
    flex-direction: column;
    color: #fff;
    page-break-after: always;
  }

  .cover-brand {
    font-size: 18pt;
    font-weight: 900;
    letter-spacing: -0.03em;
    color: #e8ff47;
    margin-bottom: 4px;
  }

  .cover-tagline { font-size: 9pt; color: rgba(255,255,255,0.45); letter-spacing: 0.06em; text-transform: uppercase; }

  .cover-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 32px;
  }

  .cover-title { font-size: 28pt; font-weight: 800; line-height: 1.2; letter-spacing: -0.03em; }
  .cover-domain {
    font-size: 13pt;
    color: rgba(255,255,255,0.55);
    font-weight: 500;
    word-break: break-all;
  }

  .cover-grade-row {
    display: flex;
    align-items: center;
    gap: 24px;
    margin-top: 8px;
  }

  .cover-grade {
    font-size: 80pt;
    font-weight: 900;
    letter-spacing: -0.05em;
    line-height: 1;
    color: ${gColor};
    text-shadow: 0 0 40px ${gColor}40;
  }

  .cover-grade-meta { display: flex; flex-direction: column; gap: 6px; }
  .cover-score { font-size: 14pt; font-weight: 700; color: #fff; }
  .cover-score-sub { font-size: 9pt; color: rgba(255,255,255,0.45); text-transform: uppercase; letter-spacing: 0.06em; }

  ${blocker ? `
  .cover-blocker {
    background: rgba(248,113,113,0.12);
    border: 1px solid rgba(248,113,113,0.3);
    border-radius: 10px;
    padding: 14px 18px;
    color: #fca5a5;
    font-size: 10pt;
    line-height: 1.5;
  }
  .cover-blocker::before { content: '⚠️  '; }
  ` : ''}

  .cover-vis-row {
    display: flex;
    align-items: center;
    gap: 20px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px;
    padding: 16px 20px;
  }

  .cover-vis-pct { font-size: 32pt; font-weight: 800; line-height: 1; color: ${g ? g.color : '#fff'}; }
  .cover-vis-label { font-size: 10pt; color: rgba(255,255,255,0.6); }
  .cover-vis-missing { font-size: 9pt; color: #f87171; margin-top: 2px; }

  .cover-footer {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    color: rgba(255,255,255,0.3);
    font-size: 8pt;
  }

  /* ── Inner pages ── */
  .page {
    padding: 48px 56px;
    page-break-after: always;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .page:last-child { page-break-after: avoid; }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 16px;
    border-bottom: 2px solid #e8ff47;
    margin-bottom: 32px;
  }

  .page-header-brand { font-size: 10pt; font-weight: 800; color: #e8ff47; }
  .page-header-domain { font-size: 8pt; color: #94a3b8; }

  .page-footer {
    margin-top: auto;
    padding-top: 16px;
    border-top: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    font-size: 8pt;
    color: #94a3b8;
  }

  /* ── Score card page ── */
  .scorecard-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 32px;
  }

  .score-main {
    background: #0f172a;
    border-radius: 14px;
    padding: 28px;
    color: #fff;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .score-grade-lg { font-size: 64pt; font-weight: 900; line-height: 1; color: ${gColor}; }
  .score-num { font-size: 16pt; font-weight: 700; color: #fff; }
  .score-label-sm { font-size: 8pt; color: rgba(255,255,255,0.45); text-transform: uppercase; letter-spacing: 0.08em; }

  ${g ? `
  .gauge-wrap {
    background: #f8fafc;
    border-radius: 14px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 1px solid #e2e8f0;
  }
  .gauge-label-main { font-size: 9pt; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; }
  .gauge-missing-label { font-size: 9pt; color: #ef4444; text-align: center; }
  ` : ''}

  /* Signals */
  .signals-section { margin-bottom: 28px; }
  .signals-title { font-size: 12pt; font-weight: 700; margin-bottom: 14px; color: #0f172a; }

  .signal-row {
    display: grid;
    grid-template-columns: 18px 1fr 48px 120px;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid #f1f5f9;
  }
  .signal-row:last-child { border-bottom: none; }
  .signal-icon-sm { font-size: 11pt; font-weight: 700; text-align: center; }
  .signal-name { font-size: 9.5pt; font-weight: 500; color: #1e293b; }
  .signal-score { font-size: 9pt; font-weight: 700; text-align: right; }
  .signal-bar-wrap { height: 5px; background: #e2e8f0; border-radius: 3px; overflow: hidden; }
  .signal-bar { height: 100%; border-radius: 3px; transition: width 0.3s; }

  /* ── Sections ── */
  .section {
    margin-bottom: 36px;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }

  .section-header h2 {
    font-size: 13pt;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.02em;
  }

  .section-icon { font-size: 14pt; }

  .section-sub {
    font-size: 9.5pt;
    color: #64748b;
    margin-bottom: 16px;
    line-height: 1.5;
  }

  /* Prompts */
  .prompts-grid { display: flex; flex-direction: column; gap: 16px; }
  .prompt-group { border-left: 3px solid #e8ff47; padding-left: 14px; }
  .intent-badge {
    display: inline-block;
    font-size: 7.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #e8ff47;
    background: #0f172a;
    padding: 2px 8px;
    border-radius: 4px;
    margin-bottom: 6px;
  }
  .prompt-item {
    font-size: 9.5pt;
    color: #1e293b;
    padding: 5px 0;
    line-height: 1.4;
    border-bottom: 1px solid #f1f5f9;
  }
  .prompt-item:last-child { border-bottom: none; }

  /* Schema */
  .schema-block { margin-bottom: 20px; }
  .schema-header { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
  .type-badge {
    font-size: 7.5pt;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 4px;
    background: #e8ff4720;
    color: #84883a;
    border: 1px solid #e8ff4740;
    white-space: nowrap;
  }
  .schema-reason { font-size: 9pt; color: #64748b; flex: 1; }

  /* Code blocks */
  .code-block {
    background: #0f172a;
    border-radius: 8px;
    padding: 14px 16px;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 7.5pt;
    line-height: 1.65;
    color: #e2e8f0;
    white-space: pre-wrap;
    word-break: break-word;
    overflow: hidden;
  }
  .llmstxt-block { max-height: 300pt; overflow: hidden; }

  /* Fixes */
  .fix-block { margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #e2e8f0; }
  .fix-block:last-child { border-bottom: none; }
  .fix-block h4 { font-size: 11pt; font-weight: 700; margin-bottom: 10px; color: #0f172a; }
  .fix-option, .fix-item { margin-bottom: 12px; }
  .fix-option strong, .fix-item strong { font-size: 9.5pt; display: block; margin-bottom: 6px; color: #1e293b; }
  .fix-note { font-size: 8.5pt; color: #94a3b8; margin-top: 6px; font-style: italic; }

  /* Roadmap */
  .roadmap-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-top: 8px;
  }
  .roadmap-phase {
    border-radius: 10px;
    padding: 16px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
  }
  .roadmap-phase-label {
    font-size: 7pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 8px;
    color: #94a3b8;
  }
  .roadmap-phase.quick .roadmap-phase-label { color: #4ade80; }
  .roadmap-phase.medium .roadmap-phase-label { color: #facc15; }
  .roadmap-phase.deep .roadmap-phase-label { color: #a78bfa; }
  .roadmap-item {
    font-size: 9pt;
    color: #334155;
    padding: 4px 0;
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }
  .roadmap-item::before { content: '→'; color: #94a3b8; flex-shrink: 0; }
</style>
</head>
<body>

<!-- ═══════════════════════════════ COVER PAGE ═══════════════════════════════ -->
<div class="cover">
  <div>
    <div class="cover-brand">legibly</div>
    <div class="cover-tagline">AI Visibility Report</div>
  </div>

  <div class="cover-body">
    <div>
      <div class="cover-title">AI Visibility<br>Audit Report</div>
      <div class="cover-domain" style="margin-top:10px;">${esc(url)}</div>
    </div>

    <div class="cover-grade-row">
      <div class="cover-grade">${esc(grade)}</div>
      <div class="cover-grade-meta">
        <div class="cover-score">${score}/100</div>
        <div class="cover-score-sub">AI Visibility Score</div>
        ${blocker ? `<div style="margin-top:6px;font-size:8.5pt;color:#fca5a5;">${esc(blocker)}</div>` : ''}
      </div>
    </div>

    ${visPct !== null ? `
    <div class="cover-vis-row">
      <div>
        <div class="cover-vis-pct">${visPct}%</div>
        <div class="cover-vis-label">of your content is visible to AI</div>
        ${missing > 0 ? `<div class="cover-vis-missing">${missing} words hidden from AI crawlers</div>` : ''}
      </div>
    </div>` : ''}
  </div>

  <div class="cover-footer">
    <span>${esc(domain)}</span>
    <span>${dateStr}</span>
  </div>
</div>

<!-- ═══════════════════════════════ SCORE CARD PAGE ═══════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <div class="page-header-brand">legibly</div>
    <div class="page-header-domain">${esc(domain)} — ${dateStr}</div>
  </div>

  <div class="scorecard-grid">
    <div class="score-main">
      <div class="score-label-sm">Overall Grade</div>
      <div class="score-grade-lg">${esc(grade)}</div>
      <div class="score-num">${score} / 100</div>
      <div class="score-label-sm">AI Visibility Score</div>
      ${blocker ? `<div style="margin-top:12px;font-size:9pt;color:#fca5a5;line-height:1.4;">${esc(blocker)}</div>` : ''}
    </div>

    ${g ? `
    <div class="gauge-wrap">
      <div class="gauge-label-main">Content Visibility</div>
      <svg viewBox="0 0 180 180" width="140" height="140">
        <circle cx="${g.cx}" cy="${g.cy}" r="${g.r}" fill="none" stroke="#e2e8f0" stroke-width="12"
          stroke-dasharray="${g.arc.toFixed(1)} ${g.circ.toFixed(1)}"
          transform="rotate(135 ${g.cx} ${g.cy})" stroke-linecap="round"/>
        <circle cx="${g.cx}" cy="${g.cy}" r="${g.r}" fill="none" stroke="${g.color}" stroke-width="12"
          stroke-dasharray="${g.fill.toFixed(1)} ${(g.circ - g.fill).toFixed(1)}"
          transform="rotate(135 ${g.cx} ${g.cy})" stroke-linecap="round"
          style="filter:drop-shadow(0 0 6px ${g.color}60)"/>
        <text x="${g.cx}" y="${g.cy - 6}" text-anchor="middle" font-family="Inter,sans-serif" font-weight="800" font-size="26" fill="${g.color}">${visPct}%</text>
        <text x="${g.cx}" y="${g.cy + 14}" text-anchor="middle" font-family="Inter,sans-serif" font-size="9" fill="#94a3b8">visible to AI</text>
      </svg>
      ${missing > 0 ? `<div class="gauge-missing-label">${missing} words hidden from AI</div>` : '<div style="font-size:9pt;color:#4ade80;">All content visible ✓</div>'}
    </div>` : '<div></div>'}
  </div>

  <div class="signals-section">
    <div class="signals-title">Signal Breakdown</div>
    ${signalsHTML}
  </div>

  <div class="page-footer">
    <span>legibly.dev — AI Visibility Report</span>
    <span>Page 2</span>
  </div>
</div>

<!-- ═══════════════════════════════ PROMPTS PAGE ═══════════════════════════════ -->
${promptsHTML ? `
<div class="page">
  <div class="page-header">
    <div class="page-header-brand">legibly</div>
    <div class="page-header-domain">${esc(domain)}</div>
  </div>
  ${promptsHTML}
  <div class="page-footer">
    <span>legibly.dev — AI Visibility Report</span>
    <span>Page 3</span>
  </div>
</div>` : ''}

<!-- ═══════════════════════════════ FIXES + SCHEMA PAGE ═══════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <div class="page-header-brand">legibly</div>
    <div class="page-header-domain">${esc(domain)}</div>
  </div>

  ${fixesHTML}
  ${schemaHTML}

  <div class="page-footer">
    <span>legibly.dev — AI Visibility Report</span>
    <span>Page 4</span>
  </div>
</div>

<!-- ═══════════════════════════════ LLMS.TXT PAGE ═══════════════════════════════ -->
${llmstxtHTML ? `
<div class="page">
  <div class="page-header">
    <div class="page-header-brand">legibly</div>
    <div class="page-header-domain">${esc(domain)}</div>
  </div>
  ${llmstxtHTML}

  <!-- Roadmap -->
  <div class="section" style="margin-top:32px;">
    <div class="section-header">
      <span class="section-icon">📅</span>
      <h2>30/60/90 Day Implementation Roadmap</h2>
    </div>
    <div class="roadmap-grid">
      <div class="roadmap-phase quick">
        <div class="roadmap-phase-label">Quick Wins — Days 1–7</div>
        <div class="roadmap-item">Upload llms.txt to site root</div>
        <div class="roadmap-item">Fix robots.txt AI crawler blocks</div>
        <div class="roadmap-item">Add Organization JSON-LD schema</div>
        <div class="roadmap-item">Fix page title and meta description</div>
      </div>
      <div class="roadmap-phase medium">
        <div class="roadmap-phase-label">Medium Term — Days 8–30</div>
        <div class="roadmap-item">Add Service/Product schema</div>
        <div class="roadmap-item">Rewrite H1 with clear value statement</div>
        <div class="roadmap-item">Add Open Graph tags</div>
        <div class="roadmap-item">Fix image alt text</div>
      </div>
      <div class="roadmap-phase deep">
        <div class="roadmap-phase-label">Deep Work — Days 31–90</div>
        <div class="roadmap-item">Enable server-side rendering</div>
        <div class="roadmap-item">Rewrite homepage with answer-first content</div>
        <div class="roadmap-item">Build FAQ page with FAQPage schema</div>
        <div class="roadmap-item">Add social sameAs links to schema</div>
      </div>
    </div>
  </div>

  <div class="page-footer">
    <span>legibly.dev — AI Visibility Report</span>
    <span>Page 5</span>
  </div>
</div>` : ''}

</body>
</html>`;
}
