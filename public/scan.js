// Scan counter — fetch real count from DB, show "since [month]" if under 500
(async () => {
  const el = document.getElementById('scan-counter');
  if (!el) return;
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const { scans } = await res.json();
    el.textContent = scans >= 500
      ? `${scans.toLocaleString()} sites scanned`
      : 'Scanning sites since June 2026';
  } catch { /* non-critical */ }
})();

const form = document.getElementById('scan-form');
const urlInput = document.getElementById('url-input');
const urlError = document.getElementById('url-error');
const scanBtn = document.getElementById('scan-btn');
const resultSection = document.getElementById('result');
const scanLayout = document.querySelector('.scan-layout');

function hasGitHub() {
  return !!localStorage.getItem('legibly_github');
}

// On page load: check if returning from Stripe payment
(async () => {
  const params = new URLSearchParams(window.location.search);

  // TESTING: ?test_paid=1 bypasses Stripe and forces paid state
  if (params.get('test_paid') === '1') {
    const tier = params.get('tier') ?? 'report';
    localStorage.setItem('legibly_paid', JSON.stringify({ tier, ts: Date.now() }));
    const testUrl = params.get('url') ?? '';
    if (testUrl && urlInput) urlInput.value = testUrl;
    window.history.replaceState({}, '', '/');
  }

  // Show test banner if paid state is active
  if (localStorage.getItem('legibly_paid')) {
    const banner = document.getElementById('test-banner');
    if (banner) banner.hidden = false;
  }

  if (params.get('payment_success') === '1') {
    const sessionId = params.get('session_id');
    const scanUrl   = params.get('scan_url') ?? '';
    if (sessionId) {
      try {
        const res  = await fetch(`/api/verify-payment?session_id=${encodeURIComponent(sessionId)}`);
        const data = await res.json();
        if (data.paid) {
          localStorage.setItem('legibly_paid', sessionId);
          // Pre-fill URL and auto-scan if we have the original URL
          if (scanUrl && urlInput) {
            urlInput.value = decodeURIComponent(scanUrl).replace('https://','').replace('http://','');
          }
        }
      } catch { /* ignore — user can retry */ }
    }
    // Check GitHub connect return
  if (params.get('github_connected') === '1') {
    localStorage.setItem('legibly_github', '1');
  }
  // Clean URL without reloading
  window.history.replaceState({}, '', '/');
  }
})();

const SIGNAL_LABELS = {
  prerender: 'AI can read your site',
  robots:    'Search rules are set',
  schema:    'AI knows what you sell',
  llmstxt:   'AI summary is in place',
  content:   'Content answers questions',
  eeat:      'Business credibility signals',
  metadata:  'Pages are described clearly',
};

// Failing-state labels (shown when a signal fails)
const SIGNAL_LABELS_FAIL = {
  prerender: "AI can't read your site",
  robots:    'Search rules are missing',
  schema:    "AI doesn't know what you sell",
  llmstxt:   'AI summary is missing',
  content:   "Content doesn't answer questions",
  eeat:      'Business credibility is missing',
  metadata:  "Pages aren't described clearly",
};

const SIGNAL_TOOLTIPS = {
  prerender: 'AI crawlers like GPTBot and ClaudeBot can\'t run JavaScript. If your site is built with React or another JS framework, AI sees a blank page — not your products, prices, or content.',
  robots:    'robots.txt tells crawlers what they can access. AI crawlers obey these rules — if they\'re blocked here, your site doesn\'t exist to ChatGPT, Perplexity, or Claude.',
  schema:    'JSON-LD structured data is hidden code that tells AI exactly what your business is, what you sell, and where you\'re located — in a format AI can reliably read and cite.',
  llmstxt:   '/llms.txt isn\'t there — without it, AI assistants have to read every page on your site to figure out what it\'s about. A plain-text summary makes it easy.',
  content:   'AI citation engines favor pages that answer questions in the first sentence — not pages that bury the answer after a long intro. Direct answers get cited.',
  eeat:      'ChatGPT and Perplexity check for proof your business is real: an About page, visible team members, a real contact method, and author credentials.',
  metadata:  'Page title, meta description, H1/H2 headings, and image alt text — the first things AI engines read to understand what your page is about.',
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
  scanLayout?.classList.remove('has-results');
  currentUrl = raw.startsWith('http') ? raw : `https://${raw}`;

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: raw }),
    });
    if (!res.ok) { showError((await res.json().catch(() => ({}))).error ?? 'Scan failed. Please try again.'); return; }
    const data = await res.json();
    currentScanData = data;
    renderResult(data);
  } catch {
    showError('Network error. Check your connection and try again.');
  } finally {
    setLoading(false);
  }
});

