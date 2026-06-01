/**
 * Generate surgical, domain-specific fix instructions for each failing signal.
 * Uses actual context (domain, title, sitePages data) — no generic placeholders.
 */
export function generateFixes(signals, context, sitePages) {
  const fixes = {};
  const domain  = context?.domain ?? 'yoursite.com';
  const origin  = context?.url ? new URL(context.url).origin : `https://${domain}`;
  const bizName = extractBrandName(context?.title ?? domain);
  const agg     = sitePages?.aggregate;
  const pages   = sitePages?.pagesChecked ?? 1;

  // ── Prerender fix ─────────────────────────────────────────────────────────
  if (signals.prerender?.score === 0 && !signals.prerender?.isBlocked) {
    fixes.prerender = {
      title: `AI crawlers see a blank page on ${domain}`,
      options: [
        {
          label: 'Option A — Static pre-render at build time (recommended for Lovable / Vite / React)',
          steps: [
            'npm install vite-plugin-prerender',
            '',
            '// vite.config.js',
            "import prerender from 'vite-plugin-prerender'",
            'export default {',
            "  plugins: [prerender({ staticDir: 'dist', routes: ['/'] })]",
            '}',
            '',
            'Run your build. AI crawlers will now receive real HTML instead of a blank shell.',
          ],
          note: 'Best for: public pages, Lovable/Bolt/v0 apps, any site without user authentication.',
        },
        {
          label: 'Option B — Dynamic pre-render at server level (for apps with auth or real-time data)',
          steps: [
            'npm install prerender-node',
            '',
            '// server.js',
            "import prerender from 'prerender-node'",
            'app.use(prerender)',
          ],
          note: 'Requires a prerender server. Use prerender.io free tier to get started.',
        },
      ],
    };
  }

  if (signals.prerender?.isBlocked) {
    fixes.prerender = {
      title: `${domain} is blocking AI crawlers at the server level`,
      options: [{
        label: 'Identify and remove the bot block',
        steps: [
          `Your server returned a 403 to GPTBot and ClaudeBot when they tried to access ${origin}`,
          '',
          'Check in order:',
          '  1. Cloudflare → Security → Bots → "Block AI Scrapers" must be OFF',
          '  2. Your hosting panel → check for WAF or bot-blocking rules',
          '  3. Any WordPress security plugins (Wordfence, iThemes) — add GPTBot to allowlist',
        ],
        note: 'This is a server configuration issue, not a code change.',
      }],
    };
  }

  // ── Robots fix ────────────────────────────────────────────────────────────
  if (signals.robots?.score === 0) {
    if (signals.robots?.cloudflareBlocking) {
      fixes.robots = {
        title: `Cloudflare is blocking all AI crawlers from ${domain}`,
        options: [{
          label: 'One toggle in Cloudflare — takes 60 seconds',
          steps: [
            '1. Log into cloudflare.com → select your domain',
            '2. Security → Bots',
            '3. Toggle "Block AI Scrapers" → OFF',
            '4. No deploy needed — takes effect immediately',
          ],
          note: `This single setting is preventing ChatGPT, Claude, and Perplexity from reading ${domain}.`,
        }],
      };
    } else {
      const blocked = signals.robots?.blockedBots ?? [];
      fixes.robots = {
        title: `Your robots.txt is blocking AI crawlers from ${domain}`,
        options: [{
          label: `Edit ${origin}/robots.txt`,
          steps: [
            blocked.length > 0
              ? `Remove or comment out these lines:\n${blocked.map(b => `  User-agent: ${b}\n  Disallow: /`).join('\n\n')}`
              : 'Review your Disallow rules for AI crawler user-agents.',
            '',
            'Add these lines to explicitly allow AI crawlers:',
            '',
            'User-agent: GPTBot',
            'Allow: /',
            '',
            'User-agent: ClaudeBot',
            'Allow: /',
            '',
            'User-agent: PerplexityBot',
            'Allow: /',
          ],
          note: `Your robots.txt is live at ${origin}/robots.txt`,
        }],
      };
    }
  }

  // ── llms.txt fix ──────────────────────────────────────────────────────────
  if (signals.llmstxt?.score === 0) {
    fixes.llmstxt = {
      title: `${domain} has no llms.txt — AI engines have no guide to your site`,
      options: [{
        label: `Upload llms.txt to ${origin}/llms.txt`,
        steps: [
          '1. Download the generated llms.txt file from the report above',
          `2. Upload it so it lives at: ${origin}/llms.txt`,
          '',
          'Platform-specific instructions:',
          '  Lovable / Vite / React: place in /public/llms.txt',
          '  WordPress: upload via FTP to your domain root, or use a file manager plugin',
          '  Webflow: Settings → Custom Code is not sufficient — use Webflow Hosting → publish a static file',
          '  Squarespace: Settings → Advanced → Code Injection will not work — use a custom domain file host',
        ],
        note: 'llms.txt is the equivalent of a business card for AI engines. Without it, they have to guess.',
      }],
    };
  }

  // ── Schema fix ────────────────────────────────────────────────────────────
  if (signals.schema?.score < 8) {
    const schemaCount = agg ? `${agg.schema} pages have structured data` : 'No structured data detected';
    fixes.schema = {
      title: `${schemaCount} — AI is guessing what ${bizName} does`,
      options: [{
        label: `Add JSON-LD to ${domain}`,
        steps: [
          'Copy the schema snippet from the "Structured Data" section of this report.',
          '',
          'Paste it inside the <head> tag of your page:',
          '<script type="application/ld+json">',
          '  { paste schema here }',
          '</script>',
          '',
          'At minimum, add Organization schema to your homepage with:',
          `  "name": "${bizName}"`,
          `  "url": "${origin}"`,
          '  "sameAs": [ your LinkedIn URL, your Twitter/X URL ]',
          '',
          'Platform instructions:',
          '  WordPress: Yoast SEO or Rank Math → Schema settings',
          '  Webflow: Page Settings → Custom Code → Head',
          '  Lovable/Vite: add to index.html <head>',
          '  Squarespace: Settings → Advanced → Code Injection → Header',
        ],
        note: `Adding Organization + sameAs links is the single highest-impact schema fix for ${domain}.`,
      }],
    };
  }

  // ── Content fix ───────────────────────────────────────────────────────────
  if (signals.content?.score < 5) {
    const contentCount = agg ? `${agg.content} of ${pages} pages have sufficient content` : null;
    fixes.content = {
      title: contentCount
        ? `${contentCount} — most pages have too little text for AI to cite`
        : `${domain} doesn't open with a clear value statement`,
      options: [{
        label: 'Rewrite the opening of your homepage',
        steps: [
          'AI citation engines read your first 50 words first. If they don\'t describe your business clearly, the page gets skipped.',
          '',
          'Current pattern to avoid:',
          '  "Welcome to [Brand]. We\'re passionate about [thing]."',
          '',
          'Replace with a direct statement:',
          `  "${bizName} provides [service] for [audience] in [location]."`,
          '  Lead with what you do, who you do it for, and where.',
          '',
          'Then follow with 2-3 specific sentences about your offer.',
          'Aim for 150+ words of meaningful content above the fold.',
        ],
        note: 'This is a copywriting change, not a technical one. Your developer doesn\'t need to be involved.',
      }],
    };
  }

  // ── Brand trust fix ───────────────────────────────────────────────────────
  if (signals.eeat?.score < 5) {
    fixes.brandtrust = {
      title: `AI has no way to verify ${bizName} is a real business`,
      options: [{
        label: 'Add Organization schema with social verification',
        steps: [
          'Add this to your homepage <head> (update the values):',
          '',
          '<script type="application/ld+json">',
          '{',
          '  "@context": "https://schema.org",',
          '  "@type": "Organization",',
          `  "name": "${bizName}",`,
          `  "url": "${origin}",`,
          '  "sameAs": [',
          '    "https://linkedin.com/company/YOUR-SLUG",',
          '    "https://twitter.com/YOUR-HANDLE"',
          '  ]',
          '}',
          '</script>',
          '',
          'The sameAs links are how AI engines cross-reference your brand across the web.',
          'Without them, your business could be anyone.',
        ],
        note: 'Takes 10 minutes. This is one of the highest-trust signals you can add for free.',
      }],
    };
  }

  // ── Metadata fix ──────────────────────────────────────────────────────────
  if (signals.metadata?.score < 8 && signals.metadata?.issues?.length > 0) {
    const issueList = signals.metadata.issues;
    const siteWide  = signals.metadata?.siteWide;
    fixes.metadata = {
      title: siteWide
        ? `Metadata gaps across ${siteWide.pagesChecked} pages on ${domain}`
        : `Incomplete page metadata on ${domain}`,
      items: issueList.map(issue => metadataFix(issue, domain, origin, bizName, siteWide)),
    };
  }

  return fixes;
}

