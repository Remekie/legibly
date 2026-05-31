const form = document.getElementById('scan-form');
const urlInput = document.getElementById('url-input');
const urlError = document.getElementById('url-error');
const scanBtn = document.getElementById('scan-btn');
const resultSection = document.getElementById('result');

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
      <ul class="signals" aria-label="Signal breakdown">
        ${Object.entries(signals).map(([key, s]) => renderSignal(key, s)).join('')}
      </ul>
      <div class="cta-row">
        <button class="btn-primary" id="full-report-btn">See full breakdown →</button>
      </div>
    </div>
  `;

  resultSection.hidden = false;
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  document.getElementById('full-report-btn')?.addEventListener('click', () => {
    // Week 3: email gate → $79 report
    alert('Full report coming soon. Enter your email to be notified.');
  });
}

function renderSignal(key, signal) {
  const label = {
    prerender: 'AI crawler rendering',
    robots: 'Crawler access',
    schema: 'Structured data',
    llmstxt: 'llms.txt',
    content: 'Answer-first content',
    eeat: 'E-E-A-T signals',
  }[key] ?? key;

  const status = signal.score === 0 ? 'fail' : signal.score >= 8 ? 'pass' : 'partial';
  const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '~';

  return `
    <li class="signal signal--${status}">
      <span class="signal-icon" aria-hidden="true">${icon}</span>
      <span class="signal-label">${escapeHtml(label)}</span>
      <span class="signal-detail">${escapeHtml(signal.detail ?? '')}</span>
    </li>
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
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