function buildLlmstxtPreview(url, scanData) {
  const domain    = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })();
  const pageTitle = scanData?.signals?.metadata?.pageTitle ?? scanData?.pageTitle ?? domain;
  const lines = [
    `# ${domain}`,
    `> ${pageTitle}`,
    ``,
    `## About`,
    `${pageTitle} — [unlock to see AI-readable description]`,
    ``,
    `## Pages`,
    `- /: ${pageTitle}`,
    `- /about, /contact, /services…`,
    ``,
    `## Contact`,
    `- Site: https://${domain}`,
  ];
  // Show first 3 lines clearly, blur the rest
  const visible = lines.slice(0, 3).map(l => escapeHtml(l)).join('\n');
  const blurred = lines.slice(3).map(l => escapeHtml(l)).join('\n');
  return { visible, blurred, domain };
}

function buildPromptTeasers(scanData) {
  const hostname = (() => { try { return new URL(currentUrl).hostname.replace(/^www\./, ''); } catch { return currentUrl; } })();
  const title = scanData?.pageTitle ?? scanData?.signals?.metadata?.pageTitle ?? null;
  // Use page title to personalize, fall back to hostname
  const topic = title && title.length < 60 ? title : hostname;
  return [
    `"What are the best ${escapeHtml(hostname)} alternatives?"`,
    `"Who provides services like ${escapeHtml(hostname)}?"`,
    `"Is ${escapeHtml(hostname)} the best option for [your service]?"`,
  ];
}

function renderLockedAnalysis(visibilityPct, hasSitePages, scanData) {
  const prompts = buildPromptTeasers(scanData);
  const hostname = (() => { try { return new URL(currentUrl).hostname.replace(/^www\./, ''); } catch { return ''; } })();

  return `
    <div class="locked-section" aria-label="Upgrade to unlock">

      <div class="locked-section-title">Who's winning when AI answers these questions?</div>

      <div class="prompt-teaser-list" id="prompt-teaser-list">
        ${prompts.map(p => `<div class="prompt-teaser-row"><span class="prompt-teaser-q">${p}</span><span class="prompt-teaser-lock">locked</span></div>`).join('')}
        <div class="prompt-teaser-more">+ 9 more prompts in the full report</div>
      </div>

      <div class="competitor-teaser" id="competitor-teaser">
        <div class="competitor-teaser-label">Sites appearing instead of <strong>${escapeHtml(hostname)}</strong>:</div>
        <div class="competitor-teaser-loading" id="competitor-teaser-loading">
          <span class="teaser-spinner"></span> Finding who's ranking instead of you…
        </div>
        <div class="competitor-teaser-names" id="competitor-teaser-names" hidden></div>
      </div>

      <div class="llmstxt-preview-section">
        <div class="llmstxt-preview-label">Your llms.txt — what AI models need to understand your business:</div>
        <div class="llmstxt-preview-code" id="llmstxt-preview-code"></div>
        <p style="font-size:.8125rem;color:var(--color-muted);margin-top:.5rem">Included in the full report →</p>
      </div>

      <div class="locked-primary-cta">
        <button class="btn-primary locked-unlock-btn" style="width:100%;font-size:.9375rem;padding:.875rem 1.5rem">
          Get full report — $79 →
        </button>
        <p class="locked-primary-cta-desc">12 prompts you should be winning · all copy-paste fixes · your llms.txt file · competitor citations</p>
        <p style="text-align:center;margin-top:.625rem">
          <button class="locked-snapshot-btn" style="background:none;border:none;font-size:.875rem;color:var(--color-muted);text-decoration:underline;cursor:pointer;padding:0">
            Just want to see who's beating you? $29 →
          </button>
        </p>
      </div>

    </div>
  `;
}

function renderLlmstxtPreview(scanData) {
  const codeEl = document.getElementById('llmstxt-preview-code');
  if (!codeEl) return;
  const { visible, blurred } = buildLlmstxtPreview(currentUrl, scanData);
  codeEl.innerHTML = `<span class="llmstxt-visible">${visible}</span><span class="llmstxt-blurred">${blurred}</span>`;
}

