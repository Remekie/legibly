const form = document.getElementById('scan-form');
const urlInput = document.getElementById('url-input');
const urlError = document.getElementById('url-error');
const scanBtn = document.getElementById('scan-btn');
const resultSection = document.getElementById('result');

const SIGNAL_LABELS = {
  prerender: 'AI crawler rendering',
  robots:    'Crawler access',
  schema:    'Structured data',
  llmstxt:   'llms.txt file',
  content:   'Answer-first content',
  eeat:      'Brand trust signals',
  metadata:  'Page metadata',
};

const SIGNAL_TOOLTIPS = {
  prerender: 'AI crawlers like GPTBot and ClaudeBot cannot run JavaScript. If your site depends on JS to show content, AI sees a blank page.',
  robots:    "A robots.txt file tells crawlers what they can and can't access. AI crawlers obey these rules — if they're blocked here, your site doesn't exist to them.",
  schema:    'Structured data is hidden code that tells AI exactly what your business is, what you offer, and where you\'re located — in a format AI can reliably read.',
  llmstxt:   'A simple text file at yoursite.com/llms.txt that tells AI models a plain-language summary of who you are and what you do.',
  content:   'AI citation engines favor pages that answer questions directly in the first few sentences — not pages that bury the answer after a long intro.',
  eeat:      'Experience, Expertise, Authoritativeness, Trustworthiness — the signals AI engines use to decide whether your business is credible enough to recommend.',
  metadata:  'Page title, meta description, social share tags, heading structure (H1/H2), canonical tag, and image alt text. These are the first signals AI engines use to understand what your page is about.',
};

const INTENT_LABELS = {
  awareness:   'Awareness',
  comparison:  'Comparison',
  decision:    'Decision',
  usecase:     'Use Case',
  postpurchase:'Post-Purchase',
};

let currentUrl = '';
let currentScanData = null;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const raw = urlInput.value.trim();
  if (!raw) { showError('Please enter a URL.'); urlInput.focus(); return; }

  setLoading(true);
  resultSection.hidden = true;
  currentUrl = raw.startsWith('http') ? raw : `https://${raw}`;

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: raw }),
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error ?? 'Scan failed. Please try again.'); return; }
    currentScanData = data;
    renderResult(data);
  } catch {
    showError('Network error. Check your connection and try again.');
  } finally {
    setLoading(false);
  }
});

function renderResult({ grade, score, blocker, signals, sitePages }) {
  const gradeClass = `grade-${grade.toLowerCase()}`;
  const vis = signals.prerender;
  const visibilityPct = vis?.visibilityPct ?? null;
  const missingWordCount = vis?.missingWordCount ?? 0;

  resultSection.innerHTML = `
    <div class="result-card ${gradeClass}">

      <div class="grade-display" aria-label="Grade ${grade}">${grade}</div>
      <div class="score-label">AI Visibility Score: ${score}/100</div>
      ${visibilityPct !== null ? renderVisibilityGauge(visibilityPct, missingWordCount) : ''}
      ${blocker ? `<p class="blocker" role="alert">⚠️ ${escapeHtml(blocker)}</p>` : ''}
      ${sitePages?.pagesChecked > 1 ? renderSitePagesSummary(sitePages) : ''}

      <ul class="signals" aria-label="Signal summary">
        ${Object.entries(signals).map(([key, s]) => renderSignalSummary(key, s)).join('')}
      </ul>

      <div class="cta-row">
        <button class="btn-primary" id="breakdown-btn" aria-expanded="false">
          See full breakdown →
        </button>
      </div>

      <div class="breakdown-panel" id="breakdown-panel" role="region" aria-label="Full signal breakdown" hidden>
        <h2 class="breakdown-title">What's blocking your AI visibility</h2>
        ${Object.entries(signals).map(([key, s]) => renderBreakdownRow(key, s)).join('')}
      </div>

      <div class="report-cta-row" id="report-cta-row">
        <button class="btn-report" id="get-report-btn">
          Get full report — prompts, fixes, llms.txt →
        </button>
      </div>

      <div class="full-report-panel" id="full-report-panel" hidden>
        <div class="report-loading" id="report-loading" hidden>
          <div class="spinner" aria-hidden="true"></div>
          <p>Generating your full report<span class="dots">...</span></p>
          <p class="loading-detail">Analyzing prompts you should be winning, generating schema snippets and llms.txt</p>
        </div>
        <div id="report-content"></div>
      </div>
    </div>
  `;

  resultSection.hidden = false;
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  document.getElementById('breakdown-btn').addEventListener('click', toggleBreakdown);
  document.getElementById('get-report-btn').addEventListener('click', fetchFullReport);
  resultSection.querySelectorAll('.info-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllTooltips();
      const tip = document.createElement('div');
      tip.className = 'tooltip';
      tip.setAttribute('role', 'tooltip');
      tip.textContent = btn.dataset.tip;
      btn.after(tip);
      btn.setAttribute('aria-expanded', 'true');
    });
  });
  document.addEventListener('click', closeAllTooltips, { once: false });
}