function metadataFix(issue, domain, origin, bizName, siteWide) {
  const fixes = {
    title: {
      label: 'Page title missing or too generic',
      instruction: siteWide
        ? `${siteWide.title} pages have descriptive titles. Fix the rest by including: brand name + topic.\nPattern: "[Topic or Service] | ${bizName}"\nExample: "Mobile Cocktail Bar Hire for Weddings | ${bizName}"`
        : `Your page title should include your brand name AND what the page is about.\nPattern: "[Topic or Service] | ${bizName}"`,
    },
    description: {
      label: 'Meta description missing or too short (needs 80+ characters)',
      instruction: `Write a meta description that answers: who are you, what do you offer, who is it for?\nTemplate: "${bizName} provides [service] for [audience]. [One specific differentiator]. [CTA]."\nAim for 120-160 characters. This is what AI uses as a citation summary.`,
    },
    og: {
      label: 'Social share tags missing (og:title, og:description, og:image)',
      instruction: `Add to your <head>:\n<meta property="og:title" content="[Your page title]">\n<meta property="og:description" content="[Your meta description]">\n<meta property="og:image" content="[Full URL to a 1200×630px image]">\n\nog:image is used by AI when summarizing your content in responses.`,
    },
    h1: {
      label: 'H1 heading missing or too generic',
      instruction: `Every page needs exactly one H1 that describes the page topic.\nAvoid: "Welcome", "Home", "Services"\nUse a specific phrase: "Mobile Cocktail Bar Hire for Weddings & Events"\n\nAI uses your H1 as the primary topic signal for the page.`,
    },
    headings: {
      label: 'No H2/H3 heading structure',
      instruction: `Break your page into sections with H2 headings that describe each section.\nAI reads headings to understand what topics your page covers — without them, it can only guess.\n\nMinimum structure:\nH1: [Main topic]\nH2: [Service or feature 1]\nH2: [Service or feature 2]\nH2: [About / Who we serve]`,
    },
    canonical: {
      label: 'Canonical tag missing',
      instruction: `Add to your homepage <head>:\n<link rel="canonical" href="${origin}/">\n\nFor other pages, the canonical href should match the page's own URL.\nThis prevents AI from treating duplicate URLs as separate pages.`,
    },
    alttext: {
      label: 'Images missing descriptive alt text',
      instruction: `Every <img> tag needs a descriptive alt attribute.\nAI reads alt text as content — missing alt text = missing content.\n\nBad:  <img src="photo.jpg">\nGood: <img src="photo.jpg" alt="${bizName} mobile bar at an outdoor wedding">\n\nDescribe what's in the image and why it's relevant to the page.`,
    },
    noindex: {
      label: 'Page is blocked from AI indexing (noindex)',
      instruction: `Your page has a noindex meta tag, which prevents AI engines from indexing it.\n\nFind and remove: <meta name="robots" content="noindex">\n\nIf this page should be public, removing noindex is the only fix.\nIf it was intentional (e.g., a private page), this is not an error.`,
    },
  };
  return fixes[issue] ?? { label: issue, instruction: 'Review and fix this metadata issue.' };
}

function extractBrandName(title) {
  const parts = title.split(/[|\-—]/).map(s => s.trim()).filter(Boolean);
  const short  = parts.find(p => p.split(' ').length <= 4);
  return short ?? parts[parts.length - 1] ?? title;
}