async function loadCompetitorTeaser() {
  const heroEl = document.getElementById('competitor-hero');
  // Also update the locked section teaser if it exists
  const teaserLoadingEl = document.getElementById('competitor-teaser-loading');
  const teaserNamesEl   = document.getElementById('competitor-teaser-names');

  try {
    const res = await fetch(`/api/competitors-preview?url=${encodeURIComponent(currentUrl)}`);
    if (!res.ok) throw new Error();
    const { competitors } = await res.json();

    // Update hero (above signal list)
    if (heroEl) {
      if (competitors?.length) {
        const hostname = (() => { try { return new URL(currentUrl).hostname.replace(/^www\./,''); } catch { return ''; } })();
        heroEl.innerHTML = `
          <span class="competitor-hero-label">Appearing instead of <strong>${escapeHtml(hostname)}</strong>:</span>
          ${competitors.map(d => `<span class="competitor-hero-domain">${escapeHtml(d)}</span>`).join('')}
        `;
      } else {
        heroEl.innerHTML = '';
      }
    }

    // Update locked section teaser (below signal list)
    if (teaserLoadingEl) teaserLoadingEl.hidden = true;
    if (teaserNamesEl) {
      if (competitors?.length) {
        teaserNamesEl.innerHTML = competitors.map(d =>
          `<span class="competitor-teaser-domain">${escapeHtml(d)}</span>`
        ).join('');
        teaserNamesEl.removeAttribute('hidden');
      } else {
        teaserNamesEl.removeAttribute('hidden');
      }
    }
  } catch {
    if (heroEl) heroEl.innerHTML = '';
    if (teaserLoadingEl) teaserLoadingEl.hidden = true;
  }
}

