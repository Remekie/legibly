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
  robots:    'A robots.txt file tells crawlers what they can and can\'t access. AI crawlers obey these rules — if they\'re blocked here, your site doesn\'t exist to them.',
  schema:    'Structured data is hidden code that tells AI exactly what your business is, what you offer, and where you\'re located — in a format AI can reliably read.',
  llmstxt:   'A simple text file at yoursite.com/llms.txt that tells AI models a plain-language summary of who you are and what you do.',
  content:   'AI citation engines favor pages that answer questions directly in the first few sentences — not pages that bury the answer after a long intro.',
  eeat:      'Experience, Expertise, Authoritativeness, Trustworthiness — the signals AI engines use to decide whether your business is credible enough to recommend.',
  metadata:  'Your page title, meta description, and social share tags (og:title, og:description, og:image). These are the first things AI engines read to understand what your page is about.',
};

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const raw = urlInput.value.trim();
  if (!raw) {
    showError('Please enter a URL.');
    urlInput.focus();
    return;
  }

  setLoading(true);
  resultSection.hidden = true;

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: raw }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error ?? 'Scan failed. Please try again.');
      return;
    }

    renderResult(data);
  } catch {
    showError('Network error. Check your connection and try again.');
  } finally {
    setLoading(false);
  }
});

function renderResult({ grade, score, blocker, signals }) {
  const gradeClass = `grade-${grade.toLowerCase()}`;

  resultSection.innerHTML = `
    <div class="result-card ${gradeClass}">
      <div class="grade-display" aria-label="Grade ${grade}">${grade}</div>
      <div class="score-label">AI Visibility Score: ${score}/100</div>
      ${blocker ? `<p class="blocker" role="alert">⚠️ ${escapeHtml(blocker)}</p>` : ''}
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
        <p class="breakdown-note">Full analysis of structured data, llms.txt, content quality, and authority signals available in the complete report.</p>
      </div>
    </div>
  `;

  resultSection.hidden = false;
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  document.getElementById('breakdown-btn').addEventListener('click', toggleBreakdown);

  // Info bubble tooltips
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

function toggleBreakdown() {
  const btn = document.getElementById('breakdown-btn');
  const panel = document.getElementById('breakdown-panel');
  const isOpen = btn.getAttribute('aria-expanded') === 'true';

  btn.setAttribute('aria-expanded', String(!isOpen));
  btn.textContent = isOpen ? 'See full breakdown →' : 'Hide breakdown ↑';
  panel.hidden = isOpen;

  if (!isOpen) {
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function infoBtn(key) {
  const tip = SIGNAL_TOOLTIPS[key];
  if (!tip) return '';
  return `<button class="info-btn" aria-label="What is ${escapeHtml(SIGNAL_LABELS[key] ?? key)}?" data-tip="${escapeHtml(tip)}">?</button>`;
}

function renderSignalSummary(key, signal) {
  const label = SIGNAL_LABELS[key] ?? key;

  if (signal.stub) {
    return `
      <li class="signal signal--stub">
        <span class="signal-icon" aria-hidden="true">·</span>
        <span class="signal-label">${escapeHtml(label)}${infoBtn(key)}</span>
        <span class="signal-detail">In full report</span>
      </li>
    `;
  }

  const status = signal.score === 0 ? 'fail' : signal.score >= 8 ? 'pass' : 'partial';
  const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '~';

  return `
    <li class="signal signal--${status}">
      <span class="signal-icon" aria-hidden="true">${icon}</span>
      <span class="signal-label">${escapeHtml(label)}${infoBtn(key)}</span>
    </li>
  `;
}

function renderBreakdownRow(key, signal) {
  const label = SIGNAL_LABELS[key] ?? key;

  if (signal.stub) {
    return `
      <div class="breakdown-row breakdown-row--stub">
        <div class="breakdown-row-header">
          <span class="breakdown-icon" aria-hidden="true">·</span>
          <span class="breakdown-label">${escapeHtml(label)}${infoBtn(key)}</span>
          <span class="breakdown-badge badge--stub">Full report</span>
        </div>
        <p class="breakdown-detail">Deeper analysis available in the complete report.</p>
      </div>
    `;
  }

  const status = signal.score === 0 ? 'fail' : signal.score >= 8 ? 'pass' : 'partial';
  const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '~';
  const badgeLabel = status === 'pass' ? 'Passing' : status === 'fail' ? 'Failing' : 'Partial';

  return `
    <div class="breakdown-row breakdown-row--${status}">
      <div class="breakdown-row-header">
        <span class="breakdown-icon" aria-hidden="true">${icon}</span>
        <span class="breakdown-label">${escapeHtml(label)}${infoBtn(key)}</span>
        <span class="breakdown-badge badge--${status}">${badgeLabel}</span>
      </div>
      <p class="breakdown-detail">${escapeHtml(signal.detail ?? '')}</p>
    </div>
  `;
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

function showError(msg) {
  urlError.textContent = msg;
  urlError.hidden = false;
}

function clearError() {
  urlError.textContent = '';
  urlError.hidden = true;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