function renderSitePagesSummary({ pagesChecked, aggregate }) {
  if (!aggregate) return '';
  const { schema, title, description, h1, content, oversized } = aggregate;
  const items = [
    { label: 'Structured data', value: schema },
    { label: 'Page titles', value: title },
    { label: 'Meta descriptions', value: description },
    { label: 'Clear headings', value: h1 },
    { label: 'Sufficient content', value: content },
  ];

  const cells = items.map(({ label, value }) => {
    const [pass, total] = value.split('/').map(Number);
    const allPass = pass === total;
    const nonePass = pass === 0;
    const color = allPass ? 'var(--color-pass)' : nonePass ? 'var(--color-fail)' : 'var(--color-partial)';
    return `<div class="site-stat">
      <span class="site-stat-value" style="color:${color}">${escapeHtml(value)}</span>
      <span class="site-stat-label">${escapeHtml(label)}</span>
    </div>`;
  }).join('');

  return `
    <div class="site-pages-summary" aria-label="Site-wide page checks">
      <div class="site-pages-header">
        <span class="site-pages-title">Site-wide check — ${pagesChecked} pages</span>
        ${oversized > 0 ? `<span class="site-pages-warning">⚠ ${oversized} page${oversized > 1 ? 's' : ''} with oversized HTML</span>` : ''}
      </div>
      <div class="site-stats-row">${cells}</div>
    </div>`;
}

function renderVisibilityGauge(pct, missingWords) {
  const radius = 52;
  const circ = 2 * Math.PI * radius;
  const arcFrac = (pct / 100) * 0.75;
  const dashOffset = circ * (1 - arcFrac);
  const color = pct >= 80 ? 'var(--color-pass)' : pct >= 50 ? 'var(--color-partial)' : 'var(--color-fail)';
  const label = pct >= 80 ? 'Page content readable by crawlers' : pct >= 50 ? 'Some content hidden from AI crawlers' : 'Most content hidden from AI crawlers';

  return `
    <div class="visibility-gauge" aria-label="Content visibility ${pct}%">
      <div style="position:relative;width:120px;height:120px;flex-shrink:0;">
        <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true" style="display:block;">
          <circle class="gauge-track" cx="60" cy="60" r="${radius}"
            stroke-dasharray="${(circ*0.75).toFixed(1)} ${circ.toFixed(1)}"
            transform="rotate(135 60 60)"/>
          <circle class="gauge-fill" cx="60" cy="60" r="${radius}"
            stroke="${color}"
            stroke-dasharray="${(circ*0.75).toFixed(1)} ${circ.toFixed(1)}"
            stroke-dashoffset="${dashOffset.toFixed(1)}"
            transform="rotate(135 60 60)"/>
        </svg>
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">
          <span class="gauge-pct" style="color:${color}">${pct}%</span>
          <span class="gauge-sub" style="display:block;">words crawlable</span>
        </div>
      </div>
      <div class="gauge-meta">
        <span class="gauge-label">${escapeHtml(label)}</span>
        ${missingWords > 0 ? `<span class="gauge-missing">${missingWords} words hidden from AI</span>` : ''}
      </div>
    </div>
  `;
}