function renderResult(data) {
  const { grade, score, blocker, signals, sitePages } = data;
  const safeGrade = escapeHtml(String(grade ?? '?'));
  const safeScore = escapeHtml(String(score ?? 0));
  const gradeClass = `grade-${safeGrade.toLowerCase().replace(/[^a-f]/g, 'f')}`;
  const vis = signals.prerender;
  const visibilityPct = vis?.visibilityPct ?? null;
  const missingWordCount = vis?.missingWordCount ?? 0;
  // invisiblePct is the % of content AI CANNOT read (0 = fully readable, 100 = fully invisible)
  const invisiblePct = visibilityPct !== null ? Math.max(0, 100 - visibilityPct) : null;
  const showInvisibilityHero = invisiblePct !== null && invisiblePct >= 60;

  const paid = hasPaid();
  const hasSitePages = sitePages?.pagesChecked > 1;
  const hostname = (() => { try { return new URL(currentUrl).hostname; } catch { return currentUrl; } })();
  const failCount = Object.values(signals ?? {}).filter(s => (s?.score ?? 0) < 5).length;

  const shareTweet = encodeURIComponent(`My site ${hostname} scored ${grade} on AI visibility. Find out if yours is invisible to ChatGPT and Perplexity → https://blindgeo.com`);
  const shareLinkedIn = encodeURIComponent(`My site scored grade ${grade} on AI visibility — meaning AI search engines may not be recommending it. BlindGEO scans for the exact issues. Free scan: https://blindgeo.com`);

  resultSection.innerHTML = `
    <div class="result-card ${gradeClass}">

      <div class="competitor-hero" id="competitor-hero" aria-live="polite">
        <span class="competitor-hero-loading">
          <span class="teaser-spinner" aria-hidden="true"></span>
          Checking who AI recommends instead of ${escapeHtml(hostname ? hostname : 'you')}…
        </span>
      </div>

      ${showInvisibilityHero
        ? `<div class="visibility-headline visibility-headline--lead" aria-live="polite">
             <span class="visibility-pct-big">${invisiblePct}%</span>
             <span class="visibility-pct-label">of your content is invisible to AI</span>
             ${vis?.botWordCount != null && vis?.humanWordCount != null && vis.humanWordCount > vis.botWordCount
               ? `<span class="visibility-hidden-count">${escapeHtml(String(vis.humanWordCount - vis.botWordCount))} words ChatGPT can't read</span>`
               : ''}
           </div>`
        : failCount > 0
          ? `<div class="visibility-headline" style="margin:.5rem 0 .75rem">
               <strong>${failCount} signal${failCount > 1 ? 's' : ''} failing</strong>
               <span style="font-weight:400;color:var(--color-muted)"> — AI can't confidently identify or recommend your business</span>
             </div>`
          : ''}

      <div class="grade-display-row">
        <div class="grade-display" aria-label="Grade ${safeGrade}">${safeGrade}</div>
        <div class="grade-meta">
          <div class="score-label">AI Visibility Score: ${safeScore}/100</div>
          ${blocker ? `<p class="blocker" role="alert">⚠️ ${escapeHtml(blocker)}</p>` : ''}
        </div>
      </div>

      <ul class="signals" aria-label="Signal summary">
        ${Object.entries(signals).map(([key, s]) => renderSignalSummary(key, s)).join('')}
      </ul>

      <div class="cta-row">
        <a href="#breakdown-panel-anchor" id="breakdown-btn" role="button" aria-expanded="false"
           style="font-size:.875rem;color:var(--color-muted);text-decoration:underline;cursor:pointer">
          See full breakdown ↓
        </a>
      </div>

      <div class="breakdown-panel" id="breakdown-panel" role="region" aria-label="Full signal breakdown" hidden>
        <h2 class="breakdown-title">What's blocking your AI visibility</h2>
        ${Object.entries(signals).map(([key, s]) => renderBreakdownRow(key, s)).join('')}
      </div>

      ${paid
        ? (visibilityPct !== null ? renderVisibilityGauge(visibilityPct, missingWordCount) : '')
          + (hasSitePages ? renderSitePagesSummary(sitePages) : '')
        : renderLockedAnalysis(visibilityPct, hasSitePages, data)
      }

      ${paid ? `
      <div class="report-cta-row" id="report-cta-row">
        <button class="btn-report" id="get-report-btn">
          Get full report — prompts, fixes, llms.txt →
        </button>
      </div>` : ''}

      <div class="grade-share-row">
        <span class="grade-share-label">Share your grade:</span>
        <a href="https://twitter.com/intent/tweet?text=${shareTweet}" target="_blank" rel="noopener" class="btn-share btn-share--twitter">
          Post on X
        </a>
        <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent('https://blindgeo.com')}&summary=${shareLinkedIn}" target="_blank" rel="noopener" class="btn-share btn-share--linkedin">
          Share on LinkedIn
        </a>
      </div>

      <div class="full-report-panel" id="full-report-panel" hidden>
        <div class="report-loading" id="report-loading" hidden></div>
        <div id="report-content"></div>
      </div>
    </div>
  `;

  resultSection.hidden = false;
  scanLayout?.classList.add('has-results');
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Update OG/Twitter meta for the grade share URL
  const shareTitle = `${escapeHtml(hostname)} scored grade ${safeGrade} on AI visibility — BlindGEO`;
  const shareDesc  = `${safeGrade === 'F' || safeGrade === 'D' ? 'Most content is invisible to ChatGPT and Perplexity.' : 'AI search engines can partially read this site.'} Scan yours free at blindgeo.com`;
  document.getElementById('og-title')?.setAttribute('content', shareTitle);
  document.getElementById('og-description')?.setAttribute('content', shareDesc);
  document.getElementById('tw-title')?.setAttribute('content', shareTitle);
  document.getElementById('tw-desc')?.setAttribute('content', shareDesc);

  document.getElementById('breakdown-btn').addEventListener('click', (e) => { e.preventDefault(); toggleBreakdown(); });

  document.querySelector('.locked-unlock-btn')?.addEventListener('click', () => redirectToCheckout('report'));
  document.querySelector('.locked-snapshot-btn')?.addEventListener('click', () => redirectToCheckout('snapshot'));

  if (paid) {
    document.getElementById('get-report-btn')?.addEventListener('click', fetchFullReport);
  }

  // Load competitor names async after result renders
  if (!paid) {
    loadCompetitorTeaser();
    renderLlmstxtPreview(data);
  }

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
  document.removeEventListener('click', closeAllTooltips);
  document.addEventListener('click', closeAllTooltips);
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
  const btn     = document.getElementById('get-report-btn');
  const panel   = document.getElementById('full-report-panel');
  const loading = document.getElementById('report-loading');
  const content = document.getElementById('report-content');
  if (!panel) return;

  if (btn) { btn.disabled = true; btn.textContent = 'Generating report…'; }
  panel.hidden = false;
  content.innerHTML = '';

  // Build prompt preview from current scan data
  const scanPrompts = currentScanData?.report?.prompts
    ? Object.values(currentScanData.report.prompts).flat().slice(0, 3).map(p => typeof p === 'string' ? p : p.prompt)
    : [];
  const promptPreview = scanPrompts.length
    ? scanPrompts.map(p => `<div class="loading-prompt">"${escapeHtml(p)}"</div>`).join('')
    : ['Checking if AI cites your site…', 'Scanning for competitors in AI results…', 'Analyzing your content structure…']
        .map(p => `<div class="loading-prompt">${escapeHtml(p)}</div>`).join('');

  const STEPS = [
    'Running 12 prompts through Perplexity',
    'Checking who appears instead of you',
    'Generating schema markup for your site',
    'Writing your llms.txt file',
    'Building copy-paste fix instructions',
  ];

  loading.innerHTML = `
    <div class="report-loading-rich">
      <div class="loading-left">
        <div class="loading-title">Generating your AI visibility report…</div>
        <ul class="loading-steps" id="loading-steps">
          ${STEPS.map((s, i) => `<li class="loading-step" data-step="${i}">
            <span class="step-icon" aria-hidden="true">☐</span>
            <span>${escapeHtml(s)}</span>
          </li>`).join('')}
        </ul>
        <p class="loading-eta">This takes 30–60 seconds.</p>
      </div>
      <div class="loading-right">
        <div class="loading-prompts-title">Prompts we're checking:</div>
        ${promptPreview}
        <div class="loading-provider-row">
          <span class="loading-provider-label">Via:</span>
          <span class="loading-provider-badge">Perplexity</span>
        </div>
      </div>
    </div>
  `;
  loading.removeAttribute('hidden');

  // Tick steps progressively (fake progress aligned to ~40s real time)
  let step = 0;
  const stepInterval = setInterval(() => {
    const stepEl = document.querySelector(`[data-step="${step}"] .step-icon`);
    if (stepEl) stepEl.textContent = '✓';
    document.querySelector(`[data-step="${step}"]`)?.classList.add('done');
    step++;
    if (step >= STEPS.length) clearInterval(stepInterval);
  }, 7500);

  try {
    // Include Stripe session_id for server-side payment verification
    const paidRaw   = localStorage.getItem('legibly_paid');
    const sessionId = (() => { try { const v = JSON.parse(paidRaw); return typeof v === 'string' ? v : null; } catch { return null; } })();

    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: currentUrl, ...(sessionId ? { session_id: sessionId } : {}) }),
    });
    clearInterval(stepInterval);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? 'Report generation failed');
    }
    const data = await res.json();
    if (data.reportId) {
      // Persist via DB — navigate with ID so the URL is shareable and survives tab close
      window.location.href = `/report.html?id=${encodeURIComponent(data.reportId)}`;
    } else {
      // Fallback: store in sessionStorage (no DB — e.g. missing API keys)
      sessionStorage.setItem('legibly_report', JSON.stringify(data));
      window.location.href = '/report.html';
    }
  } catch (err) {
    clearInterval(stepInterval);
    loading.hidden = true;
    content.innerHTML = `
      <div class="report-error-card">
        <p class="report-error">Report generation failed: ${escapeHtml(err.message)}</p>
        <p style="font-size:.875rem;color:var(--color-muted);margin-top:.5rem">Your scan result is still saved. You can retry below.</p>
        <button class="btn-primary" id="retry-report-btn" style="margin-top:1rem">Retry →</button>
      </div>`;
    document.getElementById('retry-report-btn')?.addEventListener('click', fetchFullReport);
    if (btn) { btn.disabled = false; btn.textContent = 'Retry full report →'; }
  }
}

