# CLAUDE.md — Legibly

> Loaded automatically by Claude Code and AI coding agents.
> Defines the rules of this repo. Follow these before writing a single line.
> **Do not override without explicit instruction from the project owner.**

---

## Project Identity

- **Project:** Legibly
- **Type:** Full-Stack Web App
- **Owner:** Remekie
- **Repo:** github.com/Remekie/legibly
- **Live URL:** (Railway — set after first successful deploy)
- **Staging URL:** —

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend Framework | Vanilla JS (no framework — no build step) | ES2022 |
| Styling | Plain CSS with CSS custom properties | — |
| Language | JavaScript (ESM) | Node 20 |
| Backend | Node/Express | 4.19 |
| Database | None (Week 3+) | — |
| Auth | None (Week 7+) | — |
| Hosting | Railway (auto-deploy from master) | — |
| Package Manager | npm | 10+ |

---

## Folder Structure

```
/
├── src/
│   ├── server.js           # Express entry point — rate limiting, validation, health
│   ├── scan/
│   │   ├── index.js        # Scan orchestrator — runs all 6 signals in parallel
│   │   ├── prerender.js    # Puppeteer: detect React SPA / <div id="root">
│   │   ├── robots.js       # Fetch robots.txt + detect Cloudflare AI block
│   │   └── grade.js        # Weighted A–F grade from signal scores
│   ├── report/             # Week 3: PDF generation, llms.txt, schema snippets
│   └── vendor/             # Vendored packages (geo-audit, geo-seo — see below)
├── public/
│   ├── index.html          # Scan UI — no framework, no build step
│   ├── scan.js             # Fetch /api/scan, render grade + signals
│   └── styles.css          # CSS custom properties, WCAG focus rings, dark theme
├── .env.example            # Source of truth for required env vars
├── railway.toml            # Railway deploy config
└── nixpacks.toml           # Nixpkgs: nodejs_20 + chromium for Puppeteer
```

---

## Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Server modules | camelCase | `prerender.js`, `grade.js` |
| Exported functions | camelCase | `checkPrerender`, `toGrade` |
| Constants | SCREAMING_SNAKE_CASE | `FETCH_TIMEOUT_MS` |
| API routes | `kebab-case`, verb-noun | `/api/scan`, `/api/report` |
| Environment variables | SCREAMING_SNAKE_CASE | `STRIPE_SECRET_KEY` |
| CSS classes | BEM-ish | `.signal--fail`, `.grade-display` |

---

## Code Style Standards

- ESM only (`"type": "module"`) — no `require()`
- `const` over `let`; never `var`
- No `any` — JS project but keep JSDoc types on exported functions
- Arrow functions for callbacks; named functions for top-level exports
- No optional chaining on values that must exist — fix the type, don't paper over it
- API responses always `{ data?, error?, meta? }` shape
- HTTP status codes semantically correct — never `200` on an error

---

## Code Quality — Non-Negotiable

### The Basics
- [ ] No `console.log` — use `process.stderr.write()` for server errors
- [ ] No hardcoded values — URLs, limits, timeouts go in named constants at top of file
- [ ] No unused imports or dead code — delete it
- [ ] No commented-out code — git history has it
- [ ] Every function does one thing

### Async and Error Handling
- [ ] Every `fetch()` checks `response.ok` before parsing body
- [ ] Every `async` function has `try/catch` or explicitly propagates
- [ ] User-facing errors show a meaningful message — never expose internal stack traces
- [ ] Loading, error, and empty states handled for every data fetch in the UI
- [ ] No unhandled promise rejections

### Security (OWASP Top 10)
- [ ] No secrets in source — `.env` only, never committed
- [ ] User input validated server-side — client validation is UX only
- [ ] No `innerHTML` with untrusted data — use `textContent` or `escapeHtml()`
- [ ] All sensitive endpoints rate-limited (`express-rate-limit`)
- [ ] `helmet` on every Express app
- [ ] `npm audit` clean before every push

### Performance
- [ ] Puppeteer browser closed in `finally` block — no leaked Chrome processes
- [ ] Scan signals run in `Promise.all` — never sequential when parallel is possible
- [ ] No N+1 patterns in report generation

### Accessibility (WCAG 2.1 AA minimum)
- [ ] Semantic HTML: `<button>` not `<div onclick>`
- [ ] `aria-live` on result areas, `aria-busy` on loading states
- [ ] All inputs have `<label>` (visible or `.sr-only`)
- [ ] Errors announced with `role="alert"` or `aria-live="polite"`
- [ ] Visible 3px focus ring on all interactive elements
- [ ] `prefers-reduced-motion` respected in CSS

---

## Signal Weights (Free Scan)

| Signal | Weight | Engine | Status |
|---|---|---|---|
| React/SPA rendering (`<div id="root">`) | 25% | puppeteer | ✅ Live |
| AI crawler access (robots.txt + Cloudflare) | 20% | fetch | ✅ Live |
| Schema completeness | 15% | @glincker/geo-seo | 🔲 Stub |
| llms.txt presence | 15% | llmstxt | 🔲 Stub |
| Answer-first content | 15% | @glincker/geo-audit | 🔲 Stub |
| E-E-A-T signals | 10% | rankweave-geo-audit | 🔲 Stub |

---

## Environment Variables

Required — all must be in `.env.example`:

```
PORT                    # Express port (Railway sets this automatically)
NODE_ENV                # production | development
CHROMIUM_PATH           # Set by nixpacks.toml on Railway
RESEND_API_KEY          # Email gate (Week 3)
STRIPE_SECRET_KEY       # Payments (Week 3)
STRIPE_WEBHOOK_SECRET   # Stripe webhook verification (Week 3)
FIRECRAWL_API_KEY       # Deep crawl for llms.txt (Week 3)
```

---

## Roadmap

- **Week 1–2:** Free scan — URL in, A–F grade out, email gate ← current
- **Week 3–4:** $79 PDF report (llms.txt + schema snippets + prerender fix instructions)
- **Week 5–6:** Before/after AI crawler screenshots
- **Week 7–8:** Compass Fix — GitHub connect, auto-PR, re-audit
- **Month 3:** Agency white-label dashboard

---

## AI Agent Behavior Rules

1. Read the folder structure before creating files — `src/scan/` for signal logic, `src/report/` for output generation
2. Ask before adding dependencies — state what it's for and if there's a native alternative
3. Never auto-commit — summarize what changed and why first
4. Flag scope creep — if a request touches more than the scan engine OR the UI, say so
5. Don't paper over problems — if something is architecturally wrong, say it
6. Self-review against this checklist before reporting work done

---

## Self-Review Prompt

> "Review the code you just wrote:
> - No console.logs, hardcoded values, magic numbers, or dead code
> - All async operations have try/catch and handle loading/error/empty states
> - No innerHTML with user data, no secrets, input validated server-side
> - Puppeteer browser closed in finally block
> - WCAG: semantic HTML, aria attributes, visible focus, sr-only labels
> - npm audit still clean after any new dep
> List every issue found."