async function fetchFullReport() {
  const btn = document.getElementById('get-report-btn');
  const panel = document.getElementById('full-report-panel');
  const loading = document.getElementById('report-loading');
  const content = document.getElementById('report-content');

  btn.disabled = true;
  btn.textContent = 'Generating report…';
  panel.hidden = false;
  loading.hidden = false;
  content.innerHTML = '';

  // Animate dots
  let dotCount = 0;
  const dotInterval = setInterval(() => {
    const dots = document.querySelector('.dots');
    if (dots) dots.textContent = '.'.repeat((++dotCount % 3) + 1);
  }, 500);

  try {
    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: currentUrl }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error ?? 'Report failed');

    loading.hidden = true;
    btn.textContent = 'Report generated ✓';
    content.innerHTML = renderFullReport(data);

    // Add PDF download button
    const pdfRow = document.createElement('div');
    pdfRow.className = 'report-cta-row';
    pdfRow.innerHTML = `<button class="btn-pdf" id="pdf-btn">⬇ Download PDF Report</button>`;
    content.prepend(pdfRow);
    document.getElementById('pdf-btn').addEventListener('click', () => downloadPDF());

    content.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Wire copy buttons
    content.querySelectorAll('.copy-btn').forEach(b => {
      b.addEventListener('click', () => {
        const target = document.getElementById(b.dataset.target);
        if (!target) return;
        navigator.clipboard.writeText(target.textContent).then(() => {
          b.textContent = 'Copied ✓';
          setTimeout(() => b.textContent = 'Copy', 2000);
        });
      });
    });

    // Wire download buttons
    content.querySelectorAll('.download-btn').forEach(b => {
      b.addEventListener('click', () => {
        const target = document.getElementById(b.dataset.target);
        if (!target) return;
        const blob = new Blob([target.textContent], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = b.dataset.filename ?? 'download.txt';
        a.click();
      });
    });

  } catch (err) {
    loading.hidden = true;
    content.innerHTML = `<p class="report-error">Report generation failed: ${escapeHtml(err.message)}</p>`;
    btn.disabled = false;
    btn.textContent = 'Retry full report →';
  } finally {
    clearInterval(dotInterval);
  }
}