// renderFullReport and helpers (renderDeploySection, renderFixSection) moved to report.html
// downloadPDF also moved to report.html

/* REMOVED — keeping marker so git diff is clear
function renderFullReport(data) {
  const { report, signals } = data;
  if (!report) return '<p class="report-error">No report data returned.</p>';

  const sections = [];

  // Agent view — what AI actually reads on the page
  if (report.agentView) {
    const av = report.agentView;
    const missingTags = av.missingWords?.length
      ? av.missingWords.slice(0, 20).map(w => `<span class="missing-word">${escapeHtml(w)}</span>`).join('')
      : '';
    sections.push(`
      <div class="report-section">
        <h3 class="report-section-title">What AI Actually Reads on Your Site</h3>
        <p class="report-section-sub">This is the exact content AI crawlers ingest when they visit your page — not what visitors see, but what AI reads. Every word AI can't see is a missed citation opportunity.</p>
        <div class="agent-view-stats">
          <span class="agent-stat"><strong>${escapeHtml(String(av.agentWordCount))}</strong> words AI can read</span>
        </div>
        ${missingTags ? `
          <div class="missing-words-block">
            <div class="missing-words-label">Words visible to humans but invisible to AI crawlers:</div>
            <div class="missing-words-tags">${missingTags}</div>
          </div>` : ''}
        <div class="agent-text-wrap">
          <div class="agent-text-label">Full text AI ingests from your page</div>
          <pre class="agent-text">${escapeHtml(av.full)}</pre>
        </div>
      </div>
    `);
  }

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
                ${prompts.map(p => {
                  const text = typeof p === 'object' ? p.prompt : p;
                  const type = typeof p === 'object' ? p.type : null;
                  const tag = type ? `<span class="prompt-type prompt-type--${escapeHtml(type)}">${escapeHtml(type)}</span>` : '';
                  return `<li>${tag}"${escapeHtml(text)}"</li>`;
                }).join('')}
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
        <p class="report-section-sub">Upload this file to <strong>${escapeHtml(safeOrigin(currentUrl))}/llms.txt</strong> so AI engines have a plain-language guide to your site.</p>
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
          ${c.sentiment ? `<span class="sentiment-badge sentiment-badge--${escapeHtml(c.sentiment)}">${escapeHtml(c.sentiment)} mentions</span>` : ''}
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
                ${r.competitors?.length ? `<div class="citation-competitors">Cited instead: ${r.competitors.map(d => `<span class="competitor-tag">${escapeHtml(d)}</span>`).join('')}</div>` : ''}
              </div>
            </div>`).join('')}
        </div>
        ${c.competitors?.length ? `
          <div class="competitor-summary">
            <div class="competitor-summary-title">Top competitors appearing in your prompts</div>
            <div class="competitor-list">
              ${c.competitors.map(comp => `
                <div class="competitor-row">
                  <span class="competitor-domain">${escapeHtml(comp.domain)}</span>
                  <span class="competitor-bar-wrap">
                    <span class="competitor-bar" style="width:${Math.round((comp.appearances/comp.total)*100)}%"></span>
                  </span>
                  <span class="competitor-count">${comp.appearances}/${comp.total} prompts</span>
                </div>`).join('')}
            </div>
          </div>` : ''}
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

  // Deploy fix section — always last
  sections.push(renderDeploySection());

  return sections.join('');
}

function renderDeploySection() {
  if (hasGitHub()) {
    return `
      <div class="report-section deploy-section">
        <h3 class="report-section-title">Deploy All Fixes to Your Site</h3>
        <p class="report-section-sub">GitHub connected. Enter your repo URL and Legibly will open a PR with all fixes applied — llms.txt, schema, robots.txt, and pre-rendering for React/Vite sites.</p>
        <div class="deploy-row">
          <label for="repo-input" class="sr-only">GitHub repo URL</label>
          <input type="url" id="repo-input" placeholder="github.com/yourname/yoursite"
            class="deploy-input" aria-describedby="deploy-error" />
          <button class="btn-deploy" id="deploy-btn">Deploy fixes →</button>
        </div>
        <p id="deploy-error" class="field-error" role="alert" aria-live="polite" hidden></p>
        <div id="deploy-result" hidden></div>
      </div>`;
  }

  return `
    <div class="report-section deploy-section">
      <h3 class="report-section-title">Deploy All Fixes Automatically — $99</h3>
      <p class="report-section-sub">Connect your GitHub repo and Legibly opens a PR with every fix applied. Merge it and your AI visibility score improves immediately. Works with Lovable, Vite, Next.js, and static sites.</p>
      <a href="/api/github/auth" class="btn-deploy-cta">Connect GitHub and deploy →</a>
    </div>`;
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
END REMOVED */

