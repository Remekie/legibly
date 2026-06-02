/**
 * Generate fix file content for each stack type.
 * Each fix returns { path, content, message } — ready to commit via GitHub API.
 */

export function buildFixes({ stack, hasViteSsg, llmstxt, schemaRecs, domain }) {
  const fixes = [];

  // llms.txt — universal, all stacks
  if (llmstxt?.content) {
    fixes.push({
      path:    'public/llms.txt',
      content: llmstxt.content,
      message: 'Add llms.txt — plain-language guide for AI engines',
    });
  }

  // robots.txt — universal
  fixes.push({
    path:    'public/robots.txt',
    content: buildRobotsTxt(),
    message: 'Update robots.txt — allow AI crawlers (GPTBot, ClaudeBot, PerplexityBot)',
  });

  // Schema JSON-LD injection — universal (injected into index.html)
  const primarySchema = schemaRecs?.recommendations?.[0];
  if (primarySchema) {
    fixes.push({
      path:    'legibly-schema.json',
      content: primarySchema.snippet,
      message: `Add ${primarySchema.type} structured data schema`,
      note:    `Paste contents of this file inside a <script type="application/ld+json"> tag in your index.html <head>`,
    });
  }

  // Vite-specific: add vite-ssg for SPA pre-rendering
  if (stack === 'vite' && !hasViteSsg) {
    fixes.push({
      path:    'vite.config.patch.js',
      content: buildViteConfigPatch(),
      message: 'Add vite-ssg — pre-render site so AI crawlers see real HTML (not a blank React shell)',
      note:    'Merge this into your vite.config.js and run: npm install vite-ssg',
    });
  }

  return fixes;
}

function buildRobotsTxt() {
  return `# Allow all AI crawlers — required for AI search visibility
User-agent: *
Allow: /

User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: OAI-SearchBot
Allow: /
`;
}

function buildViteConfigPatch() {
  return `// Add this to your vite.config.js
// First run: npm install vite-ssg

import { ViteSSG } from 'vite-ssg'

// In your main.js/main.ts, change:
//   createApp(App).mount('#app')
// To:
//   export const createApp = ViteSSG(App)

// In vite.config.js, add to plugins array:
// ssgOptions: {
//   script: 'async',
//   formatting: 'minify',
// }

// This pre-renders your site so AI crawlers see real HTML
// instead of a blank <div id="root"></div> shell.
// See: https://github.com/antfu/vite-ssg
`;
}