function renderFullReport(data) {
  const { report, signals } = data;
  if (!report) return '<p class="report-error">No report data returned.</p>';

  const sections = [];

  // Prompts section
  if (report.prompts) {
    const allPrompts = Object.entries(report.prompts)
      .filter(([, v]) => v?.length > 0);

    if (allPrompts.length > 0) {
      sections.push(`
        <div class="report-section">
          <h3 class="report-section-title">🎯 Prompts This Page Should Be Winning</h3>
          <p class="report-section-sub">These are real queries people type into ChatGPT and Perplexity where your site should appear — but likely doesn't.</p>
          ${allPrompts.map(([intent, prompts]) => `
            <div class="prompt-group">
              <span class="prompt-intent-label">${escapeHtml(INTENT_LABELS[intent] ?? intent)}</span>
              <ul class="prompt-list">
                ${prompts.map(p => `<li>"${escapeHtml(p)}"</li>`).join('')}
              </ul>
            </div>
          `).join('')}
        </div>
      `);
    }
  }

  // Schema recommendations
  if (report.schemaRecs?.recommendations?.length > 0) {
    sections.push(`
      <div class="report-section">
        <h3 class="report-section-title">🏗️ Structured Data — Add This to Your Site</h3>
        <p class="report-section-sub">Copy and paste each snippet inside a <code>&lt;script type="application/ld+json"&gt;</code> tag in your page <code>&lt;head&gt;</code>.</p>
        ${report.schemaRecs.recommendations.map((rec, i) => `
          <div class="schema-rec">
            <div class="schema-rec-header">
              <span class="schema-type-badge">${escapeHtml(rec.type)}</span>
              <span class="schema-reason">${escapeHtml(rec.reason)}</span>
            </div>
            <div class="code-block-wrap">
              <pre class="code-block" id="schema-${i}">${escapeHtml(rec.snippet)}</pre>
              <button class="copy-btn" data-target="schema-${i}">Copy</button>
            </div>
          </div>
        `).join('')}
      </div>
    `);
  }

  // llms.txt
  if (report.llmstxt?.content) {
    sections.push(`
      <div class="report-section">
        <h3 class="report-section-title">📄 Your llms.txt File</h3>
        <p class="report-section-sub">Upload this file to <strong>${escapeHtml(new URL(currentUrl).origin)}/llms.txt</strong> so AI engines have a plain-language guide to your site.</p>
        <div class="code-block-wrap">
          <pre class="code-block" id="llmstxt-content">${escapeHtml(report.llmstxt.content)}</pre>
          <div class="code-actions">
            <button class="copy-btn" data-target="llmstxt-content">Copy</button>
            <button class="download-btn" data-target="llmstxt-content" data-filename="llms.txt">Download llms.txt</button>
          </div>
        </div>
      </div>
    `);
  }

  // Citation monitoring
  if (report.citations) {
    const c = report.citations;
    const rateColor = c.visibilityRate >= 50 ? 'var(--color-pass)' : c.visibilityRate > 0 ? 'var(--color-partial)' : 'var(--color-fail)';
    const rateLabel = c.visibilityRate >= 50 ? 'appearing in AI results'
      : c.visibilityRate > 0 ? 'appearing in some AI results'
      : 'not appearing in any tested AI results';

    sections.push(`
      <div class="report-section">
        <h3 class="report-section-title">Are You Winning These Prompts?</h3>
        <p class="report-section-sub">We ran your top prompts through Perplexity AI and checked if <strong>${escapeHtml(c.domain)}</strong> appears in the answers. These are real queries your customers are typing.</p>
        <div class="citation-score-row">
          <span class="citation-rate" style="color:${rateColor}">${c.promptsAppearing}/${c.promptsTested}</span>
          <span class="citation-label">prompts where your site appears — ${escapeHtml(rateLabel)}</span>
        </div>
        <div class="citation-results">
          ${c.results.map(r => `
            <div class="citation-row ${r.appearing ? 'citation-row--win' : 'citation-row--miss'}">
              <span class="citation-icon">${r.appearing ? '✓' : '✗'}</span>
              <div class="citation-detail">
                <div class="citation-prompt">"${escapeHtml(r.prompt)}"</div>
                <div class="citation-verdict ${r.appearing ? 'verdict--win' : 'verdict--miss'}">
                  ${r.appearing ? 'Your site appears in this AI answer' : 'Your site does not appear — competitors are winning this prompt'}
                </div>
              </div>
            </div>`).join('')}
        </div>
      </div>
    `);
  }

  // Fix instructions
  const fixes = report.fixes ?? {};
  const fixKeys = Object.keys(fixes);
  if (fixKeys.length > 0) {
    sections.push(`
      <div class="report-section">
        <h3 class="report-section-title">🔧 How to Fix What's Failing</h3>
        ${fixKeys.map(key => renderFixSection(fixes[key])).join('')}
      </div>
    `);
  }

  if (sections.length === 0) return '<p class="report-error">No report sections to display.</p>';

  return sections.join('');
}