function toggleBreakdown() {
  const btn = document.getElementById('breakdown-btn');
  const panel = document.getElementById('breakdown-panel');
  const isOpen = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!isOpen));
  btn.textContent = isOpen ? 'See full breakdown ↓' : 'Hide breakdown ↑';
  panel.hidden = isOpen;
  if (!isOpen) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function infoBtn(key) {
  const tip = SIGNAL_TOOLTIPS[key];
  if (!tip) return '';
  return `<button class="info-btn" aria-label="What is ${escapeHtml(SIGNAL_LABELS[key] ?? key)}?" data-tip="${escapeHtml(tip)}">?</button>`;
}

function renderSignalSummary(key, signal) {
  if (signal.stub) {
    return `<li class="signal signal--stub">
      <span class="signal-icon" aria-hidden="true">·</span>
      <span class="signal-label">${escapeHtml(SIGNAL_LABELS[key] ?? key)}${infoBtn(key)}</span>
      <span class="signal-detail">In full report</span>
    </li>`;
  }
  const status = signal.score === 0 ? 'fail' : signal.score >= 8 ? 'pass' : 'partial';
  const icon   = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '!';
  // Use fail-state label when failing so it reads as a problem statement
  const label  = status === 'pass'
    ? (SIGNAL_LABELS[key] ?? key)
    : (SIGNAL_LABELS_FAIL[key] ?? SIGNAL_LABELS[key] ?? key);
  return `<li class="signal signal--${status}">
    <span class="signal-icon" aria-hidden="true">${icon}</span>
    <span class="signal-label">${escapeHtml(label)}${infoBtn(key)}</span>
  </li>`;
}

