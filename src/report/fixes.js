/**
 * Generate copy-paste fix instructions for each failing signal.
 * Returns an object keyed by signal name.
 */
export function generateFixes(signals, context) {
  const fixes = {};

  // Prerender fix
  if (signals.prerender?.score === 0 && !signals.prerender?.isBlocked) {
    fixes.prerender = {
      title: 'Make your site visible to AI crawlers',
      options: [
        {
          label: 'Option A — Static pre-render at build time (recommended for Lovable/Vite/React)',
          steps: [
            'Install the pre-render plugin:',
            '  npm install vite-plugin-prerender',
            '',
            'Add to your vite.config.js:',
            '  import prerender from "vite-plugin-prerender"',
            '  export default { plugins: [prerender({ staticDir: "dist", routes: ["/"] })] }',
            '',
            'Run your build — AI crawlers will now see real HTML.',
          ],
          note: 'Best for: public marketing sites, landing pages, Lovable/Bolt/v0 apps.',
        },
        {
          label: 'Option B — Dynamic pre-render at server level',
          steps: [
            'Install the middleware:',
            '  npm install prerender-node',
            '',
            'Add to your Express server:',
            '  import prerender from "prerender-node"',
            '  app.use(prerender)',
            '',
            'Deploy a prerender server (or use prerender.io free tier).',
          ],
          note: 'Best for: apps with user authentication or dynamic data.',
        },
      ],
    };
  }

  if (signals.prerender?.isBlocked) {
    fixes.prerender = {
      title: 'AI crawlers are being blocked before they reach your content',
      options: [{
        label: 'Check your hosting/CDN configuration',
        steps: [
          'Your server returned a 403 error to AI crawlers.',
          'Check your CDN, firewall, or hosting panel for bot-blocking rules.',
          'If using Cloudflare: Dashboard → Security → Bots → review blocked bot categories.',
        ],
        note: 'This is a server-level block, not a code issue.',
      }],
    };
  }

  // Robots fix
  if (signals.robots?.score === 0) {
    if (signals.robots?.cloudflareBlocking) {
      fixes.robots = {
        title: 'Remove Cloudflare AI crawler block',
        options: [{
          label: 'One-setting fix in your Cloudflare dashboard',
          steps: [
            '1. Log into cloudflare.com',
            '2. Select your domain',
            '3. Go to Security → Bots',
            '4. Find "Block AI Scrapers" — toggle it OFF',
            '5. Changes take effect immediately — no deploy needed.',
          ],
          note: 'This is the most common cause of AI invisibility for Cloudflare-hosted sites.',
        }],
      };
    } else {
      const blocked = signals.robots?.blockedBots ?? [];
      fixes.robots = {
        title: 'Update your robots.txt to allow AI crawlers',
        options: [{
          label: 'Edit your robots.txt file',
          steps: [
            'Remove or comment out these lines from your robots.txt:',
            ...blocked.map(b => `  User-agent: ${b}\n  Disallow: /`),
            '',
            'Or explicitly allow AI crawlers by adding:',
            '  User-agent: GPTBot',
            '  Allow: /',
            '',
            '  User-agent: ClaudeBot',
            '  Allow: /',
            '',
            '  User-agent: PerplexityBot',
            '  Allow: /',
          ],
          note: 'Your robots.txt is at: ' + (context?.url ? new URL(context.url).origin + '/robots.txt' : 'yoursite.com/robots.txt'),
        }],
      };
    }
  }

  // llms.txt fix
  if (signals.llmstxt?.score === 0) {
    fixes.llmstxt = {
      title: 'Add llms.txt to your site',
      options: [{
        label: 'Upload the generated llms.txt file',
        steps: [
          '1. Download the llms.txt file from this report',
          '2. Upload it to your website root so it\'s accessible at:',
          `   ${context?.url ? new URL(context.url).origin + '/llms.txt' : 'yoursite.com/llms.txt'}`,
          '',
          'For Lovable/Vite apps: place the file in your /public folder',
          'For WordPress: upload via FTP or media manager to root',
          'For Webflow: add a file embed via the Page Settings panel',
        ],
        note: 'llms.txt is read by AI engines as a plain-language summary of your site.',
      }],
    };
  }

  // Schema fix
  if (signals.schema?.score < 8) {
    fixes.schema = {
      title: 'Add structured data so AI knows what your business does',
      options: [{
        label: 'Add JSON-LD to your page <head>',
        steps: [
          'Copy the schema snippet from the Structured Data section of this report.',
          'Paste it inside the <head> of your page:',
          '  <script type="application/ld+json">',
          '    [paste schema here]',
          '  </script>',
          '',
          'For WordPress: use the Yoast SEO or Rank Math plugin.',
          'For Webflow: paste into Page Settings → Custom Code → Head.',
          'For Lovable/Vite: add to your index.html <head>.',
        ],
        note: 'Schema tells AI exactly what your business is, what you offer, and where you\'re located.',
      }],
    };
  }

  // Metadata fix
  if (signals.metadata?.score < 8 && signals.metadata?.issues?.length > 0) {
    const issueList = signals.metadata.issues;
    fixes.metadata = {
      title: 'Fix missing or incomplete page metadata',
      items: issueList.map(issue => metadataFix(issue, context)),
    };
  }

  return fixes;
}

function metadataFix(issue, context) {
  const domain = context?.url ? new URL(context.url).hostname.replace('www.', '') : 'yoursite.com';
  const fixes = {
    title: {
      label: 'Page title',
      instruction: 'Your title should include your brand name AND what the page is about.\nExample: "Cocktail Catering & Mobile Bar | Poptop Cocktails"',
    },
    description: {
      label: 'Meta description',
      instruction: 'Write 80–160 characters that summarize the page value.\nExample: "Poptop Cocktails provides mobile cocktail bars and professional bartenders for weddings, corporate events, and parties across Denver."',
    },
    og: {
      label: 'Social share tags (og:title, og:description, og:image)',
      instruction: 'Add to your <head>:\n<meta property="og:title" content="[Your page title]">\n<meta property="og:description" content="[Your meta description]">\n<meta property="og:image" content="[URL to a 1200×630 image]">',
    },
    h1: {
      label: 'Main heading (H1)',
      instruction: 'Your page needs one descriptive H1 that clearly states what the page is about.\nAvoid: "Welcome" or "Home"\nUse: "Mobile Cocktail Bar Hire for Weddings & Events"',
    },
    headings: {
      label: 'Content structure (H2/H3 headings)',
      instruction: 'Break your content into sections with descriptive H2 headings.\nAI uses headings to understand what topics your page covers.',
    },
    canonical: {
      label: 'Canonical tag',
      instruction: `Add to your <head>:\n<link rel="canonical" href="https://${domain}/">`,
    },
    alttext: {
      label: 'Image alt text',
      instruction: 'Add descriptive alt attributes to all <img> tags.\nBad:  <img src="photo.jpg">\nGood: <img src="photo.jpg" alt="Mobile cocktail bar at a wedding reception">',
    },
  };
  return fixes[issue] ?? { label: issue, instruction: 'Fix this metadata issue.' };
}