function renderFixSection(fix) {
  if (!fix) return '';
  if (fix.items) {
    return `
      <div class="fix-block">
        <h4 class="fix-title">${escapeHtml(fix.title)}</h4>
        ${fix.items.map(item => `
          <div class="fix-item">
            <strong>${escapeHtml(item.label)}</strong>
            <pre class="fix-instruction">${escapeHtml(item.instruction)}</pre>
          </div>
        `).join('')}
      </div>
    `;
  }
  return `
    <div class="fix-block">
      <h4 class="fix-title">${escapeHtml(fix.title)}</h4>
      ${(fix.options ?? []).map(opt => `
        <div class="fix-option">
          <strong>${escapeHtml(opt.label)}</strong>
          <pre class="fix-instruction">${opt.steps.map(s => escapeHtml(s)).join('\n')}</pre>
          ${opt.note ? `<p class="fix-note">${escapeHtml(opt.note)}</p>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function toggleBreakdown() {
  const btn = document.getElementById('breakdown-btn');
  const panel = document.getElementById('breakdown-panel');
  const isOpen = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!isOpen));
  btn.textContent = isOpen ? 'See full breakdown →' : 'Hide breakdown ↑';
  panel.hidden = isOpen;
  if (!isOpen) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function infoBtn(key) {
  const tip = SIGNAL_TOOLTIPS[key];
  if (!tip) return '';
  return `<button class="info-btn" aria-label="What is ${escapeHtml(SIGNAL_LABELS[key] ?? key)}?" data-tip="${escapeHtml(tip)}">?</button>`;
}

function renderSignalSummary(key, signal) {
  const label = SIGNAL_LABELS[key] ?? key;
  if (signal.stub) {
    return `<li class="signal signal--stub">
      <span class="signal-icon" aria-hidden="true">·</span>
      <span class="signal-label">${escapeHtml(label)}${infoBtn(key)}</span>
      <span class="signal-detail">In full report</span>
    </li>`;
  }
  const status = signal.score === 0 ? 'fail' : signal.score >= 8 ? 'pass' : 'partial';
  const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '~';
  return `<li class="signal signal--${status}">
    <span class="signal-icon" aria-hidden="true">${icon}</span>
    <span class="signal-label">${escapeHtml(label)}${infoBtn(key)}</span>
  </li>`;
}

function renderBreakdownRow(key, signal) {
  const label = SIGNAL_LABELS[key] ?? key;
  if (signal.stub) {
    return `<div class="breakdown-row breakdown-row--stub">
      <div class="breakdown-row-header">
        <span class="breakdown-icon" aria-hidden="true">·</span>
        <span class="breakdown-label">${escapeHtml(label)}${infoBtn(key)}</span>
        <span class="breakdown-badge badge--stub">Full report</span>
      </div>
      <p class="breakdown-detail">Deeper analysis available in the complete report.</p>
    </div>`;
  }
  const status = signal.score === 0 ? 'fail' : signal.score >= 8 ? 'pass' : 'partial';
  const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '~';
  const badgeLabel = status === 'pass' ? 'Passing' : status === 'fail' ? 'Failing' : 'Partial';
  return `<div class="breakdown-row breakdown-row--${status}">
    <div class="breakdown-row-header">
      <span class="breakdown-icon" aria-hidden="true">${icon}</span>
      <span class="breakdown-label">${escapeHtml(label)}${infoBtn(key)}</span>
      <span class="breakdown-badge badge--${status}">${badgeLabel}</span>
    </div>
    <p class="breakdown-detail">${escapeHtml(signal.detail ?? '')}</p>
  </div>`;
}

async function downloadPDF() {
  const btn = document.getElementById('pdf-btn');
  btn.disabled = true;
  btn.textContent = 'Generating PDF…';
  try {
    const res = await fetch('/api/report/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: currentUrl }),
    });
    if (!res.ok) throw new Error('PDF generation failed');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `legibly-report-${new URL(currentUrl).hostname.replace('www.', '')}.pdf`;
    a.click();
    btn.textContent = '⬇ Download PDF Report';
  } catch {
    btn.textContent = 'PDF failed — try again';
  } finally {
    btn.disabled = false;
  }
}

function closeAllTooltips() {
  document.querySelectorAll('.tooltip').forEach(t => t.remove());
  document.querySelectorAll('.info-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

function setLoading(loading) {
  scanBtn.disabled = loading;
  scanBtn.textContent = loading ? 'Scanning…' : 'Scan free';
  scanBtn.setAttribute('aria-busy', String(loading));
}

function showError(msg) { urlError.textContent = msg; urlError.hidden = false; }
function clearError() { urlError.textContent = ''; urlError.hidden = true; }

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