const FIX_HINTS = {
  prerender: 'Add a pre-rendering step so AI crawlers receive real HTML, not a JavaScript shell.',
  robots:    'Remove the AI crawler block from your robots.txt (User-agent: GPTBot, Disallow: /).',
  schema:    'Add Organization schema markup to your homepage <head> tag.',
  llmstxt:   'Create a /llms.txt file at your site root describing what your business does.',
  content:   'Rewrite your opening paragraphs to answer customer questions in the first sentence.',
  eeat:      'Add an About page, visible author names, and a contact method.',
  metadata:  'Write a page title and meta description that name your business and what it does.',
};

function renderBreakdownRow(key, signal) {
  if (signal.stub) {
    return `<div class="breakdown-row breakdown-row--stub">
      <div class="breakdown-row-header">
        <span class="breakdown-icon" aria-hidden="true">·</span>
        <span class="breakdown-label">${escapeHtml(SIGNAL_LABELS[key] ?? key)}${infoBtn(key)}</span>
        <span class="breakdown-badge badge--stub">Full report</span>
      </div>
      <p class="breakdown-detail">Deeper analysis available in the complete report.</p>
    </div>`;
  }
  const status     = signal.score === 0 ? 'fail' : signal.score >= 8 ? 'pass' : 'partial';
  const icon       = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '!';
  const badgeLabel = status === 'pass' ? 'Passing' : status === 'fail' ? 'Failing' : 'Partial';
  // Fail-state label as the header, technical tooltip as context
  const label      = status === 'pass'
    ? (SIGNAL_LABELS[key] ?? key)
    : (SIGNAL_LABELS_FAIL[key] ?? SIGNAL_LABELS[key] ?? key);
  const hint = (status !== 'pass' && FIX_HINTS[key])
    ? `<p class="breakdown-hint">→ ${escapeHtml(FIX_HINTS[key])}</p>`
    : '';
  return `<div class="breakdown-row breakdown-row--${status}">
    <div class="breakdown-row-header">
      <span class="breakdown-icon" aria-hidden="true">${icon}</span>
      <span class="breakdown-label">${escapeHtml(label)}${infoBtn(key)}</span>
      <span class="breakdown-badge badge--${status}">${badgeLabel}</span>
    </div>
    <p class="breakdown-detail">${escapeHtml(signal.detail ?? '')}</p>
    ${hint}
  </div>`;
}

// downloadPDF moved to report.html

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

// ── Email gate ────────────────────────────────────────────────────────────────

function hasEmail() {
  return !!localStorage.getItem('legibly_email');
}

// Server-authoritative tier — fetched once on page load
let _serverTier = null;
let _tierFetched = false;

