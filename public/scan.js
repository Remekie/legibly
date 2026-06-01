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
  eeat:      'E-E-A-T signals',
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

function renderSignalSummary(key, signal) {
  const label = SIGNAL_LABELS[key] ?? key;

  if (signal.stub) {
    return `
      <li class="signal signal--stub">
        <span class="signal-icon" aria-hidden="true">·</span>
        <span class="signal-label">${escapeHtml(label)}</span>
        <span class="signal-detail">In full report</span>
      </li>
    `;
  }

  const status = signal.score === 0 ? 'fail' : signal.score >= 8 ? 'pass' : 'partial';
  const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '~';

  return `
    <li class="signal signal--${status}">
      <span class="signal-icon" aria-hidden="true">${icon}</span>
      <span class="signal-label">${escapeHtml(label)}</span>
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
          <span class="breakdown-label">${escapeHtml(label)}</span>
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
        <span class="breakdown-label">${escapeHtml(label)}</span>
        <span class="breakdown-badge badge--${status}">${badgeLabel}</span>
      </div>
      <p class="breakdown-detail">${escapeHtml(signal.detail ?? '')}</p>
    </div>
  `;
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
