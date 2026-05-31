# legibly.dev

**Paste your URL. Find out if AI can see your site. Fix it in one click.**

## The Problem

GPTBot, ClaudeBot, and PerplexityBot never execute JavaScript. Every Lovable, Bolt, v0, and Vite/React app is client-side rendered by default — outputting `<div id="root"></div>` and nothing else to an AI crawler. 69% of AI crawlers can't read JavaScript-heavy websites.

## The Product

| Tier | Price | What it does |
|---|---|---|
| Free scan | $0 | URL in → letter grade out in 60s. No login. |
| Full report | $79 | 7-page "hand to your developer" PDF with copy-paste fixes |
| Compass fix | $299 | Auto-applies all fixes, opens PR, re-audits |
| Monitoring | $79/mo | Monthly re-audit + citation tracking |
| Agency | $149/mo | White-label dashboard, bulk CSV, branded PDF |

## Architecture

```
src/
  server.js          Express API
  scan/
    index.js         Scan orchestrator (6 signals → letter grade)
    prerender.js     Puppeteer: detect React SPA / <div id="root">
    robots.js        Fetch robots.txt + detect Cloudflare AI block
    grade.js         Weight signals → A–F grade
  report/
    pdf.js           7-page PDF generator (Week 3)
    llmstxt.js       llms.txt generator via firecrawl (Week 3)
    schema.js        JSON-LD snippet generator via geo-seo (Week 3)
public/
  index.html         Scan UI — no framework, no build step
  scan.js            Fetch scan API, render grade
  styles.css
```

## Run Locally

```bash
cp .env.example .env
# Fill in values

npm install
npm run dev
# http://localhost:3000
```

## Signal Weights (Free Scan)

| Signal | Weight | Engine |
|---|---|---|
| React/SPA rendering (`<div id="root">` only) | 25% | puppeteer |
| AI crawler access (GPTBot / ClaudeBot blocked) | 20% | robots-fetch + Cloudflare header |
| Schema completeness | 15% | @glincker/geo-seo |
| llms.txt presence | 15% | file check |
| Answer-first structure | 15% | @glincker/geo-audit |
| E-E-A-T signals | 10% | @glincker/geo-audit |

## Dev Principles

- Karpathy: think before coding, simplicity first, surgical changes, define verifiable success criteria before implementing
- No `console.log` in production paths — use the structured logger
- All user input validated at the API boundary
- WCAG 2.1 AA for the scan UI
- Explicit loading / error / empty states everywhere
- No hardcoded secrets — `.env` only

## Stack

- Node 20 + Express
- Puppeteer (headless Chrome)
- @glincker/geo-audit + geo-seo
- firecrawl/llmstxt-generator
- Stripe (Week 3)
- PDFKit (Week 3)

## Roadmap

- **Week 1–2:** Free scan MVP — URL in, grade out, email gate
- **Week 3–4:** $79 PDF report with llms.txt + schema snippets
- **Week 5–6:** Before/after AI crawler preview screenshots
- **Week 7–8:** Compass fix — GitHub connect, auto-PR, re-audit
- **Month 3:** Agency white-label dashboard
