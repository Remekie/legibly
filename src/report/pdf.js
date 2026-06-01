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

// Palette derived from the physical reality of this product:
// a diagnostic lab report. Ink on paper. Red for critical. Black for authority.
// No gradients. No glow. No purple.
function gradeColor(grade) {
  return { A: '#1a6b2e', B: '#2d6b1a', C: '#7a5c00', D: '#8b2500', F: '#8b0000' }[grade] ?? '#8b0000';
}

function gradeBackground(grade) {
  return { A: '#e8f5eb', B: '#edf5e8', C: '#fef9e7', D: '#fef0e7', F: '#fce8e8' }[grade] ?? '#fce8e8';
}

function signalStatus(score, stub) {
  if (stub) return 'pending';
  if (score >= 8) return 'pass';
  if (score > 0) return 'partial';
  return 'fail';
}

function gaugeArc(pct) {
  const r = 65, cx = 85, cy = 85;
  const circ = 2 * Math.PI * r;
  const arc  = circ * 0.75;
  const fill = arc * (pct / 100);
  const color = pct >= 80 ? '#1a6b2e' : pct >= 50 ? '#7a5c00' : '#8b0000';
  return { r, cx, cy, circ, arc, fill, color };
}

function buildReportHTML(data) {
  const { url, grade, score, blocker, signals, context, report } = data;
  const domain  = context?.domain ?? new URL(url).hostname;
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const gColor  = gradeColor(grade);
  const gBg     = gradeBackground(grade);
  const prerender = signals?.prerender ?? {};
  const visPct  = prerender.visibilityPct ?? null;
  const missing = prerender.missingWordCount ?? 0;
  const g = visPct !== null ? gaugeArc(visPct) : null;

  // ── Signal rows ──────────────────────────────────────────────────────────────
  const signalsHTML = Object.entries(signals ?? {}).map(([key, s], i) => {
    const status = signalStatus(s.score, s.stub);
    const statusColors = { pass: '#1a6b2e', partial: '#7a5c00', fail: '#8b0000', pending: '#6b7280' };
    const statusLabels = { pass: 'PASS', partial: 'PARTIAL', fail: 'FAIL', pending: 'PENDING' };
    const barPct = s.stub ? 0 : (s.score / 10) * 100;
    return `
      <tr style="background:${i % 2 === 0 ? '#fff' : '#fafaf9'}">
        <td style="padding:9px 12px;font-size:9.5pt;font-weight:600;color:#1a1a1a;border-bottom:1px solid #e5e5e0;">
          ${esc(SIGNAL_LABELS[key] ?? key)}
        </td>
        <td style="padding:9px 12px;border-bottom:1px solid #e5e5e0;">
          <span style="display:inline-block;padding:2px 8px;border-radius:3px;font-size:7.5pt;font-weight:700;letter-spacing:0.07em;
            background:${statusColors[status]}18;color:${statusColors[status]};border:1px solid ${statusColors[status]}40;">
            ${statusLabels[status]}
          </span>
        </td>
        <td style="padding:9px 12px;border-bottom:1px solid #e5e5e0;">
          <div style="background:#e5e5e0;border-radius:2px;height:5px;width:120px;">
            <div style="background:${statusColors[status]};height:5px;border-radius:2px;width:${barPct}%;"></div>
          </div>
        </td>
        <td style="padding:9px 12px;font-size:8.5pt;color:#4a4a4a;border-bottom:1px solid #e5e5e0;max-width:280px;line-height:1.4;">
          ${s.stub ? 'Full report' : esc(s.detail ?? '')}
        </td>
      </tr>`;
  }).join('');

  // ── Prompts ──────────────────────────────────────────────────────────────────
  const promptsSection = (() => {
    const p = report?.prompts;
    if (!p) return '';
    const groups = Object.entries(p).filter(([, v]) => v?.length).map(([intent, prompts], gi) => `
      <div style="margin-bottom:18px;">
        <div style="font-size:7pt;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;
          color:#6b7280;border-left:3px solid #1a1a1a;padding-left:8px;margin-bottom:8px;">
          ${esc(INTENT_LABELS[intent] ?? intent)}
        </div>
        ${prompts.map(q => `
          <div style="padding:7px 12px;font-size:9.5pt;color:#1a1a1a;line-height:1.45;
            border-bottom:1px solid #e5e5e0;font-style:italic;">
            "${esc(q)}"
          </div>`).join('')}
      </div>`).join('');

    return groups ? `
      <div class="section-page">
        <div class="section-rule">
          <span class="section-num">02</span>
          <span class="section-name">Prompts This Site Should Be Winning</span>
        </div>
        <p style="font-size:9.5pt;color:#4a4a4a;margin-bottom:20px;line-height:1.5;">
          Real queries typed into ChatGPT, Perplexity, and Claude where <strong>${esc(domain)}</strong> should appear in the answer — but currently doesn't. These represent direct revenue exposure.
        </p>
        ${groups}
      </div>` : '';
  })();

  // ── Schema recs ───────────────────────────────────────────────────────────────
  const schemaSection = (() => {
    const recs = report?.schemaRecs?.recommendations;
    if (!recs?.length) return '';
    return `
      <div style="margin-bottom:28px;">
        <div class="section-rule">
          <span class="section-num">03</span>
          <span class="section-name">Structured Data — Deploy These Snippets</span>
        </div>
        <p style="font-size:9.5pt;color:#4a4a4a;margin-bottom:16px;line-height:1.5;">
          Each block below goes inside a <code style="font-family:'Courier New',monospace;font-size:8.5pt;background:#f0f0ec;padding:1px 4px;border-radius:2px;">&lt;script type="application/ld+json"&gt;</code> tag in your page <code style="font-family:'Courier New',monospace;font-size:8.5pt;background:#f0f0ec;padding:1px 4px;border-radius:2px;">&lt;head&gt;</code>.
        </p>
        ${recs.map(r => `
          <div style="margin-bottom:20px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
              <span style="display:inline-block;padding:3px 9px;font-size:7.5pt;font-weight:700;letter-spacing:0.06em;
                background:#1a1a1a;color:#fff;border-radius:3px;">${esc(r.type)}</span>
              <span style="font-size:9pt;color:#4a4a4a;">${esc(r.reason)}</span>
            </div>
            <pre style="background:#1a1a1a;color:#d4d4d0;font-family:'Courier New',monospace;
              font-size:7.5pt;line-height:1.65;padding:14px;border-radius:4px;
              white-space:pre-wrap;word-break:break-word;margin:0;">${esc(r.snippet)}</pre>
          </div>`).join('')}
      </div>`;
  })();

  // ── llms.txt ──────────────────────────────────────────────────────────────────
  const llmsSection = (() => {
    const lt = report?.llmstxt;
    if (!lt?.content) return '';
    return `
      <div style="margin-bottom:28px;">
        <div class="section-rule">
          <span class="section-num">04</span>
          <span class="section-name">Generated llms.txt — Upload to Site Root</span>
        </div>
        <p style="font-size:9.5pt;color:#4a4a4a;margin-bottom:12px;line-height:1.5;">
          Save as <code style="font-family:'Courier New',monospace;font-size:8.5pt;background:#f0f0ec;padding:1px 4px;border-radius:2px;">llms.txt</code> and upload to <strong>https://${esc(domain)}/llms.txt</strong>. This file tells AI engines what your site covers in plain language. Covers ${lt.pageCount ?? '?'} pages.
        </p>
        <pre style="background:#1a1a1a;color:#d4d4d0;font-family:'Courier New',monospace;
          font-size:7.5pt;line-height:1.65;padding:14px;border-radius:4px;
          white-space:pre-wrap;word-break:break-word;max-height:260pt;overflow:hidden;margin:0;">${esc(lt.content)}</pre>
      </div>`;
  })();

  // ── Fixes ─────────────────────────────────────────────────────────────────────
  const fixesSection = (() => {
    const fixes = report?.fixes;
    if (!fixes || !Object.keys(fixes).length) return '';
    const fixHTML = Object.values(fixes).filter(Boolean).map(fix => {
      const options = fix.items
        ? fix.items.map(i => `
            <div style="margin-bottom:10px;">
              <div style="font-size:9pt;font-weight:600;color:#1a1a1a;margin-bottom:4px;">${esc(i.label)}</div>
              <pre style="background:#f5f3ef;border:1px solid #e5e5e0;border-radius:4px;padding:10px;
                font-family:'Courier New',monospace;font-size:7.5pt;line-height:1.6;
                white-space:pre-wrap;word-break:break-word;color:#1a1a1a;margin:0;">${esc(i.instruction)}</pre>
            </div>`).join('')
        : (fix.options ?? []).map(o => `
            <div style="margin-bottom:10px;">
              <div style="font-size:9pt;font-weight:600;color:#1a1a1a;margin-bottom:4px;">${esc(o.label)}</div>
              <pre style="background:#f5f3ef;border:1px solid #e5e5e0;border-radius:4px;padding:10px;
                font-family:'Courier New',monospace;font-size:7.5pt;line-height:1.6;
                white-space:pre-wrap;word-break:break-word;color:#1a1a1a;margin:0;">${o.steps.map(s => esc(s)).join('\n')}</pre>
              ${o.note ? `<p style="font-size:8pt;color:#6b7280;margin-top:4px;font-style:italic;">${esc(o.note)}</p>` : ''}
            </div>`).join('');
      return `
        <div style="margin-bottom:18px;padding-bottom:18px;border-bottom:1px solid #e5e5e0;">
          <div style="font-size:10.5pt;font-weight:700;color:#1a1a1a;margin-bottom:10px;">${esc(fix.title)}</div>
          ${options}
        </div>`;
    }).join('');

    return `
      <div style="margin-bottom:28px;">
        <div class="section-rule">
          <span class="section-num">05</span>
          <span class="section-name">Implementation — Copy-Paste Fixes</span>
        </div>
        ${fixHTML}
      </div>`;
  })();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>AI Visibility Audit — ${esc(domain)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Playfair+Display:wght@700;900&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Inter', Georgia, sans-serif;
    background: #fff;
    color: #1a1a1a;
    font-size: 10.5pt;
    line-height: 1.6;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ─── COVER: diagnostic lab report, not SaaS landing page ─────────────────── */
  .cover {
    min-height: 100vh;
    background: #fff;
    padding: 0;
    page-break-after: always;
    display: flex;
    flex-direction: column;
    border-top: 12px solid #1a1a1a;
  }

  .cover-top {
    padding: 36px 56px 28px;
    border-bottom: 1px solid #e5e5e0;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }

  .cover-brand-name {
    font-family: 'Inter', sans-serif;
    font-size: 15pt;
    font-weight: 900;
    letter-spacing: -0.04em;
    color: #1a1a1a;
  }

  .cover-brand-desc {
    font-size: 8pt;
    color: #6b7280;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-top: 3px;
  }

  .cover-meta {
    text-align: right;
    font-size: 8.5pt;
    color: #6b7280;
    line-height: 1.6;
  }

  .cover-body {
    flex: 1;
    padding: 48px 56px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 36px;
  }

  .cover-report-label {
    font-size: 8pt;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #6b7280;
    border-top: 2px solid #1a1a1a;
    padding-top: 10px;
    display: inline-block;
  }

  .cover-headline {
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 36pt;
    font-weight: 900;
    line-height: 1.1;
    letter-spacing: -0.02em;
    color: #1a1a1a;
    max-width: 540px;
  }

  .cover-url {
    font-size: 10pt;
    color: #4a4a4a;
    word-break: break-all;
    padding: 10px 14px;
    background: #f5f3ef;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
    display: inline-block;
  }

  .cover-grade-block {
    display: flex;
    align-items: stretch;
    gap: 0;
    border: 1.5px solid #1a1a1a;
    border-radius: 6px;
    overflow: hidden;
    max-width: 440px;
  }

  .cover-grade-main {
    background: ${gBg};
    border-right: 1.5px solid #1a1a1a;
    padding: 20px 28px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 110px;
  }

  .cover-grade-letter {
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 56pt;
    font-weight: 900;
    line-height: 1;
    color: ${gColor};
  }

  .cover-grade-label {
    font-size: 7pt;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #6b7280;
    font-weight: 600;
  }

  .cover-grade-detail {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    flex: 1;
  }

  .cover-score-num {
    font-size: 20pt;
    font-weight: 800;
    color: #1a1a1a;
    line-height: 1;
  }

  .cover-score-label { font-size: 8.5pt; color: #6b7280; }

  .cover-blocker {
    font-size: 9pt;
    color: #8b0000;
    line-height: 1.4;
    margin-top: 4px;
    font-weight: 500;
  }

  ${g ? `
  .cover-vis-block {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 14px 18px;
    border: 1.5px solid #e5e5e0;
    border-radius: 6px;
    max-width: 340px;
  }
  .cover-vis-pct {
    font-size: 28pt;
    font-weight: 900;
    line-height: 1;
    color: ${gaugeArc(visPct).color};
    font-family: 'Inter', sans-serif;
  }
  .cover-vis-label { font-size: 9pt; color: #4a4a4a; line-height: 1.4; }
  .cover-vis-missing { font-size: 8.5pt; color: #8b0000; margin-top: 3px; }
  ` : ''}

  .cover-footer {
    padding: 16px 56px;
    border-top: 1px solid #e5e5e0;
    display: flex;
    justify-content: space-between;
    font-size: 7.5pt;
    color: #9ca3af;
    letter-spacing: 0.04em;
  }

  /* ─── INNER PAGES ──────────────────────────────────────────────────────────── */
  .page {
    padding: 40px 56px 36px;
    page-break-after: always;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    border-top: 4px solid #1a1a1a;
  }
  .page:last-child { page-break-after: avoid; }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding-bottom: 12px;
    border-bottom: 1px solid #e5e5e0;
    margin-bottom: 28px;
  }

  .page-header-brand {
    font-size: 9pt;
    font-weight: 900;
    letter-spacing: -0.02em;
    color: #1a1a1a;
  }

  .page-header-info { font-size: 8pt; color: #9ca3af; }

  .page-footer {
    margin-top: auto;
    padding-top: 14px;
    border-top: 1px solid #e5e5e0;
    display: flex;
    justify-content: space-between;
    font-size: 7.5pt;
    color: #9ca3af;
  }

  /* ─── SECTION RULES ────────────────────────────────────────────────────────── */
  .section-rule {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 14px;
    padding-bottom: 8px;
    border-bottom: 2px solid #1a1a1a;
  }
  .section-num {
    font-size: 8pt;
    font-weight: 700;
    color: #9ca3af;
    letter-spacing: 0.1em;
  }
  .section-name {
    font-size: 12pt;
    font-weight: 800;
    color: #1a1a1a;
    letter-spacing: -0.02em;
  }

  .section-page { margin-bottom: 28px; }
</style>
</head>
<body>

<!-- ═══ COVER ═══════════════════════════════════════════════════════════════ -->
<div class="cover">
  <div class="cover-top">
    <div>
      <div class="cover-brand-name">legibly</div>
      <div class="cover-brand-desc">AI Visibility Audit</div>
    </div>
    <div class="cover-meta">
      Report Date: ${dateStr}<br>
      Audit Target: ${esc(domain)}<br>
      Report Type: Technical + Content + Competitive
    </div>
  </div>

  <div class="cover-body">
    <div>
      <span class="cover-report-label">AI Visibility Audit Report</span>
      <h1 class="cover-headline">What AI can see<br>on ${esc(domain)}</h1>
    </div>

    <div class="cover-url">${esc(url)}</div>

    <div class="cover-grade-block">
      <div class="cover-grade-main">
        <div class="cover-grade-letter">${esc(grade)}</div>
        <div class="cover-grade-label">Grade</div>
      </div>
      <div class="cover-grade-detail">
        <div class="cover-score-num">${score}<span style="font-size:11pt;font-weight:500;color:#6b7280;">/100</span></div>
        <div class="cover-score-label">AI Visibility Score</div>
        ${blocker ? `<div class="cover-blocker">${esc(blocker)}</div>` : '<div style="font-size:9pt;color:#1a6b2e;margin-top:4px;">No critical blockers detected</div>'}
      </div>
    </div>

    ${visPct !== null ? `
    <div class="cover-vis-block">
      <div class="cover-vis-pct">${visPct}%</div>
      <div>
        <div class="cover-vis-label">of page content is visible<br>to AI crawlers</div>
        ${missing > 0 ? `<div class="cover-vis-missing">${missing} words invisible to AI</div>` : '<div style="font-size:8.5pt;color:#1a6b2e;">All content readable by AI</div>'}
      </div>
    </div>` : ''}
  </div>

  <div class="cover-footer">
    <span>Confidential — prepared for ${esc(domain)}</span>
    <span>legibly.dev</span>
  </div>
</div>

<!-- ═══ SCORE CARD ══════════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <div class="page-header-brand">legibly</div>
    <div class="page-header-info">${esc(domain)} — ${dateStr}</div>
  </div>

  <div class="section-rule">
    <span class="section-num">01</span>
    <span class="section-name">Signal Diagnostic — ${esc(domain)}</span>
  </div>

  <p style="font-size:9.5pt;color:#4a4a4a;margin-bottom:20px;line-height:1.5;">
    Seven signals measured across technical crawlability, content structure, metadata, and authority. Each signal contributes to the overall AI Visibility Score. Failing signals suppress AI citation regardless of content quality.
  </p>

  <!-- Grade + Gauge summary row -->
  <div style="display:flex;gap:20px;margin-bottom:24px;">
    <div style="border:1.5px solid #1a1a1a;border-radius:6px;overflow:hidden;display:flex;min-width:180px;">
      <div style="background:${gBg};border-right:1.5px solid #1a1a1a;padding:16px 20px;display:flex;flex-direction:column;align-items:center;gap:2px;">
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:44pt;font-weight:900;line-height:1;color:${gColor};">${esc(grade)}</div>
        <div style="font-size:7pt;letter-spacing:0.1em;text-transform:uppercase;color:#6b7280;">Grade</div>
      </div>
      <div style="padding:12px 16px;display:flex;flex-direction:column;justify-content:center;gap:4px;">
        <div style="font-size:18pt;font-weight:800;color:#1a1a1a;line-height:1;">${score}<span style="font-size:10pt;font-weight:500;color:#6b7280;">/100</span></div>
        <div style="font-size:7.5pt;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;">AI Visibility Score</div>
      </div>
    </div>

    ${g ? `
    <div style="border:1.5px solid #e5e5e0;border-radius:6px;padding:14px 20px;display:flex;align-items:center;gap:14px;flex:1;">
      <svg viewBox="0 0 170 170" width="110" height="110">
        <circle cx="${g.cx}" cy="${g.cy}" r="${g.r}" fill="none" stroke="#e5e5e0" stroke-width="10"
          stroke-dasharray="${g.arc.toFixed(1)} ${g.circ.toFixed(1)}"
          transform="rotate(135 ${g.cx} ${g.cy})" stroke-linecap="round"/>
        <circle cx="${g.cx}" cy="${g.cy}" r="${g.r}" fill="none" stroke="${g.color}" stroke-width="10"
          stroke-dasharray="${g.fill.toFixed(1)} ${(g.circ - g.fill).toFixed(1)}"
          transform="rotate(135 ${g.cx} ${g.cy})" stroke-linecap="round"/>
        <text x="${g.cx}" y="${g.cy - 4}" text-anchor="middle"
          font-family="Inter,sans-serif" font-weight="800" font-size="22" fill="${g.color}">${visPct}%</text>
        <text x="${g.cx}" y="${g.cy + 13}" text-anchor="middle"
          font-family="Inter,sans-serif" font-size="8" fill="#9ca3af">visible to AI</text>
      </svg>
      <div>
        <div style="font-size:9pt;font-weight:700;color:#1a1a1a;margin-bottom:4px;">Content Visibility</div>
        <div style="font-size:8.5pt;color:#4a4a4a;line-height:1.5;">
          ${visPct >= 80 ? 'Most content readable by AI crawlers.' : visPct >= 50 ? 'Significant content hidden from AI.' : 'Most content invisible to AI crawlers.'}
        </div>
        ${missing > 0 ? `<div style="font-size:8.5pt;color:#8b0000;margin-top:6px;font-weight:600;">${missing} words hidden from AI</div>` : '<div style="font-size:8.5pt;color:#1a6b2e;margin-top:6px;">Full content visible to AI</div>'}
      </div>
    </div>` : ''}
  </div>

  <!-- Signals table -->
  <table style="width:100%;border-collapse:collapse;border:1.5px solid #e5e5e0;border-radius:6px;overflow:hidden;font-size:9pt;">
    <thead>
      <tr style="background:#1a1a1a;color:#fff;">
        <th style="padding:9px 12px;text-align:left;font-size:7.5pt;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Signal</th>
        <th style="padding:9px 12px;text-align:left;font-size:7.5pt;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Status</th>
        <th style="padding:9px 12px;text-align:left;font-size:7.5pt;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Score</th>
        <th style="padding:9px 12px;text-align:left;font-size:7.5pt;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Finding</th>
      </tr>
    </thead>
    <tbody>${signalsHTML}</tbody>
  </table>

  <div class="page-footer">
    <span>legibly.dev — AI Visibility Audit</span>
    <span>Page 1 of 5</span>
  </div>
</div>

<!-- ═══ PROMPTS ══════════════════════════════════════════════════════════════ -->
${promptsSection ? `
<div class="page">
  <div class="page-header">
    <div class="page-header-brand">legibly</div>
    <div class="page-header-info">${esc(domain)}</div>
  </div>
  ${promptsSection}
  <div class="page-footer">
    <span>legibly.dev — AI Visibility Audit</span>
    <span>Page 2 of 5</span>
  </div>
</div>` : ''}

<!-- ═══ SCHEMA + FIXES ════════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <div class="page-header-brand">legibly</div>
    <div class="page-header-info">${esc(domain)}</div>
  </div>
  ${schemaSection}
  ${fixesSection}
  <div class="page-footer">
    <span>legibly.dev — AI Visibility Audit</span>
    <span>Page 3 of 5</span>
  </div>
</div>

<!-- ═══ LLMS.TXT + ROADMAP ═══════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <div class="page-header-brand">legibly</div>
    <div class="page-header-info">${esc(domain)}</div>
  </div>

  ${llmsSection}

  <!-- 30/60/90 Roadmap -->
  <div>
    <div class="section-rule">
      <span class="section-num">06</span>
      <span class="section-name">30 / 60 / 90 Day Roadmap</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:4px;">
      <div style="border:1.5px solid #1a6b2e;border-radius:5px;padding:14px;">
        <div style="font-size:7pt;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#1a6b2e;margin-bottom:10px;">Days 1–7 — Quick Wins</div>
        ${['Upload llms.txt to site root','Fix robots.txt AI crawler blocks','Add Organization JSON-LD schema','Fix page title and meta description'].map(i =>
          `<div style="font-size:8.5pt;color:#1a1a1a;padding:4px 0;border-bottom:1px solid #e5e5e0;display:flex;gap:6px;align-items:flex-start;"><span style="color:#9ca3af;">→</span>${esc(i)}</div>`
        ).join('')}
      </div>
      <div style="border:1.5px solid #7a5c00;border-radius:5px;padding:14px;">
        <div style="font-size:7pt;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#7a5c00;margin-bottom:10px;">Days 8–30 — Structural</div>
        ${['Add Service/Product schema to key pages','Rewrite H1 with direct value statement','Add Open Graph tags (title, desc, image)','Fix image alt text site-wide'].map(i =>
          `<div style="font-size:8.5pt;color:#1a1a1a;padding:4px 0;border-bottom:1px solid #e5e5e0;display:flex;gap:6px;align-items:flex-start;"><span style="color:#9ca3af;">→</span>${esc(i)}</div>`
        ).join('')}
      </div>
      <div style="border:1.5px solid #4a3080;border-radius:5px;padding:14px;">
        <div style="font-size:7pt;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#4a3080;margin-bottom:10px;">Days 31–90 — Deep Work</div>
        ${['Enable server-side rendering','Rewrite homepage with answer-first content','Add FAQ page with FAQPage schema','Link social profiles via sameAs schema'].map(i =>
          `<div style="font-size:8.5pt;color:#1a1a1a;padding:4px 0;border-bottom:1px solid #e5e5e0;display:flex;gap:6px;align-items:flex-start;"><span style="color:#9ca3af;">→</span>${esc(i)}</div>`
        ).join('')}
      </div>
    </div>
  </div>

  <div class="page-footer">
    <span>legibly.dev — AI Visibility Audit</span>
    <span>Page 4 of 5</span>
  </div>
</div>

</body>
</html>`;
}
