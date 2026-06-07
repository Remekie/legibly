/**
 * Generates paste-ready prompts for AI site builders (Lovable, Bolt, v0).
 * For each failing signal, returns a natural-language instruction the user
 * can paste directly into their AI builder chat — no coding knowledge required.
 */

export function generateLovableSnippets({ signals, schemaRecs, llmstxt, domain }) {
  const snippets = [];

  const addSnippet = (signal, title, prompt) => {
    snippets.push({ signal, title, prompt });
  };

  // Prerender — React SPA invisible to AI crawlers
  if (signals?.prerender?.score < 8) {
    const isSpa = signals.prerender.isSpaOnly;
    if (isSpa) {
      addSnippet('prerender',
        'Fix: AI crawlers can\'t read your site',
        `In Lovable, type exactly this:

"Add vite-ssg to this project so AI crawlers like ChatGPT and Perplexity get pre-rendered HTML. Install vite-ssg, update vite.config.ts to use createBuildConfig from vite-ssg, and add an src/main.ts entry that exports a createApp function. Keep the existing app working for human visitors."`
      );
    } else if (signals.prerender.isBlocked) {
      addSnippet('prerender',
        'Fix: AI crawlers are blocked from your site',
        `In Lovable, type exactly this:

"Create or update the public/robots.txt file to allow AI crawlers. Add these lines at the top:

User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

Keep any existing rules below these."`
      );
    }
  }

  // Robots.txt — blocking AI crawlers
  if (signals?.robots?.score < 5) {
    addSnippet('robots',
      'Fix: robots.txt is blocking AI search engines',
      `In Lovable, type exactly this:

"Create or update the public/robots.txt file. Add these lines at the very top of the file:

User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: *
Allow: /

Do not add any Disallow rules for the root path."`
    );
  }

  // Schema — no structured data
  if (signals?.schema?.score < 5) {
    const schemaSnippet = schemaRecs?.recommendations?.[0]?.snippet;
    if (schemaSnippet) {
      addSnippet('schema',
        'Fix: No structured data (AI can\'t identify your business)',
        `In Lovable, type exactly this:

"Add this JSON-LD structured data to the <head> section of index.html. Paste it inside a <script type='application/ld+json'> tag:

${schemaSnippet}

This tells AI search engines exactly what your business is and what you offer."`
      );
    } else {
      addSnippet('schema',
        'Fix: Add Organization schema to your site',
        `In Lovable, type exactly this:

"Add Organization structured data to the <head> of index.html. Create a <script type='application/ld+json'> tag containing a JSON object with @type: Organization, name: [your business name], url: [your website URL], description: [one sentence about what you do], and contactPoint with contactType: customer service. This helps AI engines identify your business."`
      );
    }
  }

  // llms.txt — missing AI guide file
  if (signals?.llmstxt?.score < 5) {
    const llmstxtContent = llmstxt?.content;
    if (llmstxtContent) {
      // Truncate to first 600 chars to keep the prompt readable
      const preview = llmstxtContent.length > 600
        ? llmstxtContent.slice(0, 600) + '\n[... full content in your downloaded llms.txt file]'
        : llmstxtContent;
      addSnippet('llmstxt',
        'Fix: Missing llms.txt file (AI models can\'t understand your site)',
        `In Lovable, type exactly this:

"Create a file at public/llms.txt with this exact content:

${preview}

This file tells AI models like ChatGPT and Claude what your site is about so they can recommend it accurately."`
      );
    } else {
      addSnippet('llmstxt',
        'Fix: Create an llms.txt file',
        `In Lovable, type exactly this:

"Create a file at public/llms.txt. The file should start with a # heading with your site name, then a > blockquote with a one-sentence description of your business, then sections for About, Services/Products, and Contact. Use plain markdown. This file helps AI models understand and recommend your site."`
      );
    }
  }

  // Metadata — missing title/description
  if (signals?.metadata?.score < 5) {
    addSnippet('metadata',
      'Fix: Missing or weak page title and meta description',
      `In Lovable, type exactly this:

"Update the <head> section of index.html with a specific page title and meta description for ${domain ?? 'this site'}. The title should be under 60 characters and name your business plus what you do (example: 'Acme Dental — Implants & Cosmetic Dentistry in Austin'). The meta description should be 120–160 characters and answer 'what does this business do and who is it for?'. Also add og:title and og:description tags with the same content."`
    );
  }

  // Content — not answer-first
  if (signals?.content?.score < 5) {
    addSnippet('content',
      'Fix: Opening paragraph doesn\'t answer customer questions directly',
      `In Lovable, type exactly this:

"Rewrite the opening paragraph of the homepage hero section so it answers the visitor's main question in the first sentence. The first sentence should state exactly what ${domain ?? 'this business'} does and who it helps. Avoid starting with a tagline, a question, or vague statements like 'We believe in...' or 'Welcome to...'. AI citation engines rank pages higher when the answer appears in the first 50 words."`
    );
  }

  // E-E-A-T — missing brand trust signals
  if (signals?.eeat?.score < 5) {
    addSnippet('eeat',
      'Fix: Missing brand trust signals (no About, author, or contact)',
      `In Lovable, type exactly this:

"Add three trust signals to this site: (1) an About page or section that names the people behind the business and their credentials or experience, (2) visible author attribution on any blog posts or articles (name + title), and (3) a contact method that is a real email address or phone number — not just a form. Link to these from the main navigation. These signals help AI engines decide whether to recommend your business."`
    );
  }

  return snippets;
}