async function fetchServerTier() {
  if (_tierFetched) return;
  _tierFetched = true;
  try {
    const res = await fetch('/api/subscription/status', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      _serverTier = data.tier ?? null;
    }
  } catch { /* unauthenticated or offline — fall back to localStorage */ }
}

// Called once early on page load (non-blocking)
fetchServerTier();

function hasPaid() {
  return hasPaidTier('fix');
}

function hasPaidTier(tier) {
  const TIERS = { snapshot: 1, fix: 2, monitor: 3, deploy: 4 };
  // Server-authoritative check (populated by fetchServerTier)
  if (_serverTier) {
    return (TIERS[_serverTier] ?? 0) >= (TIERS[tier] ?? 0);
  }
  // Fallback: localStorage (legacy Stripe session or test mode)
  const raw = localStorage.getItem('legibly_paid');
  if (!raw) return false;
  try {
    const val = JSON.parse(raw);
    const userTier = (typeof val === 'object' && val?.tier) ? val.tier : null;
    if (!userTier) return false;
    return (TIERS[userTier] ?? 0) >= (TIERS[tier] ?? 0);
  } catch {
    return false;
  }
}

async function deployFixes() {
  const btn     = document.getElementById('deploy-btn');
  const input   = document.getElementById('repo-input');
  const errEl   = document.getElementById('deploy-error');
  const result  = document.getElementById('deploy-result');
  const repoUrl = input?.value?.trim() ?? '';

  errEl.hidden = true;
  if (!repoUrl) {
    errEl.textContent = 'Please enter your GitHub repo URL.';
    errEl.hidden = false;
    input?.focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating PR…';

  try {
    const res  = await fetch('/api/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl, scanUrl: currentUrl }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? 'Fix failed');
    }
    const { prUrl, fixCount, stack } = await res.json();
    // Validate PR URL is a real GitHub URL before inserting into href
    const safePrUrl = (typeof prUrl === 'string' && /^https:\/\/github\.com\//i.test(prUrl))
      ? prUrl : '#';
    result.hidden = false;
    result.innerHTML = `
      <div class="deploy-success">
        <strong>PR created — ${fixCount} fix${fixCount !== 1 ? 'es' : ''} applied</strong>
        <span class="deploy-stack">${escapeHtml(stack)} site detected</span>
        <a href="${escapeHtml(safePrUrl)}" target="_blank" rel="noopener" class="btn-pr-link">
          Review and merge on GitHub →
        </a>
        <p class="deploy-note">After merging, click "Scan free" again to see your improved grade.</p>
      </div>`;
    btn.textContent = 'PR created ✓';
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Deploy fixes →';
  }
}

async function redirectToCheckout(tier = 'report') {
  const btn = document.querySelector('.locked-unlock-btn') ?? document.querySelector('.locked-snapshot-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Redirecting to checkout…'; }
  try {
    const res  = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: currentUrl, tier }),
    });
    if (!res.ok) throw new Error('Checkout unavailable');
    const { url } = await res.json();
    window.location.href = url;
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = tier === 'snapshot' ? 'See who\'s winning — $29 →' : 'Full report with fixes — $79 →'; }
    showError('Could not start checkout. Please try again.');
  }
}

async function submitEmailGate() {
  const input = document.getElementById('gate-email');
  const errEl = document.getElementById('gate-error');
  const btn   = document.getElementById('gate-submit');
  const email = input?.value?.trim() ?? '';

  errEl.hidden = true;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEl.textContent = 'Please enter a valid email address.';
    errEl.hidden = false;
    input?.focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Unlocking…';

  try {
    await fetch('/api/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, url: currentUrl, grade: currentScanData?.grade }),
    });
    // Store regardless of server response — never block on email delivery
    localStorage.setItem('legibly_email', email);
    // Re-render the CTA row with the report button
    const ctaRow = document.getElementById('report-cta-row');
    if (ctaRow) {
      ctaRow.innerHTML = `<button class="btn-report" id="get-report-btn">Get full report — $79 →</button>`;
      document.getElementById('get-report-btn').addEventListener('click', redirectToCheckout);
    }
  } catch {
    // Even on network error, unlock — email is a signal not a hard gate
    localStorage.setItem('legibly_email', email);
    btn.disabled = false;
    btn.textContent = 'See my report →';
  }
}

function safeOrigin(url) {
  try { return new URL(url).origin; } catch { return url; }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
